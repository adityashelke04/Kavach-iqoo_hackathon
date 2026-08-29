import type { DetectionInput, DetectionResult } from './types.ts'
import { analyzeWithRules } from './rules.ts'
import { classifySender } from './sender.ts'
import { validateResult } from './validate.ts'

/**
 * The orchestrator — SPEC.md §6.
 *
 * Picks an engine, enforces the timeout, falls back silently. The UI calls
 * only this; it never touches an engine directly.
 *
 * Right now only the rules engine exists, so this is thin. LocalDetector (P7)
 * and CloudDetector (P3) slot in here without any screen changing, which is
 * the entire point of the Detector interface.
 */

export type EnginePreference = 'local' | 'cloud'

export const ENGINE_TIMEOUTS = { local: 8000, cloud: 6000 } as const

export async function analyze(
  input: DetectionInput,
  _preference: EnginePreference = 'local',
  _signal?: AbortSignal,
): Promise<DetectionResult> {
  // 1. Classify the sender once, here, so every engine (including the
  //    fallback) receives the same SenderSignal as an input fact (§5.5).
  const senderSignal = classifySender(input.sender)

  // 2-5. Local and cloud land later. Rules is synchronous and cannot fail.
  const result = analyzeWithRules(input, senderSignal)

  try {
    validateResult(result)
  } catch (err) {
    // An engine that produces an invalid result is a failed engine. Rules is
    // the floor, so if it ever gets here something is badly wrong — log it
    // rather than showing the user an error they cannot act on.
    console.error('[kavach] result failed validation', err)
  }

  console.info(
    `[kavach] ${result.engineUsed} · ${result.verdict} · ${result.latencyMs}ms · conf ${result.confidence.toFixed(2)}`,
  )
  return result
}
