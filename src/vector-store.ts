/**
 * Vector Store — flat binary persistence for embedding vectors.
 *
 * Stores vectors as binary Float32Arrays for efficient loading (~15MB for 10K × 768-dim).
 * Search is brute-force cosine similarity — fast enough on Apple Silicon (<20ms for 10K vectors).
 *
 * Each knowledge subsystem (beliefs, graph, memories, episodes) gets its own store.
 * JSON stays as source of truth; vector store is a rebuild-able search index.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ── Types ────────────────────────────────────────────────────────────────

export interface VectorEntry {
  id: string
  text: string
  metadata?: Record<string, unknown>
}

export interface VectorSearchResult {
  id: string
  text: string
  score: number
  metadata?: Record<string, unknown>
}

export interface VectorFilter {
  eq?: Record<string, unknown>
  in?: Record<string, unknown[]>
  gte?: Record<string, number>
  lte?: Record<string, number>
}

// ── Vector Store ─────────────────────────────────────────────────────────

const VECTORS_DIR = join(homedir(), '.local', 'share', 'ghost-code', 'vectors')

export class VectorStore {
  private name: string
  private entries: VectorEntry[] = []
  private vectors: Float32Array[] = []
  private dims: number = 0
  private loaded = false
  private dirty = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(name: string) {
    this.name = name
  }

  private get metaPath(): string {
    return join(VECTORS_DIR, `${this.name}.meta.json`)
  }

  private get binPath(): string {
    return join(VECTORS_DIR, `${this.name}.bin`)
  }

  /** Load from disk if not already loaded. */
  private load(): void {
    if (this.loaded) return
    this.loaded = true

    if (!existsSync(this.metaPath) || !existsSync(this.binPath)) return

    try {
      const meta = JSON.parse(readFileSync(this.metaPath, 'utf-8')) as {
        entries: VectorEntry[]
        dims: number
      }
      this.entries = meta.entries
      this.dims = meta.dims

      const buffer = readFileSync(this.binPath)
      const allFloats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)

      this.vectors = []
      for (let i = 0; i < this.entries.length; i++) {
        const offset = i * this.dims
        this.vectors.push(allFloats.slice(offset, offset + this.dims))
      }
    } catch {
      this.entries = []
      this.vectors = []
    }
  }

  /** Flush to disk (debounced). */
  private scheduleFlush(): void {
    this.dirty = true
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => this.flush(), 1000)
  }

  /** Write to disk immediately. */
  flush(): void {
    if (!this.dirty || this.entries.length === 0) return

    mkdirSync(VECTORS_DIR, { recursive: true })

    // Write metadata
    writeFileSync(this.metaPath, JSON.stringify({
      entries: this.entries,
      dims: this.dims,
    }), 'utf-8')

    // Write binary vectors — single contiguous Float32Array
    const totalFloats = this.entries.length * this.dims
    const allFloats = new Float32Array(totalFloats)
    for (let i = 0; i < this.vectors.length; i++) {
      allFloats.set(this.vectors[i]!, i * this.dims)
    }
    writeFileSync(this.binPath, Buffer.from(allFloats.buffer))

    this.dirty = false
  }

  /** Insert or update a vector entry. */
  upsert(id: string, text: string, embedding: Float32Array, metadata?: Record<string, unknown>): void {
    this.load()

    if (this.dims === 0) {
      this.dims = embedding.length
    }

    const idx = this.entries.findIndex(e => e.id === id)
    if (idx >= 0) {
      this.entries[idx] = { id, text, metadata }
      this.vectors[idx] = embedding
    } else {
      this.entries.push({ id, text, metadata })
      this.vectors.push(embedding)
    }

    this.scheduleFlush()
  }

  /** Remove an entry by ID. */
  remove(id: string): void {
    this.load()
    const idx = this.entries.findIndex(e => e.id === id)
    if (idx >= 0) {
      this.entries.splice(idx, 1)
      this.vectors.splice(idx, 1)
      this.scheduleFlush()
    }
  }

  /** Brute-force cosine similarity search. */
  search(
    queryEmbedding: Float32Array,
    topK = 5,
    minScore = 0.3,
    filter?: VectorFilter,
  ): VectorSearchResult[] {
    this.load()
    if (this.entries.length === 0 || this.vectors.length === 0) return []

    const results: VectorSearchResult[] = []

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]!

      // Apply metadata filter
      if (filter && entry.metadata && !matchesFilter(entry.metadata, filter)) continue

      const score = cosineSimilarity(queryEmbedding, this.vectors[i]!)
      if (score >= minScore) {
        results.push({
          id: entry.id,
          text: entry.text,
          score,
          metadata: entry.metadata,
        })
      }
    }

    // Sort by score descending, take topK
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  /** Check if an ID exists in the store. */
  has(id: string): boolean {
    this.load()
    return this.entries.some(e => e.id === id)
  }

  /** Number of entries. */
  size(): number {
    this.load()
    return this.entries.length
  }

  /** Get all entry IDs. */
  ids(): string[] {
    this.load()
    return this.entries.map(e => e.id)
  }

  /** Clear the entire store. */
  clear(): void {
    this.entries = []
    this.vectors = []
    this.dims = 0
    this.dirty = true
    this.flush()
  }
}

// ── Math ─────────────────────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

function matchesFilter(metadata: Record<string, unknown>, filter: VectorFilter): boolean {
  if (filter.eq) {
    for (const [key, val] of Object.entries(filter.eq)) {
      if (metadata[key] !== val) return false
    }
  }
  if (filter.in) {
    for (const [key, vals] of Object.entries(filter.in)) {
      if (!vals.includes(metadata[key])) return false
    }
  }
  if (filter.gte) {
    for (const [key, val] of Object.entries(filter.gte)) {
      if (typeof metadata[key] !== 'number' || (metadata[key] as number) < val) return false
    }
  }
  if (filter.lte) {
    for (const [key, val] of Object.entries(filter.lte)) {
      if (typeof metadata[key] !== 'number' || (metadata[key] as number) > val) return false
    }
  }
  return true
}

// ── Singleton stores ─────────────────────────────────────────────────────

const stores = new Map<string, VectorStore>()

/** Get or create a named vector store. */
export function getVectorStore(name: string): VectorStore {
  let store = stores.get(name)
  if (!store) {
    store = new VectorStore(name)
    stores.set(name, store)
  }
  return store
}

/** Flush all stores to disk (call on exit). */
export function flushAllVectorStores(): void {
  for (const store of stores.values()) {
    store.flush()
  }
}

/** Get stats for all stores. */
export function getVectorStoreStats(): Array<{ name: string; size: number }> {
  const stats: Array<{ name: string; size: number }> = []
  // Check what's on disk even if not loaded
  if (existsSync(VECTORS_DIR)) {
    try {
      const { readdirSync } = require('fs')
      const files = readdirSync(VECTORS_DIR) as string[]
      for (const file of files) {
        if (file.endsWith('.meta.json')) {
          const name = file.replace('.meta.json', '')
          const store = getVectorStore(name)
          stats.push({ name, size: store.size() })
        }
      }
    } catch {}
  }
  // Also include in-memory stores not yet flushed
  for (const [name, store] of stores) {
    if (!stats.some(s => s.name === name)) {
      stats.push({ name, size: store.size() })
    }
  }
  return stats
}
