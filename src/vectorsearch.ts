/**
 * Local vector search — TF-IDF + cosine similarity.
 *
 * No external dependencies. No embedding API calls. No vector DB.
 * Runs entirely in-process using term frequency–inverse document
 * frequency (TF-IDF) vectors with cosine similarity ranking.
 *
 * This gives us semantic-ish search over memory entries:
 * a query about "auth token validation" will find memories
 * mentioning "validateToken", "auth.ts", "JWT", etc. — even
 * if the exact words don't match, shared terms boost relevance.
 *
 * Performance: O(n*v) where n = documents, v = vocabulary size.
 * Fine for hundreds of memories. For thousands, would need an index.
 */

// ── Tokenization ─────────────────────────────────────────────────────────

/** Stop words to filter out (common English words that don't carry meaning). */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'and', 'but', 'or', 'if', 'that', 'this', 'it', 'its', 'i', 'me',
  'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them', 'his',
  'her', 'what', 'which', 'who', 'whom', 'these', 'those', 'am',
])

/**
 * Tokenize text into normalized terms.
 * Splits on non-alphanumeric, lowercases, removes stop words,
 * and splits camelCase/snake_case identifiers.
 */
export function tokenize(text: string): string[] {
  // Split camelCase: "validateToken" → "validate token"
  const expanded = text.replace(/([a-z])([A-Z])/g, '$1 $2')
  // Split on non-alphanumeric
  const raw = expanded.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  // Remove stop words and very short tokens
  return raw.filter(t => t.length >= 2 && !STOP_WORDS.has(t))
}

// ── TF-IDF ───────────────────────────────────────────────────────────────

/** Term frequency: count of each term in a document. */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1)
  }
  // Normalize by document length
  const len = tokens.length || 1
  for (const [term, count] of tf) {
    tf.set(term, count / len)
  }
  return tf
}

/** Inverse document frequency for each term across all documents. */
function inverseDocumentFrequency(
  documents: Map<string, number>[],
): Map<string, number> {
  const n = documents.length
  const df = new Map<string, number>()

  for (const doc of documents) {
    for (const term of doc.keys()) {
      df.set(term, (df.get(term) || 0) + 1)
    }
  }

  const idf = new Map<string, number>()
  for (const [term, count] of df) {
    // Standard IDF with smoothing
    idf.set(term, Math.log((n + 1) / (count + 1)) + 1)
  }
  return idf
}

/** Compute TF-IDF vector for a document. */
function tfidfVector(
  tf: Map<string, number>,
  idf: Map<string, number>,
): Map<string, number> {
  const vec = new Map<string, number>()
  for (const [term, freq] of tf) {
    const idfVal = idf.get(term) || 1
    vec.set(term, freq * idfVal)
  }
  return vec
}

/** Cosine similarity between two sparse vectors. */
function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (const [term, valA] of a) {
    normA += valA * valA
    const valB = b.get(term)
    if (valB !== undefined) {
      dotProduct += valA * valB
    }
  }
  for (const valB of b.values()) {
    normB += valB * valB
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dotProduct / denom
}

// ── Search Interface ─────────────────────────────────────────────────────

export interface SearchDocument {
  id: string | number
  text: string
  metadata?: Record<string, unknown>
}

export interface SearchResult {
  id: string | number
  score: number
  text: string
  metadata?: Record<string, unknown>
}

/** Metadata filter for scoped retrieval. */
export interface SearchFilter {
  /** Only include docs where metadata[key] === value */
  eq?: Record<string, unknown>
  /** Only include docs where metadata[key] is in the set */
  in?: Record<string, unknown[]>
  /** Only include docs where numeric metadata[key] >= value */
  gte?: Record<string, number>
  /** Only include docs where numeric metadata[key] <= value */
  lte?: Record<string, number>
}

/**
 * Apply metadata filters to documents BEFORE vector scoring.
 * Pre-filtering prevents recall cliffs from post-filter approaches.
 */
function applyFilters(docs: SearchDocument[], filter?: SearchFilter): SearchDocument[] {
  if (!filter) return docs
  return docs.filter(doc => {
    const meta = doc.metadata || {}
    if (filter.eq) {
      for (const [k, v] of Object.entries(filter.eq)) {
        if (meta[k] !== v) return false
      }
    }
    if (filter.in) {
      for (const [k, vals] of Object.entries(filter.in)) {
        if (!vals.includes(meta[k])) return false
      }
    }
    if (filter.gte) {
      for (const [k, v] of Object.entries(filter.gte)) {
        if (typeof meta[k] !== 'number' || (meta[k] as number) < v) return false
      }
    }
    if (filter.lte) {
      for (const [k, v] of Object.entries(filter.lte)) {
        if (typeof meta[k] !== 'number' || (meta[k] as number) > v) return false
      }
    }
    return true
  })
}

/**
 * Build a search index and query it with optional metadata filtering.
 *
 * Usage:
 *   const results = search(documents, "auth token validation", 5)
 *   const results = search(documents, "auth", 5, 0.05, { eq: { project: "myapp" } })
 *
 * Pre-filters by metadata BEFORE vector scoring to avoid recall cliffs.
 * Returns the top-k most relevant documents sorted by cosine similarity.
 */
export function search(
  documents: SearchDocument[],
  query: string,
  topK = 5,
  minScore = 0.05,
  filter?: SearchFilter,
): SearchResult[] {
  // Pre-filter by metadata before scoring (prevents recall cliffs)
  const filtered = applyFilters(documents, filter)
  if (filtered.length === 0) return []

  const docTokens = filtered.map(d => tokenize(d.text))
  const queryTokens = tokenize(query)

  if (queryTokens.length === 0) return []

  const docTFs = docTokens.map(tokens => termFrequency(tokens))
  const queryTF = termFrequency(queryTokens)

  const allDocs = [...docTFs, queryTF]
  const idf = inverseDocumentFrequency(allDocs)

  const docVectors = docTFs.map(tf => tfidfVector(tf, idf))
  const queryVector = tfidfVector(queryTF, idf)

  const scored: SearchResult[] = filtered.map((doc, i) => ({
    id: doc.id,
    score: cosineSimilarity(queryVector, docVectors[i]!),
    text: doc.text,
    metadata: doc.metadata,
  }))

  return scored
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

// ── Retrieval Cache ──────────────────────────────────────────────────────

/**
 * LRU cache for search results.
 * Avoids recomputing TF-IDF on identical queries within the same session.
 * Cache key = query + filter hash. TTL = 30 seconds.
 */
const CACHE_TTL = 30_000
const CACHE_MAX = 20

interface CacheEntry {
  results: SearchResult[]
  timestamp: number
}

const searchCache = new Map<string, CacheEntry>()

function cacheKey(query: string, filter?: SearchFilter): string {
  return `${query}::${filter ? JSON.stringify(filter) : ''}`
}

/**
 * Cached search — returns cached results if available and fresh,
 * otherwise runs search and caches the results.
 */
export function cachedSearch(
  documents: SearchDocument[],
  query: string,
  topK = 5,
  minScore = 0.05,
  filter?: SearchFilter,
): SearchResult[] {
  const key = cacheKey(query, filter)
  const cached = searchCache.get(key)

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.results
  }

  const results = search(documents, query, topK, minScore, filter)

  // Evict oldest if cache is full
  if (searchCache.size >= CACHE_MAX) {
    const oldest = [...searchCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0]
    if (oldest) searchCache.delete(oldest[0])
  }

  searchCache.set(key, { results, timestamp: Date.now() })
  return results
}

/**
 * Clear the search cache (call when memory store changes).
 */
export function clearSearchCache(): void {
  searchCache.clear()
}

/**
 * Quick relevance check — does a query have any keyword overlap with text?
 * Faster than full TF-IDF for pre-filtering.
 */
export function hasOverlap(query: string, text: string): boolean {
  const qTokens = new Set(tokenize(query))
  const tTokens = tokenize(text)
  return tTokens.some(t => qTokens.has(t))
}

// ── Hybrid Search (Vectors + TF-IDF + Reciprocal Rank Fusion) ───────────

import { embedOne, isEmbeddingAvailable } from './embedding-server.js'
import { type VectorStore, type VectorSearchResult } from './vector-store.js'

/**
 * Hybrid search: combines vector embedding search with TF-IDF using
 * Reciprocal Rank Fusion (RRF). Falls back to TF-IDF only if
 * embeddings are unavailable.
 *
 * @param documents - Documents for TF-IDF search
 * @param query - Search query
 * @param vectorStore - Optional vector store for embedding search
 * @param topK - Number of results to return
 * @param minScore - Minimum score threshold
 * @param filter - Optional metadata filter
 */
export async function hybridSearch(
  documents: SearchDocument[],
  query: string,
  vectorStore: VectorStore | null,
  topK = 5,
  minScore = 0.05,
  filter?: SearchFilter,
): Promise<SearchResult[]> {
  // Always run TF-IDF (fast, synchronous)
  const tfidfResults = search(documents, query, topK * 2, minScore, filter)

  // Try vector search if store exists and embeddings are available
  let vectorResults: VectorSearchResult[] = []
  if (vectorStore && vectorStore.size() > 0 && isEmbeddingAvailable()) {
    try {
      const queryEmbedding = await embedOne(query)
      if (queryEmbedding) {
        vectorResults = vectorStore.search(
          queryEmbedding,
          topK * 2,
          0.3, // Higher threshold for vectors (cosine similarity is different scale)
          filter ? {
            eq: filter.eq,
            in: filter.in,
            gte: filter.gte,
            lte: filter.lte,
          } : undefined,
        )
      }
    } catch {}
  }

  // If no vector results, return TF-IDF only
  if (vectorResults.length === 0) {
    return tfidfResults.slice(0, topK)
  }

  // Reciprocal Rank Fusion (RRF): merge results from different ranking systems
  // RRF score = sum(1 / (k + rank)) across all rankers. k=60 is standard.
  const K = 60
  const fusedScores = new Map<string, { score: number; text: string; metadata?: Record<string, unknown> }>()

  // Score TF-IDF results (weight: 0.35)
  for (let i = 0; i < tfidfResults.length; i++) {
    const r = tfidfResults[i]!
    const id = String(r.id)
    const rrfScore = 0.35 * (1 / (K + i + 1))
    const existing = fusedScores.get(id)
    if (existing) {
      existing.score += rrfScore
    } else {
      fusedScores.set(id, { score: rrfScore, text: r.text, metadata: r.metadata })
    }
  }

  // Score vector results (weight: 0.65 — vectors are more reliable for semantic)
  for (let i = 0; i < vectorResults.length; i++) {
    const r = vectorResults[i]!
    const id = String(r.id)
    const rrfScore = 0.65 * (1 / (K + i + 1))
    const existing = fusedScores.get(id)
    if (existing) {
      existing.score += rrfScore
    } else {
      fusedScores.set(id, { score: rrfScore, text: r.text, metadata: r.metadata })
    }
  }

  // Sort by fused score and return
  const merged = [...fusedScores.entries()]
    .map(([id, data]) => ({
      id,
      score: data.score,
      text: data.text,
      metadata: data.metadata,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  return merged
}
