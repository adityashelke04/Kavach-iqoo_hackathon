import type { DetectionInput, DetectionResult, Detector } from './types.ts'
import { analyzeWithRules } from './rules.ts'
import { classifySender } from './sender.ts'
import { validateResult } from './validate.ts'
import { cloudDetector } from './cloud.ts'
import { fuse } from './fuse.ts'

/**
 * The orchestrator — SPEC.md §6, decision D12.
 *
 * The UI calls only this and never touches an engine. What it does:
 *
 *   1. Classify the sender once, deterministically, and hand the same
 *      SenderSignal to every engine (D9).
 *   2. Run the rules engine. It is synchronous, takes single-digit
 *      milliseconds, and cannot fail — it is the floor.
 *   3. Race an LLM engine against a timeout, in parallel.
 *   4. If the LLM answered and validated, fuse the two into one result.
 *      Otherwise return the rules result unchanged.
 *
 * Step 4 is the D12 change. Previously this was a fallback chain, where the
 * LLM ran and rules only substituted on failure, so the two never met.
 *
 * The user never learns which of these happened. A failed engine is silent: no
 * error toast, no degraded banner, no mention of the rules engine, which is
 * never named in the UI (§6, §8.3). They asked whether a message is a scam and
 * they get an answer.
 */

export type EnginePreference = 'local' | 'cloud'

export const ENGINE_TIMEOUTS = { local: 8000, cloud: 6000 } as const

/**
 * LLM engines by preference, in the order they are tried.
 *
 * `local` is empty until P7 lands, so an on-device preference currently falls
 * straight through to cloud, and then to rules alone when offline. Registering
 * LocalDetector here is the only change P7 needs to make outside its own file.
 */
const LLM_ENGINES: Record<EnginePreference, Detector[]> = {
  local: [cloudDetector],
  cloud: [cloudDetector],
}

/** Wire an external signal to an internal one so a timeout and a caller abort
 *  both cancel the same request. */
function withTimeout(ms: number, external?: AbortSignal): {
  signal: AbortSignal
  done: () => void
} {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)

  const forward = () => controller.abort()
  external?.addEventListener('abort', forward, { once: true })

  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', forward)
    },
  }
}

/**
 * Try each LLM engine in turn. Returns null when none of them produced a
 * valid result — which is an ordinary outcome, not an error.
 */
async function runLlm(
  input: DetectionInput,
  preference: EnginePreference,
  external?: AbortSignal,
): Promise<DetectionResult | null> {
  for (const engine of LLM_ENGINES[preference]) {
    const budget = ENGINE_TIMEOUTS[engine.id === 'local' ? 'local' : 'cloud']
    const { signal, done } = withTimeout(budget, external)

    try {
      if (!(await engine.isAvailable())) continue
      const result = await engine.detect(input, signal)
      return validateResult(result)
    } catch (err) {
      console.info(
        `[kavach] ${engine.id} engine did not answer (${(err as Error).message}) — continuing`,
      )
    } finally {
      done()
    }
  }
  return null
}

export async function analyze(
  input: DetectionInput,
  preference: EnginePreference = 'local',
  signal?: AbortSignal,
): Promise<DetectionResult> {
  // 1. One sender classification, shared by every engine (§5.5, D9).
  const senderSignal = classifySender(input.sender)

  // 2. The floor. Synchronous and cannot fail.
  const rules = analyzeWithRules(input, senderSignal)

  // 3. The LLM, in parallel with nothing else — rules already finished.
  const llm = await runLlm(input, preference, signal)

  // 4. Fuse, or fall back to rules alone.
  let result = rules
  if (llm) {
    try {
      result = fuse({ rules, llm })
    } catch (err) {
      // A fusion that cannot satisfy §7 is a bug in the merge, not something
      // to show a user. Keep the rules answer, which is always valid.
      console.error('[kavach] fusion produced an invalid result', err)
      result = rules
    }
  }

  try {
    validateResult(result)
  } catch (err) {
    console.error('[kavach] result failed validation', err)
  }

  console.info(
    `[kavach] ${llm ? `rules+${llm.engineUsed}` : 'rules'} · ${result.verdict} · ` +
      `${result.latencyMs}ms · conf ${result.confidence.toFixed(2)}` +
      (llm ? ` (rules ${rules.confidence.toFixed(2)}, llm ${llm.confidence.toFixed(2)})` : ''),
  )

  return result
}
