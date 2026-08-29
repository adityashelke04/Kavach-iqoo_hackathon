import type { DetectionResult, Evidence, Tactic, TacticName } from './types.ts'
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
 * How much a confident rules signal can add on its own — SPEC.md §16 D15.
 *
 * Fusion is a weighted noisy-OR, now centred on the LLM: `fused = l + w·r·(1 − l)`.
 * The LLM is the primary reading; rules can still raise it, but the numeric
 * floor is the LLM's own confidence, not the rules engine's — the flip of
 * D12's guarantee. See SPEC.md §16 D15 point 4 for the accepted trade-off
 * this makes, and why the real protection against a wrong LLM moved to
 * `findAuditGap` and the §4 override rules rather than this formula.
 */
export const LLM_WEIGHT = 0.85

export function fuseConfidence(rules: number, llm: number): number {
  return Math.min(1, llm + LLM_WEIGHT * rules * (1 - llm))
}

/**
 * The rules-found tactic, with real evidence, that the LLM's raw answer is
 * missing — or `null` when there is nothing to reconsider (D15).
 *
 * When more than one is missing, the most diagnostic tactic is returned
 * first, matching §8.3's weighting guidance (isolation is the strongest
 * signal with almost no legitimate counterpart; urgency the weakest on its
 * own) — the single reconsideration call this drives should spend itself on
 * the finding most likely to actually change the verdict.
 */
const AUDIT_PRIORITY: readonly TacticName[] = ['isolation', 'extraction', 'authority', 'urgency']

export function findAuditGap(
  rulesTactics: readonly Tactic[],
  llmTactics: readonly Tactic[],
): Tactic | null {
  const llmNames = new Set(llmTactics.map((t) => t.name))
  const byName = new Map(rulesTactics.map((t) => [t.name, t] as const))

  for (const name of AUDIT_PRIORITY) {
    const candidate = byName.get(name)
    if (candidate && candidate.evidence.length > 0 && !llmNames.has(name)) {
      return candidate
    }
  }
  return null
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
