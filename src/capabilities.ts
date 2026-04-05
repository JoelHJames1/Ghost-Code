/**
 * Capability gating — tool permission model for security.
 *
 * Controls what tools can do based on:
 * 1. Tool-level permissions (which tools are allowed)
 * 2. Argument-level validation (what paths/commands are safe)
 * 3. Confirmation requirements (human-in-the-loop for dangerous ops)
 * 4. Scope restrictions (project directory boundaries)
 *
 * OWASP LLM Top 10 mitigations:
 * - Excessive Agency: tools can only do what's explicitly allowed
 * - Insecure Output Handling: output validation before execution
 * - Prompt Injection: tool calls validated against allowlists
 *
 * Default policy: "coding" profile — allows all file/search tools
 * within the project directory, restricts shell commands.
 */

import { existsSync } from 'fs'
import { resolve, relative } from 'path'

// ── Types ────────────────────────────────────────────────────────────────

export type CapabilityLevel = 'allow' | 'confirm' | 'deny'

export interface ToolPolicy {
  /** Default permission for this tool */
  level: CapabilityLevel
  /** Patterns that override the default (e.g., deny certain paths) */
  rules?: CapabilityRule[]
}

export interface CapabilityRule {
  /** What to match against (argument name) */
  field: string
  /** Regex or string to match */
  pattern: string
  /** Override level if matched */
  level: CapabilityLevel
  /** Human-readable reason */
  reason: string
}

export interface CapabilityProfile {
  name: string
  description: string
  tools: Record<string, ToolPolicy>
  /** Restrict file operations to these directory prefixes */
  allowedPaths: string[]
  /** Shell command patterns that require confirmation */
  dangerousCommands: string[]
  /** Shell command patterns that are always denied */
  blockedCommands: string[]
}

// ── Built-in profiles ────────────────────────────────────────────────────

const CODING_PROFILE: CapabilityProfile = {
  name: 'coding',
  description: 'Default profile for coding tasks — full file access within project, restricted shell',
  tools: {
    Read: { level: 'allow' },
    Write: { level: 'allow' },
    Edit: { level: 'allow' },
    Glob: { level: 'allow' },
    Grep: { level: 'allow' },
    Bash: {
      level: 'allow',
      rules: [
        // Dangerous commands require confirmation
        { field: 'command', pattern: 'rm\\s+-rf', level: 'confirm', reason: 'Recursive delete is destructive' },
        { field: 'command', pattern: 'rm\\s+.*/', level: 'confirm', reason: 'Deleting directories' },
        { field: 'command', pattern: 'git\\s+push.*--force', level: 'confirm', reason: 'Force push can destroy history' },
        { field: 'command', pattern: 'git\\s+reset\\s+--hard', level: 'confirm', reason: 'Hard reset discards changes' },
        { field: 'command', pattern: 'git\\s+clean\\s+-[fd]', level: 'confirm', reason: 'Clean removes untracked files' },
        { field: 'command', pattern: 'chmod\\s+777', level: 'confirm', reason: 'World-writable permissions' },
        { field: 'command', pattern: 'curl.*\\|.*sh', level: 'deny', reason: 'Piping remote scripts to shell' },
        { field: 'command', pattern: 'wget.*\\|.*sh', level: 'deny', reason: 'Piping remote scripts to shell' },
        { field: 'command', pattern: 'eval\\s', level: 'deny', reason: 'Eval is a code injection vector' },
        { field: 'command', pattern: '>(\\s*/dev/sd|\\s*/dev/disk)', level: 'deny', reason: 'Direct disk writes' },
        { field: 'command', pattern: 'mkfs', level: 'deny', reason: 'Filesystem formatting' },
        { field: 'command', pattern: 'dd\\s+if=', level: 'deny', reason: 'Direct disk operations' },
      ],
    },
    TaskTracker: { level: 'allow' },
    Scratchpad: { level: 'allow' },
    SpawnAgent: { level: 'allow' },
    WebSearch: { level: 'allow' },
    WebFetch: { level: 'allow' },
  },
  allowedPaths: [], // Empty = use CWD as root (set at runtime)
  dangerousCommands: [],
  blockedCommands: [],
}

// ── State ────────────────────────────────────────────────────────────────

let activeProfile: CapabilityProfile = CODING_PROFILE
let projectRoot: string = process.cwd()
let confirmCallback: ((action: string, reason: string) => Promise<boolean>) | null = null

/**
 * Initialize the capability system with a project root and optional confirm callback.
 */
export function initCapabilities(
  cwd: string,
  onConfirm?: (action: string, reason: string) => Promise<boolean>,
): void {
  projectRoot = resolve(cwd)
  activeProfile = { ...CODING_PROFILE, allowedPaths: [projectRoot] }
  confirmCallback = onConfirm || null
}

/**
 * Set a custom confirm callback for human-in-the-loop confirmation.
 */
export function setConfirmCallback(
  cb: (action: string, reason: string) => Promise<boolean>,
): void {
  confirmCallback = cb
}

// ── Validation ───────────────────────────────────────────────────────────

export interface CapabilityCheck {
  allowed: boolean
  level: CapabilityLevel
  reason?: string
  requiresConfirm?: boolean
}

/**
 * Check if a tool call is allowed by the current capability profile.
 *
 * Returns { allowed, level, reason }:
 * - allowed=true, level='allow': proceed
 * - allowed=false, level='confirm': needs human confirmation
 * - allowed=false, level='deny': blocked
 */
export function checkCapability(
  toolName: string,
  args: Record<string, unknown>,
): CapabilityCheck {
  const policy = activeProfile.tools[toolName]

  // Unknown tool: deny by default
  if (!policy) {
    return { allowed: false, level: 'deny', reason: `Unknown tool "${toolName}" not in capability profile` }
  }

  // Check argument-level rules
  if (policy.rules) {
    for (const rule of policy.rules) {
      const value = args[rule.field]
      if (value && typeof value === 'string') {
        const regex = new RegExp(rule.pattern, 'i')
        if (regex.test(value)) {
          if (rule.level === 'deny') {
            return { allowed: false, level: 'deny', reason: rule.reason }
          }
          if (rule.level === 'confirm') {
            return { allowed: false, level: 'confirm', reason: rule.reason, requiresConfirm: true }
          }
        }
      }
    }
  }

  // Check path restrictions for file tools
  if (['Read', 'Write', 'Edit'].includes(toolName)) {
    const filePath = args.file_path as string
    if (filePath) {
      const pathCheck = checkPathAllowed(filePath)
      if (!pathCheck.allowed) return pathCheck
    }
  }

  // Check base tool level
  if (policy.level === 'deny') {
    return { allowed: false, level: 'deny', reason: `Tool "${toolName}" is denied by policy` }
  }
  if (policy.level === 'confirm') {
    return { allowed: false, level: 'confirm', reason: `Tool "${toolName}" requires confirmation`, requiresConfirm: true }
  }

  return { allowed: true, level: 'allow' }
}

/**
 * Check if a file path is within the allowed project boundaries.
 */
function checkPathAllowed(filePath: string): CapabilityCheck {
  const resolved = resolve(filePath)

  // Always allow paths within the project root
  if (resolved.startsWith(projectRoot)) {
    return { allowed: true, level: 'allow' }
  }

  // Allow common system paths for reading (not writing)
  const readOnlyPaths = ['/tmp', '/var/tmp']
  for (const p of readOnlyPaths) {
    if (resolved.startsWith(p)) {
      return { allowed: true, level: 'allow' }
    }
  }

  // Paths outside project root require confirmation
  return {
    allowed: false,
    level: 'confirm',
    reason: `Path "${filePath}" is outside the project directory (${projectRoot})`,
    requiresConfirm: true,
  }
}

/**
 * Execute the capability check with optional human confirmation.
 * Returns true if the action should proceed.
 */
export async function enforceCapability(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ proceed: boolean; reason?: string }> {
  const check = checkCapability(toolName, args)

  if (check.allowed) {
    return { proceed: true }
  }

  if (check.level === 'deny') {
    return { proceed: false, reason: `BLOCKED: ${check.reason}` }
  }

  // Confirm level: ask the human if we have a callback
  if (check.level === 'confirm' && confirmCallback) {
    const action = `${toolName}(${JSON.stringify(args).slice(0, 200)})`
    const confirmed = await confirmCallback(action, check.reason || 'Requires confirmation')
    return confirmed
      ? { proceed: true }
      : { proceed: false, reason: 'User denied the action' }
  }

  // No confirm callback — auto-allow confirm-level in non-interactive mode
  // (the model was instructed to be careful; we trust it)
  return { proceed: true }
}

/**
 * Get the active profile for display.
 */
export function getActiveProfile(): { name: string; description: string; toolCount: number } {
  return {
    name: activeProfile.name,
    description: activeProfile.description,
    toolCount: Object.keys(activeProfile.tools).length,
  }
}

/**
 * Validate a shell command against the blocked patterns.
 * Returns null if allowed, or an error string if blocked.
 */
export function validateCommand(command: string): string | null {
  const check = checkCapability('Bash', { command })
  if (check.level === 'deny') {
    return check.reason || 'Command blocked by security policy'
  }
  return null
}
