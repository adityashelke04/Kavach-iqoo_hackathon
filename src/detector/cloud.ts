import type { DetectionInput, DetectionResult, Detector } from './types.ts'
import { classifySender } from './sender.ts'
import { resultFromLlm, senderFact } from './llm.ts'

/**
 * CloudDetector — SPEC.md §8.2.
 *
 * Talks to `/api/analyze` on our own origin, never to OpenRouter directly: the
 * key lives on the server (see `api/analyze.ts`). The browser sends the
 * message and gets back the raw model string, which is parsed here by the same
 * `resultFromLlm` the on-device engine uses.
 *
 * Engine contract (§6): never throws for a caller to catch as a crash — it
 * rejects, and the orchestrator falls through silently.
 */

export const CLOUD_ENDPOINT = '/api/analyze'

export class CloudUnavailableError extends Error {
  constructor(reason: string) {
    super(`cloud engine unavailable: ${reason}`)
    this.name = 'CloudUnavailableError'
  }
}

export const cloudDetector: Detector = {
  id: 'cloud',

  /**
   * Cheap and non-throwing. `navigator.onLine` is a false-positive machine —
   * it reports true on a captive portal — but it is free and correctly reports
   * the case that actually matters on a demo floor: airplane mode. A real
   * failure is caught by `detect` and handled by the orchestrator anyway.
   */
  async isAvailable(): Promise<boolean> {
    if (typeof navigator === 'undefined') return false
    return navigator.onLine !== false
  },

  async detect(input: DetectionInput, signal: AbortSignal): Promise<DetectionResult> {
    const startedAt = Date.now()

    // Deterministic and pure, so classifying here rather than threading it
    // through the frozen two-argument `Detector.detect` signature gives the
    // identical SenderSignal the orchestrator computed (D9, §7).
    const senderSignal = classifySender(input.sender)
    const fact = senderFact(senderSignal)

    const response = await fetch(CLOUD_ENDPOINT, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: input.text,
        channel: input.channel ?? 'text',
        ...(fact ? { sender: fact } : {}),
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new CloudUnavailableError(`HTTP ${response.status} ${detail.slice(0, 200)}`)
    }

    const payload = (await response.json()) as { content?: unknown }
    if (typeof payload.content !== 'string') {
      throw new CloudUnavailableError('response had no model content')
    }

    return resultFromLlm(payload.content, {
      input,
      senderSignal,
      engineId: 'cloud',
      latencyMs: Date.now() - startedAt,
    })
  },
}
