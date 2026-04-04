/**
 * Temporal Reasoning — time-aware memory and knowledge.
 *
 * Enables the AI to reason about:
 * - "When did I last talk to Joel?" → relationship timestamp
 * - "What was true THEN vs what is true NOW?" → belief history
 * - "How long has this project been going?" → project timeline
 * - "Joel usually works on weekends" → pattern detection
 *
 * This is the "time sense" that makes persistent memory feel alive
 * rather than being a flat database dump.
 */

import { loadIdentity, type Relationship } from '../identity/store.js'
import { getBeliefStats, searchBeliefs } from './beliefs.js'
import { queryEntity } from './graph.js'

// ── Types ────────────────────────────────────────────────────────────────

export interface TemporalFact {
  description: string
  timeAgo: string          // "3 days ago", "2 hours ago"
  timestamp: string
  category: 'interaction' | 'change' | 'pattern' | 'milestone'
}

// ── Time formatting ──────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then

  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`
  if (weeks < 4) return `${weeks} week${weeks > 1 ? 's' : ''} ago`
  return `${months} month${months > 1 ? 's' : ''} ago`
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Get temporal context about a person (when we last met, how long we've known them, etc.)
 */
export function getRelationshipTimeline(personId: string): TemporalFact[] {
  const identity = loadIdentity()
  const rel = identity.relationships.find(r => r.personId === personId)
  if (!rel) return []

  const facts: TemporalFact[] = []

  facts.push({
    description: `First met ${rel.name}`,
    timeAgo: timeAgo(rel.firstMet),
    timestamp: rel.firstMet,
    category: 'milestone',
  })

  facts.push({
    description: `Last interacted with ${rel.name}`,
    timeAgo: timeAgo(rel.lastInteraction),
    timestamp: rel.lastInteraction,
    category: 'interaction',
  })

  facts.push({
    description: `${rel.interactionCount} total interactions with ${rel.name}`,
    timeAgo: '',
    timestamp: rel.lastInteraction,
    category: 'pattern',
  })

  // Interaction frequency pattern
  if (rel.interactionCount > 1) {
    const firstMet = new Date(rel.firstMet).getTime()
    const lastInteraction = new Date(rel.lastInteraction).getTime()
    const span = lastInteraction - firstMet
    const daysSpan = span / 86_400_000
    if (daysSpan > 0) {
      const freq = rel.interactionCount / daysSpan
      if (freq > 1) {
        facts.push({
          description: `Interact with ${rel.name} multiple times per day`,
          timeAgo: '',
          timestamp: rel.lastInteraction,
          category: 'pattern',
        })
      } else if (freq > 0.14) {
        facts.push({
          description: `Interact with ${rel.name} regularly (every few days)`,
          timeAgo: '',
          timestamp: rel.lastInteraction,
          category: 'pattern',
        })
      }
    }
  }

  return facts
}

/**
 * Get the AI's own temporal timeline (how long have I existed, growth milestones).
 */
export function getSelfTimeline(): TemporalFact[] {
  const identity = loadIdentity()
  const facts: TemporalFact[] = []

  facts.push({
    description: `I was created`,
    timeAgo: timeAgo(identity.createdAt),
    timestamp: identity.createdAt,
    category: 'milestone',
  })

  facts.push({
    description: `I have lived ${identity.sessionCount} sessions`,
    timeAgo: '',
    timestamp: identity.lastUpdated,
    category: 'milestone',
  })

  facts.push({
    description: `I am at version ${identity.version} of my identity`,
    timeAgo: '',
    timestamp: identity.lastUpdated,
    category: 'change',
  })

  // Skills growth
  for (const skill of identity.skills) {
    if (skill.successes + skill.failures >= 3) {
      facts.push({
        description: `${skill.domain}: ${skill.successes} successes, ${skill.failures} failures (confidence: ${Math.round(skill.confidence * 100)}%)`,
        timeAgo: timeAgo(skill.lastPracticed),
        timestamp: skill.lastPracticed,
        category: 'pattern',
      })
    }
  }

  return facts
}

/**
 * Format temporal context for injection into prompt.
 */
export function formatTemporalContext(personId?: string, maxChars = 800): string {
  const facts: TemporalFact[] = []

  // Self timeline (abbreviated)
  const selfFacts = getSelfTimeline()
  facts.push(...selfFacts.slice(0, 3))

  // Person timeline if specified
  if (personId) {
    const relFacts = getRelationshipTimeline(personId)
    facts.push(...relFacts)
  }

  if (facts.length === 0) return ''

  let text = '## Time awareness\n'
  for (const f of facts) {
    const line = `- ${f.description}${f.timeAgo ? ` (${f.timeAgo})` : ''}\n`
    if (text.length + line.length > maxChars) break
    text += line
  }

  return text
}
