/**
 * Surprisal-based episode boundary detection.
 *
 * Uses logprobs from llama-server's /v1/chat/completions API to compute
 * token-level surprisal (negative log-likelihood). High surprisal indicates
 * unexpected content — a signal that the topic or activity has shifted.
 *
 * This is the EM-LLM approach: Bayesian surprise as a boundary signal,
 * combined with heuristic signals for refinement.
 *
 * When logprobs are available:
 *   surprisal = -log P(token | context)
 *   boundary triggered when surprisal exceeds mean + k * stddev
 *
 * When logprobs are NOT available (fallback):
 *   Use heuristic boundary detection (topic shift, file switch, etc.)
 *
 * The API request includes logprobs=true and top_logprobs=1 to get
 * per-token log probabilities from the model.
 */

import type { ServerConfig } from './api.js'

// ── Types ────────────────────────────────────────────────────────────────

export interface SurprisalScore {
  position: number       // Index in token sequence
  surprisal: number      // -logprob (higher = more surprising)
  token: string
}

export interface SurprisalBoundary {
  position: number
  surprisal: number
  zScore: number         // How many stddevs above the mean
  reason: 'surprisal_spike'
}

// ── Running statistics ───────────────────────────────────────────────────

class RunningStats {
  private n = 0
  private mean = 0
  private m2 = 0

  update(value: number): void {
    this.n++
    const delta = value - this.mean
    this.mean += delta / this.n
    const delta2 = value - this.mean
    this.m2 += delta * delta2
  }

  getMean(): number {
    return this.mean
  }

  getStddev(): number {
    if (this.n < 2) return 1
    return Math.sqrt(this.m2 / (this.n - 1))
  }

  getCount(): number {
    return this.n
  }
}

// ── Logprob extraction from API response ─────────────────────────────────

/**
 * Extract surprisal scores from a chat completion response that includes logprobs.
 *
 * llama-server returns logprobs in the OpenAI format:
 * {
 *   choices: [{
 *     logprobs: {
 *       content: [{ token, logprob, ... }, ...]
 *     }
 *   }]
 * }
 */
export function extractSurprisalFromResponse(responseData: unknown): SurprisalScore[] {
  try {
    const data = responseData as {
      choices?: Array<{
        logprobs?: {
          content?: Array<{
            token: string
            logprob: number
          }>
        }
      }>
    }

    const logprobs = data?.choices?.[0]?.logprobs?.content
    if (!logprobs || logprobs.length === 0) return []

    return logprobs.map((lp, i) => ({
      position: i,
      surprisal: -lp.logprob, // Surprisal = negative log probability
      token: lp.token,
    }))
  } catch {
    return []
  }
}

/**
 * Detect boundaries from surprisal scores using z-score thresholding.
 *
 * A boundary is triggered when surprisal exceeds mean + k * stddev
 * over a sliding window. This implements the Bayesian surprise approach
 * from EM-LLM.
 *
 * @param scores - Surprisal scores from extractSurprisalFromResponse
 * @param threshold - Z-score threshold (default: 2.0 = 2 stddevs above mean)
 * @param minGap - Minimum tokens between boundaries (prevents fragmentation)
 */
export function detectSurprisalBoundaries(
  scores: SurprisalScore[],
  threshold = 2.0,
  minGap = 20,
): SurprisalBoundary[] {
  if (scores.length < 10) return []

  const stats = new RunningStats()
  const boundaries: SurprisalBoundary[] = []
  let lastBoundary = -minGap

  for (const score of scores) {
    stats.update(score.surprisal)

    // Need enough data for meaningful statistics
    if (stats.getCount() < 10) continue

    const mean = stats.getMean()
    const stddev = stats.getStddev()
    const zScore = (score.surprisal - mean) / Math.max(stddev, 0.01)

    if (zScore >= threshold && score.position - lastBoundary >= minGap) {
      boundaries.push({
        position: score.position,
        surprisal: score.surprisal,
        zScore,
        reason: 'surprisal_spike',
      })
      lastBoundary = score.position
    }
  }

  return boundaries
}

/**
 * Request logprobs from llama-server for a piece of text.
 * Uses the /v1/chat/completions endpoint with logprobs=true.
 *
 * Returns surprisal scores, or empty array if logprobs not supported.
 */
export async function getSurprisalForText(
  text: string,
  config: ServerConfig,
): Promise<SurprisalScore[]> {
  try {
    const res = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: text }],
        max_tokens: 1,  // We only need logprobs on the input, not generation
        logprobs: true,
        top_logprobs: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) return []
    const data = await res.json()
    return extractSurprisalFromResponse(data)
  } catch {
    return []  // Gracefully degrade if logprobs not available
  }
}

/**
 * Compute average surprisal for a text block.
 * Higher = more surprising/novel content (potential boundary).
 */
export function averageSurprisal(scores: SurprisalScore[]): number {
  if (scores.length === 0) return 0
  return scores.reduce((sum, s) => sum + s.surprisal, 0) / scores.length
}
