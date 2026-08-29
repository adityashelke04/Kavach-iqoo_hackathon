import type {
  DetectionInput,
  DetectionResult,
  Detector,
  ReconsiderationPrompt,
} from './types.ts'
import { analyzeWithRules, toBriefing } from './rules.ts'
import { classifySender } from './sender.ts'
import { validateResult } from './validate.ts'
import { cloudDetector } from './cloud.ts'
import { localDetector } from './local.ts'
import { fuse, findAuditGap } from './fuse.ts'

/**
 * The orchestrator — SPEC.md §6, decision D15.
 *
 * The UI calls only this and never touches an engine.
 *
 *   1. Classify the sender once, deterministically (D9).
 *   2. Run the rules engine synchronously. Its result is not shown — it
 *      becomes the briefing handed to the LLM.
 *   3. Await the LLM, briefed. Nothing is published before this resolves.
 *   4. Audit: does the LLM's answer cover every rules-found tactic with real
 *      evidence?
 *   5. If not, one bounded reconsideration call, showing the LLM its own
 *      first answer and the specific finding it missed.
 *   6. Fuse (re-centred on the LLM, D15) and decide via the shared §4 rules.
 *   7. If every LLM attempt failed or the engine is unavailable, the rules
 *      result stands, silently (D2) — the only path where a rules-only
 *      result is ever shown.
 *
 * The user never learns which engines ran, or that a second call happened.
 */

export type EnginePreference = 'local' | 'cloud' | 'none'

/** Status-only. Never carries a result — nothing is shown before `analyze`
 *  resolves (D15). Purely for a "still thinking" / "double-checking one
 *  detail" caption on the Check screen. */
export type AnalysisPhase = 'thinking' | 'reconsidering'

export const ENGINE_TIMEOUTS = {
  local: { first: 120_000, reconsider: 60_000 },
  cloud: { first: 15_000, reconsider: 15_000 },
} as const

const LLM_ENGINES: Record<Exclude<EnginePreference, 'none'>, Detector> = {
  local: localDetector,
  cloud: cloudDetector,
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

async function runOnce(
  engine: Detector,
  input: DetectionInput,
  budgetMs: number,
  external?: AbortSignal,
): Promise<DetectionResult | null> {
  const { signal, done } = withTimeout(budgetMs, external)
  try {
    if (!(await engine.isAvailable())) return null
    return validateResult(await engine.detect(input, signal))
  } catch (err) {
    console.info(`[kavach] ${engine.id} engine did not answer (${(err as Error).message}) — continuing`)
    return null
  } finally {
    done()
  }
}

/**
 * Analyse a message. Resolves once, with the final result. Never throws.
 *
 * `onPhase`, when given, is called zero or more times with a status label
 * only — never a `DetectionResult` — so a UI can show "thinking" /
 * "reconsidering" captions without anything resembling an early verdict.
 *
 * `engineOverride` exists only for tests: it substitutes a fake `Detector`
 * for the given preference instead of the real local/cloud engine. Never
 * pass it from application code.
 */
export async function analyze(
  input: DetectionInput,
  preference: EnginePreference = 'local',
  signal?: AbortSignal,
  onPhase?: (phase: AnalysisPhase) => void,
  engineOverride?: Partial<Record<Exclude<EnginePreference, 'none'>, Detector>>,
): Promise<DetectionResult> {
  const senderSignal = classifySender(input.sender)
  const rules = analyzeWithRules(input, senderSignal)

  if (preference === 'none') return rules

  const engine = engineOverride?.[preference] ?? LLM_ENGINES[preference]
  const budgets = ENGINE_TIMEOUTS[preference]
  const briefing = toBriefing(rules)

  onPhase?.('thinking')
  let llm = await runOnce(
    engine,
    { ...input, ...(briefing ? { briefing } : {}) },
    budgets.first,
    signal,
  )

  if (llm) {
    const gap = findAuditGap(rules.tactics, llm.tactics)
    if (gap) {
      const reconsider: ReconsiderationPrompt = {
        priorExplanation: llm.explanation,
        missingTactic: { name: gap.name, matchedPhrases: gap.evidence.map((e) => e.phrase) },
      }
      onPhase?.('reconsidering')
      const reconsidered = await runOnce(
        engine,
        { ...input, ...(briefing ? { briefing } : {}), reconsider },
        budgets.reconsider,
        signal,
      )
      if (reconsidered) llm = reconsidered
    }
  }

  // Bug instrumentation + guard: an engine's own result must report the
  // engine that was actually asked to run (a user picking "Cloud" and being
  // shown "This phone (WebGPU)" was reported live). Every real engine hardcodes
  // its own engineId — cloud.ts always passes 'cloud', local.ts always 'local'
  // — so this is structurally impossible from the engines as written. If it
  // ever fires anyway, treat it exactly like an engine failure (§6 non-
  // negotiable 4): the mislabeled answer is discarded, not shown, and the
  // rules-only result stands, same as any other silent fallback (D2).
  if (llm && llm.engineUsed !== preference) {
    console.error(
      `[kavach] engine mismatch: asked for "${preference}" but got a result labelled ` +
        `"${llm.engineUsed}" — discarding it rather than showing a false device claim. ` +
        `Check for a stale service worker / cached bundle first, then the engine's own ` +
        `engineId wiring.`,
    )
    llm = null
  }

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

  return result
}
