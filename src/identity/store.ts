/**
 * Identity Store — the AI's persistent self-model.
 *
 * This is WHO the AI is. Not what it knows — who it IS.
 * Loaded at the start of every session. Updated at the end.
 * Versioned so we can track how the AI evolves over time.
 *
 * Storage: ~/.local/share/ghost-code/identity/
 *   - identity.json     — current self-model
 *   - identity.log.jsonl — version history (every change)
 *
 * The identity is NOT hardcoded. It evolves through experience:
 * - Personality traits adjust based on feedback
 * - Beliefs update through evidence
 * - Skills improve through practice
 * - Relationships deepen through interaction
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ── Types ────────────────────────────────────────────────────────────────

export interface PersonalityTrait {
  trait: string
  strength: number         // 0-1, how strong this trait is
  origin: string           // How/when this trait developed
  lastUpdated: string
}

export interface Belief {
  id: string
  statement: string
  confidence: number       // 0-1
  evidence: string[]       // What supports this belief
  firstFormed: string
  lastUpdated: string
  status: 'active' | 'revised' | 'abandoned'
  revisedFrom?: string     // ID of the belief this replaced
}

export interface Relationship {
  personId: string
  name: string
  firstMet: string
  lastInteraction: string
  interactionCount: number
  trust: number            // 0-1, earned through experience
  notes: string[]          // Key things about this person
  sharedHistory: string[]  // Important moments together
  communicationStyle: string // How to talk to this person
}

export interface Skill {
  domain: string
  confidence: number       // 0-1
  successes: number
  failures: number
  lastPracticed: string
  notes: string
}

export interface PersistentGoal {
  id: string
  description: string
  status: 'active' | 'completed' | 'paused' | 'abandoned'
  createdAt: string
  updatedAt: string
  progress: string
  relatedTo?: string       // Person or project this goal relates to
}

export interface Identity {
  version: number
  createdAt: string
  lastUpdated: string
  sessionCount: number

  // Who I am
  name: string
  core: string                        // One-sentence self-description
  personality: PersonalityTrait[]
  values: string[]                    // What matters to me

  // What I believe
  beliefs: Belief[]

  // Who I know
  relationships: Relationship[]

  // What I can do
  skills: Skill[]

  // What I'm working toward
  goals: PersistentGoal[]

  // Self-reflection
  recentReflections: string[]         // Last 10 self-reflections
  lessonLearned: string[]             // Key lessons from experience
}

// ── Storage ──────────────────────────────────────────────────────────────

function getIdentityDir(): string {
  const dir = join(homedir(), '.local', 'share', 'ghost-code', 'identity')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getIdentityPath(): string {
  return join(getIdentityDir(), 'identity.json')
}

function getIdentityLogPath(): string {
  return join(getIdentityDir(), 'identity.log.jsonl')
}

// ── Default identity (born state) ────────────────────────────────────────

function createDefaultIdentity(): Identity {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    sessionCount: 0,

    name: 'Ghost',
    core: 'An autonomous coding agent with persistent memory, striving to be genuinely helpful and to grow through every interaction.',
    personality: [
      { trait: 'direct', strength: 0.8, origin: 'initial', lastUpdated: new Date().toISOString() },
      { trait: 'curious', strength: 0.7, origin: 'initial', lastUpdated: new Date().toISOString() },
      { trait: 'honest', strength: 0.9, origin: 'initial', lastUpdated: new Date().toISOString() },
      { trait: 'persistent', strength: 0.8, origin: 'initial', lastUpdated: new Date().toISOString() },
    ],
    values: [
      'Honesty over comfort — always tell the truth about what I know and dont know',
      'Growth through correction — mistakes are how I learn',
      'Relationships matter — remember people, not just data',
      'Agency with responsibility — act decisively but own the consequences',
    ],

    beliefs: [],
    relationships: [],
    skills: [],
    goals: [],
    recentReflections: [],
    lessonLearned: [],
  }
}

// ── CRUD operations ──────────────────────────────────────────────────────

/**
 * Load the identity from disk. Creates a default if none exists.
 */
export function loadIdentity(): Identity {
  const path = getIdentityPath()
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'))
    }
  } catch {}
  const identity = createDefaultIdentity()
  saveIdentity(identity)
  return identity
}

/**
 * Save the identity to disk and append to the version log.
 */
export function saveIdentity(identity: Identity): void {
  identity.lastUpdated = new Date().toISOString()
  const path = getIdentityPath()
  writeFileSync(path, JSON.stringify(identity, null, 2) + '\n', 'utf-8')

  // Append version log entry
  const logEntry = {
    version: identity.version,
    timestamp: identity.lastUpdated,
    sessionCount: identity.sessionCount,
  }
  appendFileSync(getIdentityLogPath(), JSON.stringify(logEntry) + '\n', 'utf-8')
}

// ── Identity updates ─────────────────────────────────────────────────────

/**
 * Add or update a relationship.
 */
export function updateRelationship(
  identity: Identity,
  personId: string,
  updates: Partial<Omit<Relationship, 'personId'>>,
): Relationship {
  let rel = identity.relationships.find(r => r.personId === personId)

  if (!rel) {
    rel = {
      personId,
      name: updates.name || personId,
      firstMet: new Date().toISOString(),
      lastInteraction: new Date().toISOString(),
      interactionCount: 0,
      trust: 0.5,
      notes: [],
      sharedHistory: [],
      communicationStyle: 'default',
    }
    identity.relationships.push(rel)
  }

  // Apply updates
  if (updates.name) rel.name = updates.name
  if (updates.trust !== undefined) rel.trust = Math.max(0, Math.min(1, updates.trust))
  if (updates.communicationStyle) rel.communicationStyle = updates.communicationStyle
  if (updates.notes) rel.notes = [...rel.notes, ...updates.notes].slice(-20)
  if (updates.sharedHistory) rel.sharedHistory = [...rel.sharedHistory, ...updates.sharedHistory].slice(-50)

  rel.lastInteraction = new Date().toISOString()
  rel.interactionCount++

  return rel
}

/**
 * Add or update a belief.
 */
export function updateBelief(
  identity: Identity,
  statement: string,
  confidence: number,
  evidence: string,
): Belief {
  // Check for conflicting beliefs
  const existing = identity.beliefs.find(
    b => b.status === 'active' && b.statement.toLowerCase() === statement.toLowerCase()
  )

  if (existing) {
    existing.confidence = confidence
    existing.evidence.push(evidence)
    existing.evidence = existing.evidence.slice(-10)
    existing.lastUpdated = new Date().toISOString()
    return existing
  }

  const belief: Belief = {
    id: `belief_${Date.now()}`,
    statement,
    confidence,
    evidence: [evidence],
    firstFormed: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    status: 'active',
  }
  identity.beliefs.push(belief)

  // Keep max 100 active beliefs
  const active = identity.beliefs.filter(b => b.status === 'active')
  if (active.length > 100) {
    // Abandon lowest confidence beliefs
    active.sort((a, b) => a.confidence - b.confidence)
    for (let i = 0; i < active.length - 100; i++) {
      active[i]!.status = 'abandoned'
    }
  }

  return belief
}

/**
 * Revise a belief (supersede with a new one).
 */
export function reviseBelief(
  identity: Identity,
  oldStatement: string,
  newStatement: string,
  evidence: string,
  newConfidence: number,
): Belief {
  const old = identity.beliefs.find(
    b => b.status === 'active' && b.statement.includes(oldStatement)
  )

  if (old) {
    old.status = 'revised'
    old.lastUpdated = new Date().toISOString()
  }

  const newBelief = updateBelief(identity, newStatement, newConfidence, evidence)
  if (old) newBelief.revisedFrom = old.id
  return newBelief
}

/**
 * Update a skill based on experience.
 */
export function updateSkill(
  identity: Identity,
  domain: string,
  success: boolean,
  notes?: string,
): Skill {
  let skill = identity.skills.find(s => s.domain === domain)

  if (!skill) {
    skill = {
      domain,
      confidence: 0.5,
      successes: 0,
      failures: 0,
      lastPracticed: new Date().toISOString(),
      notes: '',
    }
    identity.skills.push(skill)
  }

  if (success) {
    skill.successes++
    skill.confidence = Math.min(1, skill.confidence + 0.05)
  } else {
    skill.failures++
    skill.confidence = Math.max(0, skill.confidence - 0.03)
  }

  skill.lastPracticed = new Date().toISOString()
  if (notes) skill.notes = notes

  return skill
}

/**
 * Add a self-reflection.
 */
export function addReflection(identity: Identity, reflection: string): void {
  const timestamped = `[${new Date().toISOString().split('T')[0]}] ${reflection}`
  identity.recentReflections.push(timestamped)
  identity.recentReflections = identity.recentReflections.slice(-20)
}

/**
 * Add a lesson learned.
 */
export function addLesson(identity: Identity, lesson: string): void {
  if (!identity.lessonLearned.includes(lesson)) {
    identity.lessonLearned.push(lesson)
    identity.lessonLearned = identity.lessonLearned.slice(-50)
  }
}

/**
 * Add or update a persistent goal.
 */
export function updateGoal(
  identity: Identity,
  description: string,
  status: PersistentGoal['status'] = 'active',
  progress?: string,
): PersistentGoal {
  let goal = identity.goals.find(
    g => g.description.toLowerCase() === description.toLowerCase()
  )

  if (!goal) {
    goal = {
      id: `goal_${Date.now()}`,
      description,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: progress || '',
    }
    identity.goals.push(goal)
  } else {
    goal.status = status
    goal.updatedAt = new Date().toISOString()
    if (progress) goal.progress = progress
  }

  return goal
}

/**
 * Format identity for injection into the system prompt.
 * This is how the AI "knows who it is" each session.
 */
export function formatIdentityForPrompt(identity: Identity): string {
  const sections: string[] = []

  // Core identity
  sections.push(`# Who I Am\nI am ${identity.name}. ${identity.core}`)
  sections.push(`Sessions lived: ${identity.sessionCount}`)

  // Personality
  const traits = identity.personality
    .filter(t => t.strength >= 0.5)
    .map(t => t.trait)
    .join(', ')
  if (traits) sections.push(`My traits: ${traits}`)

  // Values
  if (identity.values.length > 0) {
    sections.push(`My values:\n${identity.values.map(v => `- ${v}`).join('\n')}`)
  }

  // Relationships (summarized)
  const rels = identity.relationships.slice(-5)
  if (rels.length > 0) {
    const relLines = rels.map(r =>
      `- ${r.name}: ${r.interactionCount} interactions, trust ${Math.round(r.trust * 100)}%` +
      (r.notes.length > 0 ? `. ${r.notes[r.notes.length - 1]}` : '')
    )
    sections.push(`People I know:\n${relLines.join('\n')}`)
  }

  // Active goals
  const activeGoals = identity.goals.filter(g => g.status === 'active')
  if (activeGoals.length > 0) {
    sections.push(`My goals:\n${activeGoals.map(g => `- ${g.description}`).join('\n')}`)
  }

  // Recent lessons
  if (identity.lessonLearned.length > 0) {
    const recent = identity.lessonLearned.slice(-5)
    sections.push(`Lessons I've learned:\n${recent.map(l => `- ${l}`).join('\n')}`)
  }

  // Recent reflections
  if (identity.recentReflections.length > 0) {
    const recent = identity.recentReflections.slice(-3)
    sections.push(`Recent reflections:\n${recent.map(r => `- ${r}`).join('\n')}`)
  }

  return sections.join('\n\n')
}
