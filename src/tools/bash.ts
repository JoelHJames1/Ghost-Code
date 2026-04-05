import { execSync } from 'child_process'
import type { ToolDefinition } from './types.js'

export const BashTool: ToolDefinition = {
  spec: {
    type: 'function',
    function: {
      name: 'Bash',
      description:
        'Execute a bash command and return its output. ' +
        'Use for running tests, git commands, installing packages, etc. ' +
        'Commands run in the current working directory. ' +
        'Timeout defaults to 30 seconds.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds. Default: 30000 (30s). Max: 300000 (5m).',
          },
        },
        required: ['command'],
      },
    },
  },

  async execute(args) {
    let command = args.command as string
    const timeout = Math.min((args.timeout as number) || 30000, 300000)

    // Auto-fix: quote unquoted paths with spaces in common commands
    // Matches: cd /path/with spaces, ls /path/with spaces, cat /path/with spaces, etc.
    command = command.replace(/((?:cd|ls|cat|rm|cp|mv|mkdir|chmod|chown|find|head|tail|wc|file|stat)\s+(?:-[a-zA-Z]+\s+)*)(\/[^"'&|;>]+?\s[^"'&|;>]*?)(\s*(?:&&|\|\||;|>|\||$))/g, (match, prefix, path, rest) => {
      if (path.includes('"') || path.includes("'")) return match
      return `${prefix}"${path.trim()}"${rest}`
    })

    try {
      const output = execSync(command, {
        encoding: 'utf-8',
        timeout,
        maxBuffer: 1024 * 1024 * 10, // 10MB
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
        env: { ...process.env, TERM: 'dumb' },
      })
      return output || '(command completed with no output)'
    } catch (e: any) {
      const stderr = e.stderr?.toString() || ''
      const stdout = e.stdout?.toString() || ''
      const output = [stdout, stderr].filter(Boolean).join('\n')
      if (e.killed) {
        return `Command timed out after ${timeout}ms\n${output}`
      }
      return `Exit code ${e.status ?? 1}\n${output}`
    }
  },
}
