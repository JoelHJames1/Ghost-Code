/**
 * Terminal display utilities — colors, formatting, spinners.
 */

import chalk from 'chalk'

const GHOST_RED = chalk.hex('#FF0000')
const GHOST_WHITE = chalk.hex('#FFFFFF')
const GHOST_BLUE = chalk.hex('#2020CC')
const DIM = chalk.dim
const BOLD = chalk.bold

// Keep GEMMA_BLUE for spinner and prompt
const GEMMA_BLUE = chalk.hex('#4285F4')

export function banner(): string {
  const r = chalk.hex('#4285F4')             // Google blue ghost body
  const w = chalk.hex('#FFFFFF')             // white eyes
  const b = chalk.hex('#1A237E')             // dark blue pupils

  return `
    ${r('      ▄████████▄')}
    ${r('    ██████████████')}
    ${r('   ████████████████')}
    ${r('   ███')}${w('████')}${r('██')}${w('████')}${r('███')}
    ${r('   ███')}${w('██')}${b('██')}${r('██')}${w('██')}${b('██')}${r('███')}    ${BOLD('Gemma Code')} ${DIM('v1.0.0')}
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
    process.stderr.write(`\r${GEMMA_BLUE(frames[i % frames.length]!)} ${DIM('thinking...')}`)
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
  return GEMMA_BLUE('❯ ')
}

export function errorMsg(msg: string): void {
  process.stderr.write(chalk.red(`\n✖ ${msg}\n`))
}

export function infoMsg(msg: string): void {
  process.stderr.write(DIM(`  ${msg}\n`))
}

export { GEMMA_BLUE, DIM, BOLD }
