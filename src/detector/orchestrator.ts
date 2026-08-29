import type { DetectionInput, DetectionResult, Detector } from './types.ts'
import { analyzeWithRules } from './rules.ts'
import { classifySender } from './sender.ts'
import { validateResult } from './validate.ts'
import { cloudDetector } from './cloud.ts'
import { localDetector } from './local.ts'
import { fuse } from './fuse.ts'

/**
 * The orchestrator — SPEC.md §6, decisions D12 and D13.
 *
 * The UI calls only this and never touches an engine.
 *
 *   1. Classify the sender once, deterministically, and hand the same
 *      SenderSignal to every engine (D9).
 *   2. Run the rules engine — synchronous, single-digit milliseconds, cannot
 *      fail. **Publish that answer immediately** (D13).
 *   3. Run an LLM engine in the background against a generous budget.
 *   4. If it answered and validated, fuse the two and publish the upgrade.
 *
 * D13 is why step 2 publishes rather than waits. A 3B model on a phone takes
 * tens of seconds to write a couple of hundred tokens of JSON. Blocking on it
 * would put a 30-second spinner in front of someone who has just been
 * frightened by a message, in exchange for a better story on stage — a bad
 * trade, and one that falls apart the moment the model is slow. Publishing the
 * deterministic verdict first means a slow or failed model costs the user
 * nothing, and the on-device work becomes visible rather than invisible.
 *
 * The user never learns which engines ran. A failed engine is silent: no error
 * toast, no degraded banner, and the rules engine is never named (§6, §8.3).
 */

/**
 * `none` means the deterministic engine only.
 *
 * Listen mode uses it for the live loop: a rolling transcript is re-analysed
 * every couple of seconds, and starting a 30-second on-device generation on
 * each pass would queue jobs faster than they finish. It runs the full stack
 * once, on the final transcript, when the user stops.
 */
export type EnginePreference = 'local' | 'cloud' | 'none'

/**
 * Per-engine budgets.
 *
 * `local` is deliberately generous. Nothing is waiting on it (D13), so the
 * only thing a short timeout would achieve is throwing away an answer the
 * device already paid for.
 */
export const ENGINE_TIMEOUTS = { local: 120_000, cloud: 15_000 } as const

/** LLM engines by preference, in the order they are tried. */
const LLM_ENGINES: Record<EnginePreference, Detector[]> = {
  local: [localDetector, cloudDetector],
  cloud: [cloudDetector],
  none: [],
}

/** Wire an external signal to an internal one so a timeout and a caller abort
 *  both cancel the same request. */
function withTimeout(
  ms: number,
  external?: AbortSignal,
): { signal: AbortSignal; done: () => void } {
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
 * Try each LLM engine in turn. Returns null when none produced a valid result,
 * which is an ordinary outcome rather than an error.
 */
async function runLlm(
  input: DetectionInput,
  preference: EnginePreference,
  external?: AbortSignal,
): Promise<DetectionResult | null> {
  for (const engine of LLM_ENGINES[preference]) {
    const budget = engine.id === 'local' ? ENGINE_TIMEOUTS.local : ENGINE_TIMEOUTS.cloud
    const { signal, done } = withTimeout(budget, external)

    try {
      if (!(await engine.isAvailable())) continue
      return validateResult(await engine.detect(input, signal))
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

export type Stage = 'instant' | 'final'

export interface AnalysisStage {
  result: DetectionResult
  stage: Stage
  /** True while a slower engine is still working behind this result. */
  pending: boolean
}

/**
 * Analyse, publishing the deterministic verdict first and the fused verdict
 * when it arrives.
 *
 * `onStage` is always called at least once, synchronously enough that the
 * screen can render before any network or GPU work begins. It is called a
 * second time only when an LLM actually improved on the first answer.
 *
 * Resolves with the final result. Never throws.
 */
export async function analyzeProgressive(
  input: DetectionInput,
  onStage: (s: AnalysisStage) => void,
  preference: EnginePreference = 'local',
  signal?: AbortSignal,
): Promise<DetectionResult> {
  const senderSignal = classifySender(input.sender)
  const rules = analyzeWithRules(input, senderSignal)

  // Only promise an upgrade if some LLM engine could plausibly run.
  const candidates = LLM_ENGINES[preference]
  const anyAvailable = (
    await Promise.all(candidates.map((e) => e.isAvailable().catch(() => false)))
  ).some(Boolean)

  onStage({ result: rules, stage: 'instant', pending: anyAvailable })

  if (!anyAvailable) return rules

  const llm = await runLlm(input, preference, signal)

  let result = rules
  if (llm) {
    try {
      result = fuse({ rules, llm })
    } catch (err) {
      // A merge that cannot satisfy §7 is a bug in fusion, not something to
      // show a user. The rules answer is always valid.
      console.error('[kavach] fusion produced an invalid result', err)
      result = rules
    }
  }

  console.info(
    `[kavach] ${llm ? `rules+${llm.engineUsed}` : 'rules'} · ${result.verdict} · ` +
      `${result.latencyMs}ms · conf ${result.confidence.toFixed(2)}` +
      (llm ? ` (rules ${rules.confidence.toFixed(2)}, llm ${llm.confidence.toFixed(2)})` : ''),
  )

  onStage({ result, stage: 'final', pending: false })
  return result
}

/**
 * The awaited form: resolves once with the best answer available.
 *
 * Used by the corpus and smoke harnesses, and by any caller that genuinely
 * cannot render twice. Screens should prefer `analyzeProgressive`.
 */
export async function analyze(
  input: DetectionInput,
  preference: EnginePreference = 'local',
  signal?: AbortSignal,
): Promise<DetectionResult> {
  return analyzeProgressive(input, () => {}, preference, signal)
}
