/**
 * API client — uses the OpenAI-compatible /v1/chat/completions endpoint.
 * Works with both llama-server (default) and Ollama as backends.
 * Includes streaming, tool calling, and retry logic.
 */

import { retryWithBackoff } from './errors.js'

export interface Tool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | MessageContent[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

/** Multimodal content block (text or image) for vision support. */
export interface MessageContent {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export interface StreamDelta {
  type: 'text' | 'tool_calls' | 'done' | 'error'
  text?: string
  toolCalls?: ToolCall[]
  error?: string
}

export interface ServerConfig {
  baseUrl: string
  model: string
  requestTimeoutMs?: number
}

/**
 * Send a chat completion request with tool definitions.
 * Returns the full assistant message (non-streaming).
 */
export async function chatCompletion(
  messages: Message[],
  tools: Tool[],
  config: ServerConfig,
): Promise<Message> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: false,
  }
  if (tools.length > 0) {
    body.tools = tools
  }

  const timeoutMs = config.requestTimeoutMs || 120_000

  return retryWithBackoff(async () => {
    const res = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!res.ok) {
      const text = await res.text()
      const err = new Error(`API error ${res.status}: ${text}`) as any
      err.status = res.status
      throw err
    }

    const data = (await res.json()) as {
      choices: Array<{
        message: {
          role: string
          content: string | null
          tool_calls?: Array<{
            id: string
            type: string
            function: { name: string; arguments: string }
          }>
        }
      }>
    }

    const choice = data.choices[0]
    if (!choice) throw new Error('No response from model')

    return {
      role: 'assistant' as const,
      content: choice.message.content,
      tool_calls: choice.message.tool_calls as ToolCall[] | undefined,
    }
  })
}

/**
 * Send a streaming chat completion. Yields text chunks as they arrive.
 * For tool calls, collects them and yields a final tool_calls delta.
 */
export async function* chatCompletionStream(
  messages: Message[],
  tools: Tool[],
  config: ServerConfig,
): AsyncGenerator<StreamDelta> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
  }
  if (tools.length > 0) {
    body.tools = tools
  }

  const timeoutMs = config.requestTimeoutMs || 120_000
  const res = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!res.ok) {
    const text = await res.text()
    yield { type: 'error', error: `API error ${res.status}: ${text}` }
    return
  }

  const reader = res.body?.getReader()
  if (!reader) {
    yield { type: 'error', error: 'No response body' }
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  const collectedToolCalls: Map<number, ToolCall> = new Map()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data: ')) continue

        try {
          const json = JSON.parse(trimmed.slice(6)) as {
            choices: Array<{
              delta: {
                content?: string | null
                tool_calls?: Array<{
                  index: number
                  id?: string
                  type?: string
                  function?: { name?: string; arguments?: string }
                }>
              }
              finish_reason?: string | null
            }>
          }

          const delta = json.choices[0]?.delta
          if (!delta) continue

          // Stream text content
          if (delta.content) {
            yield { type: 'text', text: delta.content }
          }

          // Collect tool calls incrementally
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = collectedToolCalls.get(tc.index)
              if (existing) {
                if (tc.function?.arguments) {
                  existing.function.arguments += tc.function.arguments
                }
              } else {
                collectedToolCalls.set(tc.index, {
                  id: tc.id || `call_${tc.index}_${Date.now()}`,
                  type: 'function',
                  function: {
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  },
                })
              }
            }
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  // Yield collected tool calls if any
  if (collectedToolCalls.size > 0) {
    yield {
      type: 'tool_calls',
      toolCalls: Array.from(collectedToolCalls.values()),
    }
  }

  yield { type: 'done' }
}

/**
 * Create a vision message with an image.
 * Encodes a local file as a base64 data URL.
 */
export function createVisionMessage(text: string, imagePath: string): Message {
  const { readFileSync } = require('fs')
  const imageData = readFileSync(imagePath)
  const base64 = imageData.toString('base64')
  const ext = imagePath.split('.').pop()?.toLowerCase() || 'png'
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'png' ? 'image/png'
    : ext === 'gif' ? 'image/gif'
    : ext === 'webp' ? 'image/webp'
    : 'image/png'

  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
    ],
  }
}
