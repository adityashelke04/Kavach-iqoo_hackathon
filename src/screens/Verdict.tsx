import { useEffect, useRef, useState, useCallback } from 'react'
import type { DetectionResult } from '../detector/types.ts'
import { Findings, VerdictBanner } from '../ui/components/index.tsx'
import { copy, TACTIC_LABELS } from '../ui/copy.ts'
import { AppBar } from '../ui/primitives/index.tsx'
import { IconCopy, IconCheck, IconShare, IconFlag } from '../ui/icons.tsx'

/**
 * Verdict — SPEC.md §10.6.
 *
 * Reading order: judgment, why, the proof in the reader's own words, who sent
 * it, how it works on you, what to do. Everything technical is behind "How we
 * checked" at the bottom, closed.
 */
export function Verdict({
  result,
  text,
  onAgain,
  onBack,
  onReport,
}: {
  result: DetectionResult
  text: string
  onAgain: () => void
  onBack?: () => void
  /** Absent, or unused on a `safe` verdict — see the report action below. */
  onReport?: () => void
}) {
  const bannerRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    bannerRef.current?.focus()
  }, [])

  /** A summary a person could forward to the relative who received the message. */
  const buildSummary = useCallback(() => {
    const head =
      result.verdict === 'danger'
        ? copy.verdict_danger_head
        : result.verdict === 'caution'
          ? copy.verdict_caution_head
          : copy.verdict_safe_head

    return [
      `Kavach: ${head}`,
      result.explanation,
      result.senderSignal.kind !== 'unknown'
        ? `${copy.sender_card_title}: ${result.senderSignal.raw} — ${result.senderSignal.note}`
        : '',
      result.verdict !== 'safe' && result.tactics.length > 0
        ? `${copy.tactics_title}:\n${result.tactics
            .map((t) => `- ${TACTIC_LABELS[t.name] ?? t.label}: ${t.note}`)
            .join('\n')}`
        : '',
      result.verdict !== 'safe' ? `${copy.next_move_title}: ${result.nextMove}` : '',
      '---',
      text,
    ]
      .filter(Boolean)
      .join('\n\n')
  }, [result, text])

  const copySummary = useCallback(() => {
    void navigator.clipboard?.writeText(buildSummary())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [buildSummary])

  const share = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: copy.app_name, text: buildSummary() })
        return
      } catch {
        /* cancelled or unsupported — fall through to the clipboard */
      }
    }
    copySummary()
  }, [buildSummary, copySummary])

  return (
    <div className="screen">
      <AppBar title={copy.app_name} onBack={onBack} />

      <div ref={bannerRef} tabIndex={-1}>
        <VerdictBanner verdict={result.verdict} />
      </div>

      <div className="screen__body">
        <Findings result={result} text={text} />

        <div className="action-row">
          <button type="button" className="chip chip--grow" onClick={copySummary}>
            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            <span>{copied ? copy.cta_copied : copy.cta_copy}</span>
          </button>
          <button type="button" className="chip chip--grow" onClick={share}>
            <IconShare size={16} />
            <span>{copy.cta_share}</span>
          </button>
        </div>

        {/* Never offered on a `safe` verdict: you do not report a legitimate
            message, and offering to would undermine the discrimination this
            product is judged on (D16). */}
        {onReport && result.verdict !== 'safe' && (
          <button type="button" className="btn btn--report" onClick={onReport}>
            <IconFlag size={18} aria-hidden="true" />
            <span>{copy.report_cta}</span>
          </button>
        )}
      </div>

      <div className="screen__footer">
        <button className="btn btn--primary" onClick={onAgain}>
          {copy.cta_again}
        </button>
        {onBack && (
          <button type="button" className="btn btn--ghost" onClick={onBack}>
            {copy.cta_done}
          </button>
        )}
      </div>
    </div>
  )
}
