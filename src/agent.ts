/**
 * Agent loop — the core agentic execution cycle.
 *
 * 1. Refresh system prompt with current environment state
 * 2. Prune conversation if approaching context window limits
 * 3. Send conversation to model with tool definitions
 * 4. If model returns tool_calls → execute each tool → append results → goto 2
 * 5. If model returns text → display to user → done
 *
 * Includes error classification, retry logic, context pruning,
 * and self-correction nudges on repeated tool failures.
 */

import {
  chatCompletion,
  createVisionMessage,
  type Message,
  type MessageContent,
  type ServerConfig,
} from './api.js'
import { resolveConfig } from './config.js'
import { getToolSpecs, getTool, getToolNames, validateToolArgs } from './tools/index.js'
import { buildSystemPrompt, getEnvContext } from './context.js'
import { classifyOllamaError, errorKindMessage } from './errors.js'
import { pruneIfNeeded, estimateConversationTokens, getTokenBudget } from './context-window.js'
import { smartCompact } from './memory.js'
import { formatTaskListForPrompt, loadPersistedTasks, getTaskList } from './tasks.js'
import { formatScratchpadForPrompt } from './scratchpad.js'
import { saveCheckpoint } from './checkpoint.js'
import { logEvent } from './eventlog.js'
import { compileContext } from './context-compiler.js'
import { repairToolCall } from './tool-repair.js'
import { enforceCapability } from './capabilities.js'

const MAX_TOOL_ROUNDS = 30 // Safety limit on consecutive tool-call rounds

export interface AgentOptions {
  stream?: boolean
  config: ServerConfig
  abortSignal?: AbortSignal
  onText?: (text: string) => void
  onToolStart?: (name: string, args: Record<string, unknown>) => void
  onToolEnd?: (name: string, result: string) => void
}

/**
 * Create a new conversation with system prompt.
 */
export function createConversation(): Message[] {
  const ctx = getEnvContext()
  return [{ role: 'system', content: buildSystemPrompt(ctx) }]
}

/**
 * Refresh the system prompt in an existing conversation.
 */
export function refreshSystemPrompt(conversation: Message[], currentQuery?: string): void {
  const ctx = getEnvContext()
  conversation[0] = { role: 'system', content: buildSystemPrompt(ctx, currentQuery) }
}

/**
 * Run the agent loop for a single user message.
 * Appends the user message and all subsequent assistant/tool messages to the conversation.
 * Returns the final assistant text response.
 */
export async function runAgent(
  conversation: Message[],
  userMessage: string,
  options: AgentOptions = {},
): Promise<string> {
  const {
    stream = true,
    config,
    abortSignal,
    onText,
    onToolStart,
    onToolEnd,
  } = options

  // Attach abort signal to config so chatCompletion can use it
  const configWithAbort = abortSignal ? { ...config, abortSignal } : config

  // Log the user message
  logEvent('user_message', 'user', { content: userMessage })

  // Add user message to the raw conversation (ground truth)
  conversation.push({ role: 'user', content: userMessage })

  const goalAnchor = userMessage
  const tools = getToolSpecs()
  let rounds = 0
  let emptyRetries = 0
  let consecutiveFailures = 0
  let lastFailedTool = ''

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++

    // Compact raw conversation if it's getting large
    smartCompact(conversation, config.model)
    pruneIfNeeded(conversation, config.model)

    // Check if aborted before each round
    if (abortSignal?.aborted) {
      conversation.push({ role: 'assistant', content: '(Interrupted by user)' })
      return '(Interrupted)'
    }

    // CONTEXT COMPILER: build the optimal prompt from the token budget
    const compiledContext = compileContext(
      conversation,
      config.model,
      goalAnchor,
    )

    // Auto-checkpoint every 5 rounds
    if (rounds % 5 === 0 && rounds > 0) {
      saveCheckpoint(conversation, { goal: goalAnchor, round: rounds })
      logEvent('checkpoint', 'system', { round: rounds, goal: goalAnchor })
    }

    // Call the model with the COMPILED context (not raw conversation)
    let msg: Message
    try {
      msg = await chatCompletion(compiledContext, tools, configWithAbort)
    } catch (err) {
      const kind = classifyOllamaError(err)

      // On context overflow, force aggressive prune and retry once
      if (kind === 'context_overflow' && rounds <= MAX_TOOL_ROUNDS - 1) {
        const budget = getTokenBudget(config.model)
        pruneIfNeeded(conversation, config.model)
        // Try again after pruning — if still fails, surface the error
        try {
          msg = await chatCompletion(conversation, tools, config)
        } catch (retryErr) {
          throw new Error(errorKindMessage(classifyOllamaError(retryErr), String(retryErr)))
        }
      } else {
        throw new Error(errorKindMessage(kind, (err as Error).message || String(err)))
      }
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      conversation.push(msg)
      let roundHadFailure = false

      for (const tc of msg.tool_calls) {
        const failed = await executeToolCall(conversation, tc, onToolStart, onToolEnd)
        if (failed) {
          roundHadFailure = true
          if (tc.function.name === lastFailedTool) {
            consecutiveFailures++
          } else {
            consecutiveFailures = 1
            lastFailedTool = tc.function.name
          }
        } else {
          consecutiveFailures = 0
          lastFailedTool = ''
        }
      }

      // Self-correction nudge after repeated failures on the same tool
      if (consecutiveFailures >= 2) {
        conversation.push({
          role: 'user',
          content: `The last ${consecutiveFailures} "${lastFailedTool}" calls failed. Please re-read the file and try a different approach.`,
        })
        consecutiveFailures = 0
      }

      continue
    }

    // Empty response after tool use — nudge the model to summarize
    if (!msg.content?.trim() && rounds > 1) {
      // Build a more descriptive nudge
      const recentTools = conversation
        .slice(-10)
        .filter(m => m.role === 'tool')
        .map(m => (m.content || '').slice(0, 100))
      const hint = recentTools.length > 0
        ? `Recent tool results:\n${recentTools.map(r => `  - ${r}`).join('\n')}\n\nBased on these results, please provide your answer now.`
        : 'Based on the tool results above, please provide your answer now.'

      conversation.push({ role: 'user', content: hint })
      emptyRetries++
      if (emptyRetries > 2) {
        return '(The model did not produce a response. Try rephrasing your question.)'
      }
      continue
    }

    // Got a text response — stream it to the user if streaming is enabled
    const text = msg.content || ''
    if (stream && text) {
      const words = text.split(' ')
      for (let w = 0; w < words.length; w++) {
        onText?.((w > 0 ? ' ' : '') + words[w]!)
      }
    }

    conversation.push({ role: 'assistant', content: text })
    return text
  }

  return '(Agent reached maximum tool call rounds. Stopping.)'
}

/**
 * Run the agent loop with an image attachment (vision).
 * The image is sent as a multimodal content block alongside the text prompt.
 */
export async function runAgentWithImage(
  conversation: Message[],
  text: string,
  imagePath: string,
  options: AgentOptions,
): Promise<string> {
  refreshSystemPrompt(conversation)

  // Build multimodal message
  const visionMsg = createVisionMessage(text, imagePath)
  conversation.push(visionMsg)

  const {
    stream = true,
    config,
    onText,
    onToolStart,
    onToolEnd,
  } = options

  const tools = getToolSpecs()
  let rounds = 0
  let emptyRetries = 0

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++
    pruneIfNeeded(conversation, config.model)

    let msg: Message
    try {
      msg = await chatCompletion(conversation, tools, config)
    } catch (err) {
      const kind = classifyOllamaError(err)
      throw new Error(errorKindMessage(kind, (err as Error).message || String(err)))
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      conversation.push(msg)
      for (const tc of msg.tool_calls) {
        await executeToolCall(conversation, tc, onToolStart, onToolEnd)
      }
      continue
    }

    if (!msg.content?.trim() && rounds > 1) {
      conversation.push({ role: 'user', content: 'Based on the image and tool results, please provide your answer now.' })
      emptyRetries++
      if (emptyRetries > 2) return '(The model did not produce a response.)'
      continue
    }

    const responseText = (typeof msg.content === 'string' ? msg.content : '') || ''
    if (stream && responseText) {
      const words = responseText.split(' ')
      for (let w = 0; w < words.length; w++) {
        onText?.((w > 0 ? ' ' : '') + words[w]!)
      }
    }

    conversation.push({ role: 'assistant', content: responseText })
    return responseText
  }

  return '(Agent reached maximum tool call rounds. Stopping.)'
}

/**
 * Execute a tool call and append the result to the conversation.
 * Returns true if the tool call resulted in an error.
 */
async function executeToolCall(
  conversation: Message[],
  tc: ToolCall,
  onToolStart?: (name: string, args: Record<string, unknown>) => void,
  onToolEnd?: (name: string, result: string) => void,
): Promise<boolean> {
  // Repair pipeline: fix tool name and malformed JSON before failing
  const { name: toolName, args, repaired } = repairToolCall(
    tc.function.name,
    tc.function.arguments || '{}',
  )

  if (repaired) {
    logEvent('tool_call', 'system', {
      tool: toolName,
      originalName: tc.function.name,
      repaired: true,
      args: JSON.stringify(args).slice(0, 200),
    })
  }

  const tool = getTool(toolName)
  if (!tool) {
    const result = `Error: Unknown tool "${toolName}". Available: ${getToolNames().join(', ')}`
    conversation.push({ role: 'tool', content: result, tool_call_id: tc.id })
    onToolEnd?.(toolName, result)
    return true
  }

  // Validate required arguments
  const validationError = validateToolArgs(toolName, args)
  if (validationError) {
    conversation.push({ role: 'tool', content: validationError, tool_call_id: tc.id })
    onToolEnd?.(toolName, validationError)
    return true
  }

  // Capability gating: check if this tool call is allowed by security policy
  const capCheck = await enforceCapability(toolName, args)
  if (!capCheck.proceed) {
    const result = `BLOCKED by security policy: ${capCheck.reason}`
    conversation.push({ role: 'tool', content: result, tool_call_id: tc.id })
    logEvent('error', 'security', { tool: toolName, reason: capCheck.reason })
    onToolEnd?.(toolName, result)
    return true
  }

  onToolStart?.(toolName, args)
  logEvent('tool_call', 'agent', { tool: toolName, args: JSON.stringify(args).slice(0, 500) })

  try {
    const result = await tool.execute(args)
    const maxLen = 50000
    const truncated =
      result.length > maxLen
        ? result.slice(0, maxLen) + `\n\n... (truncated, ${result.length - maxLen} chars omitted)`
        : result
    conversation.push({ role: 'tool', content: truncated, tool_call_id: tc.id })
    logEvent('tool_result', 'agent', { tool: toolName, result: truncated.slice(0, 300) })
    onToolEnd?.(toolName, truncated)
    return result.startsWith('Error')
  } catch (e: any) {
    const result = `Error executing ${toolName}: ${e.message}`
    conversation.push({ role: 'tool', content: result, tool_call_id: tc.id })
    logEvent('error', 'agent', { tool: toolName, message: e.message })
    onToolEnd?.(toolName, result)
    return true
  }
}

// Re-export ToolCall type for use in this module
type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
