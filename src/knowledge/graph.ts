/**
 * Knowledge Graph — the AI's structured understanding of the world.
 *
 * Not flat text memories. A real graph of entities and relationships:
 *   - People: "Joel has an M3 Max with 48GB RAM"
 *   - Projects: "Ghost Code uses llama.cpp as its backend"
 *   - Concepts: "TF-IDF is a text similarity algorithm"
 *   - Tools: "llama-server needs --jinja for tool calling"
 *
 * Every edge has:
 *   - Provenance (which session, when)
 *   - Confidence (how sure are we)
 *   - Status (active, superseded, uncertain)
 *
 * The graph enables relational reasoning:
 *   "What do I know about Joel's hardware?" → traverse from Joel entity
 *   "What tools does Ghost Code use?" → traverse from project entity
 *
 * Storage: ~/.local/share/ghost-code/knowledge/graph.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { search, hybridSearch, type SearchDocument } from '../vectorsearch.js'
import { getVectorStore } from '../vector-store.js'
import { embedOne } from '../embedding-server.js'

// ── Types ────────────────────────────────────────────────────────────────

export type EntityType = 'person' | 'project' | 'concept' | 'tool' | 'file' | 'organization' | 'technology'

export interface Entity {
  id: string
  type: EntityType
  name: string
  aliases: string[]                // Alternative names ("Joel" = "Joel Hernandez")
  properties: Record<string, string>  // Key-value facts about this entity
  createdAt: string
  updatedAt: string
}

export type RelationType =
  | 'owns'           // Joel owns Ghost Code
  | 'uses'           // Ghost Code uses llama.cpp
  | 'knows'          // I know Joel
  | 'created'        // Joel created Ghost Code
  | 'depends_on'     // Ghost Code depends on Bun
  | 'part_of'        // api.ts is part of Ghost Code
  | 'related_to'     // TF-IDF related to vector search
  | 'has_property'   // Joel has M3 Max
  | 'learned_from'   // I learned X from Joel
  | 'worked_on'      // Joel worked on auth module

export interface Relation {
  id: string
  fromId: string
  toId: string
  type: RelationType
  label: string             // Human-readable description
  confidence: number        // 0-1
  status: 'active' | 'superseded' | 'uncertain'
  provenance: string        // Session/event that created this
  createdAt: string
  updatedAt: string
  supersededBy?: string     // ID of relation that replaced this
}

interface KnowledgeStore {
  entities: Entity[]
  relations: Relation[]
}

// ── Storage ──────────────────────────────────────────────────────────────

function getStorePath(): string {
  const dir = join(homedir(), '.local', 'share', 'ghost-code', 'knowledge')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'graph.json')
}

function loadGraph(): KnowledgeStore {
  const path = getStorePath()
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {}
  return { entities: [], relations: [] }
}

function saveGraph(store: KnowledgeStore): void {
  writeFileSync(getStorePath(), JSON.stringify(store, null, 2) + '\n', 'utf-8')
}

// ── Entity operations ────────────────────────────────────────────────────

/**
 * Find or create an entity by name.
 */
export function ensureEntity(
  name: string,
  type: EntityType,
  properties?: Record<string, string>,
): Entity {
  const store = loadGraph()
  const lower = name.toLowerCase()

  // Search by name or alias
  let entity = store.entities.find(
    e => e.name.toLowerCase() === lower || e.aliases.some(a => a.toLowerCase() === lower)
  )

  if (entity) {
    // Update properties
    if (properties) {
      entity.properties = { ...entity.properties, ...properties }
      entity.updatedAt = new Date().toISOString()
      saveGraph(store)
    }
    return entity
  }

  // Create new
  entity = {
    id: `ent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    name,
    aliases: [],
    properties: properties || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  store.entities.push(entity)
  saveGraph(store)
  return entity
}

/**
 * Add an alias to an entity.
 */
export function addAlias(entityName: string, alias: string): void {
  const store = loadGraph()
  const entity = store.entities.find(e => e.name.toLowerCase() === entityName.toLowerCase())
  if (entity && !entity.aliases.includes(alias)) {
    entity.aliases.push(alias)
    entity.updatedAt = new Date().toISOString()
    saveGraph(store)
  }
}

/**
 * Update entity properties.
 */
export function setProperty(entityName: string, key: string, value: string): void {
  const store = loadGraph()
  const entity = store.entities.find(e => e.name.toLowerCase() === entityName.toLowerCase())
  if (entity) {
    entity.properties[key] = value
    entity.updatedAt = new Date().toISOString()
    saveGraph(store)
  }
}

/**
 * Find an entity by name or alias.
 */
export function findEntity(name: string): Entity | null {
  const store = loadGraph()
  const lower = name.toLowerCase()
  return store.entities.find(
    e => e.name.toLowerCase() === lower || e.aliases.some(a => a.toLowerCase() === lower)
  ) || null
}

// ── Relation operations ──────────────────────────────────────────────────

/**
 * Add or update a relation between entities.
 * If a conflicting relation exists, it's superseded.
 */
export function addRelation(
  fromName: string,
  fromType: EntityType,
  toName: string,
  toType: EntityType,
  relationType: RelationType,
  label: string,
  confidence = 0.8,
  provenance = 'session',
): Relation {
  const store = loadGraph()

  // Ensure entities exist
  const from = ensureEntity(fromName, fromType)
  const to = ensureEntity(toName, toType)

  // Reload after ensureEntity may have saved
  const freshStore = loadGraph()

  // Check for existing relation of same type between same entities
  const existing = freshStore.relations.find(
    r => r.fromId === from.id && r.toId === to.id && r.type === relationType && r.status === 'active'
  )

  if (existing) {
    // Update confidence and label
    existing.confidence = confidence
    existing.label = label
    existing.updatedAt = new Date().toISOString()
    existing.provenance = provenance
    saveGraph(freshStore)
    return existing
  }

  // Create new relation
  const relation: Relation = {
    id: `rel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    fromId: from.id,
    toId: to.id,
    type: relationType,
    label,
    confidence,
    status: 'active',
    provenance,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  freshStore.relations.push(relation)

  // Embed for vector search (fire-and-forget)
  embedOne(label).then(embedding => {
    if (embedding) {
      getVectorStore('graph').upsert(relation.id, label, embedding, { type: relation.type })
    }
  }).catch(() => {})

  // Keep max 10000 relations
  if (freshStore.relations.length > 10000) {
    const superseded = freshStore.relations.filter(r => r.status === 'superseded')
    const active = freshStore.relations.filter(r => r.status !== 'superseded')
    freshStore.relations = [...active.slice(-9000), ...superseded.slice(-1000)]
  }

  saveGraph(freshStore)
  return relation
}

/**
 * Supersede a relation with a new one.
 */
export function supersedeRelation(
  fromName: string,
  toName: string,
  relationType: RelationType,
  newLabel: string,
  newConfidence = 0.8,
): Relation | null {
  const store = loadGraph()
  const from = findEntity(fromName)
  const to = findEntity(toName)
  if (!from || !to) return null

  // Find and supersede existing
  const existing = store.relations.find(
    r => r.fromId === from.id && r.toId === to.id && r.type === relationType && r.status === 'active'
  )

  if (existing) {
    existing.status = 'superseded'
    existing.updatedAt = new Date().toISOString()
  }

  saveGraph(store)

  // Add the new relation
  return addRelation(
    fromName, from.type,
    toName, to.type,
    relationType, newLabel, newConfidence, 'supersession'
  )
}

// ── Query operations ─────────────────────────────────────────────────────

/**
 * Get everything known about an entity (properties + relations).
 */
export function queryEntity(name: string): {
  entity: Entity | null
  relations: Array<{ type: RelationType; label: string; target: string; confidence: number }>
} {
  const store = loadGraph()
  const entity = findEntity(name)
  if (!entity) return { entity: null, relations: [] }

  const relations = store.relations
    .filter(r => (r.fromId === entity.id || r.toId === entity.id) && r.status === 'active')
    .map(r => {
      const isFrom = r.fromId === entity.id
      const targetId = isFrom ? r.toId : r.fromId
      const target = store.entities.find(e => e.id === targetId)
      return {
        type: r.type,
        label: r.label,
        target: target?.name || targetId,
        confidence: r.confidence,
      }
    })

  return { entity, relations }
}

/**
 * Search the knowledge graph by text query.
 * Searches entity names, properties, and relation labels.
 */
export function searchGraph(query: string, topK = 10): Array<{
  type: 'entity' | 'relation'
  name: string
  detail: string
  score: number
}> {
  const store = loadGraph()
  const results: Array<{ type: 'entity' | 'relation'; name: string; detail: string; score: number }> = []

  // Search entities
  const entityDocs: SearchDocument[] = store.entities.map((e, i) => ({
    id: i,
    text: `${e.name} ${e.aliases.join(' ')} ${Object.entries(e.properties).map(([k, v]) => `${k}: ${v}`).join(' ')}`,
  }))

  if (entityDocs.length > 0) {
    const entityResults = search(entityDocs, query, topK, 0.03)
    for (const r of entityResults) {
      const e = store.entities[r.id as number]!
      const props = Object.entries(e.properties).map(([k, v]) => `${k}=${v}`).join(', ')
      results.push({
        type: 'entity',
        name: e.name,
        detail: `[${e.type}] ${props || 'no properties'}`,
        score: r.score,
      })
    }
  }

  // Search relations
  const relDocs: SearchDocument[] = store.relations
    .filter(r => r.status === 'active')
    .map((r, i) => ({ id: i, text: r.label }))

  if (relDocs.length > 0) {
    const relResults = search(relDocs, query, topK, 0.03)
    const activeRelations = store.relations.filter(r => r.status === 'active')
    for (const r of relResults) {
      const rel = activeRelations[r.id as number]!
      const from = store.entities.find(e => e.id === rel.fromId)
      const to = store.entities.find(e => e.id === rel.toId)
      results.push({
        type: 'relation',
        name: `${from?.name || '?'} → ${to?.name || '?'}`,
        detail: `[${rel.type}] ${rel.label} (${Math.round(rel.confidence * 100)}%)`,
        score: r.score,
      })
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK)
}

/**
 * Format knowledge about a topic for injection into context.
 */
export function formatKnowledgeForPrompt(query: string, maxChars = 1500): string {
  const results = searchGraph(query, 8)
  if (results.length === 0) return ''

  let text = '## Knowledge graph\n'
  for (const r of results) {
    const line = `- ${r.name}: ${r.detail}\n`
    if (text.length + line.length > maxChars) break
    text += line
  }

  return text
}

/**
 * Get graph stats.
 */
export function getGraphStats(): {
  entities: number
  relations: number
  entityTypes: Record<string, number>
} {
  const store = loadGraph()
  const entityTypes: Record<string, number> = {}
  for (const e of store.entities) {
    entityTypes[e.type] = (entityTypes[e.type] || 0) + 1
  }
  return {
    entities: store.entities.length,
    relations: store.relations.filter(r => r.status === 'active').length,
    entityTypes,
  }
}
