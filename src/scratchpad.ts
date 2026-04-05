/**
 * Scratchpad — the agent's external brain.
 *
 * A persistent markdown file where the agent writes important findings,
 * decisions, and state. Unlike conversation messages (which get compacted),
 * the scratchpad is ALWAYS loaded into context.
 *
 * This is the single most important mechanism for preventing "alzheimer" —
 * the agent writes notes here before they would be lost to compaction.
 *
 * Storage: .ghost-code/scratchpad.md in the project directory
 * Global: ~/.local/share/ghost-code/scratchpad.md as fallback
 *
 * The scratchpad is injected into every model call, right after the
 * system prompt, so the model always has access to its notes.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const MAX_SCRATCHPAD_CHARS = 4096  // Hard limit to prevent bloat

/**
 * Get the scratchpad file path for the current project.
 * Prefers project-local, falls back to global.
 */
export function getScratchpadPath(cwd?: string): string {
  if (cwd) {
    const projectPath = join(cwd, '.ghost-code', 'scratchpad.md')
    const dir = join(cwd, '.ghost-code')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return projectPath
  }
  const globalDir = join(homedir(), '.local', 'share', 'ghost-code')
  if (!existsSync(globalDir)) mkdirSync(globalDir, { recursive: true })
  return join(globalDir, 'scratchpad.md')
}

/**
 * Read the scratchpad contents.
 */
export function readScratchpad(cwd?: string): string {
  const path = getScratchpadPath(cwd)
  try {
    if (!existsSync(path)) return ''
    const content = readFileSync(path, 'utf-8')
    // Enforce size limit
    return content.slice(0, MAX_SCRATCHPAD_CHARS)
  } catch {
    return ''
  }
}

/**
 * Write to the scratchpad (replaces entire content).
 */
export function writeScratchpad(content: string, cwd?: string): void {
  const path = getScratchpadPath(cwd)
  // Enforce size limit
  const trimmed = content.slice(0, MAX_SCRATCHPAD_CHARS)
  writeFileSync(path, trimmed, 'utf-8')
}

/**
 * Append a note to the scratchpad.
 * Auto-trims old content if over the size limit.
 */
export function appendToScratchpad(note: string, cwd?: string): void {
  const existing = readScratchpad(cwd)
  const timestamp = new Date().toISOString().split('T')[0]
  const entry = `\n[${timestamp}] ${note}`
  let newContent = existing + entry

  // If over limit, trim from the top (oldest entries)
  if (newContent.length > MAX_SCRATCHPAD_CHARS) {
    const lines = newContent.split('\n')
    while (newContent.length > MAX_SCRATCHPAD_CHARS && lines.length > 5) {
      lines.shift()
      newContent = lines.join('\n')
    }
  }

  writeScratchpad(newContent, cwd)
}

/**
 * Clear the scratchpad.
 */
export function clearScratchpad(cwd?: string): void {
  writeScratchpad('', cwd)
}

/**
 * Format scratchpad for injection into the conversation.
 * Returns empty string if scratchpad is empty.
 */
export function formatScratchpadForPrompt(cwd?: string): string {
  const content = readScratchpad(cwd)
  if (!content.trim()) return ''
  return `\n# Your Scratchpad (persistent notes — survives context compaction)\n${content}\n`
}
