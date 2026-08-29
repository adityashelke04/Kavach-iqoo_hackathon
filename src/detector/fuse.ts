import type { DetectionResult, Evidence, Tactic } from './types.ts'
import { decideVerdict } from './verdict.ts'
import { validateResult } from './validate.ts'

/**
 * Fusion — SPEC.md §6, decision D12.
 *
 * The rules engine and the LLM both look at every message and their findings
 * are merged into one result. This replaced the original fallback chain, where
 * the LLM ran and rules only stood in if it failed, so the two never actually
 * met.
 *
 * They are good at different things, and neither subsumes the other:
 *
 * - **Rules** is deterministic, answers in single-digit milliseconds, is tuned
 *   against the corpus, and owns the sender/DLT signal (D9). It cannot see a
 *   scam nobody has written a term for yet.
 * - **The LLM** reads meaning. It catches novel wording, unusual framing and
 *   Hinglish the term lists missed. It is also the one that can be talked into
 *   agreeing with a well-written message, and it hallucinates evidence.
 *
 * So rules sets the floor and the LLM can raise it, but a lone confident model
 * cannot carry a DANGER verdict as easily as the two of them agreeing.
 */

/**
 * How much a confident LLM can move a result on its own.
 *
 * Fusion is a weighted noisy-OR: `fused = r + w·l·(1 − r)`. The weight is what
 * keeps two mildly-suspicious readings from compounding into a warning:
 *
 *   rules 0.20, llm 0.20  ->  0.34   safe      (two weak signals stay weak)
 *   rules 0.50, llm 0.50  ->  0.71   danger    (independent agreement counts)
 *   rules 0.00, llm 0.90  ->  0.77   danger    (a novel scam rules cannot see)
 *   rules 0.80, llm 0.00  ->  0.80   danger    (rules is never talked down)
 *
 * That last row is the important one. The LLM can only ever add. A model
 * politely deciding a scam looks fine must not be able to lower a verdict the
 * deterministic engine already reached, because that is precisely the argument
 * a well-written scam makes.
 */
export const LLM_WEIGHT = 0.85

export function fuseConfidence(rules: number, llm: number): number {
  return Math.min(1, rules + LLM_WEIGHT * llm * (1 - rules))
}

/** Two spans are the same finding if they cover the same text. */
function sameEvidence(a: Evidence, b: Evidence): boolean {
  if (a.start !== -1 && a.start === b.start && a.end === b.end) return true
  return a.phrase.toLowerCase() === b.phrase.toLowerCase()
}

/**
 * Merge the evidence for one tactic, preferring resolved spans.
 *
 * A phrase the LLM paraphrased resolves to `start: -1` and renders as a plain
 * quote rather than an inline highlight (§10.6). When both engines found the
 * same phrase and only one located it, keep the located one.
 */
function mergeEvidence(a: Evidence[], b: Evidence[]): Evidence[] {
  const out: Evidence[] = [...a]

  for (const candidate of b) {
    const existing = out.findIndex((e) => sameEvidence(e, candidate))
    if (existing === -1) {
      out.push(candidate)
    } else if (out[existing]!.start === -1 && candidate.start !== -1) {
      out[existing] = candidate
    }
  }

  return out
}

/**
 * Union the tactic lists. One card per tactic is a §7 invariant, so a tactic
 * both engines found becomes a single card carrying both sets of evidence.
 */
export function mergeTactics(
  rulesTactics: readonly Tactic[],
  llmTactics: readonly Tactic[],
): Tactic[] {
  const byName = new Map<string, Tactic>()

  for (const t of rulesTactics) {
    byName.set(t.name, { ...t, evidence: [...t.evidence] })
  }

  for (const t of llmTactics) {
    const existing = byName.get(t.name)
    if (!existing) {
      byName.set(t.name, { ...t, evidence: [...t.evidence] })
      continue
    }
    existing.evidence = mergeEvidence(existing.evidence, t.evidence)
    // Keep the rules engine's note when it has one: its copy is fixed, written
    // for the §10.7 register, and regression-tested. The model's prose is not.
    if (existing.note.trim() === '') existing.note = t.note
  }

  return [...byName.values()]
}

export interface FusionInput {
  rules: DetectionResult
  llm: DetectionResult
}

/**
 * Combine a rules result and an LLM result into the single result the UI sees.
 *
 * The verdict is recomputed from the fused confidence through `decideVerdict`,
 * so §4's threshold table and all four override rules apply to the merged
 * finding set exactly as they do to a single engine. Nothing downstream can
 * tell that two engines ran, which is the point of the seam (§6).
 */
export function fuse({ rules, llm }: FusionInput): DetectionResult {
  const tactics = mergeTactics(rules.tactics, llm.tactics)
  const confidence = fuseConfidence(rules.confidence, llm.confidence)

  // The sender is a deterministic fact, identical in both inputs (D9).
  const senderSignal = rules.senderSignal

  // Prose comes from whichever engine actually explains the finding. When the
  // rules engine found nothing and the LLM found the scam, the rules copy says
  // "nothing here pressures you" — which would contradict the verdict on screen.
  const rulesFoundSomething = rules.tactics.length > 0
  const llmFoundMore = llm.tactics.length > rules.tactics.length

  const useLlmProse = !rulesFoundSomething || llmFoundMore

  const result: DetectionResult = {
    verdict: decideVerdict(confidence, tactics, senderSignal),
    confidence,
    tactics,
    senderSignal,
    explanation: useLlmProse ? llm.explanation : rules.explanation,
    nextMove: useLlmProse ? llm.nextMove : rules.nextMove,
    // Console only, never rendered. Names the engine that ran alongside rules.
    engineUsed: llm.engineUsed,
    latencyMs: Math.max(rules.latencyMs, llm.latencyMs),
  }

  return validateResult(result)
}
