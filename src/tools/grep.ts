import { execSync } from 'child_process'
import type { ToolDefinition } from './types.js'

export const GrepTool: ToolDefinition = {
  spec: {
    type: 'function',
    function: {
      name: 'Grep',
      description:
        'Search file contents using regex patterns. Uses ripgrep (rg) if available, ' +
        'falls back to grep. Returns matching lines with file paths and line numbers.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex pattern to search for',
          },
          path: {
            type: 'string',
            description: 'File or directory to search in. Defaults to current working directory.',
          },
          include: {
            type: 'string',
            description: 'Glob pattern to filter files, e.g. "*.ts" or "*.{js,tsx}"',
          },
          case_insensitive: {
            type: 'boolean',
            description: 'Case insensitive search. Default: false.',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of matching lines. Default: 100.',
          },
        },
        required: ['pattern'],
      },
    },
  },

  async execute(args) {
    const pattern = args.pattern as string
    const searchPath = (args.path as string) || process.cwd()
    const include = args.include as string | undefined
    const caseInsensitive = (args.case_insensitive as boolean) || false
    const maxResults = (args.max_results as number) || 100

    // Try ripgrep first, then fall back to grep
    for (const tool of ['rg', 'grep']) {
      try {
        let cmd: string
        if (tool === 'rg') {
          cmd = `rg -n --no-heading`
          if (caseInsensitive) cmd += ' -i'
          if (include) cmd += ` --glob ${JSON.stringify(include)}`
          cmd += ` -m ${maxResults}`
          cmd += ` ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)}`
        } else {
          cmd = `grep -rn`
          if (caseInsensitive) cmd += ' -i'
          if (include) cmd += ` --include=${JSON.stringify(include)}`
          cmd += ` ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)}`
          cmd += ` | head -${maxResults}`
        }

        const output = execSync(cmd, {
          encoding: 'utf-8',
          timeout: 15000,
          maxBuffer: 1024 * 1024 * 5,
          stdio: ['pipe', 'pipe', 'pipe'],  // Suppress stderr bleeding into terminal
        }).trim()

        if (!output) return 'No matches found.'
        return output
      } catch (e: any) {
        // grep/rg return status 1 for "no matches" — that's not an error
        if (e.status === 1) return 'No matches found.'
        // If rg failed (not installed, etc.), fall through to grep
        if (tool === 'rg') continue
        return `Error searching: ${e.message}`
      }
    }
    return 'Error: no search tool available (install ripgrep or grep)'
  },
}
