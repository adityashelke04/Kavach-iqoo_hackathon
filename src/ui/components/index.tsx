import { useMemo } from 'react'
import type { DetectionResult, SenderSignal, Tactic, Verdict } from '../../detector/types.ts'
import { buildSegments } from '../../detector/evidence.ts'
import { copy } from '../copy.ts'

/**
 * Presentational components — SPEC.md §10.3.
 *
 * These receive everything as props. They do not import an engine, do not
 * call the orchestrator, and hold no detection logic. That separation is what
 * makes the UI replaceable without touching the detector (§15).
 */

const VERDICT_UI: Record<Verdict, { icon: string; head: string; sub: string }> = {
  danger: { icon: '⛔', head: copy.verdict_danger_head, sub: copy.verdict_danger_sub },
  caution: { icon: '⚠️', head: copy.verdict_caution_head, sub: copy.verdict_caution_sub },
  safe: { icon: '✅', head: copy.verdict_safe_head, sub: copy.verdict_safe_sub },
}

/** Icon + text always accompany the colour — never colour alone (§10.8). */
export function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const v = VERDICT_UI[verdict]
  return (
    <div className={`verdict verdict--${verdict} reveal`} role="status" aria-live="polite">
      <div className="verdict__icon" aria-hidden="true">
        {v.icon}
      </div>
      <h1 className="verdict__head">{v.head}</h1>
      <p className="verdict__sub">{v.sub}</p>
    </div>
  )
}

/**
 * The user's message, verbatim, with the triggering phrases highlighted.
 * This is the proof, and it sits above the explanation on purpose (§10.1).
 *
 * INVARIANT (§7): the segments always reconstruct the input exactly. The
 * corpus suite asserts this for every message.
 */
export function HighlightedMessage({
  text,
  tactics,
}: {
  text: string
  tactics: readonly Tactic[]
}) {
  const segments = useMemo(() => {
    const spans = tactics.flatMap((t) =>
      t.evidence.map((e) => ({ start: e.start, end: e.end, tactic: t.name })),
    )
    return buildSegments(text, spans)
  }, [text, tactics])

  return (
    <p className="message">
      {segments.map((s, i) =>
        s.tactics.length === 0 ? (
          <span key={i}>{s.text}</span>
        ) : (
          <mark key={i}>{s.text}</mark>
        ),
      )}
    </p>
  )
}

export function TacticCard({ tactic }: { tactic: Tactic }) {
  const resolved = tactic.evidence.filter((e) => e.start !== -1)
  return (
    <div className="card card--danger">
      <h3 className="card__title">{tactic.label}</h3>
      <p className="card__note">{tactic.note}</p>
      {resolved.length > 0 && (
        <div className="evidence-list">
          {resolved.map((e, i) => (
            <span className="evidence" key={i}>
              “{e.phrase}”
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Sender card — renders first in the findings list (§10.6).
 *
 * The strongest variant is the impersonation mismatch: the message claims to
 * be an institution but arrived from a personal number, which in India is a
 * contradiction on its face (§5.5).
 */
export function SenderCard({
  signal,
  claimsAuthority,
}: {
  signal: SenderSignal
  claimsAuthority: boolean
}) {
  if (signal.kind === 'unknown') return null

  const mismatch = signal.risk === 'high' && claimsAuthority
  const tone = mismatch ? 'danger' : signal.risk === 'high' ? 'caution' : 'safe'

  return (
    <div className={`card card--${tone}`}>
      <h3 className="card__title">{copy.sender_card_title}</h3>
      <p className="card__note" style={{ color: 'var(--text)' }}>
        {signal.raw}
      </p>
      <p className="card__note">{mismatch ? copy.sender_mismatch_note : signal.note}</p>
    </div>
  )
}

export function NextMove({ text }: { text: string }) {
  return (
    <div className="card card--accent">
      <h3 className="card__title">{copy.next_move_title}</h3>
      <p className="card__note" style={{ color: 'var(--text)' }}>
        {text}
      </p>
    </div>
  )
}

/** The whole findings stack, shared by the Verdict screen and Listen mode. */
export function Findings({ result, text }: { result: DetectionResult; text: string }) {
  const claimsAuthority = result.tactics.some((t) => t.name === 'authority')
  const unresolved = result.tactics.flatMap((t) => t.evidence.filter((e) => e.start === -1))

  return (
    <div className="stack stagger">
      <p style={{ margin: 0, lineHeight: 'var(--lh-body)' }}>{result.explanation}</p>

      <HighlightedMessage text={text} tactics={result.tactics} />

      {unresolved.length > 0 && (
        <div>
          <p className="section-label">{copy.phrases_found}</p>
          <div className="evidence-list">
            {unresolved.map((e, i) => (
              <span className="evidence" key={i}>
                “{e.phrase}”
              </span>
            ))}
          </div>
        </div>
      )}

      <SenderCard signal={result.senderSignal} claimsAuthority={claimsAuthority} />

      {/* Tactic cards are omitted on a clean safe result (§10.6). */}
      {result.verdict !== 'safe' &&
        result.tactics.map((t) => <TacticCard key={t.name} tactic={t} />)}

      <NextMove text={result.nextMove} />
    </div>
  )
}
