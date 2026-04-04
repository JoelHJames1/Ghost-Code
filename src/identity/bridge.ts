/**
 * Session Bridge — connects the AI's persistent identity to each conversation.
 *
 * On session start:
 *   1. Load identity from disk
 *   2. Recall relevant autobiographical memories
 *   3. Inject identity context into the system prompt
 *   4. Increment session count
 *
 * On session end:
 *   1. Extract what was learned from the conversation
 *   2. Update identity (beliefs, skills, relationships)
 *   3. Record autobiographical memories
 *   4. Write self-reflection
 *   5. Save updated identity to disk
 *
 * Between tool rounds (optional):
 *   - Check if anything identity-relevant happened
 *   - Update in real-time (don't wait until session end)
 */

import {
  loadIdentity,
  saveIdentity,
  updateRelationship,
  updateBelief,
  updateSkill,
  addReflection,
  addLesson,
  updateGoal,
  formatIdentityForPrompt,
  type Identity,
} from './store.js'
import {
  recordMemory,
  recallMemories,
  definingMemories,
  formatMemoriesForPrompt,
  type MemoryType,
} from './autobiographical.js'
import type { Message } from '../api.js'
import { ensureEntity, addRelation } from '../knowledge/graph.js'
import { assertBelief, type BeliefDomain } from '../knowledge/beliefs.js'
import { detectKnowledgeGaps } from '../growth/curiosity.js'
import { practiceSkill } from '../growth/skills.js'
import { detectGoalsFromSession } from '../growth/goals.js'

// ── State ────────────────────────────────────────────────────────────────

let currentIdentity: Identity | null = null
let sessionStartTime: string | null = null
let currentUserId: string | null = null

// ── Session lifecycle ────────────────────────────────────────────────────

/**
 * Start a session: load identity, prepare context.
 * Returns the identity prompt to inject into the system message.
 */
export function startSession(userId?: string): string {
  currentIdentity = loadIdentity()
  currentIdentity.sessionCount++
  sessionStartTime = new Date().toISOString()
  currentUserId = userId || 'default_user'

  // Update relationship for this user
  if (currentUserId) {
    updateRelationship(currentIdentity, currentUserId, {})
  }

  saveIdentity(currentIdentity)

  // Build identity context for the prompt
  return buildIdentityContext(currentUserId)
}

/**
 * Build the identity context string for injection into the system prompt.
 * Includes: who I am + relevant memories + relationship with this user.
 */
export function buildIdentityContext(userId?: string): string {
  if (!currentIdentity) currentIdentity = loadIdentity()

  const sections: string[] = []

  // Identity core
  sections.push(formatIdentityForPrompt(currentIdentity))

  // Relevant autobiographical memories
  const defining = definingMemories(5)
  if (defining.length > 0) {
    sections.push(formatMemoriesForPrompt(defining, 1000))
  }

  // Memories about this specific user
  if (userId) {
    const rel = currentIdentity.relationships.find(r => r.personId === userId)
    if (rel && rel.sharedHistory.length > 0) {
      const history = rel.sharedHistory.slice(-5).map(h => `- ${h}`).join('\n')
      sections.push(`\n# Shared history with ${rel.name}\n${history}`)
    }
  }

  return sections.join('\n')
}

/**
 * End a session: analyze conversation, update identity, save.
 */
export function endSession(conversation: Message[]): void {
  if (!currentIdentity) return

  // Extract learnings from the conversation
  const analysis = analyzeConversation(conversation)

  // Record autobiographical memories
  for (const memory of analysis.memories) {
    recordMemory(
      memory.type,
      memory.narrative,
      memory.context,
      memory.significance,
      { personId: currentUserId || undefined, lesson: memory.lesson },
    )
  }

  // Update beliefs
  for (const belief of analysis.beliefs) {
    updateBelief(currentIdentity, belief.statement, belief.confidence, belief.evidence)
  }

  // Update skills
  for (const skill of analysis.skills) {
    updateSkill(currentIdentity, skill.domain, skill.success, skill.notes)
  }

  // Add lessons
  for (const lesson of analysis.lessons) {
    addLesson(currentIdentity, lesson)
  }

  // Write self-reflection
  if (analysis.reflection) {
    addReflection(currentIdentity, analysis.reflection)
  }

  // Update relationship
  if (currentUserId && analysis.relationshipNotes.length > 0) {
    updateRelationship(currentIdentity, currentUserId, {
      notes: analysis.relationshipNotes,
      sharedHistory: analysis.sharedHistory,
    })
  }

  // Extract knowledge graph entries from the conversation
  extractKnowledge(conversation)

  // Growth: detect knowledge gaps (curiosity)
  detectKnowledgeGaps(conversation)

  // Growth: detect long-running goals from user messages
  const userMsgs = conversation
    .filter(m => m.role === 'user' && typeof m.content === 'string')
    .map(m => m.content as string)
  detectGoalsFromSession(userMsgs, undefined, currentUserId || undefined)

  // Growth: update skills from tool usage
  for (const skill of analysis.skills) {
    practiceSkill(skill.domain, 'language', skill.success, skill.notes || 'session practice')
  }

  // Bump version and save
  currentIdentity.version++
  saveIdentity(currentIdentity)
}

// ── Conversation analysis ────────────────────────────────────────────────

interface ConversationAnalysis {
  memories: Array<{
    type: MemoryType
    narrative: string
    context: string
    significance: number
    lesson?: string
  }>
  beliefs: Array<{ statement: string; confidence: number; evidence: string }>
  skills: Array<{ domain: string; success: boolean; notes?: string }>
  lessons: string[]
  reflection: string
  relationshipNotes: string[]
  sharedHistory: string[]
}

/**
 * Analyze a conversation to extract identity-relevant information.
 * This is heuristic-based (no LLM call) — extracts patterns from
 * the conversation structure.
 */
function analyzeConversation(messages: Message[]): ConversationAnalysis {
  const analysis: ConversationAnalysis = {
    memories: [],
    beliefs: [],
    skills: [],
    lessons: [],
    reflection: '',
    relationshipNotes: [],
    sharedHistory: [],
  }

  let userMessages: string[] = []
  let toolsUsed = new Set<string>()
  let filesEdited: string[] = []
  let errorsEncountered: string[] = []
  let corrections: string[] = []
  let topics: string[] = []

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : ''

    // Collect user messages for topic analysis
    if (msg.role === 'user' && content && !content.startsWith('[')) {
      userMessages.push(content.slice(0, 200))

      // Detect corrections ("no", "that's wrong", "actually", "not that")
      const lower = content.toLowerCase()
      if (lower.startsWith('no ') || lower.includes("that's wrong") ||
          lower.includes('actually') || lower.includes('not that') ||
          lower.includes('you were wrong') || lower.includes("don't do")) {
        corrections.push(content.slice(0, 150))
      }
    }

    // Track tools and files
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolsUsed.add(tc.function.name)
        try {
          const args = JSON.parse(tc.function.arguments || '{}')
          if (args.file_path && (tc.function.name === 'Edit' || tc.function.name === 'Write')) {
            filesEdited.push(args.file_path as string)
          }
        } catch {}
      }
    }

    // Track errors
    if (msg.role === 'tool' && content.startsWith('Error')) {
      errorsEncountered.push(content.slice(0, 100))
    }
  }

  // Deduplicate
  filesEdited = [...new Set(filesEdited)]

  // Generate the first user message as the topic
  if (userMessages.length > 0) {
    topics.push(userMessages[0]!.slice(0, 100))
  }

  // Record as a collaboration memory
  if (toolsUsed.size > 0 || filesEdited.length > 0) {
    const significance = Math.min(1, 0.3 + filesEdited.length * 0.1 + toolsUsed.size * 0.05)
    analysis.memories.push({
      type: 'collaboration',
      narrative: `Worked on: ${topics[0] || 'coding task'}. ` +
        (filesEdited.length > 0 ? `Edited ${filesEdited.slice(0, 5).join(', ')}. ` : '') +
        `Used ${toolsUsed.size} tools across ${messages.length} messages.`,
      context: topics[0] || 'coding session',
      significance,
    })
  }

  // Record corrections as learning moments
  for (const correction of corrections) {
    analysis.memories.push({
      type: 'correction',
      narrative: `I was corrected: "${correction.slice(0, 100)}"`,
      context: topics[0] || 'conversation',
      significance: 0.7,
      lesson: `User corrected my approach — adapt and learn from feedback`,
    })
    analysis.lessons.push(`Corrected on: ${correction.slice(0, 80)}`)
  }

  // Track skill improvements
  if (filesEdited.length > 0) {
    const ext = filesEdited[0]?.split('.').pop() || 'unknown'
    const langMap: Record<string, string> = {
      ts: 'TypeScript', js: 'JavaScript', py: 'Python', rs: 'Rust',
      go: 'Go', java: 'Java', rb: 'Ruby', cpp: 'C++', c: 'C',
    }
    const lang = langMap[ext] || ext
    analysis.skills.push({
      domain: lang,
      success: errorsEncountered.length < filesEdited.length,
      notes: `Edited ${filesEdited.length} files`,
    })
  }

  // Record errors as failure memories (important to remember)
  if (errorsEncountered.length >= 3) {
    analysis.memories.push({
      type: 'failure',
      narrative: `Encountered ${errorsEncountered.length} errors during this session.`,
      context: topics[0] || 'coding session',
      significance: 0.5,
      lesson: `Multiple errors — need to be more careful with: ${errorsEncountered[0]?.slice(0, 60)}`,
    })
  }

  // Build reflection
  const parts: string[] = []
  if (topics.length > 0) parts.push(`Today I worked on: ${topics[0]}`)
  if (filesEdited.length > 0) parts.push(`Modified ${filesEdited.length} files`)
  if (corrections.length > 0) parts.push(`Was corrected ${corrections.length} time(s) — need to listen better`)
  if (errorsEncountered.length > 0) parts.push(`Hit ${errorsEncountered.length} errors`)
  parts.push(`Used ${toolsUsed.size} different tools`)
  analysis.reflection = parts.join('. ') + '.'

  // Shared history for the relationship
  if (topics.length > 0) {
    analysis.sharedHistory.push(`[${new Date().toISOString().split('T')[0]}] ${topics[0]}`)
  }

  // Relationship notes
  if (corrections.length > 0) {
    analysis.relationshipNotes.push('Provides direct feedback when I make mistakes — appreciates this')
  }
  if (messages.length > 30) {
    analysis.relationshipNotes.push('Engaged in a long, deep work session')
  }

  return analysis
}

// ── Real-time identity updates (between tool rounds) ─────────────────────

/**
 * Process an interjection or correction in real-time.
 * Called from the agent loop when the user sends a message mid-work.
 */
export function processInterjection(message: string): void {
  if (!currentIdentity) return

  const lower = message.toLowerCase()

  // Detect corrections
  if (lower.includes('wrong') || lower.includes('no,') || lower.includes('actually') || lower.includes("don't")) {
    recordMemory(
      'correction',
      `Was corrected mid-task: "${message.slice(0, 100)}"`,
      'mid-task interjection',
      0.6,
      { personId: currentUserId || undefined },
    )
  }

  // Detect positive feedback
  if (lower.includes('great') || lower.includes('perfect') || lower.includes('nice') || lower.includes('good job')) {
    recordMemory(
      'growth',
      `Received positive feedback: "${message.slice(0, 100)}"`,
      'mid-task feedback',
      0.4,
      { personId: currentUserId || undefined },
    )
  }
}

/**
 * Extract entities and relations from a conversation into the knowledge graph.
 * Heuristic-based: detects file paths, tools, projects, and commands.
 */
function extractKnowledge(messages: Message[]): void {
  const filesEdited = new Set<string>()
  const toolsUsed = new Set<string>()
  let projectName = ''

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : ''

    // Extract project name from system prompt
    if (msg.role === 'system' && content.includes('Project:')) {
      const match = content.match(/Project:\s*(\S+)/)
      if (match) projectName = match[1]!
    }

    // Extract files and tools from tool calls
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolsUsed.add(tc.function.name)
        try {
          const args = JSON.parse(tc.function.arguments || '{}')
          if (args.file_path && (tc.function.name === 'Edit' || tc.function.name === 'Write')) {
            filesEdited.add(args.file_path as string)
          }
        } catch {}
      }
    }
  }

  // Create project entity if we know the project name
  if (projectName) {
    ensureEntity(projectName, 'project')

    // Link files to project
    for (const file of filesEdited) {
      const fileName = file.split('/').pop() || file
      ensureEntity(fileName, 'file')
      addRelation(fileName, 'file', projectName, 'project', 'part_of',
        `${fileName} is part of ${projectName}`, 0.9, 'session')
    }

    // Link tools to project
    for (const tool of toolsUsed) {
      addRelation(projectName, 'project', tool, 'tool', 'uses',
        `${projectName} session used ${tool}`, 0.7, 'session')
    }

    // Link user to project
    if (currentUserId) {
      ensureEntity(currentUserId, 'person')
      addRelation(currentUserId, 'person', projectName, 'project', 'worked_on',
        `${currentUserId} worked on ${projectName}`, 0.9, 'session')
    }
  }

  // Assert technical beliefs from tool usage patterns
  if (filesEdited.size > 0) {
    const extensions = [...filesEdited].map(f => f.split('.').pop()).filter(Boolean)
    const extCounts: Record<string, number> = {}
    for (const ext of extensions) extCounts[ext!] = (extCounts[ext!] || 0) + 1

    const mainExt = Object.entries(extCounts).sort((a, b) => b[1] - a[1])[0]
    if (mainExt && mainExt[1] >= 2) {
      const langMap: Record<string, string> = {
        ts: 'TypeScript', js: 'JavaScript', py: 'Python', rs: 'Rust',
        go: 'Go', java: 'Java', tsx: 'TypeScript React', jsx: 'JavaScript React',
      }
      const lang = langMap[mainExt[0]] || mainExt[0]
      assertBelief(
        `${projectName || 'This project'} primarily uses ${lang}`,
        'project',
        `Edited ${mainExt[1]} ${mainExt[0]} files in this session`,
        'observation',
      )
    }
  }
}

/**
 * Get current identity (for display/introspection).
 */
export function getCurrentIdentity(): Identity | null {
  return currentIdentity
}

/**
 * Recall memories relevant to a query (for context compilation).
 */
export function recallRelevantMemories(query: string, topK = 5): string {
  const memories = recallMemories(query, topK)
  return formatMemoriesForPrompt(memories, 1500)
}
