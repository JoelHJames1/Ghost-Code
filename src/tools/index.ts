import type { Tool } from '../ollama.js'
import type { ToolDefinition } from './types.js'
import { ReadTool } from './read.js'
import { WriteTool } from './write.js'
import { EditTool } from './edit.js'
import { BashTool } from './bash.js'
import { GlobTool } from './glob.js'
import { GrepTool } from './grep.js'

const TOOL_MAP: Map<string, ToolDefinition> = new Map()

// Register all tools
for (const tool of [ReadTool, WriteTool, EditTool, BashTool, GlobTool, GrepTool]) {
  TOOL_MAP.set(tool.spec.function.name, tool)
}

/** Get all tool specs for the model */
export function getToolSpecs(): Tool[] {
  return Array.from(TOOL_MAP.values()).map(t => t.spec)
}

/** Look up a tool by name */
export function getTool(name: string): ToolDefinition | undefined {
  return TOOL_MAP.get(name)
}

/** Get all tool names */
export function getToolNames(): string[] {
  return Array.from(TOOL_MAP.keys())
}

/**
 * Validate tool arguments against the tool's required parameters.
 * Returns an error message string if validation fails, or null if valid.
 */
export function validateToolArgs(name: string, args: Record<string, unknown>): string | null {
  const tool = TOOL_MAP.get(name)
  if (!tool) return `Error: Unknown tool "${name}"`

  const params = tool.spec.function.parameters
  const required = (params.required as string[]) || []

  const missing = required.filter(key => args[key] === undefined || args[key] === null)
  if (missing.length > 0) {
    return `Error: ${name} requires parameters: ${missing.join(', ')}. Received: ${Object.keys(args).join(', ') || '(none)'}`
  }

  return null
}

export type { ToolDefinition } from './types.js'
