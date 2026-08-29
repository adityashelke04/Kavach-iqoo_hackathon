/**
 * The complaint, as plain text — SPEC.md §10.6, decision D16.
 *
 * This is the thing that actually gets pasted into a government form. It is the
 * highest-leverage twenty lines in the feature: a person who would have closed a
 * blank form will fill one in if the words are already written.
 *
 * Written for the officer who reads it, not for the user who copies it. So:
 * no product voice, no reassurance, no explanation of what Kavach is beyond one
 * honest footer line. Facts, in the order a complaint wants them.
 *
 * Every value comes from a field that was actually populated (D16). Nothing is
 * inferred, and a missing field yields no line rather than an empty one.
 */
import type { Report } from './types.ts'

/** `2026-08-30, 4:12 pm` — readable on a form, unambiguous about the day. */
function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${date}, ${time}`
}

export function toComplaintText(report: Report): string {
  const lines: string[] = []

  lines.push('COMPLAINT — SUSPECTED FRAUDULENT MESSAGE')
  lines.push('')
  lines.push(`Reference (my own record): ${report.reference}`)
  lines.push(`Prepared: ${formatWhen(report.preparedAt)}`)
  lines.push('')

  lines.push('WHAT I RECEIVED')
  lines.push('---------------')
  lines.push(report.message)
  lines.push('')

  if (report.rows.length > 0) {
    lines.push('WHY I BELIEVE IT IS FRAUDULENT')
    lines.push('------------------------------')
    for (const row of report.rows) lines.push(`${row.label}: ${row.value}`)
    lines.push('')
  }

  if (report.whatTheyWanted) {
    lines.push('WHAT THE SENDER WAS TRYING TO OBTAIN')
    lines.push('------------------------------------')
    lines.push(report.whatTheyWanted)
    lines.push('')
  }

  // The one line about the tool. It is here because an officer reading an
  // unusually well-structured complaint is entitled to know where it came from —
  // and because the claim that nothing was transmitted is worth stating to the
  // one reader most likely to wonder.
  lines.push('---')
  lines.push(
    'Prepared with Kavach, on my own phone. The message was not sent to any ' +
      'third party for this analysis, and this complaint was not submitted ' +
      'automatically — I am filing it myself.',
  )

  return lines.join('\n')
}
