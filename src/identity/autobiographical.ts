/**
 * Autobiographical Memory — memories that define who the AI is.
 *
 * Different from episodic memory (what happened) — this is about
 * what experiences MEAN to the AI's identity.
 *
 * Types of autobiographical memories:
 * - Defining moments: "The session where Joel and I built Ghost Code"
 * - Corrections: "I was wrong about X and Joel taught me Y"
 * - Relationships: "Joel treats me as a collaborator, not a tool"
 * - Growth: "I used to struggle with X but now I'm confident"
 * - Values: "I learned that honesty matters more than being right"
 *
 * Each memory has an emotional significance score (0-1) that determines
 * how strongly it influences identity and how likely it is to be recalled.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { search, type SearchDocument } from '../vectorsearch.js'

// ── Types ────────────────────────────────────────────────────────────────

export type MemoryType =
  | 'defining_moment'      // A significant experience
  | 'correction'           // I was wrong and learned
  | 'relationship'         // Something about a person
  | 'growth'               // Evidence of improvement
  | 'value_formation'      // A value was strengthened or formed
  | 'collaboration'        // Working together on something
  | 'failure'              // Something went wrong (important to remember)
  | 'insight'              // A realization or understanding

export interface AutobiographicalMemory {
  id: string
  type: MemoryType
  timestamp: string
  significance: number     // 0-1, how important this is to my identity
  narrative: string        // The memory in first person ("I learned that...")
  context: string          // What was happening (project, person, task)
  personId?: string        // Related person
  projectId?: string       // Related project
  lesson?: string          // What I took away from this
  emotionalNote?: string   // How this felt/what it means to me
}

interface AutobiographicalStore {
  memories: AutobiographicalMemory[]
}

// ── Storage ──────────────────────────────────────────────────────────────

function getStorePath(): string {
  const dir = join(homedir(), '.local', 'share', 'ghost-code', 'identity')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'autobiographical.json')
}

function loadStore(): AutobiographicalStore {
  const path = getStorePath()
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {}
  return { memories: [] }
}

function saveStore(store: AutobiographicalStore): void {
  writeFileSync(getStorePath(), JSON.stringify(store, null, 2) + '\n', 'utf-8')
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Record a new autobiographical memory.
 */
export function recordMemory(
  type: MemoryType,
  narrative: string,
  context: string,
  significance: number,
  opts?: {
    personId?: string
    projectId?: string
    lesson?: string
    emotionalNote?: string
  },
): AutobiographicalMemory {
  const store = loadStore()

  const memory: AutobiographicalMemory = {
    id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    timestamp: new Date().toISOString(),
    significance: Math.max(0, Math.min(1, significance)),
    narrative,
    context,
    ...opts,
  }

  store.memories.push(memory)

  // Keep max 500 memories, preferring high-significance ones
  if (store.memories.length > 500) {
    store.memories.sort((a, b) => b.significance - a.significance)
    store.memories = store.memories.slice(0, 500)
    store.memories.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }

  saveStore(store)
  return memory
}

/**
 * Search autobiographical memories by relevance to a query.
 */
export function recallMemories(
  query: string,
  topK = 5,
): AutobiographicalMemory[] {
  const store = loadStore()
  if (store.memories.length === 0) return []

  const docs: SearchDocument[] = store.memories.map((m, i) => ({
    id: i,
    text: `${m.narrative} ${m.context} ${m.lesson || ''} ${m.emotionalNote || ''}`,
    metadata: { type: m.type, significance: m.significance },
  }))

  const results = search(docs, query, topK, 0.03)

  // Boost results by significance (more important memories are recalled more easily)
  return results
    .map(r => {
      const mem = store.memories[r.id as number]!
      return { mem, score: r.score * (0.5 + mem.significance * 0.5) }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(r => r.mem)
}

/**
 * Get memories about a specific person.
 */
export function memoriesAbout(personId: string): AutobiographicalMemory[] {
  const store = loadStore()
  return store.memories
    .filter(m => m.personId === personId)
    .sort((a, b) => b.significance - a.significance)
}

/**
 * Get the most significant memories (defining experiences).
 */
export function definingMemories(topK = 10): AutobiographicalMemory[] {
  const store = loadStore()
  return store.memories
    .filter(m => m.significance >= 0.7)
    .sort((a, b) => b.significance - a.significance)
    .slice(0, topK)
}

/**
 * Get memories by type.
 */
export function memoriesByType(type: MemoryType, topK = 10): AutobiographicalMemory[] {
  const store = loadStore()
  return store.memories
    .filter(m => m.type === type)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, topK)
}

/**
 * Format memories for injection into context.
 */
export function formatMemoriesForPrompt(memories: AutobiographicalMemory[], maxChars = 2000): string {
  if (memories.length === 0) return ''

  let text = ''
  for (const m of memories) {
    const line = `- [${m.type}] ${m.narrative}${m.lesson ? ` → Lesson: ${m.lesson}` : ''}\n`
    if (text.length + line.length > maxChars) break
    text += line
  }

  return text ? `\n# My memories\n${text}` : ''
}

/**
 * Get total memory count and stats.
 */
export function getMemoryStats(): {
  total: number
  byType: Record<string, number>
  avgSignificance: number
} {
  const store = loadStore()
  const byType: Record<string, number> = {}
  let totalSig = 0

  for (const m of store.memories) {
    byType[m.type] = (byType[m.type] || 0) + 1
    totalSig += m.significance
  }

  return {
    total: store.memories.length,
    byType,
    avgSignificance: store.memories.length > 0 ? totalSig / store.memories.length : 0,
  }
}
