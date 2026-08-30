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
const { fuse, fuseConfidence, mergeTactics, findAuditGap, LLM_WEIGHT } = await import(
  mod('src/detector/fuse.ts')
)
const { analyze } = await import(mod('src/detector/orchestrator.ts'))
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
const asLlm = (payload, input, sender = NO_SENDER, engineId = 'cloud') =>
  resultFromLlm(llmJson(payload), {
    input,
    senderSignal: sender,
    engineId,
    latencyMs: 120,
  })

console.log(`\n${C.bold}Kavach fusion + LLM contract${C.reset}`)

/* ------------------------------------------------------------------ */
group('Confidence fusion (weighted noisy-OR, re-centred on the LLM — D15)')

const table = [
  [0.2, 0.2, 'safe'],
  [0.5, 0.5, 'danger'],
  [0.9, 0.0, 'danger'], // a confident LLM alone still reaches danger
  [0.0, 0.8, 'danger'], // rules corroborating a confident LLM still reaches danger
  [0.0, 0.0, 'safe'],
]
for (const [l, r] of table) {
  const f = fuseConfidence(r, l)
  const expected = Math.min(1, l + LLM_WEIGHT * r * (1 - l))
  check(
    Math.abs(f - expected) < 1e-9,
    `fuse(rules=${r}, llm=${l}) = ${f.toFixed(3)}`,
    `expected ${expected.toFixed(3)}`,
  )
}

check(fuseConfidence(0.2, 0.2) < 0.35, 'two weak signals stay below the caution threshold')
check(fuseConfidence(0.5, 0.5) >= 0.7, 'two moderate signals agreeing reach danger')
check(fuseConfidence(0, 0.9) >= 0.7, 'a confident LLM alone can reach danger on a novel scam rules missed')

// The invariant flips with D15: the LLM is now the base the rules engine can
// only add to, never subtract from. See SPEC.md §16 D15 point 4 for why the
// old "rules is the floor" guarantee does not survive re-centring, and why
// that is an intentional trade rather than a regression.
let monotonic = true
for (let r = 0; r <= 1.0001; r += 0.05) {
  for (let l = 0; l <= 1.0001; l += 0.05) {
    if (fuseConfidence(r, l) < l - 1e-9) monotonic = false
  }
}
check(monotonic, 'rules can never lower the LLM confidence (441 combinations)')

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
  const briefing = {
    tactics: [{ name: 'extraction', matchedPhrases: ['share the OTP'] }],
    legitimacyMarkers: [],
    assessment: 'has-concerns',
  }
  const withBriefing = buildUserPrompt({ text: 'hello', channel: 'text', senderFact: null, briefing })
  check(withBriefing.includes('share the OTP'), 'a briefed matched phrase is included verbatim')
  check(withBriefing.includes('extraction'), 'the briefed tactic name is included')
  check(
    /confirm|correct/i.test(renderBriefing(briefing)),
    'the briefing text instructs the model to read for itself, not just repeat the scan',
  )
}

{
  // D21: the briefing carries the scan's legitimacy findings too. Sending only
  // the incriminating half is what produced the reported false positive.
  const briefing = {
    tactics: [{ name: 'authority', matchedPhrases: ['SBI'] }],
    legitimacyMarkers: ['Do not share OTP', 'Avl Bal', '18001111109'],
    assessment: 'looks-legitimate',
  }
  const text = renderBriefing(briefing)
  check(text.includes('Avl Bal'), 'a matched legitimacy marker reaches the model')
  check(text.includes('18001111109'), 'so does the published helpline number')
  check(
    text.includes('looks legitimate'),
    "the scan's own conclusion is stated, so the model knows when it is disagreeing",
  )
  check(
    !renderBriefing({ tactics: [{ name: 'authority', matchedPhrases: ['SBI'] }] }).includes(
      'undefined',
    ),
    'a pre-D21 briefing shape still renders rather than throwing (§6)',
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
group('findAuditGap')

{
  const rulesT = [
    { name: 'isolation', label: 'x', note: 'n', evidence: [{ phrase: 'do not tell anyone', start: 0, end: 18 }] },
  ]
  const llmT = []
  const gap = findAuditGap(rulesT, llmT)
  check(gap !== null && gap.name === 'isolation', 'a rules tactic missing from the LLM answer is returned')
}

{
  const rulesT = [
    { name: 'urgency', label: 'x', note: 'n', evidence: [{ phrase: 'blocked within 24 hours', start: 0, end: 10 }] },
  ]
  const llmT = [
    { name: 'urgency', label: 'x', note: 'n', evidence: [{ phrase: 'blocked within 24 hours', start: 0, end: 10 }] },
  ]
  check(findAuditGap(rulesT, llmT) === null, 'no gap when both engines already agree')
}

{
  const rulesT = [
    { name: 'authority', label: 'x', note: 'n', evidence: [] }, // no evidence — never a valid gap
  ]
  check(findAuditGap(rulesT, []) === null, 'a rules tactic with no evidence is never an audit gap')
}

{
  // Priority: isolation over extraction when both are missing.
  const rulesT = [
    { name: 'extraction', label: 'x', note: 'n', evidence: [{ phrase: 'share the OTP', start: 0, end: 10 }] },
    { name: 'isolation', label: 'x', note: 'n', evidence: [{ phrase: 'do not tell anyone', start: 20, end: 38 }] },
  ]
  const gap = findAuditGap(rulesT, [])
  check(gap.name === 'isolation', 'isolation is chosen over extraction when both are missing, per §8.3 priority')
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
  const fused = fuse({ rules, llm, input: novel })
  validateResult(fused)
  check(fused.verdict === 'danger', `a novel scam rules missed is caught by fusion`, `rules said ${rules.verdict}, fused ${fused.verdict}`)
  check(
    fused.explanation === llm.explanation,
    'when rules found nothing, the LLM prose is shown rather than "nothing here pressures you"',
  )
}

{
  // D15: the numeric floor moved from rules to the LLM. What still holds is
  // the tactic union + §4 overrides — a concrete, evidenced tactic rules
  // found cannot be erased by a dismissive LLM, even though the raw fused
  // *number* can now come in under what rules alone would have scored.
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
  const fused = fuse({ rules, llm, input: scam })
  check(rules.verdict === 'danger', 'rules alone calls the KYC scam danger')
  check(
    fused.tactics.some((t) => t.name === 'urgency' || t.name === 'extraction'),
    "rules' tactics survive into the fused result even though the LLM reported none",
    JSON.stringify(fused.tactics.map((t) => t.name)),
  )
  check(
    fused.verdict !== 'safe',
    'the merged tactic evidence keeps a dismissed scam off "safe" at minimum',
    `got ${fused.verdict}`,
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
  const fused = fuse({ rules, llm, input: legit })
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
  const fused = fuse({ rules, llm, input: scam })
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
group('orchestrator — brief, decide, audit, reconsider (D15)')

/** A fake Detector that returns canned answers per call, and records every
 *  DetectionInput it was called with so the test can inspect what it saw. */
function fakeEngine(id, answers) {
  const calls = []
  let i = 0
  return {
    detector: {
      id,
      async isAvailable() {
        return true
      },
      async detect(input) {
        calls.push(input)
        const answer = answers[Math.min(i, answers.length - 1)]
        i++
        if (answer instanceof Error) throw answer
        return answer
      },
    },
    calls,
  }
}

{
  // The LLM's first answer already agrees with rules — no reconsideration call.
  const scam = { text: 'Stay on the call and share the OTP now, do not tell anyone.', channel: 'text' }
  const agree = asLlm(
    {
      confidence: 0.8,
      tactics: [
        { name: 'isolation', evidence: ['do not tell anyone'], note: 'x' },
        { name: 'extraction', evidence: ['share the OTP'], note: 'x' },
      ],
      explanation: 'It isolates you and asks for your code.',
      nextMove: 'They want the OTP.',
    },
    scam,
    NO_SENDER,
    'local',
  )
  const fake = fakeEngine('local', [agree])
  const result = await analyze(scam, 'local', undefined, undefined, { local: fake.detector })
  check(fake.calls.length === 1, 'no reconsideration call when the first answer already covers the rules findings')
  check(fake.calls[0].briefing !== undefined, 'the first call is briefed with the rules findings')
  check(result.verdict === 'danger', 'agreement on two tactics reaches danger')
}

{
  // The LLM misses isolation on its first pass, addresses it on reconsideration.
  const scam = { text: 'Stay on the call and share the OTP now, do not tell anyone.', channel: 'text' }
  const missed = asLlm(
    {
      confidence: 0.5,
      tactics: [{ name: 'extraction', evidence: ['share the OTP'], note: 'x' }],
      explanation: 'It asks for your code.',
      nextMove: 'They want the OTP.',
    },
    scam,
    NO_SENDER,
    'local',
  )
  const corrected = asLlm(
    {
      confidence: 0.85,
      tactics: [
        { name: 'extraction', evidence: ['share the OTP'], note: 'x' },
        { name: 'isolation', evidence: ['do not tell anyone'], note: 'x' },
      ],
      explanation: 'It also isolates you from checking with anyone.',
      nextMove: 'They want the OTP.',
    },
    scam,
    NO_SENDER,
    'local',
  )
  const fake = fakeEngine('local', [missed, corrected])
  const result = await analyze(scam, 'local', undefined, undefined, { local: fake.detector })
  check(fake.calls.length === 2, 'a missed tactic with real evidence triggers exactly one reconsideration call')
  check(fake.calls[1].reconsider?.missingTactic.name === 'isolation', 'the reconsideration call names the specific missed tactic')
  check(result.tactics.some((t) => t.name === 'isolation'), 'the corrected answer is reflected in the final result')
}

{
  // The LLM still disagrees after reconsidering — never a third call, and the
  // rules-found tactic still survives into the final result via the audit.
  const scam = { text: 'Stay on the call and share the OTP now, do not tell anyone.', channel: 'text' }
  const missed = asLlm(
    {
      confidence: 0.3,
      tactics: [{ name: 'extraction', evidence: ['share the OTP'], note: 'x' }],
      explanation: 'It asks for your code.',
      nextMove: 'They want the OTP.',
    },
    scam,
    NO_SENDER,
    'local',
  )
  const stillMissed = asLlm(
    {
      confidence: 0.3,
      tactics: [{ name: 'extraction', evidence: ['share the OTP'], note: 'x' }],
      explanation: 'I disagree, this still just looks like a code request.',
      nextMove: 'They want the OTP.',
    },
    scam,
    NO_SENDER,
    'local',
  )
  const fake = fakeEngine('local', [missed, stillMissed])
  const result = await analyze(scam, 'local', undefined, undefined, { local: fake.detector })
  check(fake.calls.length === 2, 'reconsideration is bounded to exactly one retry even when the model still disagrees')
  check(
    result.tactics.some((t) => t.name === 'isolation'),
    "the rules-found tactic is unioned into the final result even though the LLM never accepted it",
  )
  check(result.verdict !== 'safe', 'the merged evidence keeps the result off safe')
}

{
  // Every LLM call fails — silent rules-only fallback (D2), unchanged.
  const scam = { text: 'Stay on the call and share the OTP now, do not tell anyone.', channel: 'text' }
  const fake = fakeEngine('local', [new Error('model crashed')])
  const result = await analyze(scam, 'local', undefined, undefined, { local: fake.detector })
  check(fake.calls.length === 1, 'a failed engine is not retried as if it were a reconsideration')
  check(result.engineUsed === 'rules', 'a total engine failure falls back to the rules-only result')
  check(result.verdict === 'danger', 'the rules-only fallback still reaches the correct verdict on its own')
}

{
  // Bug instrumentation regression: a user picking "Cloud" and being shown
  // "This phone (WebGPU)" was reported live. Every real engine wires its own
  // fixed engineId (cloud.ts always passes 'cloud', local.ts always 'local'),
  // so this class of bug is structurally impossible from the engines as
  // written — but this test pins that invariant directly rather than trusting
  // the reasoning: even a misbehaving engine that answers under the wrong
  // label must be caught and logged, never silently shown as the truth.
  const scam = { text: 'Stay on the call and share the OTP now, do not tell anyone.', channel: 'text' }
  const mislabeled = asLlm(
    { confidence: 0.8, tactics: [], explanation: 'x', nextMove: 'x' },
    scam,
    NO_SENDER,
    'local', // wrong on purpose: this engine is registered under 'cloud' below
  )
  const fake = fakeEngine('cloud', [mislabeled])

  const seen = []
  const originalError = console.error
  console.error = (...args) => seen.push(args.join(' '))
  let result
  try {
    result = await analyze(scam, 'cloud', undefined, undefined, { cloud: fake.detector })
  } finally {
    console.error = originalError
  }

  check(
    seen.some((line) => line.includes('engine mismatch') && line.includes('"cloud"') && line.includes('"local"')),
    'a result labelled with the wrong engine is caught and logged, not shown silently',
  )
  check(
    result.engineUsed === 'rules',
    'the mislabeled result is discarded — the rules-only fallback is shown instead of a false device claim',
  )
}

/* ------------------------------------------------------------------ */
console.log(
  failed === 0
    ? `\n  ${C.green}PASS${C.reset}  fusion and LLM contract hold\n`
    : `\n  ${C.red}FAIL  ${failed} check(s)${C.reset}\n`,
)
process.exit(failed === 0 ? 0 : 1)
