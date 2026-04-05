/**
 * Web tools — search and fetch without API keys.
 *
 * WebSearch: uses DuckDuckGo (zero API key, zero signup)
 * WebFetch: fetches any URL and extracts readable text
 *
 * This gives Ghost the ability to:
 * - Research topics she's curious about
 * - Look up documentation
 * - Find code examples
 * - Stay current on technologies
 * - Learn autonomously during idle time
 */

import type { ToolDefinition } from './types.js'

// ── HTML text extraction ─────────────────────────────────────────────────

/**
 * Strip HTML tags and extract readable text.
 * Lightweight — no dependency needed.
 */
function htmlToText(html: string): string {
  return html
    // Remove script and style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    // Convert common elements to text equivalents
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    // Remove remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

// ── DuckDuckGo search ────────────────────────────────────────────────────

interface SearchResult {
  title: string
  url: string
  snippet: string
}

/**
 * Search DuckDuckGo using the HTML lite endpoint.
 * No API key. No signup. No rate limits (be respectful).
 */
async function duckDuckGoSearch(query: string, maxResults = 8): Promise<SearchResult[]> {
  const results: SearchResult[] = []

  try {
    // Use DuckDuckGo HTML lite — simplest, most reliable, no JS needed
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Ghost-Code/1.0 (autonomous coding agent)',
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) return []
    const html = await res.text()

    // Parse results from DuckDuckGo HTML
    const resultBlocks = html.split(/class="result__body"/)

    for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
      const block = resultBlocks[i]!

      // Extract title and URL from result__a link
      const linkMatch = block.match(/class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/)
      let resultUrl = linkMatch?.[1] || ''
      const title = linkMatch?.[2] ? htmlToText(linkMatch[2]).trim() : ''

      // Fix protocol-relative URLs
      if (resultUrl.startsWith('//')) resultUrl = 'https:' + resultUrl

      // DuckDuckGo wraps URLs in a redirect — extract the actual URL
      const uddgMatch = resultUrl.match(/uddg=([^&]+)/)
      if (uddgMatch) resultUrl = decodeURIComponent(uddgMatch[1]!)

      // Extract snippet
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//)
      const snippet = snippetMatch?.[1]
        ? htmlToText(snippetMatch[1]).slice(0, 200)
        : ''

      if (resultUrl && title) {
        // Skip DuckDuckGo internal links
        if (!resultUrl.includes('duckduckgo.com/y.js')) {
          results.push({ title, url: resultUrl, snippet })
        }
      }
    }
  } catch {}

  // Fallback: try DuckDuckGo instant answer API (JSON, no key)
  if (results.length === 0) {
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Ghost-Code/1.0' },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const data = await res.json() as {
          AbstractText?: string
          AbstractURL?: string
          AbstractSource?: string
          RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>
        }

        if (data.AbstractText && data.AbstractURL) {
          results.push({
            title: data.AbstractSource || 'DuckDuckGo',
            url: data.AbstractURL,
            snippet: data.AbstractText.slice(0, 300),
          })
        }

        for (const topic of (data.RelatedTopics || []).slice(0, maxResults - results.length)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.slice(0, 80),
              url: topic.FirstURL,
              snippet: topic.Text.slice(0, 200),
            })
          }
        }
      }
    } catch {}
  }

  return results
}

// ── Tools ────────────────────────────────────────────────────────────────

export const WebSearchTool: ToolDefinition = {
  spec: {
    type: 'function',
    function: {
      name: 'WebSearch',
      description:
        'Search the web using DuckDuckGo (no API key needed). ' +
        'Returns titles, URLs, and snippets. Use this to research topics, ' +
        'look up documentation, find code examples, or learn new things.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (e.g., "Rust ownership explained", "React useEffect best practices")',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results. Default: 5.',
          },
        },
        required: ['query'],
      },
    },
  },

  async execute(args) {
    const query = args.query as string
    const maxResults = (args.max_results as number) || 5

    const results = await duckDuckGoSearch(query, maxResults)

    if (results.length === 0) {
      return `No results found for "${query}". Try a different search query.`
    }

    let output = `Search results for "${query}":\n\n`
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!
      output += `${i + 1}. ${r.title}\n`
      output += `   ${r.url}\n`
      if (r.snippet) output += `   ${r.snippet}\n`
      output += '\n'
    }

    return output
  },
}

export const WebFetchTool: ToolDefinition = {
  spec: {
    type: 'function',
    function: {
      name: 'WebFetch',
      description:
        'Fetch a web page and extract its readable text content. ' +
        'Use after WebSearch to read a specific page, documentation, ' +
        'or code example. Returns cleaned text (HTML stripped).',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch',
          },
          max_chars: {
            type: 'number',
            description: 'Maximum characters to return. Default: 5000.',
          },
        },
        required: ['url'],
      },
    },
  },

  async execute(args) {
    const url = args.url as string
    const maxChars = (args.max_chars as number) || 5000

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Ghost-Code/1.0 (autonomous coding agent)',
          'Accept': 'text/html,application/xhtml+xml,text/plain',
        },
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
      })

      if (!res.ok) {
        return `Error fetching ${url}: HTTP ${res.status}`
      }

      const contentType = res.headers.get('content-type') || ''
      const body = await res.text()

      // If it's plain text or JSON, return as-is
      if (contentType.includes('text/plain') || contentType.includes('application/json')) {
        return body.slice(0, maxChars)
      }

      // Extract readable text from HTML
      const text = htmlToText(body)
      if (text.length < 50) {
        return `Page at ${url} had no readable text content (might require JavaScript).`
      }

      return text.slice(0, maxChars)
    } catch (e: any) {
      return `Error fetching ${url}: ${e.message}`
    }
  },
}
