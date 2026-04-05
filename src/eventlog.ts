/**
 * Event log — append-only ground truth for all agent actions.
 *
 * Every significant action (message, tool call, tool result, task transition,
 * memory write, agent spawn) is recorded as an immutable event. This is the
 * canonical record of what happened — summaries and projections are derived
 * from it and can always be rebuilt.
 *
 * Stored at: .ghost-code/events.jsonl (newline-delimited JSON)
 *
 * Benefits:
 * - Replay: rebuild any state by replaying the log
 * - Auditability: every action has provenance
 * - Anti-alzheimer: even if context is compacted, the full trace exists
 * - Debugging: see exactly what the agent did and when
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// ── Types ────────────────────────────────────────────────────────────────

export type EventType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'task_created'
  | 'task_updated'
  | 'memory_write'
  | 'compaction'
  | 'checkpoint'
  | 'agent_spawned'
  | 'agent_completed'
  | 'error'
  | 'session_start'
  | 'session_end'

export interface Event {
  id: string
  timestamp: number
  type: EventType
  actor: string           // 'user', 'orchestrator', agent name, 'system'
  scope?: string          // task_id, project name, etc.
  payload: Record<string, unknown>
  parentId?: string       // for causal chaining
}

// ── State ────────────────────────────────────────────────────────────────

let eventCounter = 0
let logPath: string | null = null

function ensureLogPath(): string {
  if (logPath) return logPath
  const dir = join(process.cwd(), '.ghost-code')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  logPath = join(dir, 'events.jsonl')
  return logPath
}

// ── Core API ─────────────────────────────────────────────────────────────

/**
 * Append an event to the log. Returns the event ID.
 */
export function logEvent(
  type: EventType,
  actor: string,
  payload: Record<string, unknown>,
  opts?: { scope?: string; parentId?: string },
): string {
  const id = `evt_${Date.now()}_${eventCounter++}`
  const event: Event = {
    id,
    timestamp: Date.now(),
    type,
    actor,
    payload,
    scope: opts?.scope,
    parentId: opts?.parentId,
  }

  try {
    appendFileSync(ensureLogPath(), JSON.stringify(event) + '\n', 'utf-8')
  } catch {
    // Don't crash if logging fails — it's observability, not control flow
  }

  return id
}

/**
 * Read all events from the log.
 */
export function readEventLog(): Event[] {
  const path = ensureLogPath()
  if (!existsSync(path)) return []

  try {
    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
    return lines.map(line => JSON.parse(line) as Event)
  } catch {
    return []
  }
}

/**
 * Read events filtered by type, actor, or scope.
 */
export function queryEvents(filters: {
  type?: EventType | EventType[]
  actor?: string
  scope?: string
  since?: number
  limit?: number
}): Event[] {
  let events = readEventLog()

  if (filters.type) {
    const types = Array.isArray(filters.type) ? filters.type : [filters.type]
    events = events.filter(e => types.includes(e.type))
  }
  if (filters.actor) {
    events = events.filter(e => e.actor === filters.actor)
  }
  if (filters.scope) {
    events = events.filter(e => e.scope === filters.scope)
  }
  if (filters.since) {
    events = events.filter(e => e.timestamp >= filters.since)
  }
  if (filters.limit) {
    events = events.slice(-filters.limit)
  }

  return events
}

/**
 * Get a summary of recent activity from the event log.
 * Useful for rebuilding context after a crash or compaction.
 */
export function getRecentActivitySummary(maxEvents = 50): string {
  const events = readEventLog().slice(-maxEvents)
  if (events.length === 0) return ''

  const lines: string[] = []
  for (const e of events) {
    const time = new Date(e.timestamp).toISOString().split('T')[1]?.split('.')[0]
    switch (e.type) {
      case 'user_message':
        lines.push(`[${time}] User: ${String(e.payload.content || '').slice(0, 100)}`)
        break
      case 'tool_call':
        lines.push(`[${time}] Tool: ${e.payload.tool}(${String(e.payload.args || '').slice(0, 60)})`)
        break
      case 'tool_result':
        lines.push(`[${time}] Result: ${String(e.payload.result || '').slice(0, 80)}`)
        break
      case 'task_created':
        lines.push(`[${time}] Task: ${e.payload.goal}`)
        break
      case 'task_updated':
        lines.push(`[${time}] Task ${e.payload.id} → ${e.payload.status}`)
        break
      case 'error':
        lines.push(`[${time}] ERROR: ${String(e.payload.message || '').slice(0, 100)}`)
        break
      case 'compaction':
        lines.push(`[${time}] Context compacted: ${e.payload.removedCount} messages`)
        break
    }
  }

  return lines.join('\n')
}

/**
 * Get event log stats.
 */
export function getEventLogStats(): {
  totalEvents: number
  toolCalls: number
  errors: number
  compactions: number
  sessionStart?: string
} {
  const events = readEventLog()
  return {
    totalEvents: events.length,
    toolCalls: events.filter(e => e.type === 'tool_call').length,
    errors: events.filter(e => e.type === 'error').length,
    compactions: events.filter(e => e.type === 'compaction').length,
    sessionStart: events.find(e => e.type === 'session_start')
      ? new Date(events.find(e => e.type === 'session_start')!.timestamp).toISOString()
      : undefined,
  }
}
