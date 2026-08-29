import { useMemo, useState, useCallback } from 'react'
import type {
  DetectionResult,
  SenderSignal,
  Tactic,
  Verdict,
  TacticName,
} from '../../detector/types.ts'
import { buildSegments } from '../../detector/evidence.ts'
import { copy, TACTIC_LABELS } from '../copy.ts'
import {
  IconCopy,
  IconCheck,
  IconShieldCheck,
  IconAlertTriangle,
  IconShieldX,
  IconClock,
  IconBadgeCheck,
  IconUserX,
  IconKey,
  IconCpu,
  IconChevronRight,
} from '../icons.tsx'

/**
 * Presentational components — SPEC.md §10.3.
 *
 * These render what a screen hands them and nothing else: no component imports
 * an engine, and no component hard-codes a colour, radius or duration. State
 * styling is a class, so a redesign is a token edit (§10.2).
 */

/* ==========================================================================
   1. Verdict banner
   ========================================================================== */

const VERDICT_COPY: Record<Verdict, { head: string; sub: string }> = {
  danger: { head: copy.verdict_danger_head, sub: copy.verdict_danger_sub },
  caution: { head: copy.verdict_caution_head, sub: copy.verdict_caution_sub },
  safe: { head: copy.verdict_safe_head, sub: copy.verdict_safe_sub },
}

function VerdictMark({ verdict }: { verdict: Verdict }) {
  if (verdict === 'danger') return <IconShieldX size={32} strokeWidth={2.2} />
  if (verdict === 'caution') return <IconAlertTriangle size={30} strokeWidth={2.2} />
  return <IconShieldCheck size={32} strokeWidth={2.2} />
}

/**
 * The judgment, and nothing competing with it (§10.1).
 *
 * The state is carried by an icon and a sentence as well as by colour, so it
 * survives greyscale and colour blindness (§10.8). Escalation is area: the
 * state floods the entire first viewport rather than shouting in a badge.
 */
export function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const v = VERDICT_COPY[verdict]

  return (
    <div className={`verdict verdict--${verdict}`} role="status" aria-live="polite">
      <span className="verdict__mark" aria-hidden="true">
        <VerdictMark verdict={verdict} />
      </span>
      <h1 className="verdict__head">{v.head}</h1>
      <p className="verdict__sub">{v.sub}</p>
    </div>
  )
}

/* ==========================================================================
   2. The message, with the flagged phrases marked in place
   ========================================================================== */

/**
 * Highlighting only means something while it is scarce. The engine can resolve
 * a dozen spans in a three-line SMS, and marking all of them paints the whole
 * message orange, which tells the reader nothing. We show the longest few —
 * the most specific phrases — and let the tactic list carry the rest.
 */
const MAX_MARKS = 6

export function HighlightedMessage({
  text,
  tactics,
  highlight = true,
}: {
  text: string
  tactics: readonly Tactic[]
  /** A safe verdict marks nothing: orange on a message we just called
   *  legitimate contradicts the headline the reader is still looking at. */
  highlight?: boolean
}) {
  const [copied, setCopied] = useState(false)

  const segments = useMemo(() => {
    if (!highlight) return buildSegments(text, [])
    const spans = tactics
      .flatMap((t) => t.evidence.map((e) => ({ ...e, tactic: t.name })))
      .filter((e) => e.start !== -1)
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, MAX_MARKS)
      .map((e) => ({ start: e.start, end: e.end, tactic: e.tactic }))

    return buildSegments(text, spans)
  }, [text, tactics, highlight])

  const marked = segments.some((s) => s.tactics.length > 0)

  const copyText = useCallback(() => {
    void navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <section className="panel">
      <div className="row">
        <h2 className="panel__title">{copy.message_title}</h2>
        <button
          type="button"
          className="chip"
          onClick={copyText}
          aria-label="Copy the message"
        >
          {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          <span>{copied ? copy.cta_copied : copy.cta_copy}</span>
        </button>
      </div>

      {marked && <p className="hint message-hint">{copy.message_hint}</p>}

      <p className="message">
        {segments.map((s, i) =>
          s.tactics.length === 0 ? (
            <span key={i}>{s.text}</span>
          ) : (
            <mark key={i} className="evidence-mark">
              {s.text}
            </mark>
          ),
        )}
      </p>
    </section>
  )
}

/* ==========================================================================
   3. Tactics — how the message tries to work on you
   ========================================================================== */

function TacticIcon({ name }: { name: TacticName }) {
  switch (name) {
    case 'authority':
      return <IconBadgeCheck size={18} />
    case 'urgency':
      return <IconClock size={18} />
    case 'isolation':
      return <IconUserX size={18} />
    case 'extraction':
      return <IconKey size={18} />
  }
}

/** One panel of rows. A card per tactic would be cards inside a card. */
export function TacticList({ tactics }: { tactics: readonly Tactic[] }) {
  if (tactics.length === 0) return null

  return (
    <section className="panel">
      <h2 className="panel__title">{copy.tactics_title}</h2>
      {tactics.map((t) => (
        <div className="tactic" key={t.name}>
          <span className="tactic__icon" aria-hidden="true">
            <TacticIcon name={t.name} />
          </span>
          <div className="tactic__body">
            <h3 className="tactic__title">{TACTIC_LABELS[t.name] ?? t.label}</h3>
            <p className="tactic__note">{t.note}</p>
          </div>
        </div>
      ))}
    </section>
  )
}

/* ==========================================================================
   4. Sender origin (§5.5)
   ========================================================================== */

/**
 * The strongest single card in the app when it fires: the message claims to be
 * an institution, but it arrived from a personal mobile number, which under the
 * TRAI DLT rules a real institution cannot do.
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
  const registered = signal.kind === 'dlt_header'
  const tone = mismatch ? 'danger' : registered ? 'safe' : 'quiet'

  return (
    <section className={`panel panel--${tone}`}>
      <h2 className="panel__title">{copy.sender_card_title}</h2>
      <p className="panel__value">{signal.raw}</p>
      <p className="tactic__note">
        {mismatch ? copy.sender_mismatch_note : signal.note}
      </p>
    </section>
  )
}

/* ==========================================================================
   5. What to do now
   ========================================================================== */

export function NextMove({ text }: { text: string }) {
  return (
    <section className="panel">
      <h2 className="panel__title">{copy.next_move_title}</h2>
      <p className="panel__lead">{text}</p>
    </section>
  )
}

/* ==========================================================================
   6. How we checked — the technical proof, one tap away
   ========================================================================== */

/**
 * Everything a judge or a curious user wants to verify lives here, and nothing
 * a frightened user has to read does. These are numbers about the device, which
 * §9 allows; numbers about the message are never rendered (§4).
 */
export function HowWeChecked({ result }: { result: DetectionResult }) {
  return (
    <details className="disclosure">
      <summary className="disclosure__summary">
        <IconCpu size={16} />
        <span>{copy.how_title}</span>
        <IconChevronRight size={18} className="disclosure__chevron" />
      </summary>

      <div className="disclosure__body">
        <p className="tactic__note">{copy.how_note}</p>

        <div className="meta-row">
          <span className="meta-row__k">{copy.how_engine}</span>
          <span className="meta-row__v">
            {result.engineUsed === 'cloud' ? copy.how_engine_cloud : copy.how_engine_local}
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-row__k">{copy.how_time}</span>
          <span className="meta-row__v">{result.latencyMs} ms</span>
        </div>
        <div className="meta-row">
          <span className="meta-row__k">{copy.how_sent}</span>
          <span className="meta-row__v">{copy.how_sent_no}</span>
        </div>
      </div>
    </details>
  )
}

/* ==========================================================================
   7. Findings — the reading order of the verdict screen
   ========================================================================== */

/**
 * Judgment first (the banner, rendered by the screen), then why, then the
 * proof in the reader's own words, then who sent it, then how it works, then
 * what to do. The engine detail comes last and closed.
 */
export function Findings({ result, text }: { result: DetectionResult; text: string }) {
  const claimsAuthority = result.tactics.some((t) => t.name === 'authority')
  const unresolved = result.tactics.flatMap((t) =>
    t.evidence.filter((e) => e.start === -1),
  )

  return (
    <div className="stack stack--loose">
      <section className="panel panel--quiet">
        <h2 className="panel__title">{copy.why_title}</h2>
        <p className="panel__lead">{result.explanation}</p>
      </section>

      <HighlightedMessage
        text={text}
        tactics={result.tactics}
        highlight={result.verdict !== 'safe'}
      />

      {/* Phrases the engine reported but could not locate in the text, so they
          are listed rather than highlighted (§7 evidence resolution). */}
      {unresolved.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">{copy.phrases_found}</h2>
          <div className="quote-list">
            {unresolved.map((e, i) => (
              <p className="quote" key={i}>
                “{e.phrase}”
              </p>
            ))}
          </div>
        </section>
      )}

      <SenderCard signal={result.senderSignal} claimsAuthority={claimsAuthority} />

      {result.verdict !== 'safe' && <TacticList tactics={result.tactics} />}

      {result.verdict !== 'safe' && <NextMove text={result.nextMove} />}

      <HowWeChecked result={result} />

      <p className="hint">{copy.about_disclaimer}</p>
    </div>
  )
}
