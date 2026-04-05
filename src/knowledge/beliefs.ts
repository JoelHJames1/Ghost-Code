/**
 * Belief System — typed beliefs with confidence, evidence, and revision.
 *
 * Beliefs are NOT facts. They are the AI's understanding of the world,
 * subject to revision when evidence contradicts them.
 *
 * Each belief has:
 *   - Confidence score (0-1) that changes with evidence
 *   - Supporting evidence (what supports this belief)
 *   - Contradicting evidence (what challenges it)
 *   - Status: active, revised, or abandoned
 *   - Revision chain: what this belief replaced, or what replaced it
 *
 * The system supports:
 *   - Belief strengthening: more evidence → higher confidence
 *   - Belief weakening: contradictory evidence → lower confidence
 *   - Belief revision: when contradiction is strong enough, the old
 *     belief is superseded by a new one
 *   - Abstention: when confidence is too low, the AI should say
 *     "I'm not sure" rather than asserting
 *
 * This directly addresses the LongMemEval benchmark requirements:
 * knowledge updates and abstention.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { search, type SearchDocument } from '../vectorsearch.js'

// ── Types ────────────────────────────────────────────────────────────────

export type BeliefDomain =
  | 'technical'      // "TypeScript is better than JavaScript for large projects"
  | 'personal'       // "Joel prefers direct communication"
  | 'tool'           // "llama-server needs --jinja for tool calling"
  | 'project'        // "Ghost Code uses TF-IDF for search"
  | 'world'          // "Small models can be powerful with good architecture"
  | 'self'           // "I'm good at TypeScript but struggle with C++"

export interface Evidence {
  content: string
  source: string         // Session, person, observation
  timestamp: string
  supports: boolean      // true = supports the belief, false = contradicts
}

export interface Belief {
  id: string
  statement: string
  domain: BeliefDomain
  confidence: number     // 0-1
  evidence: Evidence[]
  status: 'active' | 'revised' | 'abandoned'
  createdAt: string
  updatedAt: string
  revisedFrom?: string   // ID of belief this replaced
  revisedTo?: string     // ID of belief that replaced this
}

interface BeliefStore {
  beliefs: Belief[]
}

// ── Storage ──────────────────────────────────────────────────────────────

function getStorePath(): string {
  const dir = join(homedir(), '.local', 'share', 'ghost-code', 'knowledge')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'beliefs.json')
}

function loadBeliefs(): BeliefStore {
  const path = getStorePath()
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {}
  return { beliefs: [] }
}

function saveBeliefs(store: BeliefStore): void {
  writeFileSync(getStorePath(), JSON.stringify(store, null, 2) + '\n', 'utf-8')
}

// ── Confidence calculation ───────────────────────────────────────────────

/**
 * Recalculate confidence from evidence.
 * More supporting evidence → higher confidence.
 * Contradicting evidence pulls it down.
 * Recent evidence weighs more than old evidence.
 */
function calculateConfidence(evidence: Evidence[]): number {
  if (evidence.length === 0) return 0.5

  const now = Date.now()
  let score = 0
  let weight = 0

  for (const e of evidence) {
    // Recency weight: recent evidence counts more
    const age = now - new Date(e.timestamp).getTime()
    const recency = Math.exp(-age / (30 * 24 * 60 * 60 * 1000)) // 30-day half-life
    const w = 0.3 + 0.7 * recency

    score += e.supports ? w : -w
    weight += w
  }

  // Normalize to 0-1
  const raw = weight > 0 ? (score / weight + 1) / 2 : 0.5
  return Math.max(0.01, Math.min(0.99, raw))
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Assert a belief with evidence.
 * If the belief already exists, adds evidence and updates confidence.
 * If it contradicts an existing belief, handles revision.
 */
export function assertBelief(
  statement: string,
  domain: BeliefDomain,
  evidence: string,
  source = 'observation',
): Belief {
  const store = loadBeliefs()

  // Find existing belief
  const existing = store.beliefs.find(
    b => b.status === 'active' && b.statement.toLowerCase() === statement.toLowerCase()
  )

  if (existing) {
    // Add supporting evidence
    existing.evidence.push({
      content: evidence,
      source,
      timestamp: new Date().toISOString(),
      supports: true,
    })
    existing.confidence = calculateConfidence(existing.evidence)
    existing.updatedAt = new Date().toISOString()
    saveBeliefs(store)
    return existing
  }

  // Check for contradicting beliefs
  const contradicted = findContradictions(store, statement, domain)
  for (const c of contradicted) {
    c.evidence.push({
      content: `Contradicted by: "${statement}" — ${evidence}`,
      source,
      timestamp: new Date().toISOString(),
      supports: false,
    })
    c.confidence = calculateConfidence(c.evidence)

    // If confidence drops below 0.3, revise it
    if (c.confidence < 0.3) {
      c.status = 'revised'
      c.updatedAt = new Date().toISOString()
    }
  }

  // Create new belief
  const belief: Belief = {
    id: `bel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    statement,
    domain,
    confidence: 0.6, // Start moderate, evidence builds confidence
    evidence: [{
      content: evidence,
      source,
      timestamp: new Date().toISOString(),
      supports: true,
    }],
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  // Link to contradicted beliefs
  for (const c of contradicted.filter(c => c.status === 'revised')) {
    belief.revisedFrom = c.id
    c.revisedTo = belief.id
  }

  store.beliefs.push(belief)

  // Keep max 1000 beliefs
  if (store.beliefs.length > 1000) {
    const abandoned = store.beliefs.filter(b => b.status === 'abandoned')
    const revised = store.beliefs.filter(b => b.status === 'revised')
    const active = store.beliefs.filter(b => b.status === 'active')
    store.beliefs = [
      ...active.slice(-800),
      ...revised.slice(-150),
      ...abandoned.slice(-50),
    ]
  }

  saveBeliefs(store)
  return belief
}

/**
 * Add contradicting evidence to a belief.
 */
export function challengeBelief(
  statement: string,
  contradictionEvidence: string,
  source = 'observation',
): Belief | null {
  const store = loadBeliefs()
  const belief = store.beliefs.find(
    b => b.status === 'active' && b.statement.toLowerCase().includes(statement.toLowerCase())
  )

  if (!belief) return null

  belief.evidence.push({
    content: contradictionEvidence,
    source,
    timestamp: new Date().toISOString(),
    supports: false,
  })
  belief.confidence = calculateConfidence(belief.evidence)
  belief.updatedAt = new Date().toISOString()

  // Auto-abandon if confidence is very low
  if (belief.confidence < 0.15) {
    belief.status = 'abandoned'
  }

  saveBeliefs(store)
  return belief
}

/**
 * Find beliefs that might contradict a new statement.
 * Uses keyword overlap as a heuristic.
 */
function findContradictions(store: BeliefStore, statement: string, domain: BeliefDomain): Belief[] {
  // Simple heuristic: beliefs in the same domain with keyword overlap
  // but containing negation words or opposite claims
  const negationWords = ['not', "don't", "doesn't", "isn't", "aren't", 'never', 'wrong', 'incorrect', 'false']
  const lowerStatement = statement.toLowerCase()

  return store.beliefs.filter(b => {
    if (b.status !== 'active' || b.domain !== domain) return false
    const lowerBelief = b.statement.toLowerCase()

    // Check if one contains a negation the other doesn't
    const stmtHasNeg = negationWords.some(w => lowerStatement.includes(w))
    const beliefHasNeg = negationWords.some(w => lowerBelief.includes(w))

    if (stmtHasNeg !== beliefHasNeg) {
      // One is negative, one isn't — check if they're about the same topic
      const stmtWords = new Set(lowerStatement.split(/\s+/).filter(w => w.length > 3))
      const beliefWords = lowerBelief.split(/\s+/).filter(w => w.length > 3)
      const overlap = beliefWords.filter(w => stmtWords.has(w)).length
      return overlap >= 2
    }

    return false
  })
}

/**
 * Search beliefs by query.
 */
export function searchBeliefs(query: string, topK = 5): Belief[] {
  const store = loadBeliefs()
  const active = store.beliefs.filter(b => b.status === 'active')
  if (active.length === 0) return []

  const docs: SearchDocument[] = active.map((b, i) => ({
    id: i,
    text: `${b.statement} ${b.evidence.map(e => e.content).join(' ')}`,
  }))

  const results = search(docs, query, topK, 0.03)
  return results.map(r => active[r.id as number]!)
}

/**
 * Get beliefs the AI should be uncertain about (low confidence).
 * These are candidates for abstention — "I'm not sure about this."
 */
export function getUncertainBeliefs(threshold = 0.4): Belief[] {
  const store = loadBeliefs()
  return store.beliefs
    .filter(b => b.status === 'active' && b.confidence < threshold)
    .sort((a, b) => a.confidence - b.confidence)
}

/**
 * Format beliefs for injection into context.
 */
export function formatBeliefsForPrompt(beliefs: Belief[], maxChars = 1000): string {
  if (beliefs.length === 0) return ''

  let text = ''
  for (const b of beliefs) {
    const conf = Math.round(b.confidence * 100)
    const line = `- [${conf}%] ${b.statement}\n`
    if (text.length + line.length > maxChars) break
    text += line
  }

  return text ? `## My beliefs\n${text}` : ''
}

/**
 * Get belief stats.
 */
export function getBeliefStats(): {
  total: number
  active: number
  revised: number
  abandoned: number
  avgConfidence: number
  domains: Record<string, number>
} {
  const store = loadBeliefs()
  const active = store.beliefs.filter(b => b.status === 'active')
  const domains: Record<string, number> = {}
  for (const b of active) {
    domains[b.domain] = (domains[b.domain] || 0) + 1
  }

  return {
    total: store.beliefs.length,
    active: active.length,
    revised: store.beliefs.filter(b => b.status === 'revised').length,
    abandoned: store.beliefs.filter(b => b.status === 'abandoned').length,
    avgConfidence: active.length > 0
      ? active.reduce((s, b) => s + b.confidence, 0) / active.length
      : 0,
    domains,
  }
}
