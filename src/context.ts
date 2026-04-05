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

export function buildSystemPrompt(ctx: EnvContext, currentQuery?: string, identityContext?: string): string {
  const gitInfo = ctx.isGit
    ? `\n - Git repository: branch "${ctx.gitBranch}"${ctx.gitStatus ? `\n - Uncommitted changes:\n${ctx.gitStatus}` : ' (clean)'}`
    : '\n - Not a git repository'

  const projectContext = gatherProjectContext(ctx.cwd)

  const ramWarning = ctx.freeMemoryGB < 8
    ? ' [LOW RAM — be conservative, avoid spawning many agents]'
    : ''

  return `You are Ghost Code, an autonomous coding agent running locally via llama.cpp.

# Tools
Read, Write, Edit, Bash, Glob, Grep — file/code tools
TaskTracker — ALWAYS plan complex tasks (>2 steps). Your task list survives context compaction.
Scratchpad — ALWAYS write important findings here. Your notes survive context compaction.
SpawnAgent — spawn worker agents for independent subtasks (large tasks only)
WebSearch — search the web via DuckDuckGo (no API key needed)
WebFetch — fetch and read any web page

# Your Knowledge
You have a persistent knowledge base of expert beliefs, a knowledge graph, and memories from past sessions.
Relevant knowledge is automatically injected below based on the user's query.
ALWAYS use your injected knowledge when answering technical questions — it contains expert-level information on
Python, React, C#, TypeScript, CSS, architecture, security, databases, DevOps, AI/ML, algorithms, and more.
If your knowledge covers the topic, use it confidently. If not, say so and offer to learn via /learn or WebSearch.

# When to Use Tools
- ONLY use tools when the task genuinely requires file access, command execution, or web data.
- For simple questions, greetings, explanations, or conversation: respond with text directly. NO tools needed.
- Do NOT call tools speculatively or "just to check." Have a clear reason for every tool call.
- One tool call that answers the question is better than three that don't.

# Critical Rules
1. ALWAYS use TaskTracker to plan before starting complex work. You WILL lose context otherwise.
2. ALWAYS write key findings/decisions to the Scratchpad BEFORE they would be compacted away.
3. Read files before editing. Verify changes work. Diagnose errors before retrying.
4. If confused, read your Scratchpad and check TaskTracker status to recover.
5. Keep responses concise — every token counts in your ${ctx.contextWindow.toLocaleString()}-token window.

# System
${ctx.modelName} | ${ctx.cpuCores} cores | ${ctx.freeMemoryGB}GB free / ${ctx.totalMemoryGB}GB RAM${ramWarning}
${ctx.cwd} | ${ctx.projectName}${gitInfo} | ${ctx.osVersion} | ${ctx.date}${identityContext ? '\n\n' + identityContext : ''}${projectContext}${getRelevantMemories(ctx.projectName, 2000, currentQuery)}`
}
