/**
 * llama-server process manager — starts, monitors, and stops a local
 * llama.cpp server as the inference backend for Gemma Code.
 *
 * When the user types `gemma`, this module:
 * 1. Locates or downloads the llama-server binary
 * 2. Locates the GGUF model file (or downloads via HuggingFace)
 * 3. Starts llama-server as a child process
 * 4. Waits for it to be healthy (/health endpoint)
 * 5. Returns the base URL for the API client
 *
 * On exit, the server process is killed cleanly.
 */

import { spawn, execSync, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir, platform, arch } from 'os'

export interface LlamaServerConfig {
  /** Path to llama-server binary (auto-detected if not set) */
  binaryPath?: string
  /** Path to GGUF model file, or HuggingFace repo ID (e.g. "ggml-org/gemma-3-27b-it-GGUF") */
  modelPath?: string
  /** HuggingFace repo for auto-download (e.g. "google/gemma-4-31b-it-GGUF") */
  hfRepo?: string
  /** Port for the server (default: 8776) */
  port: number
  /** Host to bind (default: 127.0.0.1) */
  host: string
  /** Number of GPU layers to offload (default: 99 = max) */
  gpuLayers: number
  /** Context window size (default: 0 = model default) */
  contextSize: number
  /** Number of parallel request slots (default: 1) */
  parallelSlots: number
  /** Enable Jinja templates for tool calling (default: true) */
  jinja: boolean
  /** Enable flash attention (default: true) */
  flashAttn: boolean
  /** Additional CLI args to pass to llama-server */
  extraArgs: string[]
}

const DEFAULT_LLAMA_CONFIG: LlamaServerConfig = {
  port: 8776,
  host: '127.0.0.1',
  gpuLayers: 99,
  contextSize: 0,
  parallelSlots: 1,
  jinja: true,
  flashAttn: true,
  extraArgs: [],
}

let serverProcess: ChildProcess | null = null
let serverBaseUrl: string | null = null

/**
 * Get the data directory for Gemma Code.
 */
function getDataDir(): string {
  const dir = join(homedir(), '.local', 'share', 'gemma-code')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Find the llama-server binary on the system.
 * Checks: config path → PATH → homebrew → local data dir
 */
function findBinary(configPath?: string): string | null {
  // Explicit config path
  if (configPath && existsSync(configPath)) return configPath

  // Check PATH
  try {
    const which = execSync('which llama-server 2>/dev/null', { encoding: 'utf-8' }).trim()
    if (which) return which
  } catch {}

  // Check common Homebrew / build locations
  const candidates = [
    '/usr/local/bin/llama-server',
    '/opt/homebrew/bin/llama-server',
    join(homedir(), 'llama.cpp', 'build', 'bin', 'llama-server'),
    join(getDataDir(), 'llama-server'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  return null
}

/**
 * Build the command-line arguments for llama-server.
 */
function buildArgs(config: LlamaServerConfig): string[] {
  const args: string[] = []

  // Model — either a local path or a HuggingFace repo
  if (config.modelPath) {
    if (config.modelPath.includes('/') && !existsSync(config.modelPath)) {
      // Looks like a HuggingFace repo ID
      args.push('-hf', config.modelPath)
    } else {
      args.push('-m', config.modelPath)
    }
  } else if (config.hfRepo) {
    args.push('-hf', config.hfRepo)
  }

  args.push('--host', config.host)
  args.push('--port', String(config.port))
  args.push('-ngl', String(config.gpuLayers))

  if (config.contextSize > 0) {
    args.push('-c', String(config.contextSize))
  }

  args.push('-np', String(config.parallelSlots))

  if (config.jinja) args.push('--jinja')
  if (config.flashAttn) args.push('-fa', 'on')

  // Performance: cache prompts to avoid reprocessing shared prefixes
  args.push('--cache-prompt')
  // Skip warmup — saves ~2s on startup
  args.push('--no-warmup')

  args.push(...config.extraArgs)

  return args
}

/**
 * Wait for the server to become healthy.
 */
async function waitForHealth(baseUrl: string, timeoutMs = 120_000): Promise<boolean> {
  const start = Date.now()
  const checkInterval = 500

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) {
        const data = await res.json() as { status?: string }
        if (data.status === 'ok' || data.status === 'no slot available') {
          return true
        }
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(r => setTimeout(r, checkInterval))
  }
  return false
}

/**
 * Start the llama-server process and wait for it to be healthy.
 * Returns the base URL for the API.
 */
export async function startLlamaServer(
  config: Partial<LlamaServerConfig> = {},
  onLog?: (line: string) => void,
): Promise<string> {
  const cfg = { ...DEFAULT_LLAMA_CONFIG, ...config }
  const baseUrl = `http://${cfg.host}:${cfg.port}`

  // Check if server is already running on this port
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      serverBaseUrl = baseUrl
      onLog?.('llama-server already running on port ' + cfg.port)
      return baseUrl
    }
  } catch {
    // Not running, we'll start it
  }

  // Find binary
  const binary = findBinary(cfg.binaryPath)
  if (!binary) {
    throw new Error(
      'llama-server not found. Install it:\n' +
      '  brew install llama.cpp          (macOS)\n' +
      '  # or build from source:\n' +
      '  git clone https://github.com/ggml-org/llama.cpp && cd llama.cpp\n' +
      '  cmake -B build && cmake --build build --config Release -j\n' +
      '  # Binary will be at: build/bin/llama-server'
    )
  }

  // Validate model is specified
  if (!cfg.modelPath && !cfg.hfRepo) {
    throw new Error(
      'No model specified. Set one in ~/.config/gemma-code/config.json:\n' +
      '  { "modelPath": "/path/to/model.gguf" }\n' +
      '  or: { "hfRepo": "google/gemma-3-27b-it-GGUF" }\n' +
      '  or pass --model-path on the command line'
    )
  }

  const args = buildArgs(cfg)
  onLog?.(`Starting: ${binary} ${args.join(' ')}`)

  // Start the server process
  serverProcess = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  // Pipe server logs during startup only — suppress after ready
  let serverReady = false

  serverProcess.stdout?.on('data', (data: Buffer) => {
    if (serverReady) return  // Suppress verbose logs after startup
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) onLog?.(line)
  })
  serverProcess.stderr?.on('data', (data: Buffer) => {
    if (serverReady) return  // Suppress verbose logs after startup
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) onLog?.(line)
  })

  serverProcess.on('error', (err) => {
    onLog?.(`llama-server error: ${err.message}`)
  })

  serverProcess.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      onLog?.(`llama-server exited with code ${code}`)
    }
    serverProcess = null
    serverBaseUrl = null
  })

  // Wait for health — allow up to 10 minutes for first-run model download
  onLog?.('Waiting for llama-server to be ready (first run may download the model)...')
  const healthy = await waitForHealth(baseUrl, 600_000)

  if (!healthy) {
    stopLlamaServer()
    throw new Error(
      'llama-server failed to start within 10 minutes.\n' +
      'Check that the model file exists and you have enough RAM/VRAM.'
    )
  }

  serverReady = true  // Stop piping server logs to the terminal
  serverBaseUrl = baseUrl
  onLog?.(`llama-server ready at ${baseUrl}`)
  return baseUrl
}

/**
 * Stop the llama-server process.
 */
export function stopLlamaServer(): void {
  if (serverProcess) {
    serverProcess.kill('SIGTERM')
    // Give it a moment, then force kill
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGKILL')
      }
    }, 3000)
    serverProcess = null
    serverBaseUrl = null
  }
}

/**
 * Check if the server is running.
 */
export async function checkLlamaServer(baseUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { ok: false, error: `llama-server returned ${res.status}` }
    const data = await res.json() as { status?: string }
    if (data.status === 'ok' || data.status === 'no slot available') {
      return { ok: true }
    }
    return { ok: false, error: `llama-server status: ${data.status}` }
  } catch (e: any) {
    return { ok: false, error: `Cannot connect to llama-server at ${baseUrl}. ${e.message}` }
  }
}

/**
 * Get server info (loaded model, etc.)
 */
export async function getServerProps(baseUrl: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${baseUrl}/props`, { signal: AbortSignal.timeout(5000) })
    if (res.ok) return await res.json() as Record<string, unknown>
  } catch {}
  return null
}

/**
 * Register cleanup handlers to stop the server on process exit.
 */
export function registerCleanup(): void {
  const cleanup = () => {
    stopLlamaServer()
    process.exit(0)
  }

  process.on('exit', () => stopLlamaServer())
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

/**
 * Install llama.cpp via Homebrew (macOS) or build from source.
 * Returns the path to the installed binary, or null on failure.
 */
export async function installLlamaCpp(
  onLog?: (line: string) => void,
): Promise<string | null> {
  const plat = platform()

  // macOS: try Homebrew first
  if (plat === 'darwin') {
    onLog?.('Installing llama.cpp via Homebrew...')
    try {
      execSync('brew install llama.cpp', { stdio: 'pipe', timeout: 300_000 })
      const path = execSync('which llama-server', { encoding: 'utf-8' }).trim()
      if (path) {
        onLog?.(`Installed: ${path}`)
        return path
      }
    } catch (e: any) {
      onLog?.(`Homebrew install failed: ${e.message}`)
    }
  }

  // Fallback: build from source
  onLog?.('Building llama.cpp from source...')
  const buildDir = join(getDataDir(), 'llama.cpp')
  try {
    if (!existsSync(buildDir)) {
      execSync(`git clone https://github.com/ggml-org/llama.cpp.git "${buildDir}"`, {
        stdio: 'pipe',
        timeout: 120_000,
      })
    } else {
      execSync('git pull', { cwd: buildDir, stdio: 'pipe', timeout: 60_000 })
    }

    execSync('cmake -B build -DCMAKE_BUILD_TYPE=Release', {
      cwd: buildDir,
      stdio: 'pipe',
      timeout: 60_000,
    })
    execSync('cmake --build build --config Release -j', {
      cwd: buildDir,
      stdio: 'pipe',
      timeout: 600_000,
    })

    const binaryPath = join(buildDir, 'build', 'bin', 'llama-server')
    if (existsSync(binaryPath)) {
      onLog?.(`Built: ${binaryPath}`)
      return binaryPath
    }
  } catch (e: any) {
    onLog?.(`Build failed: ${e.message}`)
  }

  return null
}

/**
 * Full setup: install llama-server if needed, then start it.
 * This is the main entry point for the "just works" experience.
 */
export async function ensureAndStartServer(
  config: Partial<LlamaServerConfig> = {},
  onLog?: (line: string) => void,
): Promise<string> {
  const cfg = { ...DEFAULT_LLAMA_CONFIG, ...config }

  // Check if binary exists
  let binary = findBinary(cfg.binaryPath)

  if (!binary) {
    onLog?.('llama-server not found. Installing...')
    binary = await installLlamaCpp(onLog)
    if (!binary) {
      throw new Error(
        'Could not install llama.cpp automatically.\n' +
        'Please install it manually:\n' +
        '  macOS:  brew install llama.cpp\n' +
        '  Linux:  git clone https://github.com/ggml-org/llama.cpp && cd llama.cpp && cmake -B build && cmake --build build --config Release -j\n' +
        '  Then:   gemma --help'
      )
    }
    cfg.binaryPath = binary
  }

  return startLlamaServer(cfg, onLog)
}

export { DEFAULT_LLAMA_CONFIG }
