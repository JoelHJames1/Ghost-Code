/**
 * Skill Memory — tracks what the AI is good at and where it struggles.
 *
 * Skills improve through practice and degrade through disuse.
 * The AI can use this to:
 *   - Choose better approaches ("I'm better at Python than Rust")
 *   - Set realistic expectations ("I struggle with CSS layouts")
 *   - Track improvement over time ("TypeScript: 45% → 82% over 20 sessions")
 *
 * Each skill has:
 *   - Confidence: current ability level (0-1)
 *   - History: timestamped success/failure records
 *   - Trend: improving, stable, or declining
 *   - Last practiced: recency affects recommendations
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ── Types ──────────────���─────────────────────────────────────────────────

export interface SkillRecord {
  timestamp: string
  success: boolean
  context: string       // What was attempted
  difficulty?: number   // 0-1, how hard was this task
}

export interface Skill {
  domain: string
  category: string           // 'language', 'tool', 'concept', 'framework'
  confidence: number         // 0-1, current ability
  history: SkillRecord[]     // Recent practice records
  totalSuccesses: number
  totalFailures: number
  firstPracticed: string
  lastPracticed: string
  trend: 'improving' | 'stable' | 'declining' | 'new'
  peakConfidence: number     // Highest ever achieved
  notes: string[]            // Observations about this skill
}

interface SkillStore {
  skills: Skill[]
}

// ── Storage ──────────────────────────────────────────────────────────────

function getStorePath(): string {
  const dir = join(homedir(), '.local', 'share', 'gemma-code', 'growth')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'skills.json')
}

function loadSkills(): SkillStore {
  try {
    if (existsSync(getStorePath())) return JSON.parse(readFileSync(getStorePath(), 'utf-8'))
  } catch {}
  return { skills: [] }
}

function saveSkills(store: SkillStore): void {
  writeFileSync(getStorePath(), JSON.stringify(store, null, 2) + '\n', 'utf-8')
}

// ── Confidence calculation ───────────────────────────────────────────────

/**
 * Calculate confidence from recent practice history.
 * Recent results weighted more heavily. Disuse causes decay.
 */
function calculateSkillConfidence(skill: Skill): number {
  const now = Date.now()
  const recent = skill.history.slice(-20) // Last 20 records

  if (recent.length === 0) return 0.5

  let score = 0
  let weight = 0

  for (const record of recent) {
    const age = now - new Date(record.timestamp).getTime()
    const recency = Math.exp(-age / (14 * 24 * 60 * 60 * 1000)) // 14-day half-life
    const difficultyBonus = record.difficulty ? record.difficulty * 0.3 : 0
    const w = 0.2 + 0.8 * recency

    score += record.success ? (w + difficultyBonus) : (-w * 0.7) // Failures hurt less than successes help
    weight += w
  }

  const raw = weight > 0 ? (score / weight + 1) / 2 : 0.5

  // Decay for disuse
  const lastPracticed = new Date(skill.lastPracticed).getTime()
  const daysSince = (now - lastPracticed) / 86_400_000
  const decay = daysSince > 30 ? Math.max(0.8, 1 - (daysSince - 30) * 0.003) : 1

  return Math.max(0.05, Math.min(0.99, raw * decay))
}

/**
 * Calculate trend from recent history.
 */
function calculateTrend(skill: Skill): Skill['trend'] {
  if (skill.history.length < 5) return 'new'

  const recent5 = skill.history.slice(-5)
  const older5 = skill.history.slice(-10, -5)

  if (older5.length === 0) return 'new'

  const recentRate = recent5.filter(r => r.success).length / recent5.length
  const olderRate = older5.filter(r => r.success).length / older5.length

  if (recentRate > olderRate + 0.15) return 'improving'
  if (recentRate < olderRate - 0.15) return 'declining'
  return 'stable'
}

// ── Public API ─────────���─────────────────────────────────────────────────

/**
 * Record a skill practice event.
 */
export function practiceSkill(
  domain: string,
  category: string,
  success: boolean,
  context: string,
  difficulty?: number,
): Skill {
  const store = loadSkills()
  let skill = store.skills.find(s => s.domain.toLowerCase() === domain.toLowerCase())

  if (!skill) {
    skill = {
      domain,
      category,
      confidence: 0.5,
      history: [],
      totalSuccesses: 0,
      totalFailures: 0,
      firstPracticed: new Date().toISOString(),
      lastPracticed: new Date().toISOString(),
      trend: 'new',
      peakConfidence: 0.5,
      notes: [],
    }
    store.skills.push(skill)
  }

  // Record the practice
  skill.history.push({
    timestamp: new Date().toISOString(),
    success,
    context: context.slice(0, 200),
    difficulty,
  })

  // Keep last 100 records
  if (skill.history.length > 100) {
    skill.history = skill.history.slice(-100)
  }

  if (success) skill.totalSuccesses++
  else skill.totalFailures++

  skill.lastPracticed = new Date().toISOString()
  skill.confidence = calculateSkillConfidence(skill)
  skill.trend = calculateTrend(skill)
  if (skill.confidence > skill.peakConfidence) {
    skill.peakConfidence = skill.confidence
  }

  saveSkills(store)
  return skill
}

/**
 * Add a note to a skill.
 */
export function addSkillNote(domain: string, note: string): void {
  const store = loadSkills()
  const skill = store.skills.find(s => s.domain.toLowerCase() === domain.toLowerCase())
  if (skill) {
    skill.notes.push(`[${new Date().toISOString().split('T')[0]}] ${note}`)
    skill.notes = skill.notes.slice(-10)
    saveSkills(store)
  }
}

/**
 * Get all skills sorted by confidence.
 */
export function getAllSkills(): Skill[] {
  const store = loadSkills()
  return store.skills.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Get skills the AI is strong at.
 */
export function getStrengths(threshold = 0.7): Skill[] {
  return getAllSkills().filter(s => s.confidence >= threshold)
}

/**
 * Get skills the AI struggles with.
 */
export function getWeaknesses(threshold = 0.4): Skill[] {
  return getAllSkills().filter(s => s.confidence < threshold && s.history.length >= 3)
}

/**
 * Get skills that are improving.
 */
export function getImprovingSkills(): Skill[] {
  return getAllSkills().filter(s => s.trend === 'improving')
}

/**
 * Format skills for prompt injection.
 */
export function formatSkillsForPrompt(maxChars = 600): string {
  const skills = getAllSkills()
  if (skills.length === 0) return ''

  let text = '## My skills\n'

  const strengths = skills.filter(s => s.confidence >= 0.7)
  const weaknesses = skills.filter(s => s.confidence < 0.4 && s.history.length >= 3)

  if (strengths.length > 0) {
    text += 'Strong: ' + strengths.map(s =>
      `${s.domain} (${Math.round(s.confidence * 100)}%${s.trend === 'improving' ? ' ↑' : ''})`
    ).join(', ') + '\n'
  }

  if (weaknesses.length > 0) {
    text += 'Weak: ' + weaknesses.map(s =>
      `${s.domain} (${Math.round(s.confidence * 100)}%${s.trend === 'declining' ? ' ↓' : ''})`
    ).join(', ') + '\n'
  }

  return text.length > maxChars ? text.slice(0, maxChars) : text
}

/**
 * Get skill stats.
 */
export function getSkillStats(): {
  total: number
  strengths: number
  weaknesses: number
  improving: number
  totalPractice: number
} {
  const skills = getAllSkills()
  return {
    total: skills.length,
    strengths: skills.filter(s => s.confidence >= 0.7).length,
    weaknesses: skills.filter(s => s.confidence < 0.4 && s.history.length >= 3).length,
    improving: skills.filter(s => s.trend === 'improving').length,
    totalPractice: skills.reduce((s, sk) => s + sk.history.length, 0),
  }
}
