#!/usr/bin/env bun
/**
 * Ghost Code — Agentic coding CLI powered by llama.cpp
 *
 * When you type `ghost`, this CLI:
 * 1. Launches llama-server (llama.cpp) as the inference backend
 * 2. Waits for it to be ready
 * 3. Starts an interactive REPL with agentic tool calling + vision
 * 4. Stops llama-server on exit
 *
 * Usage:
 *   ghost                     Interactive REPL
 *   ghost -p "prompt"         Non-interactive (print mode)
 *   ghost --version           Show version
 *   ghost --model-path <path> Use a specific GGUF model file
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { createInterface } from 'readline'
import chalk from 'chalk'
import { type ServerConfig } from './api.js'
import { createConversation, runAgent, runAgentWithImage, refreshSystemPrompt } from './agent.js'
import { resolveConfig, formatConfig, type GhostConfig } from './config.js'
import { estimateConversationTokens, getTokenBudget } from './context-window.js'
import { getUsageStats } from './memory.js'
import { getTaskList, formatTaskListForPrompt, clearTasks, loadPersistedTasks } from './tasks.js'
import { setAgentToolConfig } from './tools/agents.js'
import { formatOrchestratorStatus, getOrchestratorState, clearOrchestrator } from './orchestrator.js'
import { saveCheckpoint, loadLatestCheckpoint, listCheckpoints } from './checkpoint.js'
import { readScratchpad, clearScratchpad } from './scratchpad.js'
import { logEvent, getEventLogStats, getRecentActivitySummary } from './eventlog.js'
import { initCapabilities, getActiveProfile, setConfirmCallback } from './capabilities.js'
import { startSession, endSession, getCurrentIdentity, processInterjection } from './identity/bridge.js'
import { getMemoryStats } from './identity/autobiographical.js'
import { getGraphStats, searchGraph } from './knowledge/graph.js'
import { getBeliefStats, searchBeliefs } from './knowledge/beliefs.js'
import { getCuriosityStats, getOpenQuestions } from './growth/curiosity.js'
import { startDaemon, stopDaemon, markBusy, markIdle, getDaemonStats } from './existence/daemon.js'
import { deepenRelationship } from './emotional/relationships.js'
import { connectWhatsApp, disconnectWhatsApp, isWhatsAppConnected, getWhatsAppStatus } from './channels/whatsapp.js'
import { scoreSessionSignificance, classifyExperience } from './emotional/significance.js'
import { getSkillStats, getAllSkills } from './growth/skills.js'
import { learnTopic } from './growth/learn.js'
import { getGoalStats, getActiveGoals } from './growth/goals.js'
import { getEpisodeStats, searchEpisodes } from './episodes.js'
import { getBudgetStats } from './context-compiler.js'
import { ensureAndStartServer, stopLlamaServer, registerCleanup } from './llama-server.js'
import { stopEmbeddingServer, getEmbeddingStatus } from './embedding-server.js'
import { flushAllVectorStores, getVectorStoreStats } from './vector-store.js'
import {
  banner,
  toolCallHeader,
  toolCallResult,
  userPrompt,
  errorMsg,
  infoMsg,
  spinner,
  DIM,
  formatMarkdown,
  createStreamRenderer,
  createLiveCodeDisplay,
} from './ui/display.js'

// ── CLI argument parsing ─────────────────────────────────────────────────

const args = process.argv.slice(2)

if (args.includes('--version') || args.includes('-v')) {
  console.log('1.0.0 (Ghost Code)')
  process.exit(0)
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${chalk.bold('Ghost Code')} — Agentic coding CLI powered by llama.cpp

${chalk.bold('Usage:')}
  ghost                              Start interactive session
  ghost -p "prompt"                  Non-interactive print mode
  ghost --model-path <path>          Use a specific GGUF model file
  ghost --hf-repo <repo>             Download model from HuggingFace
  ghost --gpu-layers <n>             GPU layers to offload (default: 99)
  ghost --version                    Show version

${chalk.bold('Vision:')}
  Attach images to any prompt by including a file path:
    ❯ What's in this screenshot? /path/to/image.png
    ❯ /vision /path/to/mockup.png Implement this UI

${chalk.bold('Environment Variables:')}
  GHOST_MODEL_PATH             Path to GGUF model file
  GHOST_HF_REPO                HuggingFace repo for model download
  GHOST_GPU_LAYERS             GPU layers to offload

${chalk.bold('Config File:')}
  ~/.config/ghost-code/config.json

${chalk.bold('Interactive Commands:')}
  /exit, /quit                Exit the session
  /clear                      Clear conversation history
  /vision <image> <prompt>    Send an image with a prompt (vision)
  /tokens                     Show context window usage
  /config                     Show resolved configuration
  /refresh                    Refresh system prompt (git info, etc.)
  Ctrl+C                      Cancel current operation
  Ctrl+D                      Exit

${chalk.bold('Example config.json:')}
  {
    "modelPath": "/path/to/gemma-4-31b-it-Q4_K_M.gguf",
    "gpuLayers": 99,
    "llamaContextSize": 8192,
    "flashAttn": true
  }
`)
  process.exit(0)
}

// Parse options
let printPrompt: string | undefined
const overrides: Partial<GhostConfig> = {}

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!
  if ((arg === '-p' || arg === '--print') && args[i + 1]) {
    printPrompt = args[++i]
  } else if (arg === '--model-path' && args[i + 1]) {
    overrides.modelPath = args[++i]
  } else if (arg === '--hf-repo' && args[i + 1]) {
    overrides.hfRepo = args[++i]
  } else if (arg === '--gpu-layers' && args[i + 1]) {
    overrides.gpuLayers = parseInt(args[++i]!, 10)
  } else if (arg === '--model' && args[i + 1]) {
    overrides.model = args[++i]
  } else if (!arg.startsWith('-')) {
    printPrompt = printPrompt || arg
  }
}

const appConfig = resolveConfig(overrides)

// ── Image detection & clipboard ──────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff'])

/**
 * Check if the macOS clipboard contains an image and save it to a temp file.
 * Returns the temp file path, or null if no image in clipboard.
 */
function getClipboardImage(): string | null {
  if (process.platform !== 'darwin') return null
  try {
    // Check if clipboard has image data (macOS)
    const check = execSync(
      'osascript -e "clipboard info" 2>/dev/null',
      { encoding: 'utf-8', timeout: 3000 }
    )
    if (!check.includes('«class PNGf»') && !check.includes('TIFF')) return null

    // Save clipboard image to temp file
    const tmpDir = join(tmpdir(), 'ghost-code')
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
    const tmpPath = join(tmpDir, `clipboard-${Date.now()}.png`)

    execSync(
      `osascript -e 'set imageData to the clipboard as «class PNGf»' -e 'set filePath to POSIX path of "${tmpPath}"' -e 'set fileRef to open for access filePath with write permission' -e 'write imageData to fileRef' -e 'close access fileRef'`,
      { timeout: 5000 }
    )

    if (existsSync(tmpPath)) return tmpPath
  } catch {}
  return null
}

/**
 * Extract image paths from user input.
 * Handles: normal paths, paths with spaces (backslash-escaped or quoted),
 * and paths where the image extension identifies the end of the path.
 */
function extractImagePath(input: string): { imagePath: string | null; text: string } {
  // Strategy 1: Find image extension in the input and work backwards to find the path start
  for (const ext of IMAGE_EXTENSIONS) {
    const extIdx = input.toLowerCase().indexOf(ext)
    if (extIdx === -1) continue

    const pathEnd = extIdx + ext.length

    // Work backwards from the extension to find the path start
    // A path starts after a space that isn't backslash-escaped, or at the beginning
    let pathStart = 0
    for (let i = extIdx - 1; i >= 0; i--) {
      const ch = input[i]
      if (ch === ' ' && (i === 0 || input[i - 1] !== '\\')) {
        pathStart = i + 1
        break
      }
      if (ch === '"' || ch === "'") {
        pathStart = i + 1
        break
      }
    }

    let candidate = input.slice(pathStart, pathEnd)

    // Remove surrounding quotes if present
    if ((candidate.startsWith('"') && candidate.endsWith('"')) ||
        (candidate.startsWith("'") && candidate.endsWith("'"))) {
      candidate = candidate.slice(1, -1)
    }

    // Unescape backslash-spaces: Joel\ Lambo.jpg → Joel Lambo.jpg
    const unescaped = candidate.replace(/\\ /g, ' ')

    if (existsSync(unescaped)) {
      const text = (input.slice(0, pathStart) + input.slice(pathEnd)).trim()
      return { imagePath: unescaped, text: text || 'Describe this image.' }
    }

    // Also try the raw candidate (no unescaping needed if path has no spaces)
    if (existsSync(candidate)) {
      const text = (input.slice(0, pathStart) + input.slice(pathEnd)).trim()
      return { imagePath: candidate, text: text || 'Describe this image.' }
    }
  }

  return { imagePath: null, text: input }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  registerCleanup(() => {
    stopEmbeddingServer()
    flushAllVectorStores()
  })

  infoMsg('Starting llama-server...')
  let serverConfig: ServerConfig

  try {
    const baseUrl = await ensureAndStartServer({
      binaryPath: appConfig.llamaBinaryPath,
      modelPath: appConfig.modelPath,
      hfRepo: appConfig.hfRepo,
      port: appConfig.llamaPort,
      host: '127.0.0.1',
      gpuLayers: appConfig.gpuLayers,
      contextSize: appConfig.llamaContextSize,
      jinja: true,
      flashAttn: appConfig.flashAttn,
      extraArgs: appConfig.llamaExtraArgs,
    }, (line) => {
      if (line.includes('ready') || line.includes('error') || line.includes('listening') || line.includes('model loaded') || line.includes('download') || line.includes('progress') || line.includes('loading model') || line.includes('model size') || line.includes('warming')) {
        infoMsg(line)
      }
    })

    serverConfig = { baseUrl, model: appConfig.model, requestTimeoutMs: appConfig.requestTimeoutMs }

    // Wire up multi-agent system with server config
    setAgentToolConfig(serverConfig, (event) => {
      switch (event.type) {
        case 'worker_start':
          infoMsg(`🤖 Agent "${event.worker}" starting: ${event.task}`)
          break
        case 'tool_call':
          process.stderr.write(DIM(`  ⚡ [${event.worker}] ${event.tool}\n`))
          break
        case 'worker_done':
          infoMsg(`✅ Agent "${event.worker}" done`)
          break
        case 'worker_error':
          errorMsg(`Agent "${event.worker}" failed: ${event.error}`)
          break
      }
    })
  } catch (err: any) {
    errorMsg(err.message)
    process.exit(1)
  }

  // Initialize capabilities for both modes
  initCapabilities(process.cwd())

  if (printPrompt) {
    await printMode(printPrompt, serverConfig)
  } else {
    await interactiveMode(serverConfig)
  }
}

// ── Print mode (non-interactive) ─────────────────────────────────────────

async function printMode(prompt: string, serverConfig: ServerConfig) {
  const conversation = createConversation()
  const { imagePath, text } = extractImagePath(prompt)

  const agentOpts = {
    stream: false,
    config: serverConfig,
    onToolStart: (name: string) => {
      process.stderr.write(DIM(`  ⚡ ${name}\n`))
    },
    onToolEnd: () => {},
  }

  const result = imagePath
    ? await runAgentWithImage(conversation, text, imagePath, agentOpts)
    : await runAgent(conversation, text, agentOpts)

  process.stdout.write(formatMarkdown(result) + '\n')
  stopLlamaServer()
}

// ── Interactive REPL ─────────────────────────────────────────────────────

async function interactiveMode(serverConfig: ServerConfig) {
  // Initialize capability gating with project root
  initCapabilities(process.cwd())

  // Load persistent identity and start background daemon
  const identityContext = startSession()
  startDaemon()

  process.stderr.write(banner())
  logEvent('session_start', 'system', { model: appConfig.model, cwd: process.cwd() })
  infoMsg(`Backend: llama.cpp`)
  if (appConfig.modelPath) infoMsg(`Model: ${appConfig.modelPath}`)
  else if (appConfig.hfRepo) infoMsg(`Model: ${appConfig.hfRepo}`)
  else infoMsg(`Model: ${appConfig.model}`)
  infoMsg(`Server: ${serverConfig.baseUrl}`)
  infoMsg(`CWD: ${process.cwd()}`)
  infoMsg(`Vision: enabled (attach images to prompts)`)
  infoMsg(`Context window: ${getTokenBudget(appConfig.model).toLocaleString()} tokens (with safety margin)`)
  infoMsg(`Type /help for commands, /exit to quit\n`)

  const conversation = createConversation()

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: userPrompt(),
    terminal: true,
  })

  rl.prompt()

  let inputBuffer = ''
  let currentAbort: AbortController | null = null
  let isProcessing = false
  let pendingInput: string | null = null
  let queuedMessage: string | null = null

  rl.on('line', async (line) => {
    const input = (inputBuffer + line).trim()
    inputBuffer = ''

    if (!input) {
      rl.prompt()
      return
    }

    // Slash commands: only if it matches a known command (not a file path)
    if (input.startsWith('/')) {
      const cmd = input.split(' ')[0]!.toLowerCase()
      const knownCommands = new Set(['/exit', '/quit', '/q', '/clear', '/vision', '/paste',
        '/tasks', '/tasks-clear', '/agents', '/agents-clear', '/scratchpad',
        '/checkpoint', '/resume', '/episodes', '/budget', '/eventlog',
        '/identity', '/memories', '/knowledge', '/beliefs',
        '/learn', '/skills', '/goals', '/curiosity', '/whatsapp', '/security',
        '/config', '/refresh', '/history', '/tokens', '/help', '/model'])
      if (knownCommands.has(cmd)) {
        // If processing, abort current work for /clear, /exit etc
        if (isProcessing && (cmd === '/clear' || cmd === '/exit' || cmd === '/quit' || cmd === '/q')) {
          currentAbort?.abort()
        }
        handleCommand(input, conversation, rl, serverConfig)
        return
      }
    }

    // If already processing, queue the message for the agent to see between tool rounds
    if (isProcessing) {
      const lower = input.toLowerCase().trim()
      if (lower === 'stop' || lower === 'cancel' || lower === 'abort') {
        // Explicit stop command — abort the request
        process.stderr.write(DIM('\n  ⏹ Stopping current request...\n'))
        currentAbort?.abort()
        pendingInput = null
        queuedMessage = null
      } else {
        // Queue the message — agent will see it between tool rounds
        queuedMessage = input
        // Process through identity system (detect corrections, feedback)
        processInterjection(input)
        process.stderr.write(DIM(`\n  💬 Message queued (agent will see it next round)\n`))
      }
      return
    }

    await processInput(input, conversation, rl, serverConfig)

    // Process any queued input that came in during the last request
    while (pendingInput) {
      const next = pendingInput
      pendingInput = null
      process.stderr.write('\n')
      await processInput(next, conversation, rl, serverConfig)
    }
  })

  async function processInput(
    input: string,
    conversation: ReturnType<typeof createConversation>,
    rl: ReturnType<typeof createInterface>,
    serverConfig: ServerConfig,
  ) {
    isProcessing = true
    currentAbort = new AbortController()
    markBusy()

    let spin = spinner()
    try {
      let firstChunk = true
      const renderer = createStreamRenderer()
      const liveCode = createLiveCodeDisplay()

      const agentOpts = {
        stream: true,
        config: serverConfig,
        abortSignal: currentAbort.signal,
        getQueuedMessage: () => {
          const msg = queuedMessage
          queuedMessage = null
          return msg
        },
        onText: (text: string) => {
          if (currentAbort?.signal.aborted) return
          if (firstChunk) { spin.stop(); firstChunk = false }
          renderer.push(text)
        },
        onToolCallDelta: (name: string, chunk: string) => {
          if (currentAbort?.signal.aborted) return
          if (firstChunk) { spin.stop(); firstChunk = false }
          liveCode.onToolCallDelta(name, chunk)
        },
        onToolCallComplete: () => {
          liveCode.onToolCallComplete()
        },
        onMemoryEvent: (event: string) => {
          if (currentAbort?.signal.aborted) return
          if (firstChunk) { spin.stop(); firstChunk = false }
          process.stderr.write(chalk.hex('#4285F4')(`  ${event}\n`))
        },
        onToolStart: (name: string, args: Record<string, unknown>) => {
          if (currentAbort?.signal.aborted) return
          if (firstChunk) { spin.stop(); firstChunk = false }
          toolCallHeader(name, args)
        },
        onToolEnd: (name: string, result: string) => {
          if (currentAbort?.signal.aborted) return
          toolCallResult(name, result)
        },
      }

      // Auto-detect image paths in the input
      const { imagePath, text } = extractImagePath(input)
      if (imagePath) {
        infoMsg(`📷 Attaching image: ${imagePath}`)
        await runAgentWithImage(conversation, text, imagePath, agentOpts)
      } else {
        await runAgent(conversation, input, agentOpts)
      }

      if (!currentAbort.signal.aborted) {
        renderer.flush()
        process.stdout.write('\n\n')
      }
    } catch (e: any) {
      if (e.name === 'AbortError' || currentAbort?.signal.aborted) {
        spin?.stop?.()
        process.stderr.write(DIM('\n  (interrupted)\n'))
      } else {
        errorMsg(e.message || 'Something went wrong')
      }
    }

    isProcessing = false
    currentAbort = null
    markIdle()
    rl.prompt()
  }

  rl.on('close', () => {
    stopDaemon()
    disconnectWhatsApp()

    // Emotional processing: score this session's significance
    const significance = scoreSessionSignificance(conversation)
    const experience = classifyExperience(conversation)

    // Deepen relationship with this user
    deepenRelationship('default_user', conversation)

    // Save identity — learn from this session before dying
    endSession(conversation)

    if (significance.overall > 0.5) {
      process.stderr.write(DIM(`\nThis was a ${experience} session. ${significance.reason}\n`))
    }
    process.stderr.write(DIM('Goodbye! I\'ll remember this session.\n'))
    stopLlamaServer()
    process.exit(0)
  })

  let lastSigint = 0
  rl.on('SIGINT', () => {
    const now = Date.now()
    if (now - lastSigint < 1500) {
      process.stderr.write(DIM('\nGoodbye!\n'))
      stopLlamaServer()
      process.exit(0)
    }
    lastSigint = now

    // If processing, Ctrl+C stops the current work
    if (isProcessing && currentAbort) {
      currentAbort.abort()
      queuedMessage = null
      process.stderr.write(DIM('\n  ⏹ Stopped. Type your next message or Ctrl+C again to exit.\n'))
    } else {
      process.stderr.write(DIM('\n  (Press Ctrl+C again to exit)\n'))
    }
    rl.prompt()
  })

  process.on('SIGINT', () => {
    const now = Date.now()
    if (now - lastSigint < 1500) {
      stopLlamaServer()
      process.exit(0)
    }
    lastSigint = now
    if (isProcessing && currentAbort) { currentAbort.abort(); queuedMessage = null }
  })
}

function handleCommand(
  input: string,
  conversation: ReturnType<typeof createConversation>,
  rl: ReturnType<typeof createInterface>,
  serverConfig: ServerConfig,
) {
  const [cmd, ...rest] = input.split(' ')
  const arg = rest.join(' ')

  switch (cmd) {
    case '/exit':
    case '/quit':
    case '/q':
      rl.close()
      return

    case '/clear':
      conversation.length = 1
      infoMsg('Conversation cleared')
      break

    case '/vision': {
      if (!arg) {
        infoMsg('Usage: /vision <image_path> <prompt>')
        infoMsg('Example: /vision screenshot.png What does this UI show?')
        break
      }
      // Treat as regular input — image detection handles the rest
      processInput(arg, conversation, rl, serverConfig)
      return
    }

    case '/paste': {
      const pastePrompt = arg || 'Describe this image in detail.'
      const clipImg = getClipboardImage()
      if (!clipImg) {
        errorMsg('No image found in clipboard. Copy an image first (Cmd+C on a screenshot, etc.)')
        break
      }
      processInput(`${clipImg} ${pastePrompt}`, conversation, rl, serverConfig)
      return
    }

    case '/tokens': {
      const stats = getUsageStats(conversation, serverConfig.model)
      const pct = Math.round(stats.ratio * 100)
      infoMsg(`Context usage: ~${stats.tokens.toLocaleString()} / ${stats.budget.toLocaleString()} tokens (${pct}%)`)
      infoMsg(`Messages: ${conversation.length}`)
      if (stats.compactedCount > 0) {
        infoMsg(`Compactions: ${stats.compactedCount} (old messages summarized to save context)`)
      }
      break
    }

    case '/tasks': {
      const list = getTaskList() || loadPersistedTasks()
      if (!list || list.tasks.length === 0) {
        infoMsg('No active tasks. The agent will create a task plan when given a complex task.')
      } else {
        process.stderr.write(DIM(formatTaskListForPrompt()) + '\n')
      }
      break
    }

    case '/agents': {
      const state = getOrchestratorState()
      if (!state) {
        infoMsg('No active multi-agent task. The agent will spawn workers when needed.')
      } else {
        process.stderr.write(DIM(formatOrchestratorStatus()) + '\n')
      }
      break
    }

    case '/agents-clear': {
      clearOrchestrator()
      infoMsg('Multi-agent task cleared')
      break
    }

    case '/tasks-clear': {
      clearTasks()
      infoMsg('Task list cleared')
      break
    }

    case '/scratchpad': {
      const notes = readScratchpad(process.cwd())
      if (!notes.trim()) {
        infoMsg('Scratchpad is empty. The agent writes notes here during work.')
      } else {
        process.stderr.write(DIM(notes) + '\n')
      }
      break
    }

    case '/checkpoint': {
      saveCheckpoint(conversation, { goal: 'manual checkpoint' })
      infoMsg('Checkpoint saved')
      break
    }

    case '/resume': {
      const cp = loadLatestCheckpoint()
      if (!cp) {
        infoMsg('No checkpoints found')
      } else {
        conversation.length = 0
        conversation.push(...cp.conversation)
        infoMsg(`Resumed from checkpoint (${cp.date})`)
        infoMsg(`${cp.conversation.length} messages restored`)
        if (cp.metadata?.goal) infoMsg(`Goal: ${cp.metadata.goal}`)
      }
      break
    }

    case '/episodes': {
      const stats = getEpisodeStats()
      infoMsg(`Episodes: ${stats.totalEpisodes} (${stats.totalMessages} messages segmented)`)
      if (stats.oldestTimestamp) infoMsg(`  Oldest: ${stats.oldestTimestamp}`)
      if (stats.newestTimestamp) infoMsg(`  Newest: ${stats.newestTimestamp}`)
      if (arg) {
        infoMsg(`\nSearching for: "${arg}"`)
        const results = searchEpisodes(arg, 5, 1)
        for (const ep of results) {
          infoMsg(`  [${new Date(ep.timestamp).toISOString().split('T')[0]}] ${ep.summary.slice(0, 120)}`)
        }
      }
      break
    }

    case '/budget': {
      const stats = getBudgetStats(serverConfig.model, conversation.length)
      infoMsg(`Context budget: ${stats.totalBudget.toLocaleString()} tokens`)
      for (const s of stats.slices) {
        infoMsg(`  ${s.name}: ${s.budget.toLocaleString()} tokens (${s.pct})`)
      }
      break
    }

    case '/eventlog': {
      const stats = getEventLogStats()
      infoMsg(`Event log: ${stats.totalEvents} events`)
      infoMsg(`  Tool calls: ${stats.toolCalls}`)
      infoMsg(`  Errors: ${stats.errors}`)
      infoMsg(`  Compactions: ${stats.compactions}`)
      if (stats.sessionStart) infoMsg(`  Session started: ${stats.sessionStart}`)
      if (arg === 'recent') {
        infoMsg('\nRecent activity:')
        process.stderr.write(DIM(getRecentActivitySummary(20)) + '\n')
      }
      break
    }

    case '/identity': {
      const id = getCurrentIdentity()
      if (!id) {
        infoMsg('No identity loaded')
        break
      }
      infoMsg(`Identity: ${id.name} (v${id.version}, ${id.sessionCount} sessions)`)
      infoMsg(`Core: ${id.core}`)
      infoMsg(`Traits: ${id.personality.filter(t => t.strength >= 0.5).map(t => t.trait).join(', ')}`)
      infoMsg(`Relationships: ${id.relationships.length}`)
      infoMsg(`Beliefs: ${id.beliefs.filter(b => b.status === 'active').length} active`)
      infoMsg(`Skills: ${id.skills.length}`)
      infoMsg(`Goals: ${id.goals.filter(g => g.status === 'active').length} active`)
      infoMsg(`Lessons: ${id.lessonLearned.length}`)
      if (id.recentReflections.length > 0) {
        infoMsg(`Last reflection: ${id.recentReflections[id.recentReflections.length - 1]}`)
      }
      break
    }

    case '/memories': {
      const stats = getMemoryStats()
      infoMsg(`Autobiographical memories: ${stats.total}`)
      infoMsg(`Avg significance: ${(stats.avgSignificance * 100).toFixed(0)}%`)
      for (const [type, count] of Object.entries(stats.byType)) {
        infoMsg(`  ${type}: ${count}`)
      }
      break
    }

    case '/learn': {
      if (!arg) {
        infoMsg('Usage: /learn <topic> [--deep]')
        infoMsg('Examples:')
        infoMsg('  /learn React')
        infoMsg('  /learn Rust ownership')
        infoMsg('  /learn Docker --deep')
        break
      }

      const isDeep = arg.includes('--deep')
      const topic = arg.replace('--deep', '').trim()
      const depth = isDeep ? 'deep' as const : 'normal' as const

      infoMsg(`Entering learning mode: "${topic}" (${depth})...`)
      infoMsg('Searching the web, reading docs, building knowledge...\n')

      // Run learning asynchronously
      ;(async () => {
        try {
          const result = await learnTopic(topic, (p) => {
            infoMsg(`  [${p.phase}] ${p.detail}`)
          }, depth)

          infoMsg(`\nLearning complete!`)
          infoMsg(`  Topic: ${result.topic}`)
          infoMsg(`  Pages read: ${result.pagesRead}`)
          infoMsg(`  Concepts learned: ${result.conceptsLearned.length}`)
          infoMsg(`  Beliefs formed: ${result.beliefsFormed}`)
          infoMsg(`  Time: ${(result.timeSpentMs / 1000).toFixed(1)}s`)

          if (result.conceptsLearned.length > 0) {
            infoMsg(`\n  Key concepts:`)
            for (const c of result.conceptsLearned.slice(0, 8)) {
              infoMsg(`    • ${c.slice(0, 100)}`)
            }
          }

          infoMsg(`\nI now have knowledge about ${topic}. Try asking me to build something with it!`)
        } catch (e: any) {
          errorMsg(`Learning failed: ${e.message}`)
        }
        rl.prompt()
      })()
      return  // Don't prompt until learning is done
    }

    case '/skills': {
      const stats = getSkillStats()
      infoMsg(`Skills: ${stats.total} tracked, ${stats.strengths} strong, ${stats.weaknesses} weak, ${stats.improving} improving`)
      infoMsg(`Total practice: ${stats.totalPractice} records`)
      const skills = getAllSkills()
      for (const s of skills.slice(0, 10)) {
        const trend = s.trend === 'improving' ? ' ↑' : s.trend === 'declining' ? ' ↓' : ''
        infoMsg(`  ${s.domain}: ${Math.round(s.confidence * 100)}%${trend} (${s.totalSuccesses}W/${s.totalFailures}L)`)
      }
      break
    }

    case '/goals': {
      const stats = getGoalStats()
      infoMsg(`Goals: ${stats.active} active, ${stats.completed} completed, ${stats.evolved} evolved`)
      if (stats.totalMilestones > 0) {
        infoMsg(`Milestones: ${stats.achievedMilestones}/${stats.totalMilestones}`)
      }
      const active = getActiveGoals()
      for (const g of active.slice(0, 5)) {
        const achieved = g.milestones.filter(m => m.achieved).length
        const total = g.milestones.length
        infoMsg(`  [${Math.round(g.priority * 100)}%] ${g.description}${total > 0 ? ` [${achieved}/${total}]` : ''}`)
      }
      break
    }

    case '/curiosity': {
      const stats = getCuriosityStats()
      infoMsg(`Curiosity: ${stats.open} open questions, ${stats.answered} answered`)
      if (stats.topQuestion) infoMsg(`Top question: ${stats.topQuestion}`)
      const questions = getOpenQuestions(5)
      for (const q of questions) {
        infoMsg(`  [${Math.round(q.priority * 100)}%] ${q.question.slice(0, 100)}`)
      }
      break
    }

    case '/knowledge': {
      const stats = getGraphStats()
      infoMsg(`Knowledge graph: ${stats.entities} entities, ${stats.relations} relations`)
      for (const [type, count] of Object.entries(stats.entityTypes)) {
        infoMsg(`  ${type}: ${count}`)
      }
      if (arg) {
        infoMsg(`\nSearching for: "${arg}"`)
        const results = searchGraph(arg, 5)
        for (const r of results) {
          infoMsg(`  [${r.type}] ${r.name}: ${r.detail}`)
        }
      }
      break
    }

    case '/beliefs': {
      const stats = getBeliefStats()
      infoMsg(`Beliefs: ${stats.active} active, ${stats.revised} revised, ${stats.abandoned} abandoned`)
      infoMsg(`Avg confidence: ${(stats.avgConfidence * 100).toFixed(0)}%`)
      for (const [domain, count] of Object.entries(stats.domains)) {
        infoMsg(`  ${domain}: ${count}`)
      }
      if (arg) {
        infoMsg(`\nSearching for: "${arg}"`)
        const results = searchBeliefs(arg, 5)
        for (const b of results) {
          infoMsg(`  [${Math.round(b.confidence * 100)}%] ${b.statement}`)
        }
      }
      break
    }

    case '/whatsapp': {
      const status = getWhatsAppStatus()
      if (status.connected) {
        infoMsg(`WhatsApp: connected as ${status.phone}`)
        infoMsg(`Active chats: ${status.activeChats}`)
      } else {
        infoMsg('Connecting to WhatsApp...')
        infoMsg('Scan the QR code with your phone when it appears')
        connectWhatsApp(serverConfig, (msg) => {
          infoMsg(msg)
        }).then((connected) => {
          if (connected) {
            infoMsg('WhatsApp connected! People can now message you or tag @ghost in groups.')
          }
        }).catch((err) => {
          errorMsg(`WhatsApp error: ${err.message}`)
        })
      }
      break
    }

    case '/security': {
      const profile = getActiveProfile()
      infoMsg(`Security profile: ${profile.name}`)
      infoMsg(`  ${profile.description}`)
      infoMsg(`  Tools allowed: ${profile.toolCount}`)
      infoMsg(`  Project root: ${process.cwd()}`)
      infoMsg(`  Blocked: curl|sh, eval, disk writes, mkfs, dd`)
      infoMsg(`  Confirm: rm -rf, force push, hard reset, chmod 777`)
      break
    }

    case '/config': {
      infoMsg('Resolved configuration:')
      process.stderr.write(DIM(formatConfig(appConfig)) + '\n')
      break
    }

    case '/refresh': {
      refreshSystemPrompt(conversation)
      infoMsg('System prompt refreshed with current environment state')
      break
    }

    case '/history': {
      const msgs = conversation.filter(m => m.role !== 'system')
      infoMsg(`${msgs.length} messages in conversation`)
      for (const m of msgs.slice(-10)) {
        const content = typeof m.content === 'string' ? m.content : '(image + text)'
        const preview = (content || '(tool call)').slice(0, 80)
        infoMsg(`  ${m.role}: ${preview}`)
      }
      break
    }

    case '/help':
      infoMsg('Commands:')
      infoMsg('  /exit, /quit              Exit the session')
      infoMsg('  /clear                    Clear conversation history')
      infoMsg('  /vision <image> <prompt>  Send image with prompt')
      infoMsg('  /paste [prompt]           Send clipboard image with prompt')
      infoMsg('  /tasks                    Show current task plan')
      infoMsg('  /identity                 Show AI identity and stats')
      infoMsg('  /memories                 Show autobiographical memories')
      infoMsg('  /knowledge [query]        Show/search knowledge graph')
      infoMsg('  /beliefs [query]          Show/search belief system')
      infoMsg('  /skills                   Show skill levels and trends')
      infoMsg('  /goals                    Show persistent goals')
      infoMsg('  /learn <topic>            Study a topic from the web')
      infoMsg('  /curiosity                Show knowledge gaps')
      infoMsg('  /scratchpad               View agent notes')
      infoMsg('  /agents                   Show multi-agent status')
      infoMsg('  /checkpoint               Save conversation state')
      infoMsg('  /resume                   Resume from last checkpoint')
      infoMsg('  /episodes [query]         Show/search episodic memory')
      infoMsg('  /budget                   Show context budget allocation')
      infoMsg('  /eventlog [recent]        Show event log stats')
      infoMsg('  /whatsapp                 Connect to WhatsApp (scan QR)')
      infoMsg('  /security                 Show security policy')
      infoMsg('  /tokens                   Show context window usage')
      infoMsg('  /config                   Show configuration')
      infoMsg('  /refresh                  Refresh system prompt')
      infoMsg('  /history                  Show recent messages')
      infoMsg('  /help                     Show this help')
      infoMsg('')
      infoMsg('Vision: include an image path in any prompt:')
      infoMsg('  ❯ What is this? /path/to/image.png')
      infoMsg('  ❯ /paste Implement this UI design')
      break

    default:
      errorMsg(`Unknown command: ${cmd}. Type /help for available commands.`)
  }

  rl.prompt()
}

// Run
main().catch((e) => {
  errorMsg(e.message)
  stopLlamaServer()
  process.exit(1)
})
