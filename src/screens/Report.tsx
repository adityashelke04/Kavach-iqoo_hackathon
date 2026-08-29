import { useCallback, useMemo, useState } from 'react'
import type { DetectionResult } from '../detector/types.ts'
import type { Disclosure } from '../report/types.ts'
import { buildReport } from '../report/build.ts'
import { toComplaintText } from '../report/text.ts'
import { urgentSteps } from '../report/routes.ts'
import { ReportSheet, RouteCard } from '../ui/components/ReportSheet.tsx'
import { copy } from '../ui/copy.ts'
import { AppBar } from '../ui/primitives/index.tsx'
import { IconCopy, IconCheck, IconShare, IconAlertTriangle } from '../ui/icons.tsx'
import { useOnline } from '../pwa/network.ts'

/**
 * Report — SPEC.md §10.6, decision D16.
 *
 * A screen: it composes, it does not decide (§10.3). The record comes from
 * `buildReport`, the destinations from `routes.ts`, and nothing here imports an
 * engine or touches a detector.
 *
 * Kavach never submits a complaint. Every action on this screen is a copy, a
 * share, a dial or a link out — the person files it themselves, on the
 * government's own site. A later session tempted to add a submit button should
 * read D16 first.
 */
const ANSWERS: { id: Disclosure; title: string; sub: string }[] = [
  { id: 'money', title: copy.report_a_money, sub: copy.report_a_money_sub },
  {
    id: 'credentials',
    title: copy.report_a_credentials,
    sub: copy.report_a_credentials_sub,
  },
  { id: 'nothing', title: copy.report_a_nothing, sub: copy.report_a_nothing_sub },
  { id: 'nuisance', title: copy.report_a_nuisance, sub: copy.report_a_nuisance_sub },
]

export function Report({
  result,
  text,
  onBack,
}: {
  result: DetectionResult
  text: string
  onBack: () => void
}) {
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null)
  const [copied, setCopied] = useState(false)
  const online = useOnline()

  const report = useMemo(
    () => (disclosure ? buildReport({ result, text, disclosure }) : null),
    // The reference is time-derived, so this must not rebuild on every render —
    // the number on screen would change while the user is reading it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, text, disclosure],
  )

  const complaint = useMemo(() => (report ? toComplaintText(report) : ''), [report])

  const copyComplaint = useCallback(() => {
    void navigator.clipboard?.writeText(complaint)
    setCopied(true)
    setTimeout(() => setCopied(false), 2400)
  }, [complaint])

  const share = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: copy.report_title, text: complaint })
        return
      } catch {
        /* cancelled, or the browser has no share sheet — fall back to copying */
      }
    }
    copyComplaint()
  }, [complaint, copyComplaint])

  const steps = disclosure ? urgentSteps(disclosure) : []

  return (
    <div className="screen">
      <AppBar title={copy.report_title} onBack={onBack} />

      <div className="screen__body">
        {/* The one question. Nothing below renders until it is answered,
            because the answer changes both the urgency block and where the
            complaint should go (D16). */}
        {!report && (
          <section className="disclose">
            <h2 className="disclose__title">{copy.report_q_title}</h2>
            <p className="disclose__sub">{copy.report_q_sub}</p>
            <div className="disclose__options">
              {ANSWERS.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  className="disclose__option"
                  onClick={() => setDisclosure(a.id)}
                >
                  <span className="disclose__option-title">{a.title}</span>
                  <span className="disclose__option-sub">{a.sub}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {report && (
          <>
            {/* Above the receipt on purpose: the paperwork is not the urgent
                part when money is already moving. */}
            {steps.length > 0 && (
              <section className="urgent" role="alert">
                <h2 className="urgent__title">
                  <IconAlertTriangle size={18} aria-hidden="true" />
                  {copy.report_urgent_title}
                </h2>
                <p className="urgent__sub">{copy.report_urgent_sub}</p>
                <ol className="urgent__steps">
                  {steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </section>
            )}

            <ReportSheet report={report} />

            <div className="action-row">
              <button type="button" className="chip chip--grow" onClick={copyComplaint}>
                {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                <span>{copied ? copy.report_copied : copy.report_copy}</span>
              </button>
              <button type="button" className="chip chip--grow" onClick={share}>
                <IconShare size={16} />
                <span>{copy.report_share}</span>
              </button>
            </div>

            <section className="routes">
              <h2 className="routes__title">{copy.report_routes_title}</h2>
              {/* The receipt and the complaint text are built on this phone, so
                  they survive airplane mode — the links do not. Say so once,
                  plainly, rather than letting a tap do nothing. */}
              {!online && <p className="routes__offline">{copy.report_offline}</p>}
              <div className="routes__list">
                {report.routes.map((r) => (
                  <RouteCard key={r.id} route={r} disabled={!online} />
                ))}
              </div>
            </section>

            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setDisclosure(null)}
            >
              {copy.report_change_answer}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
