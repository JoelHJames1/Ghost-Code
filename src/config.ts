/**
 * Configuration system — layered resolution: CLI args > env vars > config file > defaults.
 * Config file lives at ~/.config/ghost-code/config.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface GhostConfig {
  /** Model display name */
  model: string
  /** Base URL for llama-server API (auto-set) */
  baseUrl: string
  /** Override auto-detected context window */
  contextWindow?: number
  /** Max consecutive tool-call rounds */
  maxToolRounds: number
  /** Custom project instructions file name */
  projectInstructionsFile: string
  /** Request timeout in milliseconds */
  requestTimeoutMs: number

  // ── llama-server settings ────────────────────────────────
  /** Path to llama-server binary (auto-detected if not set) */
  llamaBinaryPath?: string
  /** Path to GGUF model file */
  modelPath?: string
  /** HuggingFace repo for auto-download (e.g. "google/gemma-3-27b-it-GGUF") */
  hfRepo?: string
  /** Port for llama-server (default: 8776) */
  llamaPort: number
  /** Number of GPU layers to offload (default: 99 = max) */
  gpuLayers: number
  /** Context size for llama-server (0 = model default) */
  llamaContextSize: number
  /** Enable flash attention (default: true) */
  flashAttn: boolean
  /** Additional CLI args for llama-server */
  llamaExtraArgs: string[]

  // ── Embedding server settings ──────────────────────────────
  /** HuggingFace repo for embedding model (e.g. "nomic-ai/nomic-embed-text-v1.5-GGUF") */
  embeddingHfRepo: string
  /** Path to embedding GGUF model file (overrides hfRepo) */
  embeddingModelPath?: string
  /** Port for embedding server (default: 8777) */
  embeddingPort: number
}

const DEFAULTS: GhostConfig = {
  model: 'gemma4:e2b',
  baseUrl: 'http://127.0.0.1:8776',
  maxToolRounds: 30,
  projectInstructionsFile: '.ghost-code.md',
  requestTimeoutMs: 120_000,
  llamaPort: 8776,
  gpuLayers: 99,
  llamaContextSize: 131072,
  flashAttn: true,
  llamaExtraArgs: [],
  embeddingHfRepo: 'nomic-ai/nomic-embed-text-v1.5-GGUF',
  embeddingPort: 8777,
}

function getConfigDir(): string {
  return join(homedir(), '.config', 'ghost-code')
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json')
}

/**
 * Load config from ~/.config/ghost-code/config.json.
 * Returns empty object if file doesn't exist or is invalid.
 */
function loadConfigFile(): Partial<GhostConfig> {
  const path = getConfigPath()
  try {
    if (!existsSync(path)) return {}
    const raw = readFileSync(path, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * Resolve final config: CLI overrides > env vars > config file > defaults.
 */
export function resolveConfig(overrides: Partial<GhostConfig> = {}): GhostConfig {
  const file = loadConfigFile()
  const env: Partial<GhostConfig> = {}

  if (process.env.GHOST_MODEL_PATH) env.modelPath = process.env.GHOST_MODEL_PATH
  if (process.env.GHOST_HF_REPO) env.hfRepo = process.env.GHOST_HF_REPO
  if (process.env.GHOST_GPU_LAYERS) env.gpuLayers = parseInt(process.env.GHOST_GPU_LAYERS, 10)
  const resolved = {
    ...DEFAULTS,
    ...file,
    ...env,
    ...overrides,
  }

  // Auto-set baseUrl based on port
  if (!overrides.baseUrl && !file.baseUrl && !env.baseUrl) {
    resolved.baseUrl = `http://127.0.0.1:${resolved.llamaPort}`
  }

  return resolved
}

/**
 * Save config to disk.
 */
export function saveConfig(config: Partial<GhostConfig>): void {
  const dir = getConfigDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const existing = loadConfigFile()
  const merged = { ...existing, ...config }
  writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2) + '\n', 'utf-8')
}

/**
 * Format config for display.
 */
export function formatConfig(config: GhostConfig): string {
  const lines: string[] = []
  lines.push(`  model: ${config.model}`)
  lines.push(`  baseUrl: ${config.baseUrl}`)
  if (config.modelPath) lines.push(`  modelPath: ${config.modelPath}`)
  if (config.hfRepo) lines.push(`  hfRepo: ${config.hfRepo}`)
  lines.push(`  gpuLayers: ${config.gpuLayers}`)
  lines.push(`  llamaPort: ${config.llamaPort}`)
  lines.push(`  llamaContextSize: ${config.llamaContextSize || 'auto'}`)
  lines.push(`  flashAttn: ${config.flashAttn}`)
  lines.push(`  maxToolRounds: ${config.maxToolRounds}`)
  lines.push(`  requestTimeoutMs: ${config.requestTimeoutMs}`)
  return lines.join('\n')
}
