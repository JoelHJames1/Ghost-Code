/**
 * Embedding server — manages a second llama-server process for text embeddings.
 *
 * Runs a small embedding model (nomic-embed-text-v1.5, ~140MB) on a separate port.
 * Lazy-started: only spins up when the first embedding is requested.
 * If the model isn't available, everything falls back to TF-IDF silently.
 */

import { spawn, execSync, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DEFAULT_EMBEDDING_PORT = 8777
const DEFAULT_EMBEDDING_HOST = '127.0.0.1'
const DEFAULT_HF_REPO = 'nomic-ai/nomic-embed-text-v1.5-GGUF'
const HEALTH_TIMEOUT_MS = 300_000 // 5 min for first-run download

let embeddingProcess: ChildProcess | null = null
let embeddingBaseUrl: string | null = null
let startPromise: Promise<string | null> | null = null
let startFailed = false

export interface EmbeddingConfig {
  hfRepo?: string
  modelPath?: string
  port?: number
  host?: string
  gpuLayers?: number
  binaryPath?: string
}

/**
 * Find llama-server binary (same logic as main server).
 */
function findBinary(configPath?: string): string | null {
  if (configPath && existsSync(configPath)) return configPath
  try {
    const which = execSync('which llama-server 2>/dev/null', { encoding: 'utf-8' }).trim()
    if (which) return which
  } catch {}
  const candidates = [
    '/usr/local/bin/llama-server',
    '/opt/homebrew/bin/llama-server',
    join(homedir(), 'llama.cpp', 'build', 'bin', 'llama-server'),
    join(homedir(), '.local', 'share', 'ghost-code', 'llama-server'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) {
        const data = await res.json() as { status?: string }
        if (data.status === 'ok' || data.status === 'no slot available') return true
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

/**
 * Start the embedding server. Returns the base URL, or null if unavailable.
 */
async function startEmbeddingServer(config: EmbeddingConfig = {}): Promise<string | null> {
  const port = config.port || DEFAULT_EMBEDDING_PORT
  const host = config.host || DEFAULT_EMBEDDING_HOST
  const baseUrl = `http://${host}:${port}`

  // Already running?
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      embeddingBaseUrl = baseUrl
      return baseUrl
    }
  } catch {}

  // Find binary
  const binary = findBinary(config.binaryPath)
  if (!binary) return null

  // Need a model
  const hfRepo = config.hfRepo || DEFAULT_HF_REPO
  const modelPath = config.modelPath

  if (!modelPath && !hfRepo) return null

  // Build args — embedding models need --embedding flag and small context
  const args: string[] = []
  if (modelPath) {
    args.push('-m', modelPath)
  } else {
    args.push('-hf', hfRepo)
  }
  args.push('--host', host)
  args.push('--port', String(port))
  args.push('-ngl', String(config.gpuLayers ?? 99))
  args.push('-c', '2048') // Small context for embeddings
  args.push('--embedding') // Enable embedding endpoint
  args.push('--no-warmup')
  args.push('-np', '1')

  // Start process
  embeddingProcess = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  // Suppress logs
  embeddingProcess.stdout?.on('data', () => {})
  embeddingProcess.stderr?.on('data', () => {})

  embeddingProcess.on('exit', () => {
    embeddingProcess = null
    embeddingBaseUrl = null
  })

  const healthy = await waitForHealth(baseUrl, HEALTH_TIMEOUT_MS)
  if (!healthy) {
    stopEmbeddingServer()
    return null
  }

  embeddingBaseUrl = baseUrl
  return baseUrl
}

/**
 * Stop the embedding server.
 */
export function stopEmbeddingServer(): void {
  if (embeddingProcess) {
    embeddingProcess.kill('SIGTERM')
    setTimeout(() => {
      if (embeddingProcess && !embeddingProcess.killed) {
        embeddingProcess.kill('SIGKILL')
      }
    }, 3000)
    embeddingProcess = null
    embeddingBaseUrl = null
  }
  startPromise = null
  startFailed = false
}

/**
 * Ensure the embedding server is running (lazy start).
 * Returns base URL or null if unavailable.
 */
export async function ensureEmbeddingServer(config: EmbeddingConfig = {}): Promise<string | null> {
  if (embeddingBaseUrl) return embeddingBaseUrl
  if (startFailed) return null

  // Deduplicate concurrent starts
  if (!startPromise) {
    startPromise = startEmbeddingServer(config).then(url => {
      if (!url) startFailed = true
      return url
    })
  }
  return startPromise
}

/**
 * Embed one or more texts. Returns array of Float32Arrays (one per text).
 * Returns null if embedding server is unavailable.
 */
export async function embed(
  texts: string[],
  config: EmbeddingConfig = {},
): Promise<Float32Array[] | null> {
  const baseUrl = await ensureEmbeddingServer(config)
  if (!baseUrl) return null

  try {
    // llama.cpp /embedding endpoint accepts array of content
    const res = await fetch(`${baseUrl}/embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: texts }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) return null

    const data = await res.json() as Array<{ embedding: number[] }>

    return data.map(d => new Float32Array(d.embedding))
  } catch {
    return null
  }
}

/**
 * Embed a single text. Returns Float32Array or null.
 */
export async function embedOne(
  text: string,
  config: EmbeddingConfig = {},
): Promise<Float32Array | null> {
  const results = await embed([text], config)
  return results?.[0] ?? null
}

/**
 * Check if the embedding server is available (without starting it).
 */
export function isEmbeddingAvailable(): boolean {
  return embeddingBaseUrl !== null
}

/**
 * Get embedding server status.
 */
export function getEmbeddingStatus(): { running: boolean; url: string | null; failed: boolean } {
  return {
    running: embeddingBaseUrl !== null,
    url: embeddingBaseUrl,
    failed: startFailed,
  }
}
