import type { DetectionResult, SenderRisk, SenderKind } from './types.ts'
import { decideVerdict } from './verdict.ts'

/**
 * Result validation — SPEC.md §7 invariants.
 *
 * Every engine calls this before returning. A result that fails is treated as
 * an engine failure: the engine rejects and the orchestrator falls through to
 * rules. It is never patched up and shown to the user.
 */

export class InvalidResultError extends Error {
  constructor(reason: string) {
    super(`DetectionResult failed validation: ${reason}`)
    this.name = 'InvalidResultError'
  }
}

/** kind -> the risks that kind is allowed to carry (§5.5 table). */
const ALLOWED_RISK: Record<SenderKind, SenderRisk[]> = {
  dlt_header: ['none'],
  shortcode: ['none'],
  phone_number: ['high'],
  telemarketer: ['medium'],
  international: ['high'],
  email_or_other: ['medium'],
  unknown: ['none'],
}

export function validateResult(r: DetectionResult): DetectionResult {
  if (!Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1) {
    throw new InvalidResultError(`confidence out of range: ${r.confidence}`)
  }

  const names = r.tactics.map((t) => t.name)
  if (new Set(names).size !== names.length) {
    throw new InvalidResultError('duplicate tactic names — one card per tactic')
  }

  for (const t of r.tactics) {
    for (const e of t.evidence) {
      if (e.phrase.trim() === '') {
        throw new InvalidResultError(`empty evidence phrase in tactic "${t.name}"`)
      }
    }
  }

  if (!r.senderSignal) throw new InvalidResultError('senderSignal missing')
  if (!ALLOWED_RISK[r.senderSignal.kind]?.includes(r.senderSignal.risk)) {
    throw new InvalidResultError(
      `sender kind "${r.senderSignal.kind}" may not carry risk "${r.senderSignal.risk}"`,
    )
  }

  if (r.explanation.trim() === '') throw new InvalidResultError('explanation is empty')
  if (r.nextMove.trim() === '') throw new InvalidResultError('nextMove is empty')

  const expected = decideVerdict(r.confidence, r.tactics, r.senderSignal)
  if (r.verdict !== expected) {
    throw new InvalidResultError(
      `verdict "${r.verdict}" disagrees with the §4 mapping, which gives "${expected}"`,
    )
  }

  // §4 rule 4: never show a danger verdict with nothing to show for it.
  if (r.verdict === 'danger' && r.tactics.length === 0 && r.senderSignal.risk !== 'high') {
    throw new InvalidResultError('danger verdict with no tactics and no high-risk sender')
  }

  return r
}
