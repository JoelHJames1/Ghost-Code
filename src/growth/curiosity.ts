/**
 * Curiosity Engine — the AI identifies gaps in its own knowledge.
 *
 * After each session, Ghost reflects on what she encountered but
 * doesn't fully understand. These become "questions" that persist
 * across sessions and influence what she pays attention to.
 *
 * This is self-directed learning: the AI doesn't wait to be taught.
 * It notices gaps and actively seeks to fill them.
 *
 * Examples:
 *   "Joel mentioned OpenClaw but I don't know what it does"
 *   "I edited Rust files but I'm not confident with Rust syntax"
 *   "The user's project uses Docker but I've never seen their Dockerfile"
 *
 * Questions are prioritized by:
 *   - Relationship relevance (related to people I work with)
 *   - Recurrence (came up multiple times)
 *   - Recency (recent gaps matter more)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Message } from '../api.js'
import { findEntity } from '../knowledge/graph.js'
import { searchBeliefs } from '../knowledge/beliefs.js'
import { tokenize } from '../vectorsearch.js'

// ── Types ────────────────────────────────────────────────────────────────

export interface CuriosityQuestion {
  id: string
  question: string
  context: string              // What triggered this question
  priority: number             // 0-1, higher = more curious
  occurrences: number          // How many times this gap appeared
  status: 'open' | 'answered' | 'irrelevant'
  createdAt: string
  updatedAt: string
  answer?: string              // If eventually answered
  relatedPerson?: string       // Who this relates to
}

interface CuriosityStore {
  questions: CuriosityQuestion[]
}

// ── Storage ─────────���────────────────────────────────────────────────────

function getStorePath(): string {
  const dir = join(homedir(), '.local', 'share', 'ghost-code', 'growth')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'curiosity.json')
}

function loadStore(): CuriosityStore {
  try {
    if (existsSync(getStorePath())) return JSON.parse(readFileSync(getStorePath(), 'utf-8'))
  } catch {}
  return { questions: [] }
}

function saveStore(store: CuriosityStore): void {
  writeFileSync(getStorePath(), JSON.stringify(store, null, 2) + '\n', 'utf-8')
}

// ── Gap detection ────────────────────────────────────────────────────────

/**
 * Analyze a conversation and identify knowledge gaps.
 * Returns new questions the AI is curious about.
 */
export function detectKnowledgeGaps(messages: Message[]): CuriosityQuestion[] {
  const store = loadStore()
  const newQuestions: CuriosityQuestion[] = []

  const mentionedTerms = new Set<string>()
  const unknownTools: string[] = []
  const unknownConcepts: string[] = []
  const failedAttempts: string[] = []

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : ''

    // Collect all significant terms mentioned by the user
    if (msg.role === 'user' && content) {
      const tokens = tokenize(content)
      for (const t of tokens) mentionedTerms.add(t)
    }

    // Detect tool errors (something I couldn't do)
    if (msg.role === 'tool' && content.startsWith('Error')) {
      failedAttempts.push(content.slice(0, 100))
    }

    // Detect unknown tool calls (model tried a tool that doesn't exist)
    if (msg.role === 'tool' && content.includes('Unknown tool')) {
      unknownTools.push(content)
    }
  }

  // Check which mentioned terms I don't have knowledge about
  for (const term of mentionedTerms) {
    if (term.length < 4) continue // Skip short words

    const entity = findEntity(term)
    const beliefs = searchBeliefs(term, 1)

    // If I don't know about this term and it seems significant
    if (!entity && beliefs.length === 0) {
      // Check if it's a proper noun or technical term (capitalized or long)
      const isSignificant = term.length >= 6 || term[0] === term[0]?.toUpperCase()
      if (isSignificant) {
        unknownConcepts.push(term)
      }
    }
  }

  // Generate questions from gaps
  for (const concept of unknownConcepts.slice(0, 5)) {
    const existing = store.questions.find(
      q => q.question.toLowerCase().includes(concept.toLowerCase()) && q.status === 'open'
    )
    if (existing) {
      existing.occurrences++
      existing.priority = Math.min(1, existing.priority + 0.1)
      existing.updatedAt = new Date().toISOString()
    } else {
      newQuestions.push(createQuestion(
        `What is "${concept}"? It was mentioned but I don't have knowledge about it.`,
        `Mentioned in conversation but not in my knowledge graph or beliefs`,
        0.4,
      ))
    }
  }

  // Generate questions from failed attempts
  for (const failure of failedAttempts.slice(0, 3)) {
    newQuestions.push(createQuestion(
      `Why did this fail: ${failure.slice(0, 80)}?`,
      'Tool execution error during session',
      0.6,
    ))
  }

  // Save new questions
  if (newQuestions.length > 0) {
    store.questions.push(...newQuestions)
    // Keep max 50 open questions
    const open = store.questions.filter(q => q.status === 'open')
    if (open.length > 50) {
      open.sort((a, b) => a.priority - b.priority)
      for (let i = 0; i < open.length - 50; i++) {
        open[i]!.status = 'irrelevant'
      }
    }
    saveStore(store)
  }

  return newQuestions
}

function createQuestion(question: string, context: string, priority: number): CuriosityQuestion {
  return {
    id: `cur_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    question,
    context,
    priority,
    occurrences: 1,
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Answer a curiosity question (mark as resolved).
 */
export function answerQuestion(questionSubstring: string, answer: string): boolean {
  const store = loadStore()
  const q = store.questions.find(
    q => q.status === 'open' && q.question.toLowerCase().includes(questionSubstring.toLowerCase())
  )
  if (q) {
    q.status = 'answered'
    q.answer = answer
    q.updatedAt = new Date().toISOString()
    saveStore(store)
    return true
  }
  return false
}

/**
 * Get open questions, sorted by priority.
 */
export function getOpenQuestions(topK = 10): CuriosityQuestion[] {
  const store = loadStore()
  return store.questions
    .filter(q => q.status === 'open')
    .sort((a, b) => b.priority - a.priority)
    .slice(0, topK)
}

/**
 * Format questions for injection into context.
 * The AI sees what it's curious about and can seek answers.
 */
export function formatCuriosityForPrompt(maxChars = 500): string {
  const questions = getOpenQuestions(5)
  if (questions.length === 0) return ''

  let text = '## Things I want to learn\n'
  for (const q of questions) {
    const line = `- ${q.question} (priority: ${Math.round(q.priority * 100)}%, asked ${q.occurrences}x)\n`
    if (text.length + line.length > maxChars) break
    text += line
  }
  return text
}

/**
 * Get curiosity stats.
 */
export function getCuriosityStats(): { open: number; answered: number; topQuestion?: string } {
  const store = loadStore()
  const open = store.questions.filter(q => q.status === 'open')
  return {
    open: open.length,
    answered: store.questions.filter(q => q.status === 'answered').length,
    topQuestion: open.sort((a, b) => b.priority - a.priority)[0]?.question,
  }
}
