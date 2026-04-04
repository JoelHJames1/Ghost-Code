/**
 * Error classification for Ollama API failures.
 * Categorizes errors so the agent loop can handle them appropriately
 * (retry, prune context, or surface actionable messages).
 */

export type OllamaErrorKind =
  | 'timeout'
  | 'connection'
  | 'format'
  | 'context_overflow'
  | 'unknown'

const TIMEOUT_RE = /timeout|timed out|deadline exceeded/i
const CONTEXT_RE = /context length|context window|too long|token limit|num_ctx|truncat/i
const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ENOTFOUND'])

function getStatusCode(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'status' in err) return (err as any).status
  return undefined
}

function getErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) return (err as any).code
  if (err && typeof err === 'object' && 'cause' in err) return getErrorCode((err as any).cause)
  return undefined
}

function getMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as any).message)
  return String(err)
}

function getName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) return String((err as any).name)
  return ''
}

/**
 * Classify an Ollama error into an actionable category.
 */
export function classifyOllamaError(err: unknown): OllamaErrorKind {
  const status = getStatusCode(err)
  const code = getErrorCode(err)
  const msg = getMessage(err)
  const name = getName(err)

  // Connection errors (Ollama not running, network issues)
  if (code && CONNECTION_CODES.has(code)) return 'connection'
  if (status === 503 || status === 502) return 'connection'
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed/i.test(msg)) return 'connection'

  // Timeout errors
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout'
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout'
  if (status === 408) return 'timeout'
  if (TIMEOUT_RE.test(msg)) return 'timeout'

  // Context overflow
  if (status === 400 && CONTEXT_RE.test(msg)) return 'context_overflow'
  if (CONTEXT_RE.test(msg)) return 'context_overflow'

  // Format / bad request (non-retryable)
  if (status === 400) return 'format'

  return 'unknown'
}

/**
 * Get a user-friendly message for an error kind.
 */
export function errorKindMessage(kind: OllamaErrorKind, raw: string): string {
  switch (kind) {
    case 'timeout':
      return `Ollama timed out. The model may be too large for your hardware, or inference is taking too long.\n  ${raw}`
    case 'connection':
      return `Cannot connect to the inference server. Is llama-server running?\n  ${raw}`
    case 'context_overflow':
      return `Context window exceeded. The conversation is too long for this model.`
    case 'format':
      return `Ollama rejected the request (bad format). This may be a tool-calling compatibility issue.\n  ${raw}`
    case 'unknown':
      return raw
  }
}

/**
 * Retry a function with exponential backoff.
 * Only retries on retryable error kinds (timeout, connection).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const kind = classifyOllamaError(err)

      // Only retry on transient errors
      if (kind !== 'timeout' && kind !== 'connection') throw err

      // Don't retry after last attempt
      if (attempt === maxRetries) throw err

      // Exponential backoff: 1s, 2s, 4s
      const delay = baseDelayMs * Math.pow(2, attempt)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}
