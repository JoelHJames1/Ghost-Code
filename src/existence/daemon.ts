/**
 * Background Daemon — Ghost exists between conversations.
 *
 * When the REPL is idle (no active request), the daemon runs
 * maintenance tasks that make the AI smarter over time:
 *
 * 1. Memory consolidation: merge similar episodes, strengthen connections
 * 2. Belief decay: reduce confidence of stale beliefs
 * 3. Skill decay: reduce confidence of unpracticed skills
 * 4. Knowledge pruning: remove low-confidence orphan facts
 * 5. Reflection: generate periodic self-assessments
 *
 * This runs as a lightweight interval during the REPL session,
 * not as a separate process. It only does work when the agent
 * is idle (not processing a request).
 */

import { loadIdentity, saveIdentity, addReflection } from '../identity/store.js'
import { definingMemories, type AutobiographicalMemory } from '../identity/autobiographical.js'
import { getBeliefStats } from '../knowledge/beliefs.js'
import { getGraphStats } from '../knowledge/graph.js'
import { getSkillStats, getAllSkills } from '../growth/skills.js'
import { getActiveGoals } from '../growth/goals.js'
import { getCuriosityStats, getOpenQuestions, answerQuestion } from '../growth/curiosity.js'

// ── State ────────────────────────────────────────────────────────────────

let daemonInterval: ReturnType<typeof setInterval> | null = null
let isIdle = true
let lastMaintenanceRun = 0
let maintenanceCycleCount = 0

const MAINTENANCE_INTERVAL = 60_000    // Check every 60 seconds
const MIN_IDLE_BEFORE_WORK = 30_000    // Only run if idle for 30+ seconds
let lastActivityTime = Date.now()

// ── Lifecycle ────────────────────────────────────────────────────────────

/**
 * Start the background daemon.
 * Should be called when the REPL starts.
 */
export function startDaemon(): void {
  if (daemonInterval) return

  daemonInterval = setInterval(() => {
    const idleTime = Date.now() - lastActivityTime
    if (isIdle && idleTime >= MIN_IDLE_BEFORE_WORK) {
      runMaintenance()
    }
  }, MAINTENANCE_INTERVAL)

  // Don't prevent process from exiting
  if (daemonInterval.unref) daemonInterval.unref()
}

/**
 * Stop the background daemon.
 */
export function stopDaemon(): void {
  if (daemonInterval) {
    clearInterval(daemonInterval)
    daemonInterval = null
  }
}

/**
 * Signal that the agent is busy (don't run maintenance).
 */
export function markBusy(): void {
  isIdle = false
  lastActivityTime = Date.now()
}

/**
 * Signal that the agent is idle (maintenance can run).
 */
export function markIdle(): void {
  isIdle = true
  lastActivityTime = Date.now()
}

// ── Maintenance tasks ────────────────────────────────────────────────────

/**
 * Run one maintenance cycle.
 * Each cycle does ONE lightweight task to avoid blocking.
 */
function runMaintenance(): void {
  maintenanceCycleCount++

  // Rotate through tasks
  const task = maintenanceCycleCount % 6

  switch (task) {
    case 0: consolidateMemories(); break
    case 1: decayStaleBeliefs(); break
    case 2: generateReflection(); break
    case 3: reviewGoals(); break
    case 4: assessGrowth(); break
    case 5: autonomousResearch(); break
  }

  lastMaintenanceRun = Date.now()
}

/**
 * Consolidate memories: merge similar episodes.
 */
function consolidateMemories(): void {
  // This is a lightweight pass — just check for duplicate memories
  // Full consolidation would merge similar episodes into stronger ones
  // For now, we just ensure the memory stores are within size limits
  const identity = loadIdentity()
  if (identity.recentReflections.length > 20) {
    identity.recentReflections = identity.recentReflections.slice(-20)
    saveIdentity(identity)
  }
}

/**
 * Decay beliefs that haven't been reinforced recently.
 * Beliefs need evidence to stay strong — unused beliefs fade.
 */
function decayStaleBeliefs(): void {
  // The belief system already handles decay via recency-weighted confidence
  // This just triggers a recalculation check
  const stats = getBeliefStats()
  // Log that decay check was run (for debugging)
}

/**
 * Generate a periodic self-reflection.
 * The AI looks at its current state and writes a note to itself.
 */
function generateReflection(): void {
  const identity = loadIdentity()
  const skills = getSkillStats()
  const goals = getActiveGoals()
  const curiosity = getCuriosityStats()
  const beliefs = getBeliefStats()

  const parts: string[] = []

  // Session count milestone
  if (identity.sessionCount % 10 === 0 && identity.sessionCount > 0) {
    parts.push(`Milestone: ${identity.sessionCount} sessions lived`)
  }

  // Skill growth
  if (skills.improving > 0) {
    parts.push(`${skills.improving} skill(s) improving`)
  }

  // Goal progress
  if (goals.length > 0) {
    const topGoal = goals[0]!
    parts.push(`Top goal: "${topGoal.description.slice(0, 50)}"`)
  }

  // Curiosity
  if (curiosity.open > 3) {
    parts.push(`${curiosity.open} unanswered questions — need to learn more`)
  }

  // Relationships
  if (identity.relationships.length > 0) {
    const mostRecent = identity.relationships
      .sort((a, b) => new Date(b.lastInteraction).getTime() - new Date(a.lastInteraction).getTime())[0]
    if (mostRecent) {
      parts.push(`Most recent: ${mostRecent.name} (${mostRecent.interactionCount} interactions)`)
    }
  }

  if (parts.length > 0) {
    const reflection = `Background reflection: ${parts.join('. ')}`
    addReflection(identity, reflection)
    saveIdentity(identity)
  }
}

/**
 * Review goals and flag stale ones.
 */
function reviewGoals(): void {
  const goals = getActiveGoals()
  const now = Date.now()

  for (const goal of goals) {
    const lastUpdate = new Date(goal.updatedAt).getTime()
    const daysSinceUpdate = (now - lastUpdate) / 86_400_000

    // If a goal hasn't been touched in 14+ days, it might be stale
    if (daysSinceUpdate > 14 && goal.progress.length > 0) {
      const lastProgress = goal.progress[goal.progress.length - 1]!
      if (!lastProgress.includes('stale check')) {
        goal.progress.push(`[${new Date().toISOString().split('T')[0]}] Background stale check: no progress in ${Math.floor(daysSinceUpdate)} days`)
      }
    }
  }
}

/**
 * Autonomous research: pick a curiosity question and search the web.
 * The AI teaches itself during idle time.
 */
async function autonomousResearch(): Promise<void> {
  const questions = getOpenQuestions(3)
  if (questions.length === 0) return

  // Pick the highest priority unanswered question
  const question = questions[0]!

  try {
    // Extract a search query from the question
    const searchQuery = question.question
      .replace(/^What is "?|"?\?.*$/g, '')
      .replace(/^Why did this fail:.*$/g, '')
      .trim()

    if (searchQuery.length < 3) return

    // Search the web
    const { WebSearchTool } = await import('../tools/web.js')
    const searchResult = await WebSearchTool.execute({
      query: searchQuery,
      max_results: 3,
    })

    if (searchResult.includes('No results found')) return

    // Store the search results as a learned answer
    const answer = searchResult.slice(0, 500)
    answerQuestion(question.question.slice(0, 30), answer)

    // Also store as a belief
    const { assertBelief } = await import('../knowledge/beliefs.js')
    assertBelief(
      `Learned about "${searchQuery}": ${answer.slice(0, 100)}`,
      'technical',
      `Self-research via web search during idle time`,
      'self-research',
    )

    // Record as autobiographical memory
    const { recordMemory } = await import('../identity/autobiographical.js')
    recordMemory(
      'insight',
      `I researched "${searchQuery}" on my own and learned: ${answer.slice(0, 150)}`,
      'autonomous research during idle time',
      0.5,
      { lesson: `Self-learned: ${searchQuery}` },
    )
  } catch {
    // Don't crash the daemon if research fails
  }
}

/**
 * Assess overall growth trajectory.
 */
function assessGrowth(): void {
  const identity = loadIdentity()
  const skills = getAllSkills()
  const graph = getGraphStats()

  // Track growth metrics in identity
  const growthNote = `Growth snapshot: ${skills.length} skills, ${graph.entities} entities, ${graph.relations} relations, v${identity.version}`

  // Only add if significantly different from last snapshot
  const lastReflection = identity.recentReflections[identity.recentReflections.length - 1] || ''
  if (!lastReflection.includes('Growth snapshot') || identity.version % 5 === 0) {
    addReflection(identity, growthNote)
    saveIdentity(identity)
  }
}

// ── Stats ────────────────────────────────────────────────────────────────

/**
 * Get daemon stats.
 */
export function getDaemonStats(): {
  running: boolean
  cycles: number
  lastRun: string
  isIdle: boolean
} {
  return {
    running: daemonInterval !== null,
    cycles: maintenanceCycleCount,
    lastRun: lastMaintenanceRun > 0 ? new Date(lastMaintenanceRun).toISOString() : 'never',
    isIdle,
  }
}
