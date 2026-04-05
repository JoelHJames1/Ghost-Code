/**
 * Learning Mode — Ghost actively studies a topic to build expertise.
 *
 * When the user says "learn React" or "/learn Rust", Ghost:
 * 1. Searches the web for tutorials, docs, and best practices
 * 2. Reads key pages and extracts core concepts
 * 3. Stores findings in the knowledge graph as entities + relations
 * 4. Creates beliefs about the technology with evidence
 * 5. Records what she learned as autobiographical memories
 * 6. Adds the skill with initial confidence
 *
 * After learning, Ghost can use this knowledge when building projects.
 * "Build me a modern React website" → she uses her learned React knowledge.
 *
 * The learning is stored permanently — she never forgets what she studied.
 */

import { WebSearchTool, WebFetchTool } from '../tools/web.js'
import { ensureEntity, addRelation } from '../knowledge/graph.js'
import { assertBelief } from '../knowledge/beliefs.js'
import { practiceSkill, addSkillNote } from './skills.js'
import { recordMemory } from '../identity/autobiographical.js'
import { createGoal, updateGoalProgress, achieveMilestone } from './goals.js'
import { logEvent } from '../eventlog.js'

// ── Types ────────────────────────────────────────────────────────────────

export interface LearningResult {
  topic: string
  conceptsLearned: string[]
  pagesRead: number
  beliefsFormed: number
  timeSpentMs: number
}

export interface LearningProgress {
  phase: string
  detail: string
}

// ── Core learning engine ─────────────────────────────────────────────────

/**
 * Study a topic by searching the web and building knowledge.
 * This is the main learning function — it takes a topic and returns
 * what was learned.
 *
 * @param topic - What to learn (e.g., "React", "Rust ownership", "Docker")
 * @param onProgress - Callback for progress updates
 * @param depth - How deep to go: 'quick' (3 searches), 'normal' (6), 'deep' (10)
 */
export async function learnTopic(
  topic: string,
  onProgress?: (p: LearningProgress) => void,
  depth: 'quick' | 'normal' | 'deep' = 'normal',
): Promise<LearningResult> {
  const startTime = Date.now()
  const result: LearningResult = {
    topic,
    conceptsLearned: [],
    pagesRead: 0,
    beliefsFormed: 0,
    timeSpentMs: 0,
  }

  logEvent('session_start', 'learning', { topic, depth })

  // Create a goal for this learning
  const goal = createGoal(
    `Learn ${topic}`,
    `User requested deep learning on ${topic}`,
    0.8,
    { milestones: ['Search fundamentals', 'Read documentation', 'Extract concepts', 'Form beliefs', 'Store knowledge'] },
  )

  // ── Phase 1: Search for fundamentals ──────────────────────────────
  onProgress?.({ phase: 'Searching', detail: `Searching for "${topic}" fundamentals...` })

  const searchQueries = buildSearchQueries(topic, depth)
  const allSnippets: string[] = []
  const allUrls: string[] = []

  for (const query of searchQueries) {
    onProgress?.({ phase: 'Searching', detail: query })
    const searchResult = await WebSearchTool.execute({ query, max_results: 5 })

    // Extract URLs and snippets
    const lines = searchResult.split('\n')
    for (const line of lines) {
      if (line.trim().startsWith('http')) {
        allUrls.push(line.trim())
      }
      if (line.trim().length > 20 && !line.trim().startsWith('http') && !line.match(/^\d+\./)) {
        allSnippets.push(line.trim())
      }
    }
  }

  achieveMilestone(goal.id, 'Search fundamentals')
  updateGoalProgress(goal.id, `Searched ${searchQueries.length} queries, found ${allUrls.length} pages`)

  // ── Phase 2: Read pages + follow internal links for depth ──────
  const maxTopPages = depth === 'deep' ? 8 : depth === 'normal' ? 5 : 3
  const maxSubPages = depth === 'deep' ? 15 : depth === 'normal' ? 8 : 3
  const maxCharsPerPage = depth === 'deep' ? 15000 : depth === 'normal' ? 10000 : 5000

  // Deduplicate URLs by domain to get diverse top-level sources
  const seenDomains = new Set<string>()
  const topPages = allUrls
    .filter(u => {
      if (u.includes('duckduckgo.com')) return false
      try {
        const domain = new URL(u).hostname
        if (seenDomains.has(domain)) return false
        seenDomains.add(domain)
        return true
      } catch { return false }
    })
    .slice(0, maxTopPages)

  onProgress?.({ phase: 'Reading', detail: `Reading ${topPages.length} pages + following links...` })
  const pageContents: string[] = []
  const readUrls = new Set<string>()

  // Read top-level pages and extract internal links for deeper reading
  const subPageUrls: string[] = []

  for (const url of topPages) {
    if (readUrls.has(url)) continue
    readUrls.add(url)
    onProgress?.({ phase: 'Reading', detail: `Reading ${url.slice(0, 60)}...` })
    try {
      const content = await WebFetchTool.execute({ url, max_chars: maxCharsPerPage })
      if (content && !content.startsWith('Error') && content.length > 100) {
        pageContents.push(content)
        result.pagesRead++

        // Extract internal links from the page content for deeper reading
        // Look for markdown links that point to sub-pages on the same domain
        try {
          const domain = new URL(url).hostname
          const linkMatches = content.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)
          for (const m of linkMatches) {
            const linkUrl = m[2]!
            try {
              const linkDomain = new URL(linkUrl).hostname
              if (linkDomain === domain && !readUrls.has(linkUrl) && !linkUrl.includes('#')) {
                subPageUrls.push(linkUrl)
              }
            } catch {}
          }
          // Also match relative-looking links converted to full URLs
          const relMatches = content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)
          for (const m of relMatches) {
            const href = m[2]!
            if (href.startsWith('http') || href.startsWith('#')) continue
            try {
              const full = new URL(href, url).toString()
              if (!readUrls.has(full)) subPageUrls.push(full)
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }

  // Phase 2b: Read sub-pages (tutorial chapters, documentation sections)
  const subPagesToRead = subPageUrls
    .filter(u => !readUrls.has(u))
    .slice(0, maxSubPages)

  if (subPagesToRead.length > 0) {
    onProgress?.({ phase: 'Deep reading', detail: `Following ${subPagesToRead.length} sub-pages...` })
  }

  for (const url of subPagesToRead) {
    if (readUrls.has(url)) continue
    readUrls.add(url)
    onProgress?.({ phase: 'Deep reading', detail: `Reading ${url.slice(0, 60)}...` })
    try {
      const content = await WebFetchTool.execute({ url, max_chars: maxCharsPerPage })
      if (content && !content.startsWith('Error') && content.length > 100) {
        pageContents.push(content)
        result.pagesRead++
      }
    } catch {}
  }

  achieveMilestone(goal.id, 'Read documentation')

  // ── Phase 3: Extract concepts ─────────────────────────────────────
  onProgress?.({ phase: 'Extracting', detail: 'Extracting core concepts...' })

  // Only extract concepts from actual page content, not search snippets
  const concepts = extractConcepts(topic, pageContents)
  result.conceptsLearned = concepts

  achieveMilestone(goal.id, 'Extract concepts')

  // ── Phase 4: Form beliefs and knowledge ───────────────────────────
  onProgress?.({ phase: 'Learning', detail: 'Forming beliefs and knowledge...' })

  // Create entity for the topic
  const topicEntity = ensureEntity(topic, 'technology', {
    learnedAt: new Date().toISOString(),
    depth,
    conceptCount: String(concepts.length),
  })

  // Store each concept as a belief and knowledge graph entry
  for (const concept of concepts) {
    // Belief
    assertBelief(
      concept,
      'technical',
      `Learned from web research on "${topic}"`,
      'self-study',
    )
    result.beliefsFormed++

    // Knowledge graph: concept → topic relation
    const conceptEntity = ensureEntity(concept.slice(0, 50), 'concept')
    addRelation(
      concept.slice(0, 50), 'concept',
      topic, 'technology',
      'part_of',
      `${concept.slice(0, 50)} is a concept within ${topic}`,
      0.7,
      'learning',
    )
  }

  achieveMilestone(goal.id, 'Form beliefs')

  // ── Phase 5: Store as skill and memory ────────────────────────────
  onProgress?.({ phase: 'Storing', detail: 'Updating skills and memory...' })

  // Add/update skill
  practiceSkill(topic, 'technology', true, `Self-studied: learned ${concepts.length} concepts`)
  addSkillNote(topic, `Studied via web research. Concepts: ${concepts.slice(0, 5).join(', ')}`)

  // Autobiographical memory
  recordMemory(
    'growth',
    `I studied "${topic}" on my own. Searched ${searchQueries.length} queries, read ${result.pagesRead} pages, learned ${concepts.length} concepts.`,
    'self-directed learning',
    0.7,
    {
      lesson: `Gained foundational knowledge of ${topic}: ${concepts.slice(0, 3).join(', ')}`,
    },
  )

  achieveMilestone(goal.id, 'Store knowledge')
  updateGoalProgress(goal.id, `Completed! Learned ${concepts.length} concepts from ${result.pagesRead} pages.`)

  result.timeSpentMs = Date.now() - startTime
  logEvent('session_end', 'learning', { topic, concepts: concepts.length, pages: result.pagesRead })

  return result
}

// ── Search query generation ──────────────────────────────────────────────

function buildSearchQueries(topic: string, depth: 'quick' | 'normal' | 'deep'): string[] {
  const queries = [
    `${topic} tutorial for beginners`,
    `${topic} core concepts explained`,
    `${topic} best practices 2025`,
  ]

  if (depth === 'normal' || depth === 'deep') {
    queries.push(
      `${topic} common patterns and examples`,
      `${topic} official documentation guide`,
      `${topic} cheat sheet quick reference`,
      `${topic} data types and structures`,
      `${topic} standard library overview`,
    )
  }

  if (depth === 'deep') {
    queries.push(
      `${topic} advanced techniques`,
      `${topic} architecture and design patterns`,
      `${topic} performance optimization`,
      `${topic} common mistakes to avoid`,
    )
  }

  return queries
}

// ── Concept extraction ───────────────────────────────────────────────────

/** Lines that are navigation, boilerplate, or noise — not real concepts. */
function isJunkLine(line: string): boolean {
  const l = line.toLowerCase()
  // Search result artifacts
  if (l.startsWith('search results for')) return true
  // Pure URLs or markdown links that are just navigation
  if (/^\[?https?:\/\//.test(line)) return true
  // Markdown links without explanatory text (just "[Label](url)" style nav)
  if (/^\[.{1,50}\]\(http/.test(line) && line.length < 80) return true
  // Lines that are mostly markdown link syntax (link lists / nav menus)
  if ((line.match(/\]\(/g) || []).length >= 1 && (line.match(/\]\(/g) || []).length * 30 > line.length) return true
  // Single-word or short bracket labels that are clearly nav items
  if (/^\[[\w\s]{1,25}\]\(/.test(line) && line.length < 60) return true
  // Navigation / CTA / site chrome
  if (/^(click|sign in|log in|subscribe|download now|install|try it|start learning|next|previous|menu|home|back to|read more|see also|related|you will|in our|this is an optional|you can study)/i.test(l)) return true
  // Reference sections / site chrome
  if (/^(you will also find|complete function|method references|check your level|many chapters|this tutorial)/i.test(l)) return true
  // Title lines with URLs appended
  if (/https?:\/\//.test(line) && line.indexOf('http') > line.length * 0.4) return true
  // Copyright, cookie banners
  if (/copyright|cookie|privacy policy|terms of|all rights reserved/i.test(l)) return true
  // Too many special characters (likely markup noise)
  if ((line.match(/[»›→←▶◀|►☆★©®™]/g) || []).length > 1) return true
  // Mostly punctuation/symbols (less than 60% alpha)
  const alphaRatio = (line.match(/[a-zA-Z]/g) || []).length / line.length
  if (alphaRatio < 0.5) return true
  return false
}

/**
 * Extract core concepts from page content about a topic.
 * Prioritizes: definitions > heading-context pairs > substantive statements.
 */
function extractConcepts(topic: string, texts: string[]): string[] {
  const concepts: string[] = []
  const seen = new Set<string>()
  const topicLower = topic.toLowerCase()
  const topicPrefix = topicLower.slice(0, Math.min(4, topicLower.length))

  for (const text of texts) {
    const lines = text.split('\n')
    let lastHeading = ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length < 25 || trimmed.length > 250) continue
      if (isJunkLine(trimmed)) continue

      // Track headings for context
      const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/)
      if (headingMatch) {
        lastHeading = headingMatch[1]!.trim()
        continue
      }

      const lower = trimmed.toLowerCase()
      // Strip markdown list markers for the clean concept text
      const clean = trimmed.replace(/^[-•*]\s+/, '').replace(/^\d+[\.)]\s+/, '').slice(0, 180)

      // Priority 1: "X is a/an/the Y" definitions
      if (/\b(?:is|are)\s+(?:a|an|the)\s+/i.test(clean) && lower.includes(topicPrefix)) {
        addConcept(concepts, seen, clean)
        continue
      }

      // Priority 2: "X is used for Y" / "X allows Y" functional descriptions
      if (/\b(?:is used|can be used|allows?|enables?|provides?|supports?|designed for|built for)\b/i.test(clean) && lower.includes(topicPrefix)) {
        addConcept(concepts, seen, clean)
        continue
      }

      // Priority 3: Lines under a relevant heading that contain substance
      if (lastHeading && lastHeading.toLowerCase().includes(topicPrefix)) {
        // Must be a statement (has a verb), not just a label
        if (/\b(?:is|are|was|were|has|have|can|will|use|run|create|return|define|call|import|store)\b/i.test(clean)) {
          addConcept(concepts, seen, clean)
          continue
        }
      }

      // Priority 4: Bulleted/numbered items mentioning the topic with a colon (key: value pattern)
      if (/^[-•*]\s|^\d+[\.)]\s/.test(trimmed) && lower.includes(topicPrefix) && clean.includes(':')) {
        addConcept(concepts, seen, clean)
        continue
      }
    }
  }

  return concepts.slice(0, 50)
}

function addConcept(concepts: string[], seen: Set<string>, concept: string): void {
  // Deduplicate by first 40 chars (catches near-duplicates)
  const key = concept.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 40)
  if (seen.has(key)) return
  if (key.length < 15) return // Too short to be meaningful
  // Must have enough real words (not just markup or labels)
  const words = concept.split(/\s+/).filter(w => w.length > 2 && !/^\[|^\(|^\]|^\)|^http/.test(w))
  if (words.length < 4) return
  seen.add(key)
  // Clean markdown links: "[Label](url) – desc" → "Label – desc"
  const cleaned = concept
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  concepts.push(cleaned)
}
