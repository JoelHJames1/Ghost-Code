/**
 * Task tracker — keeps the agent aware of what it's working on.
 *
 * When the agent starts a multi-step task, it should:
 * 1. Break it into subtasks
 * 2. Track which are done, which are pending
 * 3. Inject the task list into every model call so it never forgets
 *
 * The task list is stored in memory and injected as a system message
 * right before each model call, so even after context compaction
 * the model always knows what it was doing.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface Task {
  id: number
  description: string
  status: 'pending' | 'in_progress' | 'done' | 'failed'
  result?: string
}

export interface TaskList {
  goal: string
  tasks: Task[]
  startedAt: string
  project?: string
}

let currentTaskList: TaskList | null = null
let nextId = 1

/**
 * Start tracking a new task list with a goal.
 */
export function startTaskList(goal: string, project?: string): TaskList {
  currentTaskList = {
    goal,
    tasks: [],
    startedAt: new Date().toISOString(),
    project,
  }
  nextId = 1
  persistTasks()
  return currentTaskList
}

/**
 * Add a task to the current list.
 */
export function addTask(description: string): Task {
  if (!currentTaskList) {
    startTaskList('(auto-created task list)')
  }
  const task: Task = {
    id: nextId++,
    description,
    status: 'pending',
  }
  currentTaskList!.tasks.push(task)
  persistTasks()
  return task
}

/**
 * Update a task's status.
 */
export function updateTask(id: number, status: Task['status'], result?: string): void {
  if (!currentTaskList) return
  const task = currentTaskList.tasks.find(t => t.id === id)
  if (task) {
    task.status = status
    if (result) task.result = result
    persistTasks()
  }
}

/**
 * Get the current task list.
 */
export function getTaskList(): TaskList | null {
  return currentTaskList
}

/**
 * Clear the current task list.
 */
export function clearTasks(): void {
  currentTaskList = null
  persistTasks()
}

/**
 * Format the task list as a string for injection into the conversation.
 * This keeps the model aware of its progress even after compaction.
 */
export function formatTaskListForPrompt(): string {
  if (!currentTaskList || currentTaskList.tasks.length === 0) return ''

  const statusIcon = (s: Task['status']) => {
    switch (s) {
      case 'done': return '[x]'
      case 'in_progress': return '[>]'
      case 'failed': return '[!]'
      case 'pending': return '[ ]'
    }
  }

  const lines = [`# Current Task: ${currentTaskList.goal}`, '']
  for (const task of currentTaskList.tasks) {
    let line = `${statusIcon(task.status)} ${task.id}. ${task.description}`
    if (task.result) line += ` → ${task.result}`
    lines.push(line)
  }

  const done = currentTaskList.tasks.filter(t => t.status === 'done').length
  const total = currentTaskList.tasks.length
  lines.push('', `Progress: ${done}/${total} complete`)

  return lines.join('\n')
}

// ── Persistence ──────────────────────────────────────────────────────────

function getTasksPath(): string {
  const dir = join(homedir(), '.local', 'share', 'ghost-code')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'current-tasks.json')
}

function persistTasks(): void {
  const path = getTasksPath()
  if (currentTaskList) {
    writeFileSync(path, JSON.stringify(currentTaskList, null, 2) + '\n', 'utf-8')
  } else {
    try { writeFileSync(path, '{}', 'utf-8') } catch {}
  }
}

/**
 * Load tasks from disk (for resuming after a restart).
 */
export function loadPersistedTasks(): TaskList | null {
  const path = getTasksPath()
  try {
    if (!existsSync(path)) return null
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    if (data.goal && data.tasks) {
      currentTaskList = data
      nextId = Math.max(...data.tasks.map((t: Task) => t.id), 0) + 1
      return currentTaskList
    }
  } catch {}
  return null
}
