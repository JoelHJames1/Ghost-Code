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
    ${r('   ████████████████')}    ${DIM('Powered by llama.cpp + gemma4')}
    ${r('   ████████████████')}
    ${r('   ████████████████')}
    ${r('   ████████████████')}
    ${r('   ██▀▀███▀▀███▀▀█')}
`
}

export function toolCallHeader(name: string, args: Record<string, unknown>): void {
  const summary = formatToolArgs(name, args)
  process.stderr.write(DIM(`\n  ⚡ ${name}`) + (summary ? DIM(` ${summary}`) : '') + '\n')
}

export function toolCallResult(name: string, result: string): void {
  // Show a brief snippet of the result
  const lines = result.split('\n')
  const preview = lines.length > 5
    ? lines.slice(0, 4).join('\n') + `\n  ... (${lines.length} lines total)`
    : result
  const indented = preview.split('\n').map(l => '  ' + l).join('\n')
  process.stderr.write(DIM(indented) + '\n')
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
