import { copy } from '../copy.ts'
import { IconPhoneCall, IconArrowRight, IconLock } from '../icons.tsx'
import type { Report, ReportRoute } from '../../report/types.ts'

/**
 * The Evidence Receipt — SPEC.md §10.6, decision D16.
 *
 * A component. It renders a `Report` and knows nothing about detectors,
 * engines or routing (§10.3): everything on screen was decided by
 * `buildReport`, and every colour, radius and duration is a token.
 *
 * Shaped like a document rather than like another app screen, because a formal
 * record is what a person takes to an authority — and looking official is most
 * of what makes someone act instead of closing the app.
 *
 * WHAT MUST NEVER APPEAR HERE: a total. No count of findings, no severity, no
 * rating, no meter. §4 forbids a number about the message, and D16 records why
 * this is the surface most likely to grow one. `npm run test:report` guards it.
 */
export function ReportSheet({ report }: { report: Report }) {
  const when = new Date(report.preparedAt)
  const prepared = Number.isNaN(when.getTime())
    ? report.preparedAt
    : when.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })

  return (
    <article className={`receipt receipt--${report.verdict}`}>
      <header className="receipt__masthead">
        <div className="receipt__brand">
          <span className="receipt__brand-name">{copy.report_masthead}</span>
          <span className="receipt__brand-sub">{copy.report_masthead_sub}</span>
        </div>
        {/* A reference for the person's own records — never a case number.
            Nothing has been filed, and Kavach has no backend that could
            issue one (D16). */}
        <dl className="receipt__meta">
          <div className="receipt__meta-row">
            <dt>{copy.report_ref}</dt>
            <dd>{report.reference}</dd>
          </div>
          <div className="receipt__meta-row">
            <dt>{copy.report_prepared}</dt>
            <dd>{prepared}</dd>
          </div>
        </dl>
      </header>

      <p className="receipt__verdict">{report.headline}</p>

      {report.rows.length > 0 && (
        <section className="receipt__section">
          <h3 className="receipt__section-title">{copy.report_findings_title}</h3>
          <dl className="receipt__rows">
            {report.rows.map((row) => (
              <div className="receipt__row" key={`${row.label}:${row.value}`}>
                <dt className="receipt__row-label">{row.label}</dt>
                <dd className="receipt__row-value">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="receipt__section">
        <h3 className="receipt__section-title">{copy.report_message_title}</h3>
        {/* Verbatim and uncut. The portals ask what the message said, and a
            trimmed quote is worth less to whoever reads the complaint. */}
        <blockquote className="receipt__message">{report.message}</blockquote>
      </section>

      {report.whatTheyWanted && (
        <section className="receipt__section">
          <h3 className="receipt__section-title">{copy.report_want_title}</h3>
          <p className="receipt__want">{report.whatTheyWanted}</p>
        </section>
      )}

      <footer className="receipt__footer">
        <IconLock size={14} aria-hidden="true" />
        <span>{copy.report_footer}</span>
      </footer>
    </article>
  )
}

/**
 * One official destination.
 *
 * Renders as a link, not a button, so a long-press offers "copy link" and the
 * user can see where they are being sent before they go. `tel:` dials; `https:`
 * opens. Nothing here posts anything (D16).
 */
export function RouteCard({ route, disabled }: { route: ReportRoute; disabled: boolean }) {
  const isCall = route.action === 'tel'

  return (
    <a
      className={`route${disabled ? ' route--disabled' : ''}`}
      href={disabled ? undefined : route.href}
      {...(route.action === 'web' && !disabled
        ? { target: '_blank', rel: 'noreferrer noopener' }
        : {})}
      aria-disabled={disabled || undefined}
    >
      <span className="route__body">
        <span className="route__name">{route.name}</span>
        <span className="route__operator">{route.operator}</span>
        <span className="route__purpose">{route.purpose}</span>
        <span className="route__expect">
          {copy.report_expect}: {route.expect}
        </span>
      </span>
      <span className="route__action" aria-hidden="true">
        {isCall ? <IconPhoneCall size={18} /> : <IconArrowRight size={18} />}
        <span className="route__action-label">{isCall ? copy.report_call : copy.report_open}</span>
      </span>
    </a>
  )
}
