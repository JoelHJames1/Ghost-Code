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

  // ── Phase 2: Read top pages ───────────────────────────────────────
  onProgress?.({ phase: 'Reading', detail: `Reading ${Math.min(allUrls.length, depth === 'deep' ? 5 : 3)} pages...` })

  const pagesToRead = allUrls
    .filter(u => !u.includes('duckduckgo.com'))
    .slice(0, depth === 'deep' ? 5 : depth === 'normal' ? 3 : 2)

  const pageContents: string[] = []

  for (const url of pagesToRead) {
    onProgress?.({ phase: 'Reading', detail: `Reading ${url.slice(0, 60)}...` })
    try {
      const content = await WebFetchTool.execute({ url, max_chars: 3000 })
      if (content && !content.startsWith('Error') && content.length > 100) {
        pageContents.push(content)
        result.pagesRead++
      }
    } catch {}
  }

  achieveMilestone(goal.id, 'Read documentation')

  // ── Phase 3: Extract concepts ─────────────────────────────────────
  onProgress?.({ phase: 'Extracting', detail: 'Extracting core concepts...' })

  const concepts = extractConcepts(topic, [...allSnippets, ...pageContents])
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
    `${topic} best practices 2024 2025`,
  ]

  if (depth === 'normal' || depth === 'deep') {
    queries.push(
      `${topic} common patterns and examples`,
      `${topic} documentation official`,
      `${topic} cheat sheet quick reference`,
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

/**
 * Extract core concepts from text about a topic.
 * Heuristic-based: looks for patterns like definitions, key terms,
 * numbered lists, and recurring technical phrases.
 */
function extractConcepts(topic: string, texts: string[]): string[] {
  const concepts: string[] = []
  const seen = new Set<string>()
  const topicLower = topic.toLowerCase()

  for (const text of texts) {
    const lines = text.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length < 20 || trimmed.length > 200) continue

      // Pattern: "X is a Y" definitions
      const defMatch = trimmed.match(/^(.{10,60})\s+(?:is|are)\s+(?:a|an|the)\s+(.{10,100})/i)
      if (defMatch && trimmed.toLowerCase().includes(topicLower.slice(0, 4))) {
        addConcept(concepts, seen, trimmed.slice(0, 150))
        continue
      }

      // Pattern: lines with key technical terms related to the topic
      if (trimmed.toLowerCase().includes(topicLower) && (
        trimmed.includes(':') ||
        trimmed.match(/^[-•*]\s/) ||
        trimmed.match(/^\d+[\.)]\s/)
      )) {
        addConcept(concepts, seen, trimmed.replace(/^[-•*\d\.)]+\s*/, '').slice(0, 150))
        continue
      }

      // Pattern: "use X to Y" or "X allows Y" patterns
      const useMatch = trimmed.match(/(?:use|using|allows?|enables?|provides?)\s+(.{5,80})/i)
      if (useMatch && trimmed.toLowerCase().includes(topicLower.slice(0, 4))) {
        addConcept(concepts, seen, trimmed.slice(0, 150))
      }
    }
  }

  // Deduplicate and limit
  return concepts.slice(0, 20)
}

function addConcept(concepts: string[], seen: Set<string>, concept: string): void {
  const key = concept.toLowerCase().slice(0, 30)
  if (seen.has(key)) return
  seen.add(key)
  concepts.push(concept)
}
