#!/usr/bin/env bun
/**
 * Gemma Code — Agentic coding CLI powered by llama.cpp
 *
 * When you type `gemma`, this CLI:
 * 1. Launches llama-server (llama.cpp) as the inference backend
 * 2. Waits for it to be ready
 * 3. Starts an interactive REPL with agentic tool calling
 * 4. Stops llama-server on exit
 *
 * Usage:
 *   gemma                     Interactive REPL
 *   gemma -p "prompt"         Non-interactive (print mode)
 *   gemma --version           Show version
 *   gemma --model-path <path> Use a specific GGUF model file
 *   gemma --backend ollama    Use Ollama instead of llama-server
 */

import { createInterface } from 'readline'
import chalk from 'chalk'
import { type ServerConfig } from './api.js'
import { createConversation, runAgent, refreshSystemPrompt } from './agent.js'
import { resolveConfig, formatConfig, type GemmaConfig } from './config.js'
import { estimateConversationTokens, getTokenBudget } from './context-window.js'
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
  gemma --backend ollama             Use Ollama instead of llama-server
  gemma --gpu-layers <n>             GPU layers to offload (default: 99)
  gemma --version                    Show version

${chalk.bold('Environment Variables:')}
  GEMMA_BACKEND                Backend: llama (default) or ollama
  GEMMA_MODEL_PATH             Path to GGUF model file
  GEMMA_HF_REPO                HuggingFace repo for model download
  GEMMA_GPU_LAYERS             GPU layers to offload

${chalk.bold('Config File:')}
  ~/.config/gemma-code/config.json

${chalk.bold('Interactive Commands:')}
  /exit, /quit                Exit the session
  /clear                      Clear conversation history
  /model <name>               Switch model (Ollama backend only)
  /tokens                     Show context window usage
  /config                     Show resolved configuration
  /refresh                    Refresh system prompt (git info, etc.)
  Ctrl+C                      Cancel current operation
  Ctrl+D                      Exit

${chalk.bold('Example config.json for llama-server:')}
  {
    "backend": "llama",
    "modelPath": "/path/to/gemma-4-31b-it-Q4_K_M.gguf",
    "gpuLayers": 99,
    "llamaContextSize": 8192,
    "flashAttn": true
  }

${chalk.bold('Example config.json for Ollama:')}
  {
    "backend": "ollama",
    "model": "gemma4:31b"
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
  } else if (arg === '--backend' && args[i + 1]) {
    overrides.backend = args[++i] as 'llama' | 'ollama'
  } else if (arg === '--gpu-layers' && args[i + 1]) {
    overrides.gpuLayers = parseInt(args[++i]!, 10)
  } else if (arg === '--model' && args[i + 1]) {
    overrides.model = args[++i]
  } else if (!arg.startsWith('-')) {
    printPrompt = printPrompt || arg
  }
}

const appConfig = resolveConfig(overrides)

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  let serverConfig: ServerConfig

  if (appConfig.backend === 'llama') {
    serverConfig = await startLlamaBackend()
  } else {
    serverConfig = await startOllamaBackend()
  }

  if (printPrompt) {
    await printMode(printPrompt, serverConfig)
  } else {
    await interactiveMode(serverConfig)
  }
}

/**
 * Start llama-server backend. Launches the server process and waits for health.
 */
async function startLlamaBackend(): Promise<ServerConfig> {
  // Register cleanup to stop server on exit
  registerCleanup()

  infoMsg('Starting llama-server...')
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

    return { baseUrl, model: appConfig.model, requestTimeoutMs: appConfig.requestTimeoutMs }
  } catch (err: any) {
    errorMsg(err.message)
    process.exit(1)
  }
}

/**
 * Start Ollama backend. Just checks connectivity.
 */
async function startOllamaBackend(): Promise<ServerConfig> {
  const config: ServerConfig = {
    baseUrl: appConfig.baseUrl,
    model: appConfig.model,
    requestTimeoutMs: appConfig.requestTimeoutMs,
  }

  try {
    const res = await fetch(`${config.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      errorMsg(`Ollama returned ${res.status}`)
      process.exit(1)
    }
  } catch {
    errorMsg(`Cannot connect to Ollama at ${config.baseUrl}. Is it running? (ollama serve)`)
    process.exit(1)
  }

  return config
}

// ── Print mode (non-interactive) ─────────────────────────────────────────

async function printMode(prompt: string, serverConfig: ServerConfig) {
  const conversation = createConversation()
  const result = await runAgent(conversation, prompt, {
    stream: false,
    config: serverConfig,
    onToolStart: (name) => {
      process.stderr.write(DIM(`  ⚡ ${name}\n`))
    },
    onToolEnd: () => {},
  })
  process.stdout.write(result + '\n')
  stopLlamaServer()
}

// ── Interactive REPL ─────────────────────────────────────────────────────

async function interactiveMode(serverConfig: ServerConfig) {
  process.stderr.write(banner())
  infoMsg(`Backend: ${appConfig.backend === 'llama' ? 'llama.cpp' : 'Ollama'}`)
  if (appConfig.modelPath) infoMsg(`Model: ${appConfig.modelPath}`)
  else if (appConfig.hfRepo) infoMsg(`Model: ${appConfig.hfRepo}`)
  else infoMsg(`Model: ${appConfig.model}`)
  infoMsg(`Server: ${serverConfig.baseUrl}`)
  infoMsg(`CWD: ${process.cwd()}`)
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

      await runAgent(conversation, input, {
        stream: true,
        config: serverConfig,
        onText: (text) => {
          if (firstChunk) {
            spin.stop()
            firstChunk = false
          }
          process.stdout.write(text)
        },
        onToolStart: (name, args) => {
          if (firstChunk) {
            spin.stop()
            firstChunk = false
          }
          toolCallHeader(name, args)
        },
        onToolEnd: (name, result) => {
          toolCallResult(name, result)
        },
      })

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

    case '/model': {
      if (!arg) {
        infoMsg(`Current model: ${serverConfig.model}`)
      } else {
        serverConfig.model = arg
        infoMsg(`Switched to model: ${arg}`)
        infoMsg(`Context budget: ${getTokenBudget(arg).toLocaleString()} tokens`)
      }
      break
    }

    case '/tokens': {
      const used = estimateConversationTokens(conversation)
      const budget = getTokenBudget(serverConfig.model)
      const pct = Math.round((used / budget) * 100)
      infoMsg(`Context usage: ~${used.toLocaleString()} / ${budget.toLocaleString()} tokens (${pct}%)`)
      infoMsg(`Messages: ${conversation.length}`)
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
        const content = typeof m.content === 'string' ? m.content : '(multimodal)'
        const preview = (content || '(tool call)').slice(0, 80)
        infoMsg(`  ${m.role}: ${preview}`)
      }
      break
    }

    case '/help':
      infoMsg('Commands:')
      infoMsg('  /exit, /quit    Exit the session')
      infoMsg('  /clear          Clear conversation history')
      infoMsg('  /model <name>   Switch model')
      infoMsg('  /tokens         Show context window usage')
      infoMsg('  /config         Show configuration')
      infoMsg('  /refresh        Refresh system prompt')
      infoMsg('  /history        Show recent messages')
      infoMsg('  /help           Show this help')
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
