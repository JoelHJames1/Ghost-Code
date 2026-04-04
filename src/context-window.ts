/**
 * Context window management — token estimation and conversation pruning.
 *
 * Uses a simple char-based heuristic (4 chars ≈ 1 token) with a 20% safety
 * margin, inspired by OpenClaw's compaction system.
 */

import type { Message } from './api.js'

const CHARS_PER_TOKEN = 4
const SAFETY_MARGIN = 1.2

/** Known context windows for common Ollama models (in tokens). */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gemma4:31b': 131072,
  'gemma4:12b': 131072,
  'gemma4': 131072,
  'gemma3': 131072,
  'gemma2': 8192,
  'qwen3.5:0.8b': 32768,
  'qwen3.5:4b': 32768,
  'qwen3.5:9b': 32768,
  'qwen3.5:14b': 32768,
  'qwen3.5:32b': 32768,
  'qwen3': 32768,
  'qwen2.5': 32768,
  'llama3': 8192,
  'llama3.1': 131072,
  'llama3.2': 131072,
  'llama3.3': 131072,
  'mistral': 32768,
  'mixtral': 32768,
  'codellama': 16384,
  'deepseek-coder': 16384,
  'deepseek-coder-v2': 131072,
  'phi3': 4096,
  'phi4': 16384,
  'gemma2': 8192,
  'starcoder2': 16384,
}

const DEFAULT_CONTEXT_WINDOW = 32768

/**
 * Get the context window size for a model (in tokens).
 * Matches by prefix (e.g., "gemma4" matches "gemma4:31b").
 */
export function getModelContextWindow(model: string): number {
  // Exact match first
  if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model]!

  // Prefix match (without tag)
  const base = model.split(':')[0]!
  if (MODEL_CONTEXT_WINDOWS[base]) return MODEL_CONTEXT_WINDOWS[base]!

  // Try progressively shorter prefixes
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (model.startsWith(key) || key.startsWith(base)) return value
  }

  return DEFAULT_CONTEXT_WINDOW
}

/**
 * Estimate token count for a message using char-based heuristic.
 */
export function estimateMessageTokens(msg: Message): number {
  let chars = 0
  if (msg.content) chars += msg.content.length
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      chars += tc.function.name.length + tc.function.arguments.length
    }
  }
  // Add overhead for role, formatting
  chars += 10
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

/**
 * Estimate total tokens for a conversation.
 */
export function estimateConversationTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
}

/**
 * Get the effective token budget (context window minus safety margin).
 */
export function getTokenBudget(model: string): number {
  return Math.floor(getModelContextWindow(model) / SAFETY_MARGIN)
}

/**
 * Prune a conversation to fit within a token budget.
 *
 * Strategy:
 * - Always keep the system prompt (index 0)
 * - Always keep the most recent messages (last N turns)
 * - Remove oldest messages from the middle
 * - Insert a synthetic marker where messages were removed
 *
 * Returns the pruned conversation (mutates in place).
 */
export function pruneConversation(
  messages: Message[],
  maxTokens: number,
): Message[] {
  const currentTokens = estimateConversationTokens(messages)
  if (currentTokens <= maxTokens) return messages

  // Always preserve: system prompt (0) + at least last 6 messages
  const MIN_KEEP_TAIL = 6
  const systemMsg = messages[0]!

  // If even the system prompt + tail exceeds budget, keep system + last 4
  if (messages.length <= MIN_KEEP_TAIL + 1) {
    // Can't prune further
    return messages
  }

  // Binary search for how many middle messages to remove
  let removeCount = 0
  const tail = Math.min(MIN_KEEP_TAIL, messages.length - 1)

  for (let i = 1; i <= messages.length - tail - 1; i++) {
    const pruned = [
      systemMsg,
      {
        role: 'system' as const,
        content: `[Earlier conversation pruned to fit context window. ${i} messages removed.]`,
      },
      ...messages.slice(1 + i),
    ]
    if (estimateConversationTokens(pruned) <= maxTokens) {
      removeCount = i
      break
    }
  }

  // If we couldn't fit even after removing all middle messages, remove as much as possible
  if (removeCount === 0) {
    removeCount = messages.length - tail - 1
  }

  if (removeCount <= 0) return messages

  // Mutate the array in place
  const marker: Message = {
    role: 'system',
    content: `[Earlier conversation pruned to fit context window. ${removeCount} messages removed.]`,
  }
  messages.splice(1, removeCount, marker)

  return messages
}

/**
 * Check if conversation needs pruning and prune if necessary.
 * Returns true if pruning was performed.
 */
export function pruneIfNeeded(messages: Message[], model: string): boolean {
  const budget = getTokenBudget(model)
  const tokens = estimateConversationTokens(messages)
  if (tokens <= budget) return false
  pruneConversation(messages, budget)
  return true
}
