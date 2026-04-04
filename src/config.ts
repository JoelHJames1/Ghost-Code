/**
 * Configuration system — layered resolution: CLI args > env vars > config file > defaults.
 * Config file lives at ~/.config/gemma-code/config.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface GemmaConfig {
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
}

const DEFAULTS: GemmaConfig = {
  model: 'gemma4:e4b',
  baseUrl: 'http://127.0.0.1:8776',
  maxToolRounds: 30,
  projectInstructionsFile: '.gemma-code.md',
  requestTimeoutMs: 120_000,
  llamaPort: 8776,
  gpuLayers: 99,
  llamaContextSize: 0,
  flashAttn: true,
  llamaExtraArgs: [],
}

function getConfigDir(): string {
  return join(homedir(), '.config', 'gemma-code')
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json')
}

/**
 * Load config from ~/.config/gemma-code/config.json.
 * Returns empty object if file doesn't exist or is invalid.
 */
function loadConfigFile(): Partial<GemmaConfig> {
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
export function resolveConfig(overrides: Partial<GemmaConfig> = {}): GemmaConfig {
  const file = loadConfigFile()
  const env: Partial<GemmaConfig> = {}

  if (process.env.GEMMA_MODEL_PATH) env.modelPath = process.env.GEMMA_MODEL_PATH
  if (process.env.GEMMA_HF_REPO) env.hfRepo = process.env.GEMMA_HF_REPO
  if (process.env.GEMMA_GPU_LAYERS) env.gpuLayers = parseInt(process.env.GEMMA_GPU_LAYERS, 10)
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
export function saveConfig(config: Partial<GemmaConfig>): void {
  const dir = getConfigDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const existing = loadConfigFile()
  const merged = { ...existing, ...config }
  writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2) + '\n', 'utf-8')
}

/**
 * Format config for display.
 */
export function formatConfig(config: GemmaConfig): string {
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
