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
 * Apply the four override rules, in order, after the threshold table.
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
