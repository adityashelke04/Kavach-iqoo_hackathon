/**
 * Adaptive weighting tests — SPEC.md §8.3, decision D14.
 *
 * The point of this file is not that the learning works. It is that the
 * learning **cannot break the product**. A weight a user can push around is a
 * weight a user can break, and the one thing Kavach cannot afford is to start
 * flagging real bank messages.
 *
 * The last group is the one that matters: it drives every tactic weight to the
 * far end of its clamp, in the dangerous direction, and then runs the entire
 * legitimate corpus through the engine and asserts the false-positive gate
 * still holds.
 *
 * Run: npm run test:feedback
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

// Node has no localStorage. The engine is written to treat that as "nothing
// learned", which is what keeps the corpus harness measuring shipped defaults —
// so to test the learning at all we have to provide one.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const mod = (rel) => pathToFileURL(join(root, rel)).href

const {
  recordFeedback,
  feedbackState,
  resetFeedback,
  tacticAdjustment,
  usingDefaults,
} = await import(mod('src/detector/feedback.ts'))
const { analyzeWithRules } = await import(mod('src/detector/rules.ts'))
const { classifySender } = await import(mod('src/detector/sender.ts'))

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m' }
let failed = 0
const ok = (m) => console.log(`  ${C.green}✓${C.reset} ${m}`)
const bad = (m, d) => {
  failed++
  console.log(`  ${C.red}✗ ${m}${C.reset}`)
  if (d) console.log(`      ${C.dim}${d}${C.reset}`)
}
const check = (c, m, d) => (c ? ok(m) : bad(m, d))
const group = (n) => console.log(`\n${C.bold}${n}${C.reset}`)

/** A synthetic result: recordFeedback only reads `verdict` and `tactics`. */
const resultWith = (verdict, tacticNames, withEvidence = true) => ({
  verdict,
  confidence: 0.5,
  tactics: tacticNames.map((name) => ({
    name,
    label: name,
    note: '',
    evidence: withEvidence ? [{ phrase: 'x', start: 0, end: 1 }] : [],
  })),
  senderSignal: classifySender(''),
  explanation: 'x',
  nextMove: 'x',
  engineUsed: 'rules',
  latencyMs: 1,
})

console.log(`\n${C.bold}Kavach adaptive weighting${C.reset}`)

/* ------------------------------------------------------------------ */
group('Defaults')

resetFeedback()
check(usingDefaults(), 'a fresh install has learned nothing')
check(tacticAdjustment('urgency') === 1, 'every multiplier starts at 1')

/* ------------------------------------------------------------------ */
group('Correction direction')

resetFeedback()
recordFeedback(resultWith('danger', ['urgency']), false)
check(
  tacticAdjustment('urgency') < 1,
  'rejecting a warning makes the tactics that fired less sensitive',
  `urgency = ${tacticAdjustment('urgency')}`,
)
check(tacticAdjustment('extraction') === 1, 'tactics that did not fire are untouched')

resetFeedback()
recordFeedback(resultWith('safe', ['extraction']), false)
check(
  tacticAdjustment('extraction') > 1,
  'rejecting a clean verdict makes the tactics that fired more sensitive',
  `extraction = ${tacticAdjustment('extraction')}`,
)

/* ------------------------------------------------------------------ */
group('Safety constraints')

resetFeedback()
recordFeedback(resultWith('safe', ['urgency'], false), false)
check(
  tacticAdjustment('urgency') === 1,
  'a correction with no evidence adjusts nothing — there is nothing to attribute it to',
)
check(feedbackState().unattributedMisses === 1, 'the unattributable miss is still counted')

resetFeedback()
for (let i = 0; i < 50; i++) recordFeedback(resultWith('safe', ['urgency']), false)
const high = tacticAdjustment('urgency')
check(high <= 1.25 + 1e-9, `50 corrections cannot exceed the +25% clamp (got ${high.toFixed(3)})`)

resetFeedback()
for (let i = 0; i < 50; i++) recordFeedback(resultWith('danger', ['isolation']), false)
const low = tacticAdjustment('isolation')
check(low >= 0.75 - 1e-9, `50 corrections cannot fall below the -25% clamp (got ${low.toFixed(3)})`)

// Agreement must pull weights home, or one bad afternoon is permanent.
resetFeedback()
for (let i = 0; i < 20; i++) recordFeedback(resultWith('safe', ['authority']), false)
const drifted = tacticAdjustment('authority')
for (let i = 0; i < 60; i++) recordFeedback(resultWith('danger', ['authority']), true)
const decayed = tacticAdjustment('authority')
check(
  decayed < drifted && decayed > 1 - 1e-9,
  'agreement decays a drifted weight back toward neutral without overshooting',
  `${drifted.toFixed(3)} -> ${decayed.toFixed(3)}`,
)

resetFeedback()
check(usingDefaults(), 'reset restores the shipped defaults')

/* ------------------------------------------------------------------ */
group('The false-positive gate survives worst-case feedback')

// Drive every tactic to maximum sensitivity — the direction that causes false
// positives — and then run the whole legitimate corpus through the engine.
resetFeedback()
for (const name of ['authority', 'urgency', 'isolation', 'extraction']) {
  for (let i = 0; i < 50; i++) recordFeedback(resultWith('safe', [name]), false)
}
const maxed = ['authority', 'urgency', 'isolation', 'extraction'].map((n) => tacticAdjustment(n))
check(
  maxed.every((v) => v > 1.2),
  `all four tactics pinned at maximum sensitivity (${maxed.map((v) => v.toFixed(2)).join(', ')})`,
)

const corpusDir = join(root, 'corpus')
const legit = []
for (const f of readdirSync(corpusDir).filter((f) => f.endsWith('.json'))) {
  for (const entry of JSON.parse(readFileSync(join(corpusDir, f), 'utf8'))) {
    if (entry.expect === 'safe') legit.push({ file: f, entry })
  }
}

const flagged = []
for (const { file, entry } of legit) {
  const r = analyzeWithRules({
    text: entry.text,
    ...(entry.sender ? { sender: entry.sender } : {}),
    ...(entry.channel ? { channel: entry.channel } : {}),
  })
  if (r.verdict === 'danger') flagged.push(`${file}:${entry.id ?? entry.text.slice(0, 40)}`)
}

check(
  flagged.length === 0,
  `all ${legit.length} legitimate messages stay out of danger even at maximum learned sensitivity`,
  flagged.join('\n      '),
)

resetFeedback()

/* ------------------------------------------------------------------ */
console.log(
  failed === 0
    ? `\n  ${C.green}PASS${C.reset}  feedback adapts, and cannot break the gate\n`
    : `\n  ${C.red}FAIL  ${failed} check(s)${C.reset}\n`,
)
process.exit(failed === 0 ? 0 : 1)
