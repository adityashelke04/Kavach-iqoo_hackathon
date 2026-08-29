/**
 * Compose the Evidence Receipt — SPEC.md §10.6, decision D16.
 *
 * A pure function over a `DetectionResult`. No React, no network, no storage,
 * no engine import. That is what lets `npm run test:report` check it in Node,
 * and it is why the whole feature works in airplane mode: everything on the
 * receipt is already in memory by the time this runs.
 *
 * TWO RULES GOVERN EVERY LINE BELOW.
 *
 * 1. **No total.** §4 forbids a number about the message, and D16 explains why
 *    this surface is the one most likely to grow one: a document laid out like a
 *    bill invites a bottom line. There is no tactic count, no severity, no
 *    rating and no meter here, and `test:report` asserts it.
 *
 * 2. **Nothing is invented.** A row exists only where a field was actually
 *    populated. No sender supplied means no sender row — not "Sender: unknown",
 *    which reads like a finding and is not one.
 */
import { copy } from '../ui/copy.ts'
import type { SenderSignal, Tactic } from '../detector/types.ts'
import { routesFor } from './routes.ts'
import type { Report, ReportInput, ReportRow } from './types.ts'

/** Verdict headlines, reused verbatim so the receipt cannot drift from §4. */
const HEADLINE = {
  danger: copy.verdict_danger_head,
  caution: copy.verdict_caution_head,
  safe: copy.verdict_safe_head,
} as const

/**
 * What kind of sender it was, in words a person would use.
 *
 * Deliberately not the `SenderKind` identifier: "phone_number" is a field name,
 * and D11 keeps field names off default screens.
 */
const SENDER_KIND_LABEL: Record<SenderSignal['kind'], string> = {
  dlt_header: 'A registered business sender ID',
  shortcode: 'An operator or service shortcode',
  phone_number: 'An ordinary personal mobile number',
  telemarketer: 'A registered telemarketing number',
  international: 'An international number',
  email_or_other: 'Something other than a normal Indian sender',
  unknown: '',
}

/**
 * A local reference, so the person has something to write on a form and to
 * quote back to themselves later.
 *
 * It is NOT a case number and must never be presented as one — nothing was
 * filed, and Kavach has no backend that could issue one. Date plus a
 * time-derived suffix, which is unique enough for a personal record and
 * obviously not an official identifier.
 */
function makeReference(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const day = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
  const suffix = p(now.getHours()) + p(now.getMinutes()) + p(now.getSeconds())
  return `KVC-${day}-${suffix}`
}

/**
 * The findings, as line items.
 *
 * Order is chosen to answer the questions in the order a frightened person asks
 * them: who did they say they were, what did they want, how did they push, and
 * could they even have been who they claimed.
 */
function buildRows(tactics: Tactic[], sender: SenderSignal): ReportRow[] {
  const rows: ReportRow[] = []
  const byName = (n: string) => tactics.find((t) => t.name === n)

  const authority = byName('authority')
  if (authority) {
    rows.push({ label: 'Claimed to be', value: quoteEvidence(authority) })
  }

  const extraction = byName('extraction')
  if (extraction) {
    rows.push({ label: 'Asked you for', value: quoteEvidence(extraction) })
  }

  const pressure = [byName('urgency'), byName('isolation')].filter(Boolean) as Tactic[]
  if (pressure.length > 0) {
    // The labels, not a count of them — see rule 1 in the file header.
    rows.push({ label: 'Pressure used', value: pressure.map((t) => t.label).join(', ') })
  }

  if (sender.kind !== 'unknown') {
    rows.push({ label: 'Came from', value: sender.raw })
    const kind = SENDER_KIND_LABEL[sender.kind]
    if (kind) rows.push({ label: 'Which is', value: kind })
  }

  return rows
}

/**
 * The phrases that triggered a tactic, quoted from the message itself.
 *
 * Quoting the sender's own words is what makes the receipt evidence rather than
 * an opinion — and it is the same principle as the highlighting on the Verdict
 * screen (§7). Falls back to the tactic's plain label when a phrase could not be
 * resolved, so a row never comes out empty.
 */
function quoteEvidence(tactic: Tactic): string {
  const seen = new Set<string>()
  const phrases: string[] = []

  for (const e of tactic.evidence) {
    const phrase = e.phrase.trim()
    if (phrase.length === 0) continue
    // The rules engine can match the same word twice in different cases —
    // "SBI" in the header and "sbi" inside a URL. Quoting both reads as a
    // padded list on a document meant to be taken seriously, so the first
    // spelling wins and the duplicate is dropped.
    const key = phrase.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    phrases.push(phrase)
  }

  if (phrases.length === 0) return tactic.label
  return phrases.map((p) => `“${p}”`).join(', ')
}

/**
 * Build the record.
 *
 * Returns `null` for a `safe` verdict. You do not report a legitimate message,
 * and offering to would undermine the discrimination this product is judged on
 * (D16). Callers must handle the null rather than assume a report exists.
 */
export function buildReport(input: ReportInput): Report | null {
  const { result, text, disclosure } = input
  if (result.verdict === 'safe') return null

  const now = input.now ?? new Date()

  return {
    reference: makeReference(now),
    preparedAt: now.toISOString(),
    verdict: result.verdict,
    headline: HEADLINE[result.verdict],
    rows: buildRows(result.tactics, result.senderSignal),
    // Verbatim, uncut. The portals ask what the message said, and a trimmed
    // quote is worth less to whoever reads the complaint.
    message: text,
    whatTheyWanted: result.nextMove,
    routes: routesFor(disclosure),
    urgent: disclosure === 'money' || disclosure === 'credentials',
  }
}
