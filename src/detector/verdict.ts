import type { SenderSignal, Tactic, Verdict } from './types.ts'

/**
 * The confidence -> verdict mapping and its override rules — SPEC.md §4.
 *
 * This lives in exactly one place and every engine calls it. No engine
 * implements its own thresholds, which is what keeps the local model, the
 * cloud model and the rules engine agreeing with each other.
 *
 * NOTE: `confidence` is internal. It decides the verdict and is never
 * rendered in any form (§4). Numbers about the *device* (§9) are fine;
 * numbers about the *message* are not.
 */

export const THRESHOLDS = { danger: 0.7, caution: 0.35 } as const

export function verdictFromConfidence(confidence: number): Verdict {
  if (confidence >= THRESHOLDS.danger) return 'danger'
  if (confidence >= THRESHOLDS.caution) return 'caution'
  return 'safe'
}

const RANK: Record<Verdict, number> = { safe: 0, caution: 1, danger: 2 }

/** Raise `current` to `floor` if it is below it. Never lowers. */
function atLeast(current: Verdict, floor: Verdict): Verdict {
  return RANK[floor] > RANK[current] ? floor : current
}

/**
 * Apply the override rules, in order, after the threshold table.
 * Returns the final verdict.
 */
export function applyOverrides(
  base: Verdict,
  tactics: readonly Tactic[],
  sender: SenderSignal,
): Verdict {
  let v = base

  const present = new Set(tactics.map((t) => t.name))
  const extraction = tactics.find((t) => t.name === 'extraction')

  // 1. Extraction floor — a message asking for an OTP is never 'safe'.
  if (extraction && extraction.evidence.some((e) => e.start !== -1)) {
    v = atLeast(v, 'caution')
  }

  // 2. Three-tactic rule — three distinct tactics is a scam by construction.
  if (present.size >= 3) {
    v = 'danger'
  }

  // 3. Impersonation mismatch (§5.5) — claims to be an institution but arrived
  //    from a personal number. Decided here, deterministically, not by a model.
  if (present.has('authority') && sender.risk === 'high') {
    v = present.has('extraction') ? 'danger' : atLeast(v, 'caution')
  }

  // 4. Empty-finding ceiling — never show a verdict we cannot justify on
  //    screen. A high-risk sender counts as something showable (the
  //    SenderCard), so it satisfies this rule on its own.
  if (tactics.length === 0 && sender.risk !== 'high') {
    v = 'safe'
  }

  return v
}

/** Convenience: threshold table plus overrides, the way every engine wants it. */
export function decideVerdict(
  confidence: number,
  tactics: readonly Tactic[],
  sender: SenderSignal,
): Verdict {
  return applyOverrides(verdictFromConfidence(confidence), tactics, sender)
}

/**
 * Override rule 5 — corroboration for danger. D21.
 *
 * "This is a scam. Do not reply. Do not send money or codes." is the strongest
 * thing this app says to anyone. It must not rest on a single engine's
 * unsupported reading of a message.
 *
 * D15 re-centred fusion on the LLM and accepted that trade-off explicitly, on
 * the grounds that "the real protection against a wrong LLM moved to
 * `findAuditGap` and the §4 override rules". Neither actually provided it.
 * `findAuditGap` only detects tactics the LLM *omitted*, never ones it
 * *invented*; and rules 1-3 above can only raise a verdict, while the one
 * lowering rule needs an empty finding set, which an inventive model never
 * leaves. The gap was measured, not theorised: with one over-eager model, all
 * 19 legitimate corpus messages reached `danger`, a real SBI debit alert from a
 * registered header among them. That is what was reported from the phone.
 *
 * **Expressed as a cap on confidence, not on the verdict, and that is
 * deliberate.** `validateResult` enforces `verdict === decideVerdict(confidence,
 * tactics, sender)` — the verdict is a pure function of those three, which is
 * what keeps the rules engine, the cloud engine and the on-device engine
 * agreeing with each other (§4, §6). A rule that lowered the verdict while
 * leaving the confidence untouched would break that invariant, and did: every
 * fused result began failing validation. Lowering the confidence instead keeps
 * one source of truth and says the honest thing — we are not confident enough
 * to call this a scam, because only one reader thought so.
 *
 * Narrow, and it leaves every path that matters alone:
 * - A high-risk sender is exempt, so the classic Indian shape — a personal
 *   number claiming to be a bank — is untouched (rule 3 owns it).
 * - §8.3's conclusive signals (AnyDesk, digital arrest, "share the OTP") each
 *   register a rules tactic, so a message carrying one never reaches this.
 * - It can only lower, only to just under the danger threshold, and only when
 *   the deterministic scan found nothing of its own. The user still gets
 *   `caution` — "Something's off here. Check before you act." — which is a real
 *   warning, and the right one for a finding nothing corroborates.
 */
export function capUncorroborated(
  confidence: number,
  sender: SenderSignal,
  corroboration: DeterministicCorroboration,
): number {
  if (isCorroborated(sender, corroboration)) return confidence
  return Math.min(confidence, THRESHOLDS.danger - 0.01)
}

/** What the deterministic engine concluded on its own, for rule 5. */
export interface DeterministicCorroboration {
  /** The rules engine's own verdict, before any model was consulted. */
  verdict: Verdict
  /** Did the rules engine itself match the `authority` tactic? */
  foundAuthority: boolean
  /**
   * Did the scan match any legitimacy marker (§8.3 `NEGATIVES`)?
   *
   * This is what separates the scan *disagreeing* from the scan being *silent*,
   * and the two must not be treated alike. Measured over the corpus: all 21
   * scams match zero legitimacy markers, while 12 of 19 legitimate messages
   * match at least one.
   */
  foundLegitimacyMarkers: boolean
  /**
   * Did a surviving tactic name a concrete ask, with evidence found verbatim in
   * the message?
   *
   * §5 defines `extraction` as "the actual ask — an OTP, a UPI PIN or payment,
   * card details". A model that has located the ask is doing the job; a model
   * that merely finds the tone suspicious is not.
   */
  locatedConcreteAsk: boolean
}

/**
 * May a `danger` verdict stand when the deterministic engine concluded `safe`?
 *
 * Three ways, and each exists to protect a capability the product actually
 * needs. The default — none of them holding — is `caution`, not `danger`.
 *
 * 1. **The scan's own verdict was not `safe`.** Its considered judgement over
 *    positives, negatives, the sender and §8.3's conclusive floors. If it
 *    concluded `safe`, it does not support calling the message a scam.
 *
 *    Note what this deliberately does *not* count: merely having registered a
 *    tactic. The rules engine registers `authority` on a bare institution name
 *    by design — §4 rule 3 depends on it — so a genuine SBI alert carries an
 *    `authority` tactic while scoring 0.00 and concluding `safe`. Counting that
 *    as corroboration let nine legitimate bank messages through an earlier
 *    draft of this rule.
 *
 * 2. **A high-risk sender where the scan itself saw the authority claim.** That
 *    is §5.5's impersonation mismatch, established deterministically at both
 *    ends: the envelope is a personal number, and the text really does claim an
 *    institution. The strongest single combination in this market, untouched.
 *
 *    The `foundAuthority` half matters. Without it, a model hallucinating
 *    `authority` on a message from a friend's mobile manufactures the mismatch
 *    itself, and §5.5 is explicit that a personal number "on its own is worth a
 *    small nudge and a neutral note, nothing more."
 *
 * 3. **The scan is silent, and the model located the actual ask.** This is the
 *    capability D12 and D15 put an LLM in the path for: a scam written in
 *    wording nobody has listed yet. The corpus bears out the distinction — all
 *    21 scams match zero legitimacy markers — so a scan that matched none is
 *    not disagreeing with the model, merely unaccompanied.
 *
 *    "Silent" alone is not enough, because an ordinary message between friends
 *    is also silent, and §5.5 warns that flagging those "would make the app
 *    useless". So the model must also have found a concrete ask with evidence
 *    quoted verbatim from the message — §5's `extraction`, the thing the scam
 *    actually came for. Finding the ask is doing the job; finding the tone
 *    suspicious is not.
 */
function isCorroborated(
  sender: SenderSignal,
  {
    verdict,
    foundAuthority,
    foundLegitimacyMarkers,
    locatedConcreteAsk,
  }: DeterministicCorroboration,
): boolean {
  if (verdict !== 'safe') return true
  if (sender.risk === 'high' && foundAuthority) return true
  if (!foundLegitimacyMarkers && locatedConcreteAsk) return true
  return false
}
