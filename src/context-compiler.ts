/**
 * Context compiler — assembles the model prompt from a token budget.
 *
 * Instead of ad-hoc injection, this module allocates the context window
 * into explicit slices with priorities:
 *
 *   1. System prompt (fixed, non-negotiable)
 *   2. Pinned invariants: goal anchor, task plan, scratchpad
 *   3. Retrieved memories (vector search results)
 *   4. Recent conversation (sliding window)
 *   5. Recovery instructions
 *
 * Each slice has a budget and priority. If the total exceeds the window,
 * lower-priority slices are compressed or dropped first.
 *
 * This is the OS-inspired "virtual context management" pattern:
 * the context window is like RAM, and we page in/out from external stores.
 */

import type { Message } from './api.js'
import { estimateConversationTokens, getTokenBudget } from './context-window.js'
import { buildSystemPrompt, getEnvContext } from './context.js'
import { formatTaskListForPrompt, getTaskList, loadPersistedTasks } from './tasks.js'
import { formatScratchpadForPrompt } from './scratchpad.js'
import { searchMemories } from './memory.js'
import { searchEpisodes, formatEpisodesForContext } from './episodes.js'

const CHARS_PER_TOKEN = 4

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

// ── Budget allocation (% of total budget) ────────────────────────────────

interface BudgetConfig {
  systemPrompt: number      // ~15% — instructions, tools, environment
  pinnedState: number        // ~20% — goal, tasks, scratchpad
  retrievedMemory: number    // ~10% — vector search results
  conversation: number       // ~50% — recent messages
  recovery: number           // ~5%  — instructions for self-recovery
}

const DEFAULT_BUDGET: BudgetConfig = {
  systemPrompt: 0.15,
  pinnedState: 0.20,
  retrievedMemory: 0.10,
  conversation: 0.50,
  recovery: 0.05,
}

// ── Context slice ────────────────────────────────────────────────────────

interface ContextSlice {
  name: string
  priority: number          // 1 = highest (never drop), 5 = lowest
  content: Message[]
  tokenEstimate: number
  budget: number            // max tokens allocated
}

/**
 * Compile the full context for a model call.
 *
 * Takes the raw conversation, current state, and a query,
 * and returns a token-budgeted message array ready for the model.
 *
 * This is called before EVERY model call to ensure optimal context usage.
 */
export function compileContext(
  rawConversation: Message[],
  model: string,
  currentQuery?: string,
  budgetOverrides?: Partial<BudgetConfig>,
): Message[] {
  const totalBudget = getTokenBudget(model)
  const budget = { ...DEFAULT_BUDGET, ...budgetOverrides }

  // ── 1. System prompt (priority 1 — never dropped) ──────────────────
  const ctx = getEnvContext()
  const systemPromptText = buildSystemPrompt(ctx, currentQuery)
  const systemPromptTokens = estimateTokens(systemPromptText)
  const systemSlice: Message[] = [{ role: 'system', content: systemPromptText }]

  // ── 2. Pinned state (priority 2 — compress before dropping) ────────
  const pinnedBudget = Math.floor(totalBudget * budget.pinnedState)
  const pinnedParts: string[] = []

  // Goal anchor: find the first non-system user message
  const firstUserMsg = rawConversation.find(m => m.role === 'user' && typeof m.content === 'string')
  if (firstUserMsg && typeof firstUserMsg.content === 'string') {
    pinnedParts.push(`## Original Goal\n${firstUserMsg.content}`)
  }

  // Task plan
  if (!getTaskList()) loadPersistedTasks()
  const taskPrompt = formatTaskListForPrompt()
  if (taskPrompt) pinnedParts.push(taskPrompt)

  // Scratchpad
  const scratchpad = formatScratchpadForPrompt()
  if (scratchpad) pinnedParts.push(scratchpad)

  // Assemble pinned content within budget
  let pinnedText = pinnedParts.join('\n\n')
  const pinnedTokens = estimateTokens(pinnedText)
  if (pinnedTokens > pinnedBudget) {
    // Truncate scratchpad first (it's the most compressible)
    pinnedText = pinnedText.slice(0, pinnedBudget * CHARS_PER_TOKEN)
  }

  const pinnedSlice: Message[] = pinnedText
    ? [{ role: 'system', content: pinnedText }]
    : []

  // ── 3. Retrieved memories + episodes (priority 3) ───────────────────
  // Two-source hybrid retrieval:
  //   a) Episode search with temporal contiguity (structured episodic memory)
  //   b) Flat memory search (general facts and compaction summaries)
  const memBudget = Math.floor(totalBudget * budget.retrievedMemory)
  let memSlice: Message[] = []

  if (currentQuery) {
    let memText = ''
    let memTokens = 0

    // (a) Episode retrieval with contiguity buffers
    // Finds relevant episodes and pulls temporal neighbors for causal context
    const episodes = searchEpisodes(currentQuery, 4, 1)
    if (episodes.length > 0) {
      const epText = formatEpisodesForContext(episodes, Math.floor(memBudget * CHARS_PER_TOKEN * 0.6))
      memText += epText
      memTokens += estimateTokens(epText)
    }

    // (b) Flat memory search (fills remaining budget)
    const remainingBudget = memBudget - memTokens
    if (remainingBudget > 50) {
      const results = searchMemories(currentQuery, 5)
      if (results.length > 0) {
        memText += '## Relevant facts\n'
        memTokens += estimateTokens('## Relevant facts\n')

        for (const r of results) {
          const line = `- [${r.timestamp.split('T')[0]}] ${r.summary}\n`
          const lineTokens = estimateTokens(line)
          if (memTokens + lineTokens > memBudget) break
          memText += line
          memTokens += lineTokens
        }
      }
    }

    if (memText) {
      memSlice = [{ role: 'system', content: memText }]
    }
  }

  // ── 4. Conversation window (priority 4 — largest slice) ────────────
  const convBudget = Math.floor(totalBudget * budget.conversation)

  // Take messages from the raw conversation (skip system, skip already-pinned first user msg)
  const conversationMessages = rawConversation.filter(m => m.role !== 'system')

  // Fill from the END (most recent first) until we hit the budget
  let convTokens = 0
  let convStartIdx = conversationMessages.length
  for (let i = conversationMessages.length - 1; i >= 0; i--) {
    const msg = conversationMessages[i]!
    const msgTokens = estimateTokens(
      typeof msg.content === 'string' ? msg.content || '' : JSON.stringify(msg.content || '')
    ) + (msg.tool_calls ? estimateTokens(JSON.stringify(msg.tool_calls)) : 0)

    if (convTokens + msgTokens > convBudget) break
    convTokens += msgTokens
    convStartIdx = i
  }

  const convSlice = conversationMessages.slice(convStartIdx)

  // ── 5. Recovery instructions (priority 5 — smallest) ───────────────
  const recoveryText = 'Stay focused on the Original Goal. Update tasks as you complete them. Write findings to Scratchpad.'
  const recoverySlice: Message[] = [{ role: 'system', content: recoveryText }]

  // ── Assemble final context ─────────────────────────────────────────
  const compiled: Message[] = [
    ...systemSlice,       // System prompt first
    ...memSlice,          // Retrieved memories
    ...convSlice,         // Conversation window
    ...pinnedSlice,       // Pinned state (near end for high attention)
    ...recoverySlice,     // Recovery instructions (last)
  ]

  return compiled
}

/**
 * Get budget allocation stats for display.
 */
export function getBudgetStats(
  model: string,
  conversationLength: number,
): {
  totalBudget: number
  slices: Array<{ name: string; budget: number; pct: string }>
} {
  const totalBudget = getTokenBudget(model)
  const budget = DEFAULT_BUDGET
  return {
    totalBudget,
    slices: [
      { name: 'System prompt', budget: Math.floor(totalBudget * budget.systemPrompt), pct: `${budget.systemPrompt * 100}%` },
      { name: 'Pinned state', budget: Math.floor(totalBudget * budget.pinnedState), pct: `${budget.pinnedState * 100}%` },
      { name: 'Retrieved memory', budget: Math.floor(totalBudget * budget.retrievedMemory), pct: `${budget.retrievedMemory * 100}%` },
      { name: 'Conversation', budget: Math.floor(totalBudget * budget.conversation), pct: `${budget.conversation * 100}%` },
      { name: 'Recovery', budget: Math.floor(totalBudget * budget.recovery), pct: `${budget.recovery * 100}%` },
    ],
  }
}
