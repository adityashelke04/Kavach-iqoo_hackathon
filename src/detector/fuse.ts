import type {
  DetectionInput,
  DetectionResult,
  Evidence,
  SenderSignal,
  Tactic,
  TacticName,
} from './types.ts'
import { capUncorroborated, decideVerdict } from './verdict.ts'
import { validateResult } from './validate.ts'
import { scanDeterministically } from './rules.ts'

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

/**
 * Drop the LLM tactics the deterministic scan actively contradicts — D21.
 *
 * §8.3 describes the false-positive defence as negatives "subtracted BEFORE the
 * presence check, so a genuine bank message never registers extraction at all".
 * That defence was only ever applied to the rules engine's *own* tactics.
 * `mergeTactics` then unioned the LLM's tactics in with no scrutiny at all, so
 * a model asserting `extraction` on a message whose extraction score is deeply
 * negative sailed straight past a defence built precisely to stop it.
 *
 * That is how a real SBI debit alert was reported as "This is a scam", with the
 * bank's published fraud-reporting line — "Not you? Call 18001111109." — quoted
 * on screen as the evidence of extraction. The scan had already matched that
 * number as a legitimacy marker and scored extraction below zero.
 *
 * Two screens, both deterministic, both narrow:
 *
 * 1. **Contradicted tactic.** The scan's subtotal for this tactic is negative:
 *    it did not merely fail to find the tactic, it found the opposite. The
 *    same test the rules engine applies to itself, applied symmetrically.
 *
 * 2. **Corroborated identity.** `authority` means, per §5, pretending to be an
 *    institution "in order to borrow their power". A message arriving through a
 *    registered TRAI header and naming that institution is not borrowing
 *    anything — it is the institution, verified by the envelope (§5.5). So
 *    authority-from-a-registered-sender is not a finding *on its own*. It
 *    survives whenever any other tactic survives, because a scam pushed through
 *    a misused header is real (§5.5) and there the identity claim is genuine
 *    context.
 *
 * This is not "trust the header", which §5.5 forbids. Nothing here can clear a
 * message that still has a surviving tactic, and `test:falsepos` re-sends every
 * corpus scam through `VM-SBIINB` to prove it.
 */
export function screenLlmTactics(
  llmTactics: readonly Tactic[],
  input: DetectionInput,
): Tactic[] {
  if (llmTactics.length === 0) return []
  const { subtotals } = scanDeterministically(input)
  return llmTactics.filter((t) => (subtotals[t.name] ?? 0) >= 0)
}

/**
 * Screen 2 — corroborated identity (D21).
 *
 * Applied to the *merged* finding set, because it is a statement about what
 * `authority` means rather than about which engine said it. The rules engine
 * registers `authority` on a bare institution name by design — §4's
 * impersonation-mismatch rule depends on it registering — so "SBI" in a genuine
 * SBI message becomes a tactic on the card no matter who asserted it.
 *
 * §5 defines authority as pretending to be an institution "in order to borrow
 * their power". A message arriving through that institution's registered TRAI
 * header and naming it is not borrowing anything; the envelope corroborates the
 * claim (§5.5). There is nothing to warn a reader about, and §4's rule 4 says
 * we never show a verdict we cannot justify on screen — a card reading "this
 * claims to come from an official body" about a message that genuinely came
 * from that official body is the opposite of informative.
 *
 * Narrow on purpose: it fires only when `authority` is the *sole* surviving
 * finding. A scam pushed through a misused header keeps its urgency, isolation
 * or extraction, so it keeps its authority card too, and stays a scam. §5.5
 * requires exactly that, and `test:falsepos` re-sends every corpus scam through
 * `VM-SBIINB` to hold it.
 */
export function screenCorroboratedIdentity(
  tactics: readonly Tactic[],
  sender: SenderSignal,
): Tactic[] {
  if (sender.kind !== 'dlt_header') return [...tactics]
  if (tactics.length === 1 && tactics[0]!.name === 'authority') return []
  return [...tactics]
}

export interface FusionInput {
  rules: DetectionResult
  llm: DetectionResult
  /**
   * The message being analysed, so fusion can re-run the deterministic scan and
   * screen the LLM's tactics against it (D21).
   *
   * **Required, deliberately.** It was optional for one revision, defaulting to
   * "screen nothing" — which is the exact shape of the bug D20 fixed elsewhere:
   * a safety contract that every layer honours except the one that has to
   * supply it. An omitted argument must not be able to silently switch off the
   * false-positive defence.
   */
  input: DetectionInput
}

/**
 * Combine a rules result and an LLM result into the single result the UI sees.
 *
 * The verdict is recomputed from the fused confidence through `decideVerdict`,
 * so §4's threshold table and all four override rules apply to the merged
 * finding set exactly as they do to a single engine. Nothing downstream can
 * tell that two engines ran, which is the point of the seam (§6).
 */
export function fuse({ rules, llm, input }: FusionInput): DetectionResult {
  // The LLM's findings are screened against the deterministic scan before they
  // are merged (D21). The rules engine's own tactics are not screened — they
  // already passed this test to exist.
  const llmTactics = screenLlmTactics(llm.tactics, input)

  const merged = mergeTactics(rules.tactics, llmTactics)
  const tactics = screenCorroboratedIdentity(merged, rules.senderSignal)

  // §4 override rule 5 (D21): a danger verdict needs more than one engine's
  // unsupported reading. Only fusion can see whether the two agreed.
  const scan = scanDeterministically(input)
  const confidence = capUncorroborated(
    fuseConfidence(rules.confidence, llm.confidence),
    rules.senderSignal,
    {
      verdict: rules.verdict,
      foundAuthority: rules.tactics.some((t) => t.name === 'authority'),
      foundLegitimacyMarkers: scan.legitimacyMarkers.length > 0,
      locatedConcreteAsk: tactics.some(
        (t) => t.name === 'extraction' && t.evidence.some((e) => e.start !== -1),
      ),
    },
  )

  // The sender is a deterministic fact, identical in both inputs (D9).
  const senderSignal = rules.senderSignal

  // Prose comes from whichever engine actually explains the finding. When the
  // rules engine found nothing and the LLM found the scam, the rules copy says
  // "nothing here pressures you" — which would contradict the verdict on screen.
  const rulesFoundSomething = rules.tactics.length > 0
  const llmFoundMore = llmTactics.length > rules.tactics.length

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
