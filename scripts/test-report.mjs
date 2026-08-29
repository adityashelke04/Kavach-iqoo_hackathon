/**
 * The Report Handoff gate — SPEC.md §12, decision D16.
 *
 * Guards the four things most likely to go wrong on this surface, in the order
 * they would do the most damage:
 *
 * 1. A total appears. §4 forbids a number about the message, and D16 explains
 *    why a document laid out like a bill is the one place a later session will
 *    talk itself into "3 findings". That is "4 of 5 signals" wearing a hat.
 * 2. Something gets invented. A report that lists a sender the user never gave
 *    is worse than no report — it is a false statement in a government form.
 * 3. A destination stops being official, or stops being reachable-shaped.
 * 4. A `safe` verdict gets a report, which would undo the discrimination the
 *    whole product is judged on.
 *
 * Run: npm run test:report
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
// Windows absolute paths must be file:// URLs for dynamic import.
const mod = (rel) => pathToFileURL(join(root, rel)).href

const { analyzeWithRules } = await import(mod('src/detector/rules.ts'))
const { buildReport } = await import(mod('src/report/build.ts'))
const { toComplaintText } = await import(mod('src/report/text.ts'))
const { ROUTES, routesFor, urgentSteps } = await import(mod('src/report/routes.ts'))

const C = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', bold: '\x1b[1m' }
const paint = (c, s) => `${c}${s}${C.reset}`

let failures = 0
const ok = (label, pass, detail = '') => {
  console.log(
    `  ${pass ? paint(C.green, '/') : paint(C.red, 'x')} ${label}` +
      (detail ? ` ${paint(C.dim, detail)}` : ''),
  )
  if (!pass) failures++
}
const section = (name) => console.log(`\n${paint(C.bold, name)}`)

/* -- fixtures -------------------------------------------------------------- */
const SCAM =
  'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. ' +
  'Share the OTP sent to your number immediately to avoid suspension.'
const SCAM_SENDER = '+91 98765 43210'
const LEGIT = 'Your Swiggy order has been delivered. Rate your experience in the app.'

const scam = analyzeWithRules({ text: SCAM, sender: SCAM_SENDER })
const scamNoSender = analyzeWithRules({ text: SCAM })
const legit = analyzeWithRules({ text: LEGIT })

const at = new Date('2026-08-30T16:12:30')
const build = (result, text, disclosure) =>
  buildReport({ result, text, disclosure, now: at })

const report = build(scam, SCAM, 'money')
const complaint = report ? toComplaintText(report) : ''

/* -- 1 · no total (§4, D16) ------------------------------------------------ */
section('No number about the message (§4)')

// Row text only. The message itself is excluded on purpose: it is the
// scammer's own words, verbatim, and "within 24 hours" is their number, not
// ours. Quoting it is the point of the receipt.
const rowText = (report?.rows ?? []).map((r) => `${r.label}: ${r.value}`).join('\n')
const judgementText = `${rowText}\n${report?.headline ?? ''}\n${report?.whatTheyWanted ?? ''}`

ok('no percentage in the findings', !/\d+\s?%/.test(judgementText))
ok('no "N of M" count', !/\b\d+\s*(?:of|\/)\s*\d+\b/i.test(judgementText))
ok(
  'no count of tactics, signals or findings',
  !/\b\d+\s+(?:findings?|signals?|tactics?|flags?|issues?|problems?)\b/i.test(judgementText),
)
ok(
  'no rating vocabulary',
  !/\b(?:score|confidence|severity|rating|risk level|probability|likelihood)\b/i.test(
    judgementText,
  ),
)
ok(
  'confidence never reaches the report object',
  !JSON.stringify(report).toLowerCase().includes('confidence'),
)
ok(
  'the complaint text carries no rating either',
  !/\b(?:score|confidence|severity|rating|risk level)\b/i.test(
    complaint.replace(SCAM, ''),
  ),
)

/* -- 2 · nothing is invented (D16) ----------------------------------------- */
section('Nothing is invented')

const noSenderReport = build(scamNoSender, SCAM, 'nothing')
const noSenderLabels = (noSenderReport?.rows ?? []).map((r) => r.label)

ok(
  'no sender supplied means no sender row',
  !noSenderLabels.includes('Came from') && !noSenderLabels.includes('Which is'),
  noSenderLabels.join(' · ') || 'no rows',
)
ok(
  'a supplied sender is quoted exactly as typed',
  (report?.rows ?? []).some((r) => r.label === 'Came from' && r.value === SCAM_SENDER),
)
ok(
  'every row has a label and a value',
  (report?.rows ?? []).every((r) => r.label.trim().length > 0 && r.value.trim().length > 0),
)
ok(
  'the message is carried verbatim, uncut',
  report?.message === SCAM && complaint.includes(SCAM),
)
ok(
  'the same phrase is not quoted twice in different cases',
  (report?.rows ?? []).every((r) => {
    const quoted = (r.value.match(/“[^”]+”/g) ?? []).map((q) => q.toLowerCase())
    return new Set(quoted).size === quoted.length
  }),
  (report?.rows ?? []).map((r) => r.value).join(' | '),
)

ok('a reference is issued', /^KVC-\d{8}-\d{6}$/.test(report?.reference ?? ''))
ok(
  'the reference is not presented as a case number',
  /my own record/i.test(complaint) && !/case (?:number|id)/i.test(complaint),
)

/* -- 3 · the destinations hold up ------------------------------------------ */
section('Destinations')

ok('every route names the body that runs it', ROUTES.every((r) => r.operator.trim().length > 0))
ok('every route says what it is for', ROUTES.every((r) => r.purpose.trim().length > 0))
ok('every route says what to expect', ROUTES.every((r) => r.expect.trim().length > 0))
ok(
  'every route is a tel: or an https: link, nothing else',
  ROUTES.every((r) => /^tel:\d+$/.test(r.href) || /^https:\/\//.test(r.href)),
  ROUTES.map((r) => r.href).join(' '),
)
ok(
  'every web destination is a .gov.in address',
  ROUTES.filter((r) => r.action === 'web').every((r) => /^https:\/\/[^/]*\.gov\.in(\/|$)/.test(r.href)),
)
ok('route ids are unique', new Set(ROUTES.map((r) => r.id)).size === ROUTES.length)

section('Routing is total')
for (const d of ['money', 'credentials', 'nothing', 'nuisance']) {
  const routes = routesFor(d)
  ok(`"${d}" reaches a destination`, routes.length > 0, routes.map((r) => r.name).join(' → '))
}
ok(
  'money and shared credentials both lead with the phone helpline',
  routesFor('money')[0].href === 'tel:1930' && routesFor('credentials')[0].href === 'tel:1930',
)
ok(
  'a message that cost nothing is not filed as financial fraud first',
  routesFor('nothing')[0].id === 'chakshu',
  routesFor('nothing')[0].name,
)

/* -- 4 · urgency, and the safe verdict ------------------------------------- */
section('Damage control and the safe verdict')

ok('money already gone gets ordered steps', urgentSteps('money').length === 4)
ok('shared credentials get ordered steps', urgentSteps('credentials').length === 4)
ok('nothing sent gets no urgency block', urgentSteps('nothing').length === 0)
ok(
  'the steps name actions, not feelings',
  !/\b(?:stay calm|don't panic|do not panic|be careful|stay alert)\b/i.test(
    [...urgentSteps('money'), ...urgentSteps('credentials')].join(' '),
  ),
)
ok(
  'the steps say to use the number on the card, never one from the message',
  urgentSteps('money').some((s) => /printed on your card/i.test(s)),
)
ok('urgent is set for money and credentials', build(scam, SCAM, 'credentials')?.urgent === true)
ok('urgent is not set when nothing was sent', build(scam, SCAM, 'nothing')?.urgent === false)

ok(
  'a legitimate message yields no report at all',
  legit.verdict === 'safe' && build(legit, LEGIT, 'nothing') === null,
  `legit verdict: ${legit.verdict}`,
)

/* -- summary --------------------------------------------------------------- */
console.log(
  failures === 0
    ? `\n  ${paint(C.green, 'PASS')}  ${paint(C.dim, 'the report carries no total, invents nothing, and always lands somewhere official')}\n`
    : `\n  ${paint(C.red, 'FAIL')}  ${failures} check${failures === 1 ? '' : 's'}\n`,
)
process.exit(failures === 0 ? 0 : 1)
