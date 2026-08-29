/**
 * "What usually happens next" gate — SPEC.md §12, decision D17.
 *
 * The prediction is the one surface in Kavach that makes a claim about the
 * future, so it carries a risk nothing else does: **a prediction that does not
 * come true discredits every other one.** These checks exist to keep that from
 * happening.
 *
 * 1. No legitimate message may ever receive a script. Handing someone a
 *    "here's how they'll defraud you" narrative about a real bank alert is a
 *    worse failure than any missed scam.
 * 2. The lines predict the sender, never instruct the reader. The moment they
 *    instruct, they have become advice competing with `nextMove` and the
 *    report's urgent steps (D16) — and unlike those, they are a guess.
 * 3. Silence beats a generic script. Coverage is reported as a soft number
 *    precisely so nobody is tempted to raise it by writing a vague catch-all.
 * 4. §4 holds here too: no number about the message.
 *
 * Run: npm run test:predict
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const mod = (rel) => pathToFileURL(join(root, rel)).href

const { analyzeWithRules } = await import(mod('src/detector/rules.ts'))
const { predictNextLines } = await import(mod('src/predict/match.ts'))
const { PLAYBOOKS } = await import(mod('src/predict/playbooks.ts'))

const C = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', bold: '\x1b[1m' }
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

/* -- load the corpus ------------------------------------------------------- */
const corpusDir = join(root, 'corpus')
const entries = []
for (const f of readdirSync(corpusDir).filter((f) => f.endsWith('.json'))) {
  const channel = f.startsWith('voice-') ? 'voice' : 'text'
  for (const e of JSON.parse(readFileSync(join(corpusDir, f), 'utf8'))) {
    entries.push({ ...e, file: f, channel })
  }
}

const predictFor = (entry) => {
  const result = analyzeWithRules({ text: entry.text, sender: entry.sender, channel: entry.channel })
  return {
    result,
    prediction: predictNextLines({
      text: entry.text,
      tactics: result.tactics,
      channel: entry.channel,
    }),
  }
}

/* -- 1 · the playbooks are well-formed ------------------------------------- */
section('The scripts are well-formed')

ok('ids are unique', new Set(PLAYBOOKS.map((p) => p.id)).size === PLAYBOOKS.length)
ok(
  'every script is exactly three steps',
  PLAYBOOKS.every((p) => Array.isArray(p.steps) && p.steps.length === 3),
)
ok(
  'every step says something',
  PLAYBOOKS.every((p) => p.steps.every((s) => s.trim().length > 20)),
)
ok(
  'every script names what the last step costs',
  PLAYBOOKS.every((p) => p.ending.trim().length > 20),
)
ok(
  'every script requires at least one tactic',
  PLAYBOOKS.every((p) => p.requiresTactics.length > 0),
)
ok(
  'every script can be corroborated',
  PLAYBOOKS.every((p) => p.supporting.length > 0),
)

section('The lines predict the sender, they do not instruct the reader')

const allSteps = PLAYBOOKS.flatMap((p) => p.steps)
// Future tense, not opening word. "Then they'll ask…", "If you pause, they'll
// say…" and "a tax will have to be paid first" are all predictions; an earlier
// version of this check demanded every line start with "They'll" and was
// measuring sentence shape rather than the property that matters.
ok(
  'every step is phrased in the future — it predicts, it does not describe',
  allSteps.every((s) => /'ll | will /.test(s)),
  allSteps.filter((s) => !/'ll | will /.test(s)).join(' | ') || 'all of them',
)
ok(
  'most steps name the sender explicitly',
  allSteps.filter((s) => /\bthey('ll|'re| will | say| ask)/i.test(s)).length >=
    Math.ceil(allSteps.length * 0.7),
)
ok(
  'no step gives the reader an instruction',
  !allSteps.some((s) => /\byou should\b|\bmake sure\b|\bplease\b|^Do not|^Call |^Hang up/i.test(s)),
)
ok(
  'no jargon reaches the reader (D11)',
  !PLAYBOOKS.some((p) =>
    /\b(playbook|script|vector|social engineering|threat|protocol|forensic|telemetry)\b/i.test(
      [...p.steps, p.ending].join(' '),
    ),
  ),
)
ok(
  'no number about the message (§4)',
  !PLAYBOOKS.some((p) =>
    /\d+\s?%|\b(?:score|confidence|severity|rating|risk level|probability)\b/i.test(
      [...p.steps, p.ending].join(' '),
    ),
  ),
)

/* -- 2 · the guard that matters -------------------------------------------- */
section('No legitimate message is ever handed a script')

const legit = entries.filter((e) => e.expect === 'safe')
const legitWithScript = legit.filter((e) => predictFor(e).prediction !== null)

ok(
  'not one legitimate message matches a script',
  legitWithScript.length === 0,
  legitWithScript.length === 0
    ? `${legit.length} legitimate messages, none matched`
    : legitWithScript.map((e) => `${e.id}→${predictFor(e).prediction.id}`).join(', '),
)

/* -- 3 · silence rather than a guess --------------------------------------- */
section('Silence when nothing fits')

ok('empty text yields nothing', predictNextLines({ text: '', tactics: [] }) === null)
ok('whitespace yields nothing', predictNextLines({ text: '   ', tactics: [] }) === null)
ok(
  'a message with no tactics yields nothing',
  predictNextLines({ text: 'Your parcel from customs is arriving today.', tactics: [] }) === null,
)
ok(
  'a marker with no corroboration yields nothing',
  predictNextLines({ text: 'I got a refund.', tactics: [{ name: 'extraction' }] }) === null,
  'a stray word must not carry a whole script',
)
ok(
  'the same input always gives the same answer',
  JSON.stringify(predictFor(entries.find((e) => e.expect === 'danger')).prediction) ===
    JSON.stringify(predictFor(entries.find((e) => e.expect === 'danger')).prediction),
)

/* -- 4 · the right script wins --------------------------------------------- */
section('The best-corroborated script wins')

const pick = (text, tactics, channel) =>
  predictNextLines({ text, tactics: tactics.map((name) => ({ name })), channel })?.id ?? null

ok(
  'a customs parcel case is not read as a generic arrest threat',
  pick(
    'Your parcel has been seized by Customs. Illegal drugs found. Case FIR/2026/88. Pay customs clearance fee to release.',
    ['authority', 'urgency', 'extraction'],
  ) === 'parcel-customs',
  String(
    pick(
      'Your parcel has been seized by Customs. Illegal drugs found. Case FIR/2026/88. Pay customs clearance fee to release.',
      ['authority', 'urgency', 'extraction'],
    ),
  ),
)
ok(
  'a remote-access ask is recognised as one',
  pick('Please install AnyDesk from Play Store and share the 9 digit code so I can fix your refund.', [
    'extraction',
  ]) === 'remote-access',
)
ok(
  'a KYC block asking for the code is recognised as one',
  pick(
    'Your SBI account will be blocked within 24 hours due to incomplete KYC. Share the OTP to verify immediately.',
    ['authority', 'urgency', 'extraction'],
  ) === 'kyc-otp',
)
ok(
  'a script requiring a tactic is refused without it',
  pick('Pay the customs clearance fee for your seized parcel.', ['extraction']) !== 'parcel-customs',
  'parcel-customs requires authority',
)

/* -- 5 · coverage, reported not enforced ----------------------------------- */
section('Coverage')

const scams = entries.filter((e) => e.expect === 'danger')
const covered = scams.filter((e) => predictFor(e).prediction !== null)
const byId = new Map()
for (const e of covered) {
  const id = predictFor(e).prediction.id
  byId.set(id, (byId.get(id) ?? 0) + 1)
}

const pct = Math.round((covered.length / scams.length) * 100)
console.log(
  `  ${paint(C.dim, '·')} ${covered.length} of ${scams.length} scam messages get a script ` +
    paint(C.dim, `(${pct}% — soft, and never to be raised with a vague catch-all)`),
)
for (const [id, n] of [...byId].sort((a, b) => b[1] - a[1])) {
  console.log(`      ${paint(C.dim, String(n).padStart(2))} ${id}`)
}
const unmatched = scams.filter((e) => predictFor(e).prediction === null)
if (unmatched.length > 0) {
  console.log(paint(C.dim, `      no script: ${unmatched.map((e) => e.id).join(', ')}`))
}

// Not a coverage target — a floor low enough that it only trips if the matcher
// has broken outright.
ok('the matcher is actually matching something', covered.length > 0)

/* -- summary --------------------------------------------------------------- */
console.log(
  failures === 0
    ? `\n  ${paint(C.green, 'PASS')}  ${paint(C.dim, 'scripts predict, never instruct, and never fire on a legitimate message')}\n`
    : `\n  ${paint(C.red, 'FAIL')}  ${failures} check${failures === 1 ? '' : 's'}\n`,
)
process.exit(failures === 0 ? 0 : 1)
