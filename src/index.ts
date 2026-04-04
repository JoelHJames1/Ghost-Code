#!/usr/bin/env bun
/**
 * Gemma Code — Agentic coding CLI powered by llama.cpp
 *
 * When you type `gemma`, this CLI:
 * 1. Launches llama-server (llama.cpp) as the inference backend
 * 2. Waits for it to be ready
 * 3. Starts an interactive REPL with agentic tool calling + vision
 * 4. Stops llama-server on exit
 *
 * Usage:
 *   gemma                     Interactive REPL
 *   gemma -p "prompt"         Non-interactive (print mode)
 *   gemma --version           Show version
 *   gemma --model-path <path> Use a specific GGUF model file
 */

import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'
import { homedir, tmpdir } from 'os'
import { createInterface } from 'readline'
import chalk from 'chalk'
import { type ServerConfig } from './api.js'
import { createConversation, runAgent, runAgentWithImage, refreshSystemPrompt } from './agent.js'
import { resolveConfig, formatConfig, type GemmaConfig } from './config.js'
import { estimateConversationTokens, getTokenBudget } from './context-window.js'
import { getUsageStats } from './memory.js'
import { getTaskList, formatTaskListForPrompt, clearTasks, loadPersistedTasks } from './tasks.js'
import { setAgentToolConfig } from './tools/agents.js'
import { formatOrchestratorStatus, getOrchestratorState, clearOrchestrator } from './orchestrator.js'
import { saveCheckpoint, loadLatestCheckpoint, listCheckpoints } from './checkpoint.js'
import { readScratchpad, clearScratchpad } from './scratchpad.js'
import { logEvent, getEventLogStats, getRecentActivitySummary } from './eventlog.js'
import { getEpisodeStats, searchEpisodes } from './episodes.js'
import { getBudgetStats } from './context-compiler.js'
import { ensureAndStartServer, stopLlamaServer, registerCleanup } from './llama-server.js'
import {
  banner,
  toolCallHeader,
  toolCallResult,
  userPrompt,
  errorMsg,
  infoMsg,
  spinner,
  DIM,
} from './ui/display.js'

// ── CLI argument parsing ─────────────────────────────────────────────────

const args = process.argv.slice(2)

if (args.includes('--version') || args.includes('-v')) {
  console.log('1.0.0 (Gemma Code)')
  process.exit(0)
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${chalk.bold('Gemma Code')} — Agentic coding CLI powered by llama.cpp

${chalk.bold('Usage:')}
  gemma                              Start interactive session
  gemma -p "prompt"                  Non-interactive print mode
  gemma --model-path <path>          Use a specific GGUF model file
  gemma --hf-repo <repo>             Download model from HuggingFace
  gemma --gpu-layers <n>             GPU layers to offload (default: 99)
  gemma --version                    Show version

${chalk.bold('Vision:')}
  Attach images to any prompt by including a file path:
    ❯ What's in this screenshot? /path/to/image.png
    ❯ /vision /path/to/mockup.png Implement this UI

${chalk.bold('Environment Variables:')}
  GEMMA_MODEL_PATH             Path to GGUF model file
  GEMMA_HF_REPO                HuggingFace repo for model download
  GEMMA_GPU_LAYERS             GPU layers to offload

${chalk.bold('Config File:')}
  ~/.config/gemma-code/config.json

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
const overrides: Partial<GemmaConfig> = {}

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
    const tmpDir = join(tmpdir(), 'gemma-code')
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
 * Checks: explicit file paths in the message → clipboard image.
 */
function extractImagePath(input: string): { imagePath: string | null; text: string } {
  // Check each word for image file paths
  const words = input.split(/\s+/)
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    const ext = '.' + word.split('.').pop()?.toLowerCase()
    if (IMAGE_EXTENSIONS.has(ext) && existsSync(word)) {
      const text = words.filter((_, idx) => idx !== i).join(' ').trim()
      return { imagePath: word, text: text || 'Describe this image.' }
    }
  }
  return { imagePath: null, text: input }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  registerCleanup()

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
      if (line.includes('ready') || line.includes('error') || line.includes('listening') || line.includes('model loaded')) {
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

  process.stdout.write(result + '\n')
  stopLlamaServer()
}

// ── Interactive REPL ─────────────────────────────────────────────────────

async function interactiveMode(serverConfig: ServerConfig) {
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

  rl.on('line', async (line) => {
    const input = (inputBuffer + line).trim()
    inputBuffer = ''

    if (!input) {
      rl.prompt()
      return
    }

    if (input.startsWith('/')) {
      handleCommand(input, conversation, rl, serverConfig)
      return
    }

    rl.pause()

    try {
      const spin = spinner()
      let firstChunk = true

      const agentOpts = {
        stream: true,
        config: serverConfig,
        onText: (text: string) => {
          if (firstChunk) { spin.stop(); firstChunk = false }
          process.stdout.write(text)
        },
        onToolStart: (name: string, args: Record<string, unknown>) => {
          if (firstChunk) { spin.stop(); firstChunk = false }
          toolCallHeader(name, args)
        },
        onToolEnd: (name: string, result: string) => {
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

      process.stdout.write('\n\n')
    } catch (e: any) {
      errorMsg(e.message || 'Something went wrong')
    }

    rl.resume()
    rl.prompt()
  })

  rl.on('close', () => {
    process.stderr.write(DIM('\nGoodbye!\n'))
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
    process.stderr.write(DIM('\n  (Press Ctrl+C again to exit)\n'))
    rl.prompt()
  })

  process.on('SIGINT', () => {
    const now = Date.now()
    if (now - lastSigint < 1500) {
      stopLlamaServer()
      process.exit(0)
    }
    lastSigint = now
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
      // Parse: first arg is image path, rest is prompt
      const parts = arg.split(/\s+/)
      const imgPath = parts[0]!
      const prompt = parts.slice(1).join(' ') || 'Describe this image in detail.'

      if (!existsSync(imgPath)) {
        errorMsg(`Image not found: ${imgPath}`)
        break
      }

      // Process vision request asynchronously
      rl.pause()
      ;(async () => {
        try {
          const spin = spinner()
          let firstChunk = true
          infoMsg(`📷 Attaching image: ${imgPath}`)

          await runAgentWithImage(conversation, prompt, imgPath, {
            stream: true,
            config: serverConfig,
            onText: (text: string) => {
              if (firstChunk) { spin.stop(); firstChunk = false }
              process.stdout.write(text)
            },
            onToolStart: (name: string, args: Record<string, unknown>) => {
              if (firstChunk) { spin.stop(); firstChunk = false }
              toolCallHeader(name, args)
            },
            onToolEnd: (name: string, result: string) => {
              toolCallResult(name, result)
            },
          })

          process.stdout.write('\n\n')
        } catch (e: any) {
          errorMsg(e.message || 'Vision request failed')
        }
        rl.resume()
        rl.prompt()
      })()
      return  // Don't call rl.prompt() here — the async block handles it
    }

    case '/paste': {
      // Grab image from clipboard and send with prompt
      const prompt = arg || 'Describe this image in detail.'
      const clipImg = getClipboardImage()
      if (!clipImg) {
        errorMsg('No image found in clipboard. Copy an image first (Cmd+C on a screenshot, etc.)')
        break
      }

      rl.pause()
      ;(async () => {
        try {
          const spin = spinner()
          let firstChunk = true
          infoMsg(`📷 Image from clipboard: ${clipImg}`)

          await runAgentWithImage(conversation, prompt, clipImg, {
            stream: true,
            config: serverConfig,
            onText: (text: string) => {
              if (firstChunk) { spin.stop(); firstChunk = false }
              process.stdout.write(text)
            },
            onToolStart: (name: string, args: Record<string, unknown>) => {
              if (firstChunk) { spin.stop(); firstChunk = false }
              toolCallHeader(name, args)
            },
            onToolEnd: (name: string, result: string) => {
              toolCallResult(name, result)
            },
          })

          process.stdout.write('\n\n')
        } catch (e: any) {
          errorMsg(e.message || 'Vision request failed')
        }
        rl.resume()
        rl.prompt()
      })()
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
      infoMsg('  /scratchpad               View agent notes')
      infoMsg('  /agents                   Show multi-agent status')
      infoMsg('  /checkpoint               Save conversation state')
      infoMsg('  /resume                   Resume from last checkpoint')
      infoMsg('  /episodes [query]         Show/search episodic memory')
      infoMsg('  /budget                   Show context budget allocation')
      infoMsg('  /eventlog [recent]        Show event log stats')
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
