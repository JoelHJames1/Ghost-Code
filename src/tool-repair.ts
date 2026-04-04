/**
 * Tool call repair — fixes common malformed tool calls from LLMs.
 *
 * Even strong models occasionally produce:
 * - Trailing commas in JSON: {"key": "value",}
 * - Single quotes instead of double: {'key': 'value'}
 * - Unquoted keys: {key: "value"}
 * - Missing closing braces: {"key": "value"
 * - Embedded markdown: ```json\n{...}\n```
 * - Extra text before/after JSON: "Here is the call: {...}"
 * - Escaped newlines in strings that break JSON
 * - Tool name case mismatches: "read" instead of "Read"
 *
 * The repair layer attempts to fix these before failing,
 * saving a round trip to the model.
 */

import { getTool, getToolNames } from './tools/index.js'

/**
 * Attempt to repair malformed JSON arguments.
 * Returns parsed object or null if repair fails.
 */
export function repairJSON(raw: string): Record<string, unknown> | null {
  // 1. Try direct parse first (fast path)
  try {
    return JSON.parse(raw)
  } catch {}

  let fixed = raw.trim()

  // 2. Strip markdown code fences: ```json ... ```
  fixed = fixed.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '')

  // 3. Extract JSON from surrounding text
  // Look for the outermost { ... } or [ ... ]
  const braceStart = fixed.indexOf('{')
  const bracketStart = fixed.indexOf('[')
  if (braceStart >= 0) {
    const lastBrace = fixed.lastIndexOf('}')
    if (lastBrace > braceStart) {
      fixed = fixed.slice(braceStart, lastBrace + 1)
    }
  } else if (bracketStart >= 0) {
    const lastBracket = fixed.lastIndexOf(']')
    if (lastBracket > bracketStart) {
      fixed = fixed.slice(bracketStart, lastBracket + 1)
    }
  }

  // Try after extraction
  try { return JSON.parse(fixed) } catch {}

  // 4. Fix single quotes → double quotes (but not inside strings)
  fixed = fixed.replace(/'/g, '"')
  try { return JSON.parse(fixed) } catch {}

  // 5. Fix trailing commas: ,} or ,]
  fixed = fixed.replace(/,\s*([\]}])/g, '$1')
  try { return JSON.parse(fixed) } catch {}

  // 6. Fix unquoted keys: { key: "value" } → { "key": "value" }
  fixed = fixed.replace(/(\{|,)\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":')
  try { return JSON.parse(fixed) } catch {}

  // 7. Fix missing closing brace/bracket
  const openBraces = (fixed.match(/{/g) || []).length
  const closeBraces = (fixed.match(/}/g) || []).length
  if (openBraces > closeBraces) {
    fixed += '}'.repeat(openBraces - closeBraces)
  }
  const openBrackets = (fixed.match(/\[/g) || []).length
  const closeBrackets = (fixed.match(/]/g) || []).length
  if (openBrackets > closeBrackets) {
    fixed += ']'.repeat(openBrackets - closeBrackets)
  }
  try { return JSON.parse(fixed) } catch {}

  // 8. Fix escaped newlines in string values that aren't properly escaped
  fixed = fixed.replace(/\n/g, '\\n')
  try { return JSON.parse(fixed) } catch {}

  // 9. Last resort: try to extract key-value pairs manually
  // Handles cases like: file_path="src/auth.ts" old_string="foo"
  const kvPattern = /(\w+)\s*[=:]\s*"([^"]*)"/g
  let match
  const obj: Record<string, string> = {}
  let found = false
  // Reset the regex
  const kvStr = raw
  while ((match = kvPattern.exec(kvStr)) !== null) {
    obj[match[1]!] = match[2]!
    found = true
  }
  if (found) return obj

  return null
}

/**
 * Repair a tool name to match the registered tool names.
 * Handles case mismatches and common aliases.
 */
export function repairToolName(name: string): string {
  // Exact match
  if (getTool(name)) return name

  // Case-insensitive match
  const toolNames = getToolNames()
  const lower = name.toLowerCase()
  const match = toolNames.find(t => t.toLowerCase() === lower)
  if (match) return match

  // Common aliases
  const aliases: Record<string, string> = {
    'read_file': 'Read',
    'readfile': 'Read',
    'write_file': 'Write',
    'writefile': 'Write',
    'edit_file': 'Edit',
    'editfile': 'Edit',
    'bash_command': 'Bash',
    'run_command': 'Bash',
    'shell': 'Bash',
    'exec': 'Bash',
    'find_files': 'Glob',
    'search_files': 'Grep',
    'search': 'Grep',
    'grep_search': 'Grep',
    'task_tracker': 'TaskTracker',
    'tasktracker': 'TaskTracker',
    'task': 'TaskTracker',
    'scratchpad': 'Scratchpad',
    'notepad': 'Scratchpad',
    'notes': 'Scratchpad',
    'spawn_agent': 'SpawnAgent',
    'spawnagent': 'SpawnAgent',
    'agent': 'SpawnAgent',
  }

  const aliasMatch = aliases[lower]
  if (aliasMatch && getTool(aliasMatch)) return aliasMatch

  // Prefix match (e.g., "Rea" → "Read")
  const prefixMatch = toolNames.find(t => t.toLowerCase().startsWith(lower))
  if (prefixMatch) return prefixMatch

  return name  // Return as-is, let the caller handle the error
}

/**
 * Full repair pipeline for a tool call.
 * Attempts to fix both the tool name and the arguments.
 * Returns { name, args, repaired } — repaired is true if any fix was applied.
 */
export function repairToolCall(
  rawName: string,
  rawArgs: string,
): { name: string; args: Record<string, unknown>; repaired: boolean } {
  let repaired = false

  // Repair tool name
  const name = repairToolName(rawName)
  if (name !== rawName) repaired = true

  // Repair arguments
  let args: Record<string, unknown>
  try {
    args = JSON.parse(rawArgs || '{}')
  } catch {
    const fixed = repairJSON(rawArgs || '{}')
    if (fixed) {
      args = fixed
      repaired = true
    } else {
      // If all repair attempts fail, return empty args
      // The validation layer will catch missing required params
      args = {}
      repaired = true
    }
  }

  return { name, args, repaired }
}
