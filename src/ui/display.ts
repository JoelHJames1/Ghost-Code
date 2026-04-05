/**
 * Terminal display utilities — colors, formatting, spinners.
 */

import chalk from 'chalk'

const GHOST_RED = chalk.hex('#FF0000')
const GHOST_WHITE = chalk.hex('#FFFFFF')
const GHOST_BLUE = chalk.hex('#2020CC')
const DIM = chalk.dim
const BOLD = chalk.bold

// GHOST_BLUE defined above — used for spinner and prompt

export function banner(): string {
  const r = chalk.hex('#4285F4')             // Google blue ghost body
  const w = chalk.hex('#FFFFFF')             // white eyes
  const b = chalk.hex('#1A237E')             // dark blue pupils

  return `
    ${r('      ▄████████▄')}
    ${r('    ██████████████')}
    ${r('   ████████████████')}
    ${r('   ███')}${w('████')}${r('██')}${w('████')}${r('███')}
    ${r('   ███')}${w('██')}${b('██')}${r('██')}${w('██')}${b('██')}${r('███')}    ${BOLD('Ghost Code')} ${DIM('v1.0.0')}
    ${r('   ████████████████')}    ${DIM('Local-first agentic coding CLI')}
    ${r('   ████████████████')}    ${DIM('Powered by llama.cpp')}
    ${r('   ████████████████')}
    ${r('   ████████████████')}
    ${r('   ████████████████')}
    ${r('   ██▀▀███▀▀███▀▀█')}
`
}

// ── Tool icons and colors ────────────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Write: '✏️', Edit: '🔧', Bash: '⚡', Glob: '🔍',
  Grep: '🔎', TaskTracker: '📋', Scratchpad: '📝', SpawnAgent: '🤖',
  WebSearch: '🌐', WebFetch: '🌐', Browser: '👁️',
}

const TOOL_COLORS: Record<string, (s: string) => string> = {
  Read: chalk.cyan, Write: chalk.green, Edit: chalk.yellow,
  Bash: chalk.magenta, Glob: chalk.blue, Grep: chalk.blue, Browser: chalk.hex('#FF6B6B'),
  TaskTracker: chalk.white, WebSearch: chalk.cyan, WebFetch: chalk.cyan,
}

export function toolCallHeader(name: string, args: Record<string, unknown>): void {
  const icon = TOOL_ICONS[name] || '⚡'
  const colorFn = TOOL_COLORS[name] || DIM
  const summary = formatToolArgs(name, args)

  process.stderr.write(`\n  ${icon} ${colorFn(name)}${summary ? ' ' + DIM(summary) : ''}\n`)
}

export function toolCallResult(name: string, result: string): void {
  const lines = result.split('\n')

  switch (name) {
    case 'Write': {
      // Show file being written with line count
      const lineCount = lines.length
      process.stderr.write(chalk.green(`  ✓ Wrote ${lineCount} lines\n`))
      // Show first 8 lines of content with syntax coloring
      const preview = lines.slice(0, 8)
      for (const line of preview) {
        process.stderr.write(DIM('  │ ') + chalk.gray(line.slice(0, 100)) + '\n')
      }
      if (lines.length > 8) {
        process.stderr.write(DIM(`  │ ... ${lines.length - 8} more lines\n`))
      }
      break
    }

    case 'Edit': {
      // Show what changed
      if (result.includes('successfully')) {
        process.stderr.write(chalk.yellow(`  ✓ ${result.split('\n')[0]}\n`))
      } else {
        process.stderr.write(chalk.red(`  ✗ ${lines[0]}\n`))
      }
      break
    }

    case 'Read': {
      // Show file info
      const lineCount = lines.length
      process.stderr.write(DIM(`  ─ ${lineCount} lines read\n`))
      break
    }

    case 'Bash': {
      // Show command output — more lines for visibility
      const isError = result.includes('Exit code 1') || result.includes('Error') || result.includes('error')
      const maxLines = isError ? 10 : 6
      const preview = lines.slice(0, maxLines)

      for (const line of preview) {
        const trimmed = line.slice(0, 120)
        if (isError && (line.includes('Error') || line.includes('error') || line.includes('ERR'))) {
          process.stderr.write('  ' + chalk.red(trimmed) + '\n')
        } else {
          process.stderr.write('  ' + DIM(trimmed) + '\n')
        }
      }
      if (lines.length > maxLines) {
        process.stderr.write(DIM(`  ... ${lines.length - maxLines} more lines\n`))
      }

      // Success indicator for clean exits
      if (!isError && result.trim().length > 0) {
        process.stderr.write(chalk.green('  ✓ done\n'))
      }
      break
    }

    case 'Glob': {
      // Show files found
      const files = lines.filter(l => l.trim().length > 0)
      const count = files.length
      process.stderr.write(DIM(`  ─ ${count} file(s) found\n`))
      for (const f of files.slice(0, 5)) {
        process.stderr.write(DIM('  │ ') + chalk.cyan(f.trim().slice(0, 80)) + '\n')
      }
      if (count > 5) process.stderr.write(DIM(`  │ ... ${count - 5} more\n`))
      break
    }

    case 'Grep': {
      // Show matches found
      const matches = lines.filter(l => l.trim().length > 0)
      process.stderr.write(DIM(`  ─ ${matches.length} match(es)\n`))
      for (const m of matches.slice(0, 5)) {
        process.stderr.write(DIM('  │ ') + chalk.gray(m.trim().slice(0, 100)) + '\n')
      }
      if (matches.length > 5) process.stderr.write(DIM(`  │ ... ${matches.length - 5} more\n`))
      break
    }

    case 'TaskTracker': {
      // Show task updates with color
      for (const line of lines.slice(0, 6)) {
        if (line.includes('✓') || line.includes('completed') || line.includes('created')) {
          process.stderr.write('  ' + chalk.green(line.trim().slice(0, 100)) + '\n')
        } else if (line.includes('#') || line.includes('Task')) {
          process.stderr.write('  ' + chalk.white(line.trim().slice(0, 100)) + '\n')
        } else if (line.trim()) {
          process.stderr.write('  ' + DIM(line.trim().slice(0, 100)) + '\n')
        }
      }
      if (lines.length > 6) process.stderr.write(DIM(`  ... ${lines.length - 6} more lines\n`))
      break
    }

    case 'WebSearch':
    case 'WebFetch': {
      // Show web results
      const preview = lines.slice(0, 5)
      for (const line of preview) {
        if (line.trim().startsWith('http')) {
          process.stderr.write('  ' + chalk.cyan(line.trim().slice(0, 80)) + '\n')
        } else if (line.trim()) {
          process.stderr.write('  ' + DIM(line.trim().slice(0, 100)) + '\n')
        }
      }
      if (lines.length > 5) process.stderr.write(DIM(`  ... ${lines.length - 5} more lines\n`))
      break
    }

    case 'Browser': {
      for (const line of lines) {
        const t = line.trim()
        if (!t) continue
        if (t.startsWith('✅')) process.stderr.write('  ' + chalk.green(t.slice(0, 120)) + '\n')
        else if (t.startsWith('❌') || t.startsWith('✗')) process.stderr.write('  ' + chalk.red(t.slice(0, 120)) + '\n')
        else if (t.startsWith('⚠')) process.stderr.write('  ' + chalk.yellow(t.slice(0, 120)) + '\n')
        else if (t.startsWith('🔴') || t.startsWith('🟠')) process.stderr.write('  ' + chalk.red(t.slice(0, 120)) + '\n')
        else if (t.startsWith('📸')) process.stderr.write('  ' + chalk.cyan(t.slice(0, 120)) + '\n')
        else if (t.startsWith('📐')) process.stderr.write('  ' + DIM(t.slice(0, 120)) + '\n')
        else process.stderr.write('  ' + DIM(t.slice(0, 120)) + '\n')
      }
      break
    }

    default: {
      const preview = lines.slice(0, 4)
      for (const line of preview) {
        if (line.trim()) process.stderr.write('  ' + DIM(line.trim().slice(0, 100)) + '\n')
      }
      if (lines.length > 4) process.stderr.write(DIM(`  ... ${lines.length - 4} more lines\n`))
    }
  }
}

function formatToolArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
      return truncStr(args.file_path as string, 60)
    case 'Write':
      return truncStr(args.file_path as string, 60)
    case 'Edit':
      return truncStr(args.file_path as string, 60)
    case 'Bash':
      return truncStr(args.command as string, 80)
    case 'Glob':
      return truncStr(args.pattern as string, 60)
    case 'Grep':
      return `"${truncStr(args.pattern as string, 40)}"${args.path ? ` in ${truncStr(args.path as string, 30)}` : ''}`
    default:
      return ''
  }
}

function truncStr(s: string | undefined, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max - 3) + '...' : s
}

export function spinner(): { stop: () => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let i = 0
  const interval = setInterval(() => {
    process.stderr.write(`\r${GHOST_BLUE(frames[i % frames.length]!)} ${DIM('thinking...')}`)
    i++
  }, 80)

  return {
    stop() {
      clearInterval(interval)
      process.stderr.write('\r' + ' '.repeat(30) + '\r')
    },
  }
}

export function userPrompt(): string {
  return GHOST_BLUE('❯ ')
}

export function errorMsg(msg: string): void {
  process.stderr.write(chalk.red(`\n✖ ${msg}\n`))
}

export function infoMsg(msg: string): void {
  process.stderr.write(DIM(`  ${msg}\n`))
}

// ── Markdown rendering for terminal ─────────────────────────────────────

/**
 * Render markdown-ish text for nice terminal output.
 * Handles: headings, bold, inline code, code blocks, bullets, numbered lists.
 */
export function formatMarkdown(text: string): string {
  const lines = text.split('\n')
  let inCodeBlock = false
  const result: string[] = []

  for (const line of lines) {
    // Code block toggle
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      if (inCodeBlock) {
        const lang = line.trim().slice(3).trim()
        result.push(DIM(lang ? `  ┌─ ${lang} ─` : '  ┌──'))
      } else {
        result.push(DIM('  └──'))
      }
      continue
    }

    // Inside code block — dim, indented
    if (inCodeBlock) {
      result.push(DIM('  │ ') + chalk.cyan(line))
      continue
    }

    let formatted = line

    // Headings
    if (/^#{1,3}\s/.test(formatted)) {
      const level = (formatted.match(/^(#+)/))?.[1]?.length || 1
      const heading = formatted.replace(/^#+\s*/, '')
      if (level === 1) {
        result.push('\n' + BOLD(chalk.hex('#4285F4')(heading)))
      } else if (level === 2) {
        result.push('\n' + BOLD(heading))
      } else {
        result.push(BOLD(heading))
      }
      continue
    }

    // Bullet points — add color to the bullet
    if (/^\s*[-*•]\s/.test(formatted)) {
      formatted = formatted.replace(/^(\s*)([-*•])(\s)/, '$1' + chalk.hex('#4285F4')('•') + '$3')
    }

    // Numbered lists — color the number
    if (/^\s*\d+[.)]\s/.test(formatted)) {
      formatted = formatted.replace(/^(\s*)(\d+[.)])(\s)/, '$1' + chalk.hex('#4285F4')('$2') + '$3')
    }

    // Inline code: `code` → cyan
    formatted = formatted.replace(/`([^`]+)`/g, (_, code) => chalk.cyan(code))

    // Bold: **text** → bold
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, (_, text) => BOLD(text))

    // Italic: *text* → dim (after bold is handled)
    formatted = formatted.replace(/\*([^*]+)\*/g, (_, text) => chalk.italic(text))

    result.push(formatted)
  }

  return result.join('\n')
}

// ── Live code streaming display ──────────────────────────────────────────

/**
 * Shows code being written in real-time as the model generates tool call arguments.
 * Extracts the "content" field from Write tool JSON and displays it line by line.
 */
export function createLiveCodeDisplay(): {
  onToolCallDelta: (name: string, chunk: string) => void
  onToolCallComplete: () => void
} {
  let buffer = ''
  let isWriteTool = false
  let inContentField = false
  let linesShown = 0
  let headerShown = false
  const MAX_LIVE_LINES = 30

  return {
    onToolCallDelta(name: string, chunk: string) {
      if (name === 'Write' || name === 'Edit') {
        isWriteTool = true
        buffer += chunk

        // Detect when we enter the "content" field value in JSON
        if (!inContentField) {
          const contentStart = buffer.indexOf('"content"')
          if (contentStart >= 0) {
            // Find the start of the string value after "content":
            const afterKey = buffer.indexOf(':', contentStart + 9)
            if (afterKey >= 0) {
              const valueStart = buffer.indexOf('"', afterKey + 1)
              if (valueStart >= 0) {
                inContentField = true
                // Show header
                if (!headerShown) {
                  process.stderr.write(DIM('  ┌─ writing code ─\n'))
                  headerShown = true
                }
                // Process any content already in buffer after the opening quote
                buffer = buffer.slice(valueStart + 1)
              }
            }
          }
          return
        }

        // Stream content lines as they arrive
        if (inContentField && linesShown < MAX_LIVE_LINES) {
          // Process complete lines from buffer
          while (true) {
            // Look for newline (escaped as \n in JSON string)
            const nlIdx = buffer.indexOf('\\n')
            const endIdx = buffer.indexOf('"') // End of JSON string

            if (endIdx >= 0 && (nlIdx < 0 || endIdx < nlIdx)) {
              // End of content field — show remaining
              const remaining = buffer.slice(0, endIdx).replace(/\\t/g, '  ').replace(/\\"/g, '"')
              if (remaining.trim() && linesShown < MAX_LIVE_LINES) {
                process.stderr.write(DIM('  │ ') + chalk.gray(remaining.slice(0, 100)) + '\n')
                linesShown++
              }
              inContentField = false
              buffer = ''
              break
            }

            if (nlIdx >= 0) {
              const line = buffer.slice(0, nlIdx).replace(/\\t/g, '  ').replace(/\\"/g, '"')
              buffer = buffer.slice(nlIdx + 2)

              if (linesShown < MAX_LIVE_LINES) {
                // Color code lines based on content
                const trimmed = line.trim()
                let colored = chalk.gray(line.slice(0, 100))
                if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) colored = chalk.cyan(line.slice(0, 100))
                else if (trimmed.startsWith('export ') || trimmed.startsWith('function ') || trimmed.startsWith('const ') || trimmed.startsWith('class ')) colored = chalk.green(line.slice(0, 100))
                else if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) colored = DIM(line.slice(0, 100))
                else if (trimmed.startsWith('return ')) colored = chalk.yellow(line.slice(0, 100))

                process.stderr.write(DIM('  │ ') + colored + '\n')
                linesShown++
              } else if (linesShown === MAX_LIVE_LINES) {
                process.stderr.write(DIM('  │ ... (streaming)\n'))
                linesShown++
              }
            } else {
              break // No complete line yet, wait for more data
            }
          }
        }
      }
    },

    onToolCallComplete() {
      if (isWriteTool && headerShown) {
        process.stderr.write(DIM('  └──\n'))
      }
      // Reset
      buffer = ''
      isWriteTool = false
      inContentField = false
      linesShown = 0
      headerShown = false
    },
  }
}

// ── Streaming markdown renderer ─────────────────────────────────────────

/**
 * Creates a streaming markdown formatter that renders line-by-line
 * as text arrives. Feels live like Claude Code — no wall of text.
 */
export function createStreamRenderer(): {
  push: (chunk: string) => void
  flush: () => void
} {
  let buffer = ''
  let inCodeBlock = false

  function renderLine(line: string): string {
    // Code block toggle
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      if (inCodeBlock) {
        const lang = line.trim().slice(3).trim()
        return DIM(lang ? `  ┌─ ${lang} ─` : '  ┌──')
      } else {
        return DIM('  └──')
      }
    }

    if (inCodeBlock) {
      return DIM('  │ ') + chalk.cyan(line)
    }

    let formatted = line

    // Headings
    if (/^#{1,3}\s/.test(formatted)) {
      const level = (formatted.match(/^(#+)/))?.[1]?.length || 1
      const heading = formatted.replace(/^#+\s*/, '')
      if (level === 1) return '\n' + BOLD(chalk.hex('#4285F4')(heading))
      if (level === 2) return '\n' + BOLD(heading)
      return BOLD(heading)
    }

    // Bullets
    if (/^\s*[-*•]\s/.test(formatted)) {
      formatted = formatted.replace(/^(\s*)([-*•])(\s)/, '$1' + chalk.hex('#4285F4')('•') + '$3')
    }

    // Numbered lists
    if (/^\s*\d+[.)]\s/.test(formatted)) {
      formatted = formatted.replace(/^(\s*)(\d+[.)])(\s)/, '$1' + chalk.hex('#4285F4')('$2') + '$3')
    }

    // Inline code
    formatted = formatted.replace(/`([^`]+)`/g, (_, code) => chalk.cyan(code))
    // Bold
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, (_, text) => BOLD(text))
    // Italic
    formatted = formatted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, text) => chalk.italic(text))

    return formatted
  }

  return {
    push(chunk: string) {
      buffer += chunk

      // Process complete lines
      const lines = buffer.split('\n')
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        process.stdout.write(renderLine(line) + '\n')
      }
    },
    flush() {
      // Render any remaining buffered text
      if (buffer.trim()) {
        process.stdout.write(renderLine(buffer))
      }
      buffer = ''
      inCodeBlock = false
    },
  }
}

export { GHOST_BLUE, DIM, BOLD }
