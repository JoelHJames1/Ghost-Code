import { execSync } from 'child_process'
import type { ToolDefinition } from './types.js'

export const GlobTool: ToolDefinition = {
  spec: {
    type: 'function',
    function: {
      name: 'Glob',
      description:
        'Find files matching a glob pattern. Returns matching file paths. ' +
        'Examples: "**/*.ts", "src/**/*.tsx", "*.json"',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern to match files against',
          },
          path: {
            type: 'string',
            description: 'Directory to search in. Defaults to current working directory.',
          },
        },
        required: ['pattern'],
      },
    },
  },

  async execute(args) {
    const pattern = args.pattern as string
    const searchPath = ((args.path as string) || process.cwd()).replace(/\\ /g, ' ')

    // Use Bun's glob first — reliable, no shell escaping issues
    try {
      const g = new Bun.Glob(pattern)
      const results: string[] = []
      for await (const file of g.scan({ cwd: searchPath, absolute: true })) {
        results.push(file)
        if (results.length >= 200) break
      }
      if (results.length === 0) return 'No files matched the pattern.'
      return `Found ${results.length} file(s):\n${results.sort().join('\n')}`
    } catch {
      // Fallback: find command with properly quoted path
      try {
        const output = execSync(
          `find "${searchPath}" -path "*/${pattern}" -o -name "${pattern}" 2>/dev/null | head -200 | sort`,
          { encoding: 'utf-8', timeout: 10000 },
        ).trim()

        if (!output) return 'No files matched the pattern.'
        const files = output.split('\n')
        return `Found ${files.length} file(s):\n${output}`
      } catch (e: any) {
        return `Error searching files: ${e.message}`
      }
    }
  },
}
