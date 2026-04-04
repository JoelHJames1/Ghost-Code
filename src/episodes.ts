/**
 * Episodic memory — segments conversation into coherent episodes
 * and retrieves them with temporal contiguity.
 *
 * Instead of compacting raw message ranges, this module:
 * 1. Segments the conversation into "episodes" — coherent units of work
 *    (e.g., "read and fix auth.ts", "run tests", "refactor database")
 * 2. Stores episodes with embeddings for vector search
 * 3. When retrieving, pulls matching episodes PLUS their temporal
 *    neighbors to preserve causal/temporal context
 *
 * Boundary detection heuristics (no logprobs needed):
 * - New user message after assistant text response (topic shift)
 * - Tool error spike (context switch to debugging)
 * - File change (switching from reading to editing different files)
 * - Long idle gap between messages
 * - Explicit task transitions (TaskTracker updates)
 *
 * Storage: .gemma-code/episodes.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Message, ServerConfig } from './api.js'
import { tokenize } from './vectorsearch.js'
import { search, type SearchDocument, type SearchResult } from './vectorsearch.js'
import {
  extractSurprisalFromResponse,
  detectSurprisalBoundaries,
  type SurprisalBoundary,
} from './surprisal.js'

// ── Types ────────────────────────────────────────────────────────────────

export interface Episode {
  id: string
  index: number                    // Sequential order (for contiguity lookup)
  timestamp: number                // When this episode started
  endTimestamp: number             // When this episode ended
  summary: string                  // Compact summary of what happened
  messageCount: number             // How many messages in this episode
  boundaryReason: string           // Why a boundary was detected here

  // Structured metadata for filtering
  filesRead: string[]
  filesEdited: string[]
  toolsUsed: string[]
  errors: string[]
  userQuestions: string[]
  decisions: string[]
}

interface EpisodeStore {
  episodes: Episode[]
  nextIndex: number
}

// ── Persistence ──────────────────────────────────────────────────────────

function getEpisodePath(): string {
  const dir = join(process.cwd(), '.gemma-code')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'episodes.json')
}

function loadEpisodes(): EpisodeStore {
  const path = getEpisodePath()
  try {
    if (!existsSync(path)) return { episodes: [], nextIndex: 0 }
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return { episodes: [], nextIndex: 0 }
  }
}

function saveEpisodes(store: EpisodeStore): void {
  writeFileSync(getEpisodePath(), JSON.stringify(store, null, 2) + '\n', 'utf-8')
}

// ── Episode boundary detection ───────────────────────────────────────────

interface BoundarySignal {
  position: number      // Index in the message array
  reason: string
  strength: number      // 0-1, higher = stronger boundary
}

/**
 * Detect episode boundaries in a message sequence.
 * Uses a hybrid approach:
 *   1. Heuristic signals (topic shift, file switch, error spike, task transition)
 *   2. Surprisal signals (if logprobs data is available on assistant messages)
 * Returns indices where episodes should be split.
 */
function detectBoundaries(messages: Message[], surprisalData?: Map<number, SurprisalBoundary[]>): BoundarySignal[] {
  const signals: BoundarySignal[] = []

  let lastRole = ''
  let lastFiles = new Set<string>()
  let errorCount = 0
  let consecutiveToolCalls = 0

  for (let i = 1; i < messages.length; i++) {
    const msg = messages[i]!
    const prev = messages[i - 1]!
    const content = typeof msg.content === 'string' ? msg.content : ''

    // Signal 1: New user message after assistant text response (topic shift)
    if (msg.role === 'user' && prev.role === 'assistant' && !prev.tool_calls) {
      // Check if the user's message seems like a new topic
      const prevContent = typeof prev.content === 'string' ? prev.content : ''
      const topicShift = !hasTopicOverlap(prevContent, content)
      signals.push({
        position: i,
        reason: topicShift ? 'new_topic' : 'follow_up',
        strength: topicShift ? 0.8 : 0.3,
      })
    }

    // Signal 2: Tool error spike
    if (msg.role === 'tool' && content.startsWith('Error')) {
      errorCount++
      if (errorCount >= 2) {
        signals.push({
          position: i,
          reason: 'error_spike',
          strength: 0.6,
        })
        errorCount = 0
      }
    } else if (msg.role === 'tool' && !content.startsWith('Error')) {
      errorCount = 0
    }

    // Signal 3: File context switch
    if (msg.role === 'assistant' && msg.tool_calls) {
      const currentFiles = new Set<string>()
      for (const tc of msg.tool_calls) {
        try {
          const args = JSON.parse(tc.function.arguments || '{}')
          if (args.file_path) currentFiles.add(args.file_path as string)
        } catch {}
      }

      if (lastFiles.size > 0 && currentFiles.size > 0) {
        const overlap = [...currentFiles].filter(f => lastFiles.has(f)).length
        if (overlap === 0) {
          signals.push({
            position: i,
            reason: 'file_switch',
            strength: 0.5,
          })
        }
      }
      lastFiles = currentFiles
    }

    // Signal 4: Task tracker transitions
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.function.name === 'TaskTracker') {
          try {
            const args = JSON.parse(tc.function.arguments || '{}')
            if (args.action === 'plan' || args.action === 'update') {
              signals.push({
                position: i,
                reason: 'task_transition',
                strength: 0.7,
              })
            }
          } catch {}
        }
      }
    }

    // Signal 5: Long sequence of tool calls followed by text (work unit complete)
    if (msg.role === 'assistant' && msg.tool_calls) {
      consecutiveToolCalls++
    } else if (msg.role === 'assistant' && !msg.tool_calls && consecutiveToolCalls >= 3) {
      signals.push({
        position: i,
        reason: 'work_unit_complete',
        strength: 0.6,
      })
      consecutiveToolCalls = 0
    } else {
      consecutiveToolCalls = 0
    }

    // Signal 6: Surprisal-based boundary (if logprobs available)
    // High surprisal = unexpected content = likely topic/activity shift
    if (surprisalData?.has(i)) {
      for (const sb of surprisalData.get(i)!) {
        signals.push({
          position: sb.position,
          reason: 'surprisal_spike',
          strength: Math.min(0.9, 0.5 + sb.zScore * 0.1),
        })
      }
    }

    lastRole = msg.role
  }

  // Filter to strong boundaries only, deduplicate nearby
  return signals
    .filter(s => s.strength >= 0.5)
    .filter((s, i, arr) => {
      if (i === 0) return true
      return s.position - arr[i - 1]!.position >= 3  // Min 3 messages per episode
    })
}

/**
 * Check if two texts share topic-related tokens.
 */
function hasTopicOverlap(textA: string, textB: string): boolean {
  const tokA = new Set(tokenize(textA))
  const tokB = tokenize(textB)
  const overlap = tokB.filter(t => tokA.has(t)).length
  return overlap >= 2 || (overlap >= 1 && tokB.length <= 5)
}

// ── Episode extraction ───────────────────────────────────────────────────

/**
 * Extract metadata from a group of messages.
 */
function extractEpisodeMetadata(messages: Message[]): Omit<Episode, 'id' | 'index' | 'timestamp' | 'endTimestamp' | 'boundaryReason' | 'summary' | 'messageCount'> {
  const filesRead: string[] = []
  const filesEdited: string[] = []
  const toolsUsed: string[] = []
  const errors: string[] = []
  const userQuestions: string[] = []
  const decisions: string[] = []

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : ''

    if (msg.role === 'user' && content && !content.startsWith('[')) {
      userQuestions.push(content.slice(0, 150))
    }

    if (msg.role === 'tool' && content.startsWith('Error')) {
      errors.push(content.slice(0, 120))
    }

    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolsUsed.push(tc.function.name)
        try {
          const args = JSON.parse(tc.function.arguments || '{}')
          if (tc.function.name === 'Read' && args.file_path) filesRead.push(args.file_path)
          if (tc.function.name === 'Edit' && args.file_path) filesEdited.push(args.file_path)
          if (tc.function.name === 'Write' && args.file_path) filesEdited.push(args.file_path)
        } catch {}
      }
    }

    if (msg.role === 'assistant' && content && !msg.tool_calls && content.length > 20) {
      decisions.push(content.slice(0, 200))
    }
  }

  return {
    filesRead: [...new Set(filesRead)],
    filesEdited: [...new Set(filesEdited)],
    toolsUsed: [...new Set(toolsUsed)],
    errors,
    userQuestions,
    decisions: decisions.slice(-3),
  }
}

/**
 * Build a summary string from episode metadata.
 */
function buildEpisodeSummary(meta: ReturnType<typeof extractEpisodeMetadata>): string {
  const parts: string[] = []
  if (meta.userQuestions.length > 0) parts.push(`Q: ${meta.userQuestions.join('; ')}`)
  if (meta.filesEdited.length > 0) parts.push(`Edited: ${meta.filesEdited.join(', ')}`)
  if (meta.filesRead.length > 0) parts.push(`Read: ${meta.filesRead.slice(0, 5).join(', ')}`)
  if (meta.errors.length > 0) parts.push(`Errors: ${meta.errors.slice(0, 2).join('; ')}`)
  if (meta.decisions.length > 0) parts.push(`Decided: ${meta.decisions[meta.decisions.length - 1]!.slice(0, 100)}`)
  if (meta.toolsUsed.length > 0) parts.push(`Tools: ${meta.toolsUsed.slice(0, 6).join(', ')}`)
  return parts.join('. ') || 'Conversation segment'
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Segment a conversation into episodes and store them.
 * Called during compaction — the messages being evicted are segmented
 * into episodes for later retrieval.
 *
 * @param surprisalData - Optional map of message index → surprisal boundaries.
 *   If provided (from logprobs), used alongside heuristic signals for more
 *   accurate boundary detection (EM-LLM approach).
 */
export function segmentAndStore(
  messages: Message[],
  surprisalData?: Map<number, SurprisalBoundary[]>,
): Episode[] {
  if (messages.length < 3) return []

  const store = loadEpisodes()
  const boundaries = detectBoundaries(messages, surprisalData)
  const now = Date.now()
  const newEpisodes: Episode[] = []

  // Split messages at boundaries
  let startIdx = 0
  const splitPoints = [...boundaries.map(b => b.position), messages.length]

  for (let i = 0; i < splitPoints.length; i++) {
    const endIdx = splitPoints[i]!
    if (endIdx <= startIdx) continue

    const chunk = messages.slice(startIdx, endIdx)
    if (chunk.length === 0) continue

    const meta = extractEpisodeMetadata(chunk)
    const summary = buildEpisodeSummary(meta)

    const episode: Episode = {
      id: `ep_${now}_${store.nextIndex}`,
      index: store.nextIndex++,
      timestamp: now - (messages.length - startIdx) * 1000,  // Approximate
      endTimestamp: now - (messages.length - endIdx) * 1000,
      summary,
      messageCount: chunk.length,
      boundaryReason: boundaries[i]?.reason || 'end_of_segment',
      ...meta,
    }

    newEpisodes.push(episode)
    startIdx = endIdx
  }

  store.episodes.push(...newEpisodes)

  // Keep max 200 episodes
  if (store.episodes.length > 200) {
    store.episodes = store.episodes.slice(-200)
  }

  saveEpisodes(store)
  return newEpisodes
}

/**
 * Search episodes with similarity + temporal contiguity.
 *
 * Two-stage retrieval:
 * 1. TF-IDF similarity: find the most relevant episodes
 * 2. Contiguity buffer: for each hit, also include its temporal neighbors
 *    (the episode before and after) to preserve causal context
 *
 * This prevents "topic teleportation" where the model gets a relevant
 * fact but loses the surrounding context that makes it usable.
 */
export function searchEpisodes(
  query: string,
  topK = 5,
  contiguityRadius = 1,   // Include N neighbors on each side
): Episode[] {
  const store = loadEpisodes()
  if (store.episodes.length === 0) return []

  // Stage 1: Similarity search via TF-IDF
  const docs: SearchDocument[] = store.episodes.map((ep, i) => ({
    id: i,
    text: `${ep.summary} ${ep.filesRead.join(' ')} ${ep.filesEdited.join(' ')} ${ep.userQuestions.join(' ')} ${ep.errors.join(' ')}`,
    metadata: { index: ep.index },
  }))

  const simResults = search(docs, query, topK, 0.04)

  // Stage 2: Contiguity expansion
  // For each similarity hit, also pull neighboring episodes
  const selectedIndices = new Set<number>()

  for (const result of simResults) {
    const arrayIdx = result.id as number
    // Add the hit itself
    selectedIndices.add(arrayIdx)

    // Add temporal neighbors
    for (let offset = -contiguityRadius; offset <= contiguityRadius; offset++) {
      const neighborIdx = arrayIdx + offset
      if (neighborIdx >= 0 && neighborIdx < store.episodes.length) {
        selectedIndices.add(neighborIdx)
      }
    }
  }

  // Sort by index (temporal order) and return
  const episodes = [...selectedIndices]
    .sort((a, b) => a - b)
    .map(i => store.episodes[i]!)

  return episodes
}

/**
 * Format retrieved episodes for injection into context.
 * Maintains temporal order and marks which are similarity hits vs contiguity.
 */
export function formatEpisodesForContext(
  episodes: Episode[],
  maxChars = 3000,
): string {
  if (episodes.length === 0) return ''

  let text = '## Retrieved episodes (from past work)\n'
  let chars = text.length

  for (const ep of episodes) {
    const line = `[${new Date(ep.timestamp).toISOString().split('T')[0]}] ${ep.summary}\n`
    if (chars + line.length > maxChars) break
    text += line
    chars += line.length
  }

  return text
}

/**
 * Get episode store stats.
 */
export function getEpisodeStats(): {
  totalEpisodes: number
  totalMessages: number
  oldestTimestamp?: string
  newestTimestamp?: string
} {
  const store = loadEpisodes()
  return {
    totalEpisodes: store.episodes.length,
    totalMessages: store.episodes.reduce((sum, ep) => sum + ep.messageCount, 0),
    oldestTimestamp: store.episodes[0]
      ? new Date(store.episodes[0].timestamp).toISOString()
      : undefined,
    newestTimestamp: store.episodes.length > 0
      ? new Date(store.episodes[store.episodes.length - 1]!.timestamp).toISOString()
      : undefined,
  }
}
