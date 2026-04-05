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
  chatCompletionStream,
  createVisionMessage,
  type Message,
  type MessageContent,
  type ServerConfig,
  type StreamDelta,
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
import { compileContext, setMemorySearchCallback } from './context-compiler.js'
import { repairToolCall } from './tool-repair.js'
import { enforceCapability } from './capabilities.js'
import { lookupError, recordError, recordSolution } from './error-db.js'

const MAX_TOOL_ROUNDS = 30 // Safety limit on consecutive tool-call rounds

/**
 * Strip Gemma 4 thinking tokens from model output.
 * Thinking blocks look like: <|channel>thought\n...<channel|>
 * Per Gemma docs, multi-turn history should only include the final response.
 */
function stripThinking(text: string): string {
  return text.replace(/<\|channel>thought\n[\s\S]*?<channel\|>/g, '').trim()
}

export interface AgentOptions {
  stream?: boolean
  config: ServerConfig
  abortSignal?: AbortSignal
  /** Check for queued user messages between tool rounds. */
  getQueuedMessage?: () => string | null
  onText?: (text: string) => void
  onToolStart?: (name: string, args: Record<string, unknown>) => void
  onToolEnd?: (name: string, result: string) => void
  /** Called with streaming tool call argument chunks — for live code display */
  onToolCallDelta?: (name: string, chunk: string) => void
  /** Called when a tool call is fully received (before execution) */
  onToolCallComplete?: () => void
  /** Called when memory/knowledge search events happen */
  onMemoryEvent?: (event: string) => void
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
/**
 * Stream a chat completion, yielding tool call deltas for live code display.
 * Returns the final assembled message (same shape as chatCompletion).
 */
async function streamToMessage(
  messages: Message[],
  tools: any[],
  config: ServerConfig,
  onToolCallDelta?: (name: string, chunk: string) => void,
  onToolCallComplete?: () => void,
  onText?: (text: string) => void,
  streamText = true,
): Promise<Message> {
  // If no live display callbacks, fall back to non-streaming (faster)
  if (!onToolCallDelta) {
    return chatCompletion(messages, tools, config)
  }

  let content = ''
  let toolCalls: any[] | undefined

  for await (const delta of chatCompletionStream(messages, tools, config)) {
    if (delta.type === 'text' && delta.text) {
      content += delta.text
      // Don't stream text here — agent.ts handles it after stripThinking
    }
    if (delta.type === 'tool_call_delta' && delta.toolCallDelta) {
      onToolCallDelta(delta.toolCallDelta.name, delta.toolCallDelta.argumentChunk)
    }
    if (delta.type === 'tool_calls' && delta.toolCalls) {
      toolCalls = delta.toolCalls
      onToolCallComplete?.()
    }
    if (delta.type === 'error') {
      throw new Error(delta.error)
    }
  }

  return {
    role: 'assistant',
    content: content || null,
    tool_calls: toolCalls,
  }
}

export async function runAgent(
  conversation: Message[],
  userMessage: string,
  options: AgentOptions = {},
): Promise<string> {
  const {
    stream = true,
    config,
    abortSignal,
    getQueuedMessage,
    onText,
    onToolStart,
    onToolEnd,
    onToolCallDelta,
    onToolCallComplete,
    onMemoryEvent,
  } = options

  // Attach abort signal to config so chatCompletion can use it
  const configWithAbort = abortSignal ? { ...config, abortSignal } : config

  // Log the user message
  logEvent('user_message', 'user', { content: userMessage })

  // Check if user is reporting an error — look up known fixes
  let errorHint = ''
  if (/error|Error|ERR|failed|Failed|FAIL|crash|Crash|cannot|Cannot|not found|not provide|unexpected|Uncaught|SyntaxError|TypeError|ReferenceError/i.test(userMessage)) {
    onMemoryEvent?.('🔍 Checking error database...')
    const knownFix = lookupError(userMessage, 'user-reported')
    if (knownFix && knownFix.confidence >= 0.3) {
      onMemoryEvent?.(`💡 Found known fix (${Math.round(knownFix.confidence * 100)}% confidence)`)
      errorHint = `\n\n[Ghost Memory] I've seen this error before. Known fix (${Math.round(knownFix.confidence * 100)}% confidence): ${knownFix.solution}`
    } else {
      onMemoryEvent?.('🔍 No known fix — will diagnose fresh')
    }
  }

  // Add user message to the raw conversation (ground truth)
  const fullMessage = errorHint ? userMessage + errorHint : userMessage
  conversation.push({ role: 'user', content: fullMessage })

  // Wire memory search visibility
  setMemorySearchCallback(onMemoryEvent || null)

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

    // Check if aborted (Ctrl+C or "stop")
    if (abortSignal?.aborted) {
      conversation.push({ role: 'assistant', content: '(Stopped by user)' })
      return '(Stopped)'
    }

    // Check for queued user messages — inject them into the conversation
    // so the model sees them on the next turn (user can redirect mid-work)
    if (getQueuedMessage) {
      const queued = getQueuedMessage()
      if (queued) {
        // Check if user wants to stop
        const lower = queued.toLowerCase().trim()
        if (lower === 'stop' || lower === 'cancel' || lower === 'abort') {
          conversation.push({ role: 'user', content: queued })
          conversation.push({ role: 'assistant', content: '(Stopped by user)' })
          return '(Stopped)'
        }
        // Otherwise inject the message — model will see it and can respond
        conversation.push({
          role: 'user',
          content: `[Interjection while you were working]: ${queued}`,
        })
        logEvent('user_message', 'user', { content: queued, interjection: true })
      }
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

    // Call the model with streaming — enables live code display
    let msg: Message
    try {
      msg = await streamToMessage(compiledContext, tools, configWithAbort, onToolCallDelta, onToolCallComplete, onText, stream)
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
        const failed = await executeToolCall(conversation, tc, onToolStart, onToolEnd, onMemoryEvent)
        if (failed) {
          roundHadFailure = true
          if (tc.function.name === lastFailedTool) {
            consecutiveFailures++
          } else {
            consecutiveFailures = 1
            lastFailedTool = tc.function.name
          }
        } else {
          // Success after a failure — record what worked as the solution
          if (lastFailedTool && consecutiveFailures > 0) {
            const successContext = `${tc.function.name}: ${tc.function.arguments.slice(0, 300)}`
            // Find the most recent error ID from previous tool calls
            const prevErrors = msg.tool_calls.filter((t: any) => t._errorId)
            for (const prev of prevErrors) {
              recordSolution((prev as any)._errorId, successContext)
            }
          }
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

    // Got a text response — strip thinking tokens, then stream to user
    const text = stripThinking(msg.content || '')
    if (stream && text) {
      const words = text.split(' ')
      for (let w = 0; w < words.length; w++) {
        onText?.((w > 0 ? ' ' : '') + words[w]!)
      }
    }

    // Store without thinking tokens per Gemma docs (multi-turn best practice)
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
        await executeToolCall(conversation, tc, onToolStart, onToolEnd, onMemoryEvent)
      }
      continue
    }

    if (!msg.content?.trim() && rounds > 1) {
      conversation.push({ role: 'user', content: 'Based on the image and tool results, please provide your answer now.' })
      emptyRetries++
      if (emptyRetries > 2) return '(The model did not produce a response.)'
      continue
    }

    const responseText = stripThinking((typeof msg.content === 'string' ? msg.content : '') || '')
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
  onMemoryEvent?: (event: string) => void,
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

    const isError = result.startsWith('Error') || result.includes('Exit code 1')

    if (isError) {
      // Record this error and check for known solutions
      onMemoryEvent?.('🔍 Checking error database...')
      const context = `${toolName}(${JSON.stringify(args).slice(0, 200)})`
      const errorId = recordError(truncated.slice(0, 500), toolName, context)
      const knownFix = lookupError(truncated, toolName)

      let content = truncated
      if (knownFix) {
        onMemoryEvent?.(`💡 Found known fix (${Math.round(knownFix.confidence * 100)}% confidence)`)
        content += `\n\n💡 Known fix (${Math.round(knownFix.confidence * 100)}% confidence): ${knownFix.solution}`
      } else {
        // Search beliefs for related knowledge about this error
        const { searchBeliefs } = await import('./knowledge/beliefs.js')
        const errorBeliefs = searchBeliefs(truncated.slice(0, 200), 3)
        if (errorBeliefs.length > 0) {
          onMemoryEvent?.(`🧠 Found ${errorBeliefs.length} related beliefs`)
          const hints = errorBeliefs.map(b => b.statement.slice(0, 150)).join('\n- ')
          content += `\n\n🧠 Related knowledge from memory:\n- ${hints}`
        }
      }

      conversation.push({ role: 'tool', content, tool_call_id: tc.id })
      logEvent('tool_result', 'agent', { tool: toolName, result: truncated.slice(0, 300), errorId })
      onToolEnd?.(toolName, truncated)

      // Store errorId so we can record the solution when the next call succeeds
      ;(tc as any)._errorId = errorId
    } else {
      conversation.push({ role: 'tool', content: truncated, tool_call_id: tc.id })
      logEvent('tool_result', 'agent', { tool: toolName, result: truncated.slice(0, 300) })
      onToolEnd?.(toolName, truncated)
    }

    return isError
  } catch (e: any) {
    const errorMsg = `Error executing ${toolName}: ${e.message}`
    const context = `${toolName}(${JSON.stringify(args).slice(0, 200)})`
    const errorId = recordError(errorMsg, toolName, context)
    const knownFix = lookupError(errorMsg, toolName)

    let content = errorMsg
    if (knownFix) {
      content += `\n\n💡 Known fix (${Math.round(knownFix.confidence * 100)}% confidence): ${knownFix.solution}`
    }

    conversation.push({ role: 'tool', content, tool_call_id: tc.id })
    logEvent('error', 'agent', { tool: toolName, message: e.message, errorId })
    onToolEnd?.(toolName, errorMsg)
    return true
  }
}

// Re-export ToolCall type for use in this module
type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}
