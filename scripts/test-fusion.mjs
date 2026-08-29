/**
 * Fusion and LLM-contract tests — SPEC.md §6 (D12), §7, §8.
 *
 * The corpus harness proves the rules engine. This proves the layer that sits
 * on top of it: that model output becomes a valid DetectionResult, that
 * garbage is rejected rather than patched up and shown to someone, and that
 * merging two engines cannot produce a verdict neither of them justified.
 *
 * Run: npm run test:fusion
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const mod = (rel) => pathToFileURL(join(root, rel)).href

const { analyzeWithRules, toBriefing } = await import(mod('src/detector/rules.ts'))
const { classifySender } = await import(mod('src/detector/sender.ts'))
const { validateResult } = await import(mod('src/detector/validate.ts'))
const { fuse, fuseConfidence, mergeTactics, LLM_WEIGHT } = await import(mod('src/detector/fuse.ts'))
const { resultFromLlm, extractJson, LlmContractError } = await import(mod('src/detector/llm.ts'))
const { buildUserPrompt, renderBriefing, renderReconsideration } = await import(
  mod('src/detector/prompt.ts')
)

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m' }
let failed = 0

const ok = (msg) => console.log(`  ${C.green}✓${C.reset} ${msg}`)
const bad = (msg, detail) => {
  failed++
  console.log(`  ${C.red}✗ ${msg}${C.reset}`)
  if (detail) console.log(`      ${C.dim}${detail}${C.reset}`)
}
const check = (cond, msg, detail) => (cond ? ok(msg) : bad(msg, detail))

const group = (name) => console.log(`\n${C.bold}${name}${C.reset}`)

const NO_SENDER = classifySender('')
const PERSONAL = classifySender('+91 98765 43210')
const REGISTERED = classifySender('VM-SBIINB')

const llmJson = (o) => JSON.stringify(o)

/** Build an LLM-side result from a payload object. */
const asLlm = (payload, input, sender = NO_SENDER) =>
  resultFromLlm(llmJson(payload), {
    input,
    senderSignal: sender,
    engineId: 'cloud',
    latencyMs: 120,
  })

console.log(`\n${C.bold}Kavach fusion + LLM contract${C.reset}`)

/* ------------------------------------------------------------------ */
group('Confidence fusion (weighted noisy-OR)')

const table = [
  [0.2, 0.2, 'safe'],
  [0.5, 0.5, 'danger'],
  [0.0, 0.9, 'danger'],
  [0.8, 0.0, 'danger'],
  [0.0, 0.0, 'safe'],
]
for (const [r, l] of table) {
  const f = fuseConfidence(r, l)
  const expected = Math.min(1, r + LLM_WEIGHT * l * (1 - r))
  check(
    Math.abs(f - expected) < 1e-9,
    `fuse(${r}, ${l}) = ${f.toFixed(3)}`,
    `expected ${expected.toFixed(3)}`,
  )
}

check(fuseConfidence(0.2, 0.2) < 0.35, 'two weak signals stay below the caution threshold')
check(fuseConfidence(0.5, 0.5) >= 0.7, 'two moderate signals agreeing reach danger')
check(fuseConfidence(0, 0.9) >= 0.7, 'a confident LLM alone can reach danger on a novel scam')

// The invariant the whole design rests on.
let monotonic = true
for (let r = 0; r <= 1.0001; r += 0.05) {
  for (let l = 0; l <= 1.0001; l += 0.05) {
    if (fuseConfidence(r, l) < r - 1e-9) monotonic = false
  }
}
check(monotonic, 'the LLM can never lower the rules confidence (441 combinations)')

/* ------------------------------------------------------------------ */
group('extractJson')

check(extractJson('{"a":1}') === '{"a":1}', 'bare object')
check(
  extractJson('```json\n{"a":1}\n```') === '{"a":1}',
  'fenced object',
  extractJson('```json\n{"a":1}\n```'),
)
check(
  extractJson('Here is the analysis:\n{"a":1}\nHope that helps!') === '{"a":1}',
  'object wrapped in prose',
)
check(extractJson('{"a":{"b":2}}') === '{"a":{"b":2}}', 'nested object')
check(
  extractJson('{"evidence":"he said }{ to me"}') === '{"evidence":"he said }{ to me"}',
  'braces inside a string do not end the object',
)
check(
  extractJson('{"q":"a \\" b }"}') === '{"q":"a \\" b }"}',
  'escaped quote inside a string',
)

let threw = false
try {
  extractJson('no json at all')
} catch (e) {
  threw = e instanceof LlmContractError
}
check(threw, 'a response with no JSON throws LlmContractError')

/* ------------------------------------------------------------------ */
group('resultFromLlm')

const SCAM = {
  text: 'Your SBI account will be blocked within 24 hours. Share the OTP to reactivate.',
  channel: 'text',
}

const base = {
  confidence: 0.8,
  tactics: [
    { name: 'urgency', evidence: ['blocked within 24 hours'], note: 'It sets a deadline.' },
  ],
  explanation: 'It pressures you with a deadline.',
  nextMove: 'They want you to act before checking.',
}

{
  const r = asLlm(base, SCAM)
  const ev = r.tactics[0].evidence[0]
  check(ev.start !== -1, 'evidence phrase resolves to character offsets')
  check(
    SCAM.text.slice(ev.start, ev.end) === 'blocked within 24 hours',
    'resolved offsets point at the right substring',
    `got "${SCAM.text.slice(ev.start, ev.end)}"`,
  )
}

{
  // Rescaling an out-of-range confidence would be guessing at a safety-critical
  // number, and it is only dangerous in one direction. See readConfidence.
  for (const value of [80, 4, -0.1]) {
    let rejected = false
    try {
      asLlm({ ...base, confidence: value }, SCAM)
    } catch (e) {
      rejected = e instanceof LlmContractError
    }
    check(rejected, `confidence ${value} is rejected rather than rescaled`)
  }
}

{
  const r = asLlm(
    {
      ...base,
      tactics: [
        ...base.tactics,
        { name: 'financial_fraud', evidence: ['blocked'], note: 'invented' },
      ],
    },
    SCAM,
  )
  check(r.tactics.length === 1, 'a tactic outside the frozen taxonomy is dropped')
}

{
  const r = asLlm(
    { ...base, tactics: [...base.tactics, { name: 'isolation', evidence: [], note: 'no proof' }] },
    SCAM,
  )
  check(
    r.tactics.every((t) => t.name !== 'isolation'),
    'a tactic with no evidence is dropped (nothing to show the user)',
  )
}

{
  const r = asLlm(
    {
      ...base,
      tactics: [
        { name: 'urgency', evidence: ['blocked within 24 hours'], note: 'a' },
        { name: 'urgency', evidence: ['Share the OTP'], note: 'b' },
      ],
    },
    SCAM,
  )
  check(r.tactics.length === 1, 'duplicate tactic names merge into one card')
  check(r.tactics[0].evidence.length === 2, 'merged card keeps both evidence phrases')
}

{
  // A phrase the model paraphrased cannot be highlighted, but must survive.
  const r = asLlm(
    { ...base, tactics: [{ name: 'urgency', evidence: ['it will be blocked soon'], note: 'x' }] },
    SCAM,
  )
  check(r.tactics[0].evidence[0].start === -1, 'a paraphrased phrase is kept but unresolved')
  check(r.tactics[0].evidence[0].phrase !== '', 'the unresolved phrase text is preserved')
}

for (const [name, payload] of [
  ['confidence missing', { ...base, confidence: undefined }],
  ['explanation empty', { ...base, explanation: '   ' }],
  ['nextMove missing', { ...base, nextMove: undefined }],
]) {
  let rejected = false
  try {
    asLlm(payload, SCAM)
  } catch (e) {
    rejected = e instanceof LlmContractError
  }
  check(rejected, `rejects: ${name}`)
}

{
  let rejected = false
  try {
    resultFromLlm('the model refused to answer', {
      input: SCAM,
      senderSignal: NO_SENDER,
      engineId: 'cloud',
      latencyMs: 1,
    })
  } catch {
    rejected = true
  }
  check(rejected, 'rejects a non-JSON response instead of inventing a verdict')
}

/* ------------------------------------------------------------------ */
group('mergeTactics')

{
  const rulesT = [
    { name: 'urgency', label: 'Rushing you', note: 'rules note', evidence: [{ phrase: 'within 24 hours', start: 10, end: 25 }] },
  ]
  const llmT = [
    { name: 'urgency', label: 'Rushing you', note: 'llm note', evidence: [{ phrase: 'within 24 hours', start: 10, end: 25 }] },
    { name: 'extraction', label: 'Getting what they came for', note: 'llm', evidence: [{ phrase: 'OTP', start: 40, end: 43 }] },
  ]
  const merged = mergeTactics(rulesT, llmT)
  check(merged.length === 2, 'union of both engines, one card per tactic')
  check(
    merged.find((t) => t.name === 'urgency').evidence.length === 1,
    'the same span found by both engines is not duplicated',
  )
  check(
    merged.find((t) => t.name === 'urgency').note === 'rules note',
    'the rules engine keeps its regression-tested copy',
  )
}

{
  const rulesT = [
    { name: 'urgency', label: 'Rushing you', note: 'n', evidence: [{ phrase: 'blocked', start: -1, end: -1 }] },
  ]
  const llmT = [
    { name: 'urgency', label: 'Rushing you', note: 'n', evidence: [{ phrase: 'blocked', start: 5, end: 12 }] },
  ]
  const merged = mergeTactics(rulesT, llmT)
  check(
    merged[0].evidence.length === 1 && merged[0].evidence[0].start === 5,
    'an unresolved span is upgraded when the other engine located it',
  )
}

/* ------------------------------------------------------------------ */
group('buildUserPrompt — briefing and reconsideration (D15)')

{
  const plain = buildUserPrompt({ text: 'hello', channel: 'text', senderFact: null })
  check(!plain.includes('keyword scan'), 'no briefing text appears when none is given')
}

{
  const briefing = { tactics: [{ name: 'extraction', matchedPhrases: ['share the OTP'] }] }
  const withBriefing = buildUserPrompt({ text: 'hello', channel: 'text', senderFact: null, briefing })
  check(withBriefing.includes('share the OTP'), 'a briefed matched phrase is included verbatim')
  check(withBriefing.includes('extraction'), 'the briefed tactic name is included')
  check(
    renderBriefing(briefing).includes('confirm, refine, or add'),
    'the briefing text instructs the model to read for itself, not just repeat the scan',
  )
}

{
  const reconsider = {
    priorExplanation: 'This looks like a routine notice.',
    missingTactic: { name: 'isolation', matchedPhrases: ['do not tell anyone'] },
  }
  const withReconsider = buildUserPrompt({
    text: 'hello',
    channel: 'text',
    senderFact: null,
    reconsider,
  })
  check(withReconsider.includes('This looks like a routine notice.'), "the prior answer's explanation is shown back to the model")
  check(withReconsider.includes('do not tell anyone'), 'the specific missed phrase is shown')
  check(
    renderReconsideration(reconsider).includes('already answered'),
    'the reconsideration text tells the model this is a second look',
  )
}

/* ------------------------------------------------------------------ */
group('toBriefing')

{
  const scam = { text: 'Stay on the call and share the OTP now, do not tell anyone.', channel: 'text' }
  const rules = analyzeWithRules(scam, NO_SENDER)
  const briefing = toBriefing(rules)
  check(briefing !== undefined, 'a message with tactics produces a briefing')
  check(
    briefing.tactics.every((t) => t.matchedPhrases.length > 0),
    'every briefed tactic carries at least one matched phrase',
  )
  check(
    briefing.tactics.some((t) => t.name === 'extraction'),
    'the extraction tactic rules found is present in the briefing',
    JSON.stringify(briefing),
  )
}

{
  const legit = { text: 'Your OTP is 4821. Do not share this OTP with anyone.', channel: 'text' }
  const rules = analyzeWithRules(legit, NO_SENDER)
  const briefing = toBriefing(rules)
  check(briefing === undefined, 'a message rules found nothing in produces no briefing at all')
}

/* ------------------------------------------------------------------ */
group('fuse — end to end')

{
  // A novel scam the term lists do not cover, which the LLM does catch.
  const novel = {
    text: 'Namaste, main aapke society ke naye gas connection ke liye call kar raha hoon. Aapko abhi ek chhota sa registration amount bhejna hoga warna connection cancel ho jayega.',
    channel: 'text',
  }
  const rules = analyzeWithRules(novel, NO_SENDER)
  const llm = asLlm(
    {
      confidence: 0.85,
      tactics: [
        { name: 'urgency', evidence: ['warna connection cancel ho jayega'], note: 'Threatens loss.' },
        { name: 'extraction', evidence: ['registration amount bhejna hoga'], note: 'Asks for money.' },
      ],
      explanation: 'It demands a payment now and threatens to cancel your connection.',
      nextMove: 'They want a payment before you can check.',
    },
    novel,
  )
  const fused = fuse({ rules, llm })
  validateResult(fused)
  check(fused.verdict === 'danger', `a novel scam rules missed is caught by fusion`, `rules said ${rules.verdict}, fused ${fused.verdict}`)
  check(
    fused.explanation === llm.explanation,
    'when rules found nothing, the LLM prose is shown rather than "nothing here pressures you"',
  )
}

{
  // The critical direction: a persuasive model must not talk down a scam.
  const scam = {
    text: 'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. Update your KYC immediately at http://sbi-kyc-verify.in/update to avoid suspension.',
    channel: 'text',
  }
  const rules = analyzeWithRules(scam, PERSONAL)
  const llm = asLlm(
    {
      confidence: 0.02,
      tactics: [],
      explanation: 'This looks like a routine bank notification.',
      nextMove: 'Nothing is being asked of you.',
    },
    scam,
    PERSONAL,
  )
  const fused = fuse({ rules, llm })
  check(rules.verdict === 'danger', 'rules alone calls the KYC scam danger')
  check(fused.verdict === 'danger', 'a confidently wrong LLM cannot downgrade it')
  check(
    fused.explanation === rules.explanation,
    'the rules explanation is kept when the LLM contributed nothing',
  )
}

{
  // The false-positive gate, at the fusion layer.
  const legit = {
    text: 'Dear Customer, Rs.2,500.00 has been debited from A/c XX8842 on 28-Aug-26. Avl Bal Rs.18,340.20. Do not share OTP/CVV/PIN with anyone. -SBI',
    channel: 'text',
  }
  const rules = analyzeWithRules(legit, REGISTERED)
  const llm = asLlm(
    {
      confidence: 0.1,
      tactics: [],
      explanation: 'This is an ordinary transaction alert.',
      nextMove: 'Nothing is being asked of you.',
    },
    legit,
    REGISTERED,
  )
  const fused = fuse({ rules, llm })
  check(fused.verdict === 'safe', 'a real bank SMS stays safe through fusion', `got ${fused.verdict}`)
  check(fused.tactics.length === 0 || fused.verdict === 'safe', 'no danger verdict on a registered-sender alert')
}

{
  // Fusion output must satisfy every §7 invariant, including that the verdict
  // agrees with decideVerdict applied to the *merged* finding set.
  const scam = { text: 'Stay on the call and share the OTP now, do not tell anyone.', channel: 'text' }
  const rules = analyzeWithRules(scam, PERSONAL)
  const llm = asLlm(
    {
      confidence: 0.7,
      tactics: [
        { name: 'isolation', evidence: ['do not tell anyone'], note: 'Keeps you alone.' },
        { name: 'extraction', evidence: ['share the OTP'], note: 'Wants your code.' },
      ],
      explanation: 'It keeps you on the call and asks for your code.',
      nextMove: 'They want the OTP.',
    },
    scam,
    PERSONAL,
  )
  const fused = fuse({ rules, llm })
  let valid = true
  try {
    validateResult(fused)
  } catch (e) {
    valid = false
    bad('fused result failed §7 validation', e.message)
  }
  if (valid) ok('fused result satisfies every §7 invariant')
  check(new Set(fused.tactics.map((t) => t.name)).size === fused.tactics.length, 'no duplicate tactic cards after merge')
}

/* ------------------------------------------------------------------ */
console.log(
  failed === 0
    ? `\n  ${C.green}PASS${C.reset}  fusion and LLM contract hold\n`
    : `\n  ${C.red}FAIL  ${failed} check(s)${C.reset}\n`,
)
process.exit(failed === 0 ? 0 : 1)
