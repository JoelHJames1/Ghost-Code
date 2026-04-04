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
  type Message,
  type ServerConfig,
} from './api.js'
import { resolveConfig } from './config.js'
import { getToolSpecs, getTool, validateToolArgs } from './tools/index.js'
import { buildSystemPrompt, getEnvContext } from './context.js'
import { classifyOllamaError, errorKindMessage } from './errors.js'
import { pruneIfNeeded, estimateConversationTokens, getTokenBudget } from './context-window.js'

const MAX_TOOL_ROUNDS = 30 // Safety limit on consecutive tool-call rounds

export interface AgentOptions {
  stream?: boolean
  config: ServerConfig
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
export function refreshSystemPrompt(conversation: Message[]): void {
  const ctx = getEnvContext()
  conversation[0] = { role: 'system', content: buildSystemPrompt(ctx) }
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
    onText,
    onToolStart,
    onToolEnd,
  } = options

  // Refresh system prompt with current env state (git branch, etc.)
  refreshSystemPrompt(conversation)

  // Add user message
  conversation.push({ role: 'user', content: userMessage })

  const tools = getToolSpecs()
  let rounds = 0
  let emptyRetries = 0
  let consecutiveFailures = 0
  let lastFailedTool = ''

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++

    // Prune conversation if approaching context window limits
    pruneIfNeeded(conversation, config.model)

    // Call the model with error classification and retry
    let msg: Message
    try {
      msg = await chatCompletion(conversation, tools, config)
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
 * Execute a tool call and append the result to the conversation.
 * Returns true if the tool call resulted in an error.
 */
async function executeToolCall(
  conversation: Message[],
  tc: ToolCall,
  onToolStart?: (name: string, args: Record<string, unknown>) => void,
  onToolEnd?: (name: string, result: string) => void,
): Promise<boolean> {
  const toolName = tc.function.name
  let args: Record<string, unknown> = {}

  try {
    args = JSON.parse(tc.function.arguments || '{}')
  } catch {
    const result = `Error: Invalid JSON arguments for tool "${toolName}"`
    conversation.push({ role: 'tool', content: result, tool_call_id: tc.id })
    onToolEnd?.(toolName, result)
    return true
  }

  const tool = getTool(toolName)
  if (!tool) {
    const result = `Error: Unknown tool "${toolName}"`
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

  onToolStart?.(toolName, args)

  try {
    const result = await tool.execute(args)
    // Truncate very large results to avoid context overflow
    const maxLen = 50000
    const truncated =
      result.length > maxLen
        ? result.slice(0, maxLen) + `\n\n... (truncated, ${result.length - maxLen} chars omitted)`
        : result
    conversation.push({ role: 'tool', content: truncated, tool_call_id: tc.id })
    onToolEnd?.(toolName, truncated)
    return result.startsWith('Error')
  } catch (e: any) {
    const result = `Error executing ${toolName}: ${e.message}`
    conversation.push({ role: 'tool', content: result, tool_call_id: tc.id })
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
