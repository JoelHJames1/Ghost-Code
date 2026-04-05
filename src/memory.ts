/**
 * Conversation memory with semantic compaction.
 *
 * When the context window fills up, instead of just dropping old messages,
 * we summarize them into compact memory entries that preserve key information
 * while using far fewer tokens.
 *
 * Memory flow:
 * 1. Agent loop runs normally, conversation grows
 * 2. Before each model call, check token usage
 * 3. If over 70% of budget → compact old messages into summaries
 * 4. If over 90% of budget → aggressive compaction, keep only recent + summaries
 * 5. Summaries are stored as system messages in the conversation
 *
 * For persistent memory across sessions, we use a simple JSON file
 * at ~/.local/share/ghost-code/memory.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Message } from './api.js'
import { estimateMessageTokens, estimateConversationTokens, getTokenBudget } from './context-window.js'
import { cachedSearch, clearSearchCache, type SearchDocument, type SearchFilter } from './vectorsearch.js'
import { logEvent } from './eventlog.js'
import { segmentAndStore } from './episodes.js'

// ── Thresholds ───────────────────────────────────────────────────────────

const COMPACT_THRESHOLD = 0.60   // Start compacting at 60% of budget
const AGGRESSIVE_THRESHOLD = 0.85 // Aggressive compaction at 85%
const MIN_RECENT_MESSAGES = 8     // Always keep at least this many recent messages

// ── Persistent memory ────────────────────────────────────────────────────

interface MemoryEntry {
  timestamp: string
  summary: string
  project?: string
  tags?: string[]
  status?: 'active' | 'superseded'    // Fact supersession
  supersededBy?: string                // ID of replacing entry
  id?: string                          // For linking supersession
}

interface MemoryStore {
  entries: MemoryEntry[]
}

function getMemoryPath(): string {
  const dir = join(homedir(), '.local', 'share', 'ghost-code')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'memory.json')
}

function loadMemory(): MemoryStore {
  const path = getMemoryPath()
  try {
    if (!existsSync(path)) return { entries: [] }
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return { entries: [] }
  }
}

function saveMemory(store: MemoryStore): void {
  const path = getMemoryPath()
  writeFileSync(path, JSON.stringify(store, null, 2) + '\n', 'utf-8')
}

/**
 * Add a memory entry from a conversation summary.
 */
export function addMemory(summary: string, project?: string): string {
  const store = loadMemory()
  const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  store.entries.push({
    id,
    timestamp: new Date().toISOString(),
    summary,
    project,
    status: 'active',
  })
  // Keep max 100 entries (active + superseded)
  if (store.entries.length > 100) {
    // Remove oldest superseded first, then oldest active
    const superseded = store.entries.filter(e => e.status === 'superseded')
    const active = store.entries.filter(e => e.status !== 'superseded')
    store.entries = [...active.slice(-80), ...superseded.slice(-20)]
  }
  saveMemory(store)
  clearSearchCache()  // Invalidate cached search results
  return id
}

/**
 * Supersede a memory entry with a new one.
 * The old entry is marked as superseded and linked to the new one.
 * This prevents stale facts from being returned in searches.
 */
export function supersedeMemory(oldSummarySubstring: string, newSummary: string, project?: string): string | null {
  const store = loadMemory()

  // Find the most recent active entry matching the substring
  const oldEntry = store.entries
    .filter(e => e.status !== 'superseded' && e.summary.includes(oldSummarySubstring))
    .pop()

  const newId = addMemory(newSummary, project)

  if (oldEntry) {
    oldEntry.status = 'superseded'
    oldEntry.supersededBy = newId
    saveMemory(store)
  }

  return newId
}

/**
 * Get relevant memories using TF-IDF vector search.
 *
 * If a query is provided (e.g., the user's current message), searches
 * semantically for the most relevant memories. Otherwise falls back
 * to recency + project filtering.
 *
 * Returns a formatted string to inject into the system prompt.
 */
export function getRelevantMemories(
  project?: string,
  maxChars = 2000,
  query?: string,
): string {
  const store = loadMemory()
  if (store.entries.length === 0) return ''

  let selected: MemoryEntry[]

  if (query && store.entries.length > 5) {
    // Vector search: find memories most relevant to the current query
    // Filter out superseded entries — they've been replaced by newer facts
    const activeEntries = store.entries
      .map((e, i) => ({ entry: e, idx: i }))
      .filter(({ entry }) => entry.status !== 'superseded')

    const docs: SearchDocument[] = activeEntries.map(({ entry, idx }) => ({
      id: idx,
      text: `${entry.summary} ${entry.project || ''}`,
      metadata: {
        timestamp: entry.timestamp,
        project: entry.project,
        ts: new Date(entry.timestamp).getTime(),  // Numeric for range queries
      },
    }))

    // Metadata-filtered search: scope by project if available
    const filter: SearchFilter | undefined = project
      ? { eq: { project } }
      : undefined
    const results = cachedSearch(docs, query, 10, 0.05, filter)

    // Merge: top vector results + most recent 3 (for recency)
    const vectorIds = new Set(results.map(r => r.id as number))
    const vectorEntries = results.map(r => store.entries[r.id as number]!)
    const recentEntries = store.entries
      .slice(-3)
      .filter((_, i) => !vectorIds.has(store.entries.length - 3 + i))

    selected = [...vectorEntries, ...recentEntries]
  } else {
    // Fallback: recency + project filtering (exclude superseded)
    const active = store.entries.filter(e => e.status !== 'superseded')
    if (project) {
      const projectEntries = active.filter(e => e.project === project)
      const otherEntries = active.filter(e => e.project !== project)
      selected = [...projectEntries.slice(-8), ...otherEntries.slice(-3)]
    } else {
      selected = active.slice(-10)
    }
  }

  let text = ''
  for (const entry of selected) {
    const line = `- [${entry.timestamp.split('T')[0]}] ${entry.summary}\n`
    if (text.length + line.length > maxChars) break
    text += line
  }

  return text ? `\n\n# Relevant memories\n${text}` : ''
}

/**
 * Search memories with a specific query. Used by tools/agents.
 * Returns raw results with scores.
 */
export function searchMemories(
  query: string,
  topK = 10,
): Array<{ score: number; summary: string; timestamp: string; project?: string }> {
  const store = loadMemory()
  if (store.entries.length === 0) return []

  // Filter out superseded entries
  const activeWithIdx = store.entries
    .map((e, i) => ({ entry: e, idx: i }))
    .filter(({ entry }) => entry.status !== 'superseded')

  const docs: SearchDocument[] = activeWithIdx.map(({ entry, idx }) => ({
    id: idx,
    text: `${entry.summary} ${entry.project || ''}`,
  }))

  const results = cachedSearch(docs, query, topK, 0.03)

  return results.map(r => {
    const entry = store.entries[r.id as number]!
    return {
      score: Math.round(r.score * 100) / 100,
      summary: entry.summary,
      timestamp: entry.timestamp,
      project: entry.project,
    }
  })
}

// ── Conversation compaction ──────────────────────────────────────────────

/**
 * Compact a range of messages into a brief summary.
 * This is a local heuristic — no LLM call needed.
 */
function compactMessages(messages: Message[]): string {
  const parts: string[] = []

  let toolCalls = 0
  let filesRead: string[] = []
  let filesEdited: string[] = []
  let commandsRun: string[] = []
  let userQuestions: string[] = []
  let errors: string[] = []
  let decisions: string[] = []

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : ''

    if (msg.role === 'user' && content) {
      const preview = content.slice(0, 150).replace(/\n/g, ' ')
      if (!content.startsWith('[') && !content.startsWith('Based on')) {
        userQuestions.push(preview)
      }
    }

    if (msg.role === 'tool' && content) {
      // Capture errors — these are critical to remember
      if (content.startsWith('Error')) {
        errors.push(content.slice(0, 120))
      }
    }

    if (msg.role === 'assistant') {
      // Capture tool calls
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolCalls++
          try {
            const args = JSON.parse(tc.function.arguments || '{}')
            if (tc.function.name === 'Read' && args.file_path) {
              filesRead.push(args.file_path)
            } else if (tc.function.name === 'Edit' && args.file_path) {
              filesEdited.push(args.file_path)
            } else if (tc.function.name === 'Write' && args.file_path) {
              filesEdited.push(args.file_path)
            } else if (tc.function.name === 'Bash' && args.command) {
              commandsRun.push(args.command.slice(0, 80))
            } else if (tc.function.name === 'Scratchpad') {
              // Scratchpad writes are decisions — note them
              if (args.action === 'write' || args.action === 'append') {
                decisions.push('Wrote to scratchpad')
              }
            }
          } catch {}
        }
      }
      // Capture assistant text responses as decisions/conclusions
      if (content && !msg.tool_calls && content.length > 20) {
        decisions.push(content.slice(0, 200).replace(/\n/g, ' '))
      }
    }
  }

  // Deduplicate
  filesRead = [...new Set(filesRead)]
  filesEdited = [...new Set(filesEdited)]

  if (userQuestions.length > 0) {
    parts.push(`User asked: ${userQuestions.join('; ')}`)
  }
  if (decisions.length > 0) {
    parts.push(`Key conclusions: ${decisions.slice(-3).join('; ')}`)
  }
  if (errors.length > 0) {
    parts.push(`Errors encountered: ${errors.slice(-3).join('; ')}`)
  }
  if (filesRead.length > 0) {
    parts.push(`Files read: ${filesRead.slice(0, 8).join(', ')}`)
  }
  if (filesEdited.length > 0) {
    parts.push(`Files modified: ${filesEdited.join(', ')}`)
  }
  if (commandsRun.length > 0) {
    parts.push(`Commands: ${commandsRun.slice(0, 4).join('; ')}`)
  }
  parts.push(`${toolCalls} tool calls`)

  return parts.join('. ')
}

/**
 * Smart compaction of the conversation.
 *
 * Strategy:
 * - Keep system prompt (index 0)
 * - Keep the most recent MIN_RECENT_MESSAGES messages
 * - Compact older messages into a summary system message
 * - If still over budget, compact more aggressively
 *
 * Returns true if compaction was performed.
 */
export function smartCompact(messages: Message[], model: string): boolean {
  const budget = getTokenBudget(model)
  const currentTokens = estimateConversationTokens(messages)
  const ratio = currentTokens / budget

  if (ratio < COMPACT_THRESHOLD) return false

  const systemMsg = messages[0]!

  // How many recent messages to preserve
  const keepRecent = ratio >= AGGRESSIVE_THRESHOLD
    ? MIN_RECENT_MESSAGES
    : Math.max(MIN_RECENT_MESSAGES, Math.floor(messages.length * 0.4))

  // Can't compact if not enough messages
  if (messages.length <= keepRecent + 1) return false

  // Split: [system, ...old, ...recent]
  const oldMessages = messages.slice(1, messages.length - keepRecent)
  const recentMessages = messages.slice(messages.length - keepRecent)

  if (oldMessages.length === 0) return false

  // Segment evicted messages into episodes (structured episodic memory)
  const episodes = segmentAndStore(oldMessages)

  // Also generate a flat summary for the general memory store
  const summary = compactMessages(oldMessages)
  addMemory(summary)

  // Replace conversation in place
  const compactedMsg: Message = {
    role: 'system',
    content: `[Conversation compacted — ${oldMessages.length} messages summarized]\n${summary}`,
  }

  messages.length = 0
  messages.push(systemMsg, compactedMsg, ...recentMessages)

  logEvent('compaction', 'system', {
    removedCount: oldMessages.length,
    keptCount: recentMessages.length,
    summary: summary.slice(0, 300),
  })

  return true
}

/**
 * Get token usage stats for display.
 */
export function getUsageStats(messages: Message[], model: string): {
  tokens: number
  budget: number
  ratio: number
  compactedCount: number
} {
  const budget = getTokenBudget(model)
  const tokens = estimateConversationTokens(messages)
  const compactedCount = messages.filter(m =>
    m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[Conversation compacted')
  ).length

  return { tokens, budget, ratio: tokens / budget, compactedCount }
}
