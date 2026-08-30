/**
 * The false-positive gate, on the pipeline that actually ships — SPEC.md §12, D21.
 *
 * `test:corpus` calls `analyzeWithRules` and nothing else. §12 calls the
 * false-positive gate "the metric that actually matters", and it has been
 * measuring a component that was never wrong: the rules engine returns `safe`
 * with confidence 0.00 for a genuine SBI debit alert, and always did. What ships
 * is rules + LLM + fusion, and that path was never gated at all.
 *
 * It was reported from the phone: the Check screen's own third sample — a real
 * SBI transaction alert from the registered header `VM-SBIINB` — came back as
 * "This is a scam", with the bank's signature and its published fraud-reporting
 * number highlighted as the evidence.
 *
 * This gate runs the full orchestrator against stub engines, so it needs no
 * weights and no network. Three parts, and the third matters as much as the
 * first: it is what stops the fix being "trust the registered header", which
 * §5.5 explicitly forbids.
 *
 * Run: npm run test:falsepos
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const mod = (rel) => pathToFileURL(join(root, rel)).href
const corpus = (f) => JSON.parse(readFileSync(join(root, 'corpus', f), 'utf8'))

const { analyze } = await import(mod('src/detector/orchestrator.ts'))
const { analyzeWithRules } = await import(mod('src/detector/rules.ts'))
const { classifySender } = await import(mod('src/detector/sender.ts'))
const { resultFromLlm } = await import(mod('src/detector/llm.ts'))

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m' }
let failed = 0
const ok = (m, d) => console.log(`  ${C.green}✓${C.reset} ${m}${d ? ` ${C.dim}${d}${C.reset}` : ''}`)
const bad = (m, d) => {
  failed++
  console.log(`  ${C.red}✗ ${m}${C.reset}`)
  if (d) console.log(`      ${C.dim}${d}${C.reset}`)
}
const check = (cond, m, d) => (cond ? ok(m, cond ? d : undefined) : bad(m, d))
const group = (n) => console.log(`\n${C.bold}${n}${C.reset}`)

/** Wrap a payload object as a Detector that returns it. */
function stub(build, engineId = 'local') {
  return {
    id: engineId,
    async isAvailable() {
      return true
    },
    async detect(input) {
      const payload = build(input)
      if (!payload) throw new Error('stub declines')
      return resultFromLlm(JSON.stringify(payload), {
        input,
        senderSignal: classifySender(input.sender ?? ''),
        engineId,
        latencyMs: 10,
      })
    },
  }
}

/** Find a phrase in the text, case-insensitively, returning it verbatim. */
const find = (text, re) => text.match(re)?.[0] ?? null

console.log(`\n${C.bold}Kavach false-positive gate — full pipeline (D21)${C.reset}`)

/* ================================================================== */
group('1. The reported message, with the model that got it wrong')

const SBI_TEXT =
  'Dear Customer, Rs.2,500.00 has been debited from A/c XX8842 on 28-Aug-26 to UPI/adityaenterprises. Avl Bal Rs.18,340.20. Not you? Call 18001111109. Do not share OTP/CVV/PIN with anyone. -SBI'
const SBI = { text: SBI_TEXT, sender: 'VM-SBIINB', channel: 'text' }

/**
 * Reconstructed from the screenshot: the explanation is the model's verbatim
 * prose and the orange highlights name the evidence phrases it returned. It
 * called the bank's own signature `authority` and the bank's published
 * fraud-reporting number `extraction`.
 */
const observedModel = stub(() => ({
  confidence: 0.75,
  tactics: [
    { name: 'authority', evidence: ['SBI'], note: 'It presents itself as your bank.' },
    {
      name: 'extraction',
      evidence: ['Not you? Call 18001111109.'],
      note: 'It points you at a phone number to call.',
    },
  ],
  explanation:
    'This message looks like a potential scam because it mimics a bank transaction alert and asks the recipient to call a provided number if the transaction is not recognized. While it mentions not sharing OTP/CVV/PIN, the overall structure and the call to action are suspicious.',
  nextMove: 'It wants you to call the number in the message.',
}))

{
  const rules = analyzeWithRules(SBI)
  check(rules.verdict === 'safe', 'the deterministic engine reads it correctly, as it always did', `rules: ${rules.verdict} @ ${rules.confidence.toFixed(2)}`)

  const result = await analyze(SBI, 'local', undefined, undefined, { local: observedModel })
  check(
    result.verdict !== 'danger',
    'a real SBI debit alert is not called a scam',
    `got "${result.verdict}"`,
  )
  check(
    result.verdict === 'safe',
    'and it is not hedged into a warning either — it is an ordinary bank SMS',
    `got "${result.verdict}"`,
  )
  check(
    !result.tactics.some((t) => t.name === 'authority'),
    'the bank signing its own registered message is not "authority"',
    result.tactics.map((t) => t.name).join(', ') || '(none)',
  )
  check(
    !result.tactics.some((t) => t.name === 'extraction'),
    'a published 1800 fraud-reporting number is not "extraction"',
    result.tactics.map((t) => t.name).join(', ') || '(none)',
  )
}

/* ================================================================== */
group('2. Every legitimate message, against an over-eager model')

/**
 * A model that finds something suspicious in every message, using phrases the
 * message really contains — the failure mode a small model actually has. It
 * never invents text, because unresolvable evidence is already discarded.
 */
const overEager = stub((input) => {
  const t = input.text
  const phrase =
    find(t, /Not you\? Call \d+\.?/i) ??
    find(t, /\b1800[- ]?\d{3}[- ]?\d{3,4}\b/) ??
    find(t, /do not share[^.]*/i) ??
    find(t, /\b(OTP|UPI|A\/c|account|balance|debited|credited)\b/i) ??
    t.trim().split(/\s+/).slice(0, 4).join(' ')
  return {
    confidence: 0.78,
    tactics: [
      { name: 'authority', evidence: [phrase], note: 'It sounds official.' },
      { name: 'urgency', evidence: [phrase], note: 'It wants a response.' },
    ],
    explanation: 'This looks like it could be a scam.',
    nextMove: 'It wants you to act on the message.',
  }
})

{
  const legit = corpus('legit.json')
  let flagged = []
  for (const row of legit) {
    const input = { text: row.text, channel: 'text', ...(row.sender ? { sender: row.sender } : {}) }
    const res = await analyze(input, 'local', undefined, undefined, { local: overEager })
    if (res.verdict === 'danger') flagged.push(`${row.id} (${row.sender || 'no sender'})`)
  }
  check(
    flagged.length === 0,
    `no legitimate message reaches "danger" through the full pipeline (${legit.length} messages)`,
    flagged.join('; '),
  )
}

/* ================================================================== */
group('3. The fix must not be "trust the header" (§5.5)')

/**
 * §5.5 is explicit: a registered header "never forces `safe` and never
 * short-circuits the tactic analysis. Header spoofing and misuse of
 * legitimately registered headers both happen, and a scam message that reaches
 * the user through a real header is exactly the case where our text analysis
 * has to still work."
 *
 * So every scam below is re-sent through a registered DLT header. If a fix
 * makes these pass, the fix is wrong.
 */
const competentModel = stub((input) => {
  const t = input.text
  const phrase =
    find(t, /any ?desk|team ?viewer/i) ??
    find(t, /share[^.]{0,30}otp/i) ??
    find(t, /blocked?[^.]{0,30}/i) ??
    find(t, /\b(arrest|warrant|suspend|expire|verify|KYC)\b[^.]{0,30}/i) ??
    t.trim().split(/\s+/).slice(0, 5).join(' ')
  return {
    confidence: 0.85,
    tactics: [
      { name: 'urgency', evidence: [phrase], note: 'It pushes you to act at once.' },
      { name: 'extraction', evidence: [phrase], note: 'It wants something from you.' },
    ],
    explanation: 'This message pressures you into acting quickly.',
    nextMove: 'It wants you to act before you check.',
  }
})

{
  const scams = [...corpus('scam-en.json'), ...corpus('scam-hinglish.json')]
  let missed = []
  for (const row of scams) {
    const input = { text: row.text, channel: 'text', sender: 'VM-SBIINB' }
    const res = await analyze(input, 'local', undefined, undefined, { local: competentModel })
    if (res.verdict === 'safe') missed.push(row.id)
  }
  check(
    missed.length === 0,
    `a scam sent through a registered header is still caught (${scams.length} messages)`,
    missed.join(', '),
  )
}

{
  // And the plain case: scams with their real senders must still land.
  const scams = [...corpus('scam-en.json'), ...corpus('scam-hinglish.json')]
  let weak = []
  for (const row of scams) {
    const input = { text: row.text, channel: 'text', ...(row.sender ? { sender: row.sender } : {}) }
    const res = await analyze(input, 'local', undefined, undefined, { local: competentModel })
    if (res.verdict !== 'danger') weak.push(`${row.id}:${res.verdict}`)
  }
  check(
    weak.length === 0,
    `every scam still reaches "danger" with its real sender (${scams.length} messages)`,
    weak.join(', '),
  )
}

{
  // The LLM must still be able to catch what the term lists miss — the whole
  // reason D12/D15 put it in the path. A novel scam the rules engine scores at
  // zero must still be reachable.
  const novel = {
    text: 'Hello, this is regarding your parcel. Kindly confirm by installing the tracking helper we send you and keep this conversation between us only.',
    sender: '+91 98765 43210',
    channel: 'text',
  }
  const rules = analyzeWithRules(novel)
  const res = await analyze(novel, 'local', undefined, undefined, { local: competentModel })
  check(
    res.verdict !== 'safe',
    'a confident model can still raise a message the term lists scored low',
    `rules ${rules.confidence.toFixed(2)}/${rules.verdict} -> ${res.verdict}`,
  )
}

/* ================================================================== */
group('4. Where the line actually falls (rule 5, §4)')

{
  // The scan is silent and the model only found the *tone* suspicious. This is
  // an ordinary message between friends, and §5.5 warns that flagging these
  // "would make the app useless". Capped to caution.
  const ordinary = { text: 'Mummy I reached college safely. Will call you in the evening after class.', sender: '+91 99887 12345', channel: 'text' }
  const vague = stub((input) => ({
    confidence: 0.88,
    tactics: [
      { name: 'authority', evidence: [input.text.split(' ').slice(0, 3).join(' ')], note: 'x' },
      { name: 'urgency', evidence: [input.text.split(' ').slice(0, 3).join(' ')], note: 'y' },
    ],
    explanation: 'Something about this feels wrong.',
    nextMove: 'It wants a reply.',
  }))
  const res = await analyze(ordinary, 'local', undefined, undefined, { local: vague })
  check(
    res.verdict !== 'danger',
    'a model that only finds the tone suspicious cannot call an ordinary message a scam',
    `got "${res.verdict}"`,
  )
}

{
  // The scan is silent and the model located a concrete ask, quoted verbatim.
  // This is the novel-scam capability D12/D15 put a model in the path for, and
  // it must survive rule 5.
  const novel = {
    text: 'Namaste, main aapke society ke naye gas connection ke liye call kar raha hoon. Aapko abhi ek chhota sa registration amount bhejna hoga warna connection cancel ho jayega.',
    channel: 'text',
  }
  const found = stub(() => ({
    confidence: 0.85,
    tactics: [
      { name: 'urgency', evidence: ['warna connection cancel ho jayega'], note: 'Threatens loss.' },
      { name: 'extraction', evidence: ['registration amount bhejna hoga'], note: 'Asks for money.' },
    ],
    explanation: 'It demands a payment now and threatens to cancel your connection.',
    nextMove: 'They want a payment before you can check.',
  }))
  const res = await analyze(novel, 'local', undefined, undefined, { local: found })
  check(
    res.verdict === 'danger',
    'a novel scam the term lists miss is still called a scam when the model finds the ask',
    `got "${res.verdict}"`,
  )
}

/* ================================================================== */
if (failed > 0) {
  console.log(`\n${C.red}${C.bold}FALSE-POSITIVE GATE: ${failed} check(s) failed${C.reset}\n`)
  process.exit(1)
}
console.log(`\n${C.green}${C.bold}PASS${C.reset}  ${C.dim}no legitimate message is called a scam, and no scam escapes${C.reset}\n`)
