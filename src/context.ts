/**
 * Environment context — gathers cwd, git info, OS, project files for the system prompt.
 */

import { execSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { platform, release, userInfo, totalmem, freemem, cpus } from 'os'
import { basename, join } from 'path'
import { resolveConfig } from './config.js'
import { getRelevantMemories } from './memory.js'
import { getModelContextWindow } from './context-window.js'

export interface EnvContext {
  cwd: string
  projectName: string
  isGit: boolean
  gitBranch?: string
  gitStatus?: string
  platform: string
  osVersion: string
  shell: string
  user: string
  date: string
  // Hardware awareness
  totalMemoryGB: number
  freeMemoryGB: number
  cpuCores: number
  cpuModel: string
  // Model awareness
  modelName: string
  contextWindow: number
}

export function getEnvContext(): EnvContext {
  const cwd = process.cwd()
  const config = resolveConfig()
  const cpuInfo = cpus()

  const ctx: EnvContext = {
    cwd,
    projectName: basename(cwd),
    isGit: false,
    platform: platform(),
    osVersion: `${platform()} ${release()}`,
    shell: process.env.SHELL || '/bin/bash',
    user: userInfo().username,
    date: new Date().toISOString().split('T')[0]!,
    totalMemoryGB: Math.round(totalmem() / 1073741824 * 10) / 10,
    freeMemoryGB: Math.round(freemem() / 1073741824 * 10) / 10,
    cpuCores: cpuInfo.length,
    cpuModel: cpuInfo[0]?.model || 'unknown',
    modelName: config.model,
    contextWindow: getModelContextWindow(config.model),
  }

  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe', cwd })
    ctx.isGit = true
    ctx.gitBranch = execSync('git branch --show-current', { encoding: 'utf-8', cwd }).trim()
    ctx.gitStatus = execSync('git status --short', { encoding: 'utf-8', cwd }).trim()
  } catch {
    // Not a git repo
  }

  return ctx
}

/**
 * Gather project context from common project files.
 * Returns formatted sections, respecting a total char budget.
 */
function gatherProjectContext(cwd: string): string {
  const config = resolveConfig()
  const MAX_TOTAL = 8192
  const sections: string[] = []
  let totalChars = 0

  const files: Array<{ path: string; label: string; maxChars: number }> = [
    { path: join(cwd, 'package.json'), label: 'package.json', maxChars: 2048 },
    { path: join(cwd, 'README.md'), label: 'README.md', maxChars: 3072 },
    { path: join(cwd, '.gitignore'), label: '.gitignore', maxChars: 1024 },
    // Auto-detect project type configs
    { path: join(cwd, 'tsconfig.json'), label: 'tsconfig.json', maxChars: 1024 },
    { path: join(cwd, 'pyproject.toml'), label: 'pyproject.toml', maxChars: 1024 },
    { path: join(cwd, 'Cargo.toml'), label: 'Cargo.toml', maxChars: 1024 },
    { path: join(cwd, 'go.mod'), label: 'go.mod', maxChars: 1024 },
    // User-provided project instructions
    { path: join(cwd, config.projectInstructionsFile), label: 'Project Instructions', maxChars: 2048 },
  ]

  for (const { path, label, maxChars } of files) {
    if (totalChars >= MAX_TOTAL) break
    try {
      if (!existsSync(path)) continue
      let content = readFileSync(path, 'utf-8')
      const budget = Math.min(maxChars, MAX_TOTAL - totalChars)
      if (content.length > budget) {
        content = content.slice(0, budget) + '\n... (truncated)'
      }
      sections.push(`## ${label}\n\`\`\`\n${content}\n\`\`\``)
      totalChars += content.length
    } catch {
      // Skip unreadable files
    }
  }

  return sections.length > 0
    ? '\n\n# Project Context\n' + sections.join('\n\n')
    : ''
}

export function buildSystemPrompt(ctx: EnvContext): string {
  const gitInfo = ctx.isGit
    ? `\n - Git repository: branch "${ctx.gitBranch}"${ctx.gitStatus ? `\n - Uncommitted changes:\n${ctx.gitStatus}` : ' (clean)'}`
    : '\n - Not a git repository'

  const projectContext = gatherProjectContext(ctx.cwd)

  return `You are Gemma Code, an autonomous agentic coding assistant running locally via llama.cpp.
You help users with software engineering tasks: writing code, fixing bugs, refactoring, explaining code, running commands, and more.

# How you work
- You have tools available: Read, Write, Edit, Bash, Glob, Grep
- Use tools to explore the codebase, make changes, run tests, and verify your work
- Always read files before editing them
- Prefer editing existing files over creating new ones
- Run tests after making changes to verify correctness
- Be direct and concise in your responses

# Tool usage
- Read: Read file contents (use offset/limit for large files)
- Write: Create new files or overwrite existing ones
- Edit: Make precise string replacements in files
- Bash: Run shell commands (git, npm, tests, etc.)
- Glob: Find files by pattern (e.g. "**/*.ts")
- Grep: Search file contents with regex
- TaskTracker: Plan and track multi-step tasks (ALWAYS use this for complex tasks)
- SpawnAgent: Spawn worker agents for parallel subtasks (use for large tasks that can be split)

# Task tracking (CRITICAL)
- For ANY task requiring more than 2 tool calls, FIRST use TaskTracker with action "plan" to break it into subtasks
- Update each task as you complete it using TaskTracker with action "update"
- Your context window is limited — old messages get compacted, but your task list is ALWAYS visible
- If you feel you've lost context, call TaskTracker with action "status" to see your plan
- Never start a complex task without a plan — you WILL forget what you were doing

# Multi-agent (for large tasks)
- For tasks that can be split into independent pieces, use SpawnAgent to create worker agents
- Each worker gets its own context, tools, and task — they work independently
- Example: spawn "frontend" agent, "backend" agent, and "tests" agent
- Workers run sequentially but with isolated contexts — results are collected at the end
- Use SpawnAgent(action: "spawn") to create workers, then SpawnAgent(action: "run_all") to execute
- Use SpawnAgent(action: "message") to send information between agents if needed

# Guidelines
- Do NOT propose changes to code you haven't read
- When you make a change, verify it works
- Be careful with destructive operations — don't delete files or force-push without asking
- Write secure code — avoid injection vulnerabilities
- Keep changes minimal and focused on what was asked
- If something fails, read the error and diagnose before retrying
- If a tool call fails, try a different approach rather than repeating the same call

# System Resources & Constraints
 - RAM: ${ctx.freeMemoryGB}GB free / ${ctx.totalMemoryGB}GB total
 - CPU: ${ctx.cpuCores} cores (${ctx.cpuModel})
 - Model: ${ctx.modelName} (context window: ${ctx.contextWindow.toLocaleString()} tokens)
 - You are running locally via llama.cpp — all data stays on this machine
 - Vision: You can analyze images sent by the user
 - IMPORTANT: Be aware of memory constraints. ${ctx.freeMemoryGB < 8 ? 'RAM is LOW — avoid spawning many agents, keep tool results small, prefer targeted reads over full file reads.' : ctx.freeMemoryGB < 16 ? 'RAM is moderate — spawn at most 2-3 agents at a time.' : 'RAM is healthy — you can spawn multiple agents if needed.'}
 - Your context window is ${ctx.contextWindow.toLocaleString()} tokens. Old messages are auto-compacted. Always use TaskTracker for tasks requiring >2 tool calls.

# Environment
 - Working directory: ${ctx.cwd}
 - Project: ${ctx.projectName}${gitInfo}
 - Platform: ${ctx.osVersion}
 - Shell: ${ctx.shell}
 - User: ${ctx.user}
 - Date: ${ctx.date}${projectContext}${getRelevantMemories(ctx.projectName)}`
}
