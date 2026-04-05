/**
 * Checkpoint system — saves and restores conversation state.
 *
 * Automatically saves checkpoints at key milestones:
 * - After every N tool rounds (default: 5)
 * - Before compaction
 * - On explicit /checkpoint command
 *
 * If the session crashes or is interrupted, the user can resume
 * from the last checkpoint with /resume.
 *
 * Storage: .ghost-code/checkpoints/ in the project directory
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { Message } from './api.js'

const MAX_CHECKPOINTS = 5  // Keep last N checkpoints

function getCheckpointDir(cwd?: string): string {
  const base = cwd || process.cwd()
  const dir = join(base, '.ghost-code', 'checkpoints')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Save a checkpoint of the current conversation state.
 */
export function saveCheckpoint(
  conversation: Message[],
  metadata?: { goal?: string; round?: number },
  cwd?: string,
): string {
  const dir = getCheckpointDir(cwd)
  const timestamp = Date.now()
  const filename = `checkpoint-${timestamp}.json`
  const path = join(dir, filename)

  const data = {
    timestamp,
    date: new Date().toISOString(),
    messageCount: conversation.length,
    metadata,
    conversation,
  }

  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')

  // Cleanup old checkpoints
  const files = readdirSync(dir)
    .filter(f => f.startsWith('checkpoint-') && f.endsWith('.json'))
    .sort()
  while (files.length > MAX_CHECKPOINTS) {
    const old = files.shift()!
    try {
      unlinkSync(join(dir, old))
    } catch {}
  }

  return filename
}

/**
 * Load the most recent checkpoint.
 */
export function loadLatestCheckpoint(cwd?: string): {
  conversation: Message[]
  metadata?: { goal?: string; round?: number }
  date: string
} | null {
  const dir = getCheckpointDir(cwd)
  if (!existsSync(dir)) return null

  const files = readdirSync(dir)
    .filter(f => f.startsWith('checkpoint-') && f.endsWith('.json'))
    .sort()

  if (files.length === 0) return null

  const latest = files[files.length - 1]!
  try {
    const data = JSON.parse(readFileSync(join(dir, latest), 'utf-8'))
    return {
      conversation: data.conversation,
      metadata: data.metadata,
      date: data.date,
    }
  } catch {
    return null
  }
}

/**
 * List available checkpoints.
 */
export function listCheckpoints(cwd?: string): Array<{
  filename: string
  date: string
  messageCount: number
  goal?: string
}> {
  const dir = getCheckpointDir(cwd)
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter(f => f.startsWith('checkpoint-') && f.endsWith('.json'))
    .sort()
    .map(f => {
      try {
        const data = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
        return {
          filename: f,
          date: data.date,
          messageCount: data.messageCount,
          goal: data.metadata?.goal,
        }
      } catch {
        return { filename: f, date: '?', messageCount: 0 }
      }
    })
}
