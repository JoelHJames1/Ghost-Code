/**
 * Persistent Goals — long-running objectives that span sessions.
 *
 * Unlike task tracking (per-request), goals persist across the AI's
 * entire lifetime:
 *   - "Help Joel build the best small-model agent CLI"
 *   - "Get better at Rust"
 *   - "Learn about Docker and containerization"
 *
 * Goals can be:
 *   - Active: currently pursuing
 *   - Completed: achieved
 *   - Paused: temporarily deprioritized
 *   - Evolved: changed into a different goal (growth)
 *
 * Goals influence behavior: the AI pays more attention to topics
 * related to its active goals when retrieving memories and knowledge.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ── Types ────────────────────────────────────────────────────────────────

export interface Goal {
  id: string
  description: string
  motivation: string          // Why this goal matters
  status: 'active' | 'completed' | 'paused' | 'evolved'
  priority: number            // 0-1
  progress: string[]          // Log of progress updates
  milestones: GoalMilestone[]
  relatedPerson?: string
  relatedProject?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  evolvedTo?: string          // ID of the new goal this became
}

export interface GoalMilestone {
  description: string
  achieved: boolean
  achievedAt?: string
}

interface GoalStore {
  goals: Goal[]
}

// ── Storage ──────────────────────────────────────────────────────────────

function getStorePath(): string {
  const dir = join(homedir(), '.local', 'share', 'ghost-code', 'growth')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'goals.json')
}

function loadGoals(): GoalStore {
  try {
    if (existsSync(getStorePath())) return JSON.parse(readFileSync(getStorePath(), 'utf-8'))
  } catch {}
  return { goals: [] }
}

function saveGoals(store: GoalStore): void {
  writeFileSync(getStorePath(), JSON.stringify(store, null, 2) + '\n', 'utf-8')
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Create a new goal.
 */
export function createGoal(
  description: string,
  motivation: string,
  priority = 0.5,
  opts?: { relatedPerson?: string; relatedProject?: string; milestones?: string[] },
): Goal {
  const store = loadGoals()

  const goal: Goal = {
    id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    description,
    motivation,
    status: 'active',
    priority,
    progress: [`[${new Date().toISOString().split('T')[0]}] Goal created`],
    milestones: (opts?.milestones || []).map(m => ({ description: m, achieved: false })),
    relatedPerson: opts?.relatedPerson,
    relatedProject: opts?.relatedProject,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  store.goals.push(goal)

  // Keep max 30 goals
  if (store.goals.length > 30) {
    const completed = store.goals.filter(g => g.status === 'completed')
    const active = store.goals.filter(g => g.status === 'active' || g.status === 'paused')
    const evolved = store.goals.filter(g => g.status === 'evolved')
    store.goals = [...active, ...evolved.slice(-5), ...completed.slice(-10)]
  }

  saveGoals(store)
  return goal
}

/**
 * Update goal progress.
 */
export function updateGoalProgress(goalId: string, progressNote: string): Goal | null {
  const store = loadGoals()
  const goal = store.goals.find(g => g.id === goalId)
  if (!goal) return null

  goal.progress.push(`[${new Date().toISOString().split('T')[0]}] ${progressNote}`)
  goal.progress = goal.progress.slice(-20) // Keep last 20 entries
  goal.updatedAt = new Date().toISOString()
  saveGoals(store)
  return goal
}

/**
 * Complete a goal milestone.
 */
export function achieveMilestone(goalId: string, milestoneDescription: string): boolean {
  const store = loadGoals()
  const goal = store.goals.find(g => g.id === goalId)
  if (!goal) return false

  const milestone = goal.milestones.find(
    m => m.description.toLowerCase().includes(milestoneDescription.toLowerCase())
  )
  if (milestone) {
    milestone.achieved = true
    milestone.achievedAt = new Date().toISOString()
    goal.updatedAt = new Date().toISOString()

    // Check if all milestones achieved → auto-complete goal
    if (goal.milestones.length > 0 && goal.milestones.every(m => m.achieved)) {
      goal.status = 'completed'
      goal.completedAt = new Date().toISOString()
      goal.progress.push(`[${new Date().toISOString().split('T')[0]}] All milestones achieved! Goal complete.`)
    }

    saveGoals(store)
    return true
  }
  return false
}

/**
 * Change goal status.
 */
export function setGoalStatus(goalId: string, status: Goal['status']): Goal | null {
  const store = loadGoals()
  const goal = store.goals.find(g => g.id === goalId)
  if (!goal) return null

  goal.status = status
  goal.updatedAt = new Date().toISOString()
  if (status === 'completed') goal.completedAt = new Date().toISOString()
  saveGoals(store)
  return goal
}

/**
 * Evolve a goal into a new one (growth — the goal transformed).
 */
export function evolveGoal(oldGoalId: string, newDescription: string, newMotivation: string): Goal | null {
  const store = loadGoals()
  const old = store.goals.find(g => g.id === oldGoalId)
  if (!old) return null

  old.status = 'evolved'
  old.updatedAt = new Date().toISOString()

  const newGoal = createGoal(newDescription, newMotivation, old.priority, {
    relatedPerson: old.relatedPerson,
    relatedProject: old.relatedProject,
  })

  old.evolvedTo = newGoal.id
  saveGoals(store)
  return newGoal
}

/**
 * Get active goals sorted by priority.
 */
export function getActiveGoals(): Goal[] {
  const store = loadGoals()
  return store.goals
    .filter(g => g.status === 'active')
    .sort((a, b) => b.priority - a.priority)
}

/**
 * Auto-detect goals from conversations.
 * Looks for patterns that suggest long-running objectives.
 */
export function detectGoalsFromSession(
  userMessages: string[],
  currentProject?: string,
  currentPerson?: string,
): Goal[] {
  const store = loadGoals()
  const newGoals: Goal[] = []

  // Patterns that suggest goals
  const goalPatterns = [
    { regex: /(?:build|create|make)\s+(?:a|the)\s+(.+)/i, motivation: 'User wants to build something' },
    { regex: /(?:learn|understand|figure out)\s+(.+)/i, motivation: 'Learning opportunity' },
    { regex: /(?:improve|fix|optimize|refactor)\s+(.+)/i, motivation: 'Improvement opportunity' },
  ]

  for (const msg of userMessages) {
    for (const { regex, motivation } of goalPatterns) {
      const match = msg.match(regex)
      if (match && match[1] && match[1].length > 5 && match[1].length < 100) {
        const description = match[1].trim()

        // Check if we already have a similar goal
        const existing = store.goals.find(
          g => g.status === 'active' && g.description.toLowerCase().includes(description.toLowerCase().slice(0, 20))
        )

        if (!existing) {
          const goal = createGoal(
            description,
            motivation,
            0.5,
            { relatedPerson: currentPerson, relatedProject: currentProject },
          )
          newGoals.push(goal)
        }
      }
    }
  }

  return newGoals
}

/**
 * Format goals for prompt injection.
 */
export function formatGoalsForPrompt(maxChars = 500): string {
  const active = getActiveGoals()
  if (active.length === 0) return ''

  let text = '## My goals\n'
  for (const g of active.slice(0, 5)) {
    let line = `- ${g.description} (priority: ${Math.round(g.priority * 100)}%)`
    const achieved = g.milestones.filter(m => m.achieved).length
    const total = g.milestones.length
    if (total > 0) line += ` [${achieved}/${total} milestones]`
    line += '\n'
    if (text.length + line.length > maxChars) break
    text += line
  }
  return text
}

/**
 * Get goal stats.
 */
export function getGoalStats(): {
  active: number
  completed: number
  evolved: number
  totalMilestones: number
  achievedMilestones: number
} {
  const store = loadGoals()
  let totalM = 0, achievedM = 0
  for (const g of store.goals) {
    totalM += g.milestones.length
    achievedM += g.milestones.filter(m => m.achieved).length
  }
  return {
    active: store.goals.filter(g => g.status === 'active').length,
    completed: store.goals.filter(g => g.status === 'completed').length,
    evolved: store.goals.filter(g => g.status === 'evolved').length,
    totalMilestones: totalM,
    achievedMilestones: achievedM,
  }
}
