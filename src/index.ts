#!/usr/bin/env bun
/**
 * Qwen Code — Agentic coding CLI powered by Ollama
 *
 * Usage:
 *   qwen                     Interactive REPL
 *   qwen -p "prompt"         Non-interactive (print mode)
 *   qwen --version           Show version
 *   qwen --model <model>     Use a different Ollama model
 */

import { createInterface } from 'readline'
import chalk from 'chalk'
import { checkOllama, type OllamaConfig } from './ollama.js'
import { createConversation, runAgent, refreshSystemPrompt } from './agent.js'
import { resolveConfig, formatConfig } from './config.js'
import { estimateConversationTokens, getTokenBudget } from './context-window.js'
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
  console.log('1.0.0 (Qwen Code)')
  process.exit(0)
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${chalk.bold('Qwen Code')} — Agentic coding CLI powered by Ollama

${chalk.bold('Usage:')}
  qwen                        Start interactive session
  qwen -p "prompt"            Non-interactive print mode
  qwen --model <model>        Use a different Ollama model
  qwen --version              Show version

${chalk.bold('Environment Variables:')}
  OLLAMA_BASE_URL             Ollama server URL (default: http://localhost:11434)
  OLLAMA_MODEL                Default model (default: qwen3.5:0.8b)

${chalk.bold('Config File:')}
  ~/.config/qwen-code/config.json

${chalk.bold('Interactive Commands:')}
  /exit, /quit                Exit the session
  /clear                      Clear conversation history
  /model <name>               Switch model mid-session
  /tokens                     Show context window usage
  /config                     Show resolved configuration
  /refresh                    Refresh system prompt (git info, etc.)
  Ctrl+C                      Cancel current operation
  Ctrl+D                      Exit
`)
  process.exit(0)
}

// Parse options
let printPrompt: string | undefined
let modelOverride: string | undefined

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!
  if ((arg === '-p' || arg === '--print') && args[i + 1]) {
    printPrompt = args[++i]
  } else if (arg === '--model' && args[i + 1]) {
    modelOverride = args[++i]
  } else if (!arg.startsWith('-')) {
    // Bare argument treated as prompt
    printPrompt = printPrompt || arg
  }
}

const appConfig = resolveConfig(modelOverride ? { model: modelOverride } : {})
const config: OllamaConfig = {
  baseUrl: appConfig.baseUrl,
  model: appConfig.model,
  requestTimeoutMs: appConfig.requestTimeoutMs,
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  // Check Ollama connectivity
  const check = await checkOllama(config)
  if (!check.ok) {
    errorMsg(check.error || 'Cannot connect to Ollama')
    process.exit(1)
  }

  if (printPrompt) {
    await printMode(printPrompt)
  } else {
    await interactiveMode()
  }
}

// ── Print mode (non-interactive) ─────────────────────────────────────────

async function printMode(prompt: string) {
  const conversation = createConversation()
  const result = await runAgent(conversation, prompt, {
    stream: false,
    config,
    onToolStart: (name, args) => {
      process.stderr.write(DIM(`  ⚡ ${name}\n`))
    },
    onToolEnd: () => {},
  })
  process.stdout.write(result + '\n')
}

// ── Interactive REPL ─────────────────────────────────────────────────────

async function interactiveMode() {
  process.stderr.write(banner())
  infoMsg(`Model: ${config.model}`)
  infoMsg(`CWD: ${process.cwd()}`)
  infoMsg(`Context window: ${getTokenBudget(config.model).toLocaleString()} tokens (with safety margin)`)
  infoMsg(`Type /help for commands, /exit to quit\n`)

  const conversation = createConversation()

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: userPrompt(),
    terminal: true,
  })

  rl.prompt()

  // Collect multi-line input (track open brackets/quotes)
  let inputBuffer = ''

  rl.on('line', async (line) => {
    const input = (inputBuffer + line).trim()
    inputBuffer = ''

    if (!input) {
      rl.prompt()
      return
    }

    // Slash commands
    if (input.startsWith('/')) {
      handleCommand(input, conversation, rl)
      return
    }

    // Disable prompt while processing
    rl.pause()

    try {
      const spin = spinner()
      let firstChunk = true

      await runAgent(conversation, input, {
        stream: true,
        config,
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

      // Ensure newline after response
      process.stdout.write('\n\n')
    } catch (e: any) {
      errorMsg(e.message || 'Something went wrong')
    }

    rl.resume()
    rl.prompt()
  })

  rl.on('close', () => {
    process.stderr.write(DIM('\nGoodbye!\n'))
    process.exit(0)
  })

  // Ctrl+C: first press cancels current operation, second press exits
  let lastSigint = 0
  rl.on('SIGINT', () => {
    const now = Date.now()
    if (now - lastSigint < 1500) {
      // Double Ctrl+C — exit
      process.stderr.write(DIM('\nGoodbye!\n'))
      process.exit(0)
    }
    lastSigint = now
    process.stderr.write(DIM('\n  (Press Ctrl+C again to exit)\n'))
    rl.prompt()
  })

  // Also catch process-level SIGINT for when readline doesn't have focus
  process.on('SIGINT', () => {
    const now = Date.now()
    if (now - lastSigint < 1500) {
      process.exit(0)
    }
    lastSigint = now
  })
}

function handleCommand(
  input: string,
  conversation: ReturnType<typeof createConversation>,
  rl: ReturnType<typeof createInterface>,
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
      // Reset conversation, keep system message
      conversation.length = 1
      infoMsg('Conversation cleared')
      break

    case '/model': {
      if (!arg) {
        infoMsg(`Current model: ${config.model}`)
      } else {
        config.model = arg
        infoMsg(`Switched to model: ${arg}`)
        infoMsg(`Context budget: ${getTokenBudget(arg).toLocaleString()} tokens`)
      }
      break
    }

    case '/tokens': {
      const used = estimateConversationTokens(conversation)
      const budget = getTokenBudget(config.model)
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
        const preview = (m.content || '(tool call)').slice(0, 80)
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
  process.exit(1)
})
