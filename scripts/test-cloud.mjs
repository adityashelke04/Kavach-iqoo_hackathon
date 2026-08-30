/**
 * The cloud engine — SPEC.md §8.2, D21.
 *
 * `api/analyze.ts` is a hand-maintained duplicate of `src/detector/prompt.ts`.
 * Its own header says so: the serverless function cannot import from `src/`, so
 * the system prompt and the three prompt-rendering functions exist twice.
 *
 * That duplication failed exactly the way duplication fails. D21 rewrote
 * `renderBriefing` in `prompt.ts` and left the copy in `api/` untouched, so the
 * on-device engine received the corrected briefing and the cloud engine kept
 * receiving the one-sided one. Nothing caught it, because nothing compared them.
 *
 * Measured against the live model, three runs each, on a genuine SBI debit
 * alert from the registered header VM-SBIINB:
 *
 *   no briefing  -> confidence 0.10, no tactics
 *   old briefing -> confidence 0.30, THREE tactics invented
 *   new briefing -> confidence 0.05, no tactics
 *
 * Three tactics trips §4 override rule 2, which forces `danger` whatever the
 * confidence. A briefing meant to inform the model was talking it into
 * convicting a real bank message.
 *
 * Group 1 runs offline and is the one that matters day to day. Group 3 needs
 * OPENROUTER_API_KEY (from `.env`) and is skipped without it, so this stays
 * part of a normal gate run.
 *
 * Run: npm run test:cloud
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const mod = (rel) => pathToFileURL(join(root, rel)).href
const src = (rel) => readFileSync(join(root, rel), 'utf8')

const api = await import(mod('api/analyze.ts'))
const prompt = await import(mod('src/detector/prompt.ts'))
const { analyzeWithRules, toBriefing } = await import(mod('src/detector/rules.ts'))
const { classifySender } = await import(mod('src/detector/sender.ts'))
const { senderFact, resultFromLlm } = await import(mod('src/detector/llm.ts'))
const { MAX_TOKENS } = await import(mod('src/detector/local.ts'))
const { analyze } = await import(mod('src/detector/orchestrator.ts'))

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m' }
let failed = 0
const ok = (m, d) => console.log(`  ${C.green}✓${C.reset} ${m}${d ? ` ${C.dim}${d}${C.reset}` : ''}`)
const bad = (m, d) => {
  failed++
  console.log(`  ${C.red}✗ ${m}${C.reset}`)
  if (d) console.log(`      ${C.dim}${d}${C.reset}`)
}
const check = (c, m, d) => (c ? ok(m, c ? d : undefined) : bad(m, d))
const skip = (m) => console.log(`  ${C.yellow}–${C.reset} ${C.dim}${m}${C.reset}`)
const group = (n) => console.log(`\n${C.bold}${n}${C.reset}`)

console.log(`\n${C.bold}Kavach cloud engine (§8.2, D21)${C.reset}`)

/* ================================================================== */
group('1. The two copies of the prompt have not drifted')

check(
  api.SYSTEM_PROMPT === prompt.SYSTEM_PROMPT,
  'SYSTEM_PROMPT is identical in api/analyze.ts and src/detector/prompt.ts',
  api.SYSTEM_PROMPT === prompt.SYSTEM_PROMPT
    ? undefined
    : 'they differ — the cloud model is being given different instructions',
)
check(api.TACTIC_GUIDE === prompt.TACTIC_GUIDE, 'TACTIC_GUIDE is identical')
check(api.VOICE_NOTE === prompt.VOICE_NOTE, 'VOICE_NOTE is identical')

{
  const briefing = {
    tactics: [{ name: 'authority', matchedPhrases: ['SBI'] }],
    legitimacyMarkers: ['Do not share OTP', 'Avl Bal', '18001111109'],
    assessment: 'looks-legitimate',
  }
  check(
    api.renderBriefing(briefing) === prompt.renderBriefing(briefing),
    'renderBriefing produces identical text on both sides (D21)',
  )
  check(
    api.renderBriefing(briefing).includes('Avl Bal'),
    'and the cloud copy really does carry the legitimacy markers',
  )
  check(
    api.renderBriefing(briefing).includes('looks legitimate'),
    "and the scan's own conclusion",
  )
}

{
  const reconsider = {
    priorExplanation: 'It looked fine to me.',
    missingTactic: { name: 'isolation', matchedPhrases: ['do not tell anyone'] },
  }
  check(
    api.renderReconsideration(reconsider) === prompt.renderReconsideration(reconsider),
    'renderReconsideration produces identical text on both sides',
  )
}

{
  const text = 'Dear Customer, your account will be blocked. Share the OTP now.'
  for (const channel of ['text', 'voice']) {
    const ctx = {
      text,
      channel,
      senderFact: 'a personal mobile number',
      briefing: {
        tactics: [{ name: 'urgency', matchedPhrases: ['will be blocked'] }],
        legitimacyMarkers: [],
        assessment: 'has-concerns',
      },
    }
    check(
      api.buildUserPrompt(ctx) === prompt.buildUserPrompt(ctx),
      `buildUserPrompt is identical for channel "${channel}"`,
    )
  }
}

{
  // A briefing carrying only legitimacy markers is the case that stops a false
  // positive. If the endpoint drops it, the fix does not reach the cloud model.
  const markersOnly = {
    tactics: [],
    legitimacyMarkers: ['Do not share OTP', 'Avl Bal'],
    assessment: 'looks-legitimate',
  }
  const rendered = api.buildUserPrompt({
    text: 'x',
    channel: 'text',
    senderFact: null,
    briefing: markersOnly,
  })
  check(
    rendered.includes('Avl Bal'),
    'a markers-only briefing is still sent, not dropped for having no tactics',
  )
}

{
  const apiSrc = src('api/analyze.ts')
  const m = /max_tokens:\s*(\d+)/.exec(apiSrc)
  check(
    m !== null && Number(m[1]) === MAX_TOKENS,
    `the cloud call uses the same token budget as on-device (${MAX_TOKENS}, §8.1)`,
    m ? `api says ${m[1]}, local says ${MAX_TOKENS}` : 'no max_tokens found',
  )
}

/* ================================================================== */
group('2. The endpoint contract (§8.2)')

function fakeRes() {
  const out = { code: 0, body: null, headers: {} }
  const r = {
    status(c) {
      out.code = c
      return r
    },
    json(d) {
      out.body = d
    },
    setHeader(k, v) {
      out.headers[k] = v
      return r
    },
  }
  return { r, out }
}

{
  const { r, out } = fakeRes()
  await api.default({ method: 'GET' }, r)
  check(out.code === 405, 'GET is rejected with 405', String(out.code))
  check(out.headers['Allow'] === 'POST', 'and it says what is allowed')
}

// The remaining contract checks need the key check to pass first, so they only
// mean anything when a key is present.
const envPath = join(root, '.env')
let KEY = process.env.OPENROUTER_API_KEY ?? null
let MODEL = process.env.KAVACH_CLOUD_MODEL ?? null
if (!KEY && existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim()
    if (k === 'OPENROUTER_API_KEY' && v) KEY = v
    if (k === 'KAVACH_CLOUD_MODEL' && v) MODEL = v
  }
}

{
  // With no key configured the endpoint must say so plainly rather than crash.
  const saved = process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_API_KEY
  const { r, out } = fakeRes()
  await api.default({ method: 'POST', body: { text: 'hello there friend' } }, r)
  check(out.code === 503, 'a deployment with no key returns 503, not a crash', String(out.code))
  if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved
}

if (KEY) {
  process.env.OPENROUTER_API_KEY = KEY
  if (MODEL) process.env.KAVACH_CLOUD_MODEL = MODEL

  {
    const { r, out } = fakeRes()
    await api.default({ method: 'POST', body: { text: '   ' } }, r)
    check(out.code === 400, 'an empty message is rejected with 400', String(out.code))
  }
  {
    const { r, out } = fakeRes()
    await api.default({ method: 'POST', body: { text: 'x'.repeat(4001) } }, r)
    check(out.code === 413, 'an oversized message is rejected with 413', String(out.code))
  }
  {
    const { r, out } = fakeRes()
    await api.default({ method: 'POST', body: 'not json at all' }, r)
    check(out.code === 400, 'a non-JSON body is rejected with 400', String(out.code))
  }
} else {
  skip('body-validation checks need OPENROUTER_API_KEY')
}

/* ================================================================== */
group('3. Live round trip through the real model')

const SCAM = {
  text: 'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. Update your KYC immediately at http://sbi-kyc-verify.in/update to avoid suspension.',
  sender: '+91 98765 43210',
  channel: 'text',
}
const LEGIT = {
  text: 'Dear Customer, Rs.2,500.00 has been debited from A/c XX8842 on 28-Aug-26 to UPI/adityaenterprises. Avl Bal Rs.18,340.20. Not you? Call 18001111109. Do not share OTP/CVV/PIN with anyone. -SBI',
  sender: 'VM-SBIINB',
  channel: 'text',
}

/** Call the handler exactly as `cloud.ts` would, and parse as `cloud.ts` does. */
async function callCloud(input) {
  const sig = classifySender(input.sender)
  const rules = analyzeWithRules(input, sig)
  const briefing = toBriefing(rules, input)
  const { r, out } = fakeRes()
  await api.default(
    {
      method: 'POST',
      body: {
        text: input.text,
        channel: input.channel,
        ...(senderFact(sig) ? { sender: senderFact(sig) } : {}),
        ...(briefing ? { briefing } : {}),
      },
    },
    r,
  )
  if (out.code !== 200) return { httpCode: out.code, error: out.body, result: null }
  const result = resultFromLlm(out.body.content, {
    input,
    senderSignal: sig,
    engineId: 'cloud',
    latencyMs: 0,
  })
  return { httpCode: 200, error: null, result }
}

if (!KEY) {
  skip('no OPENROUTER_API_KEY — set it in .env to exercise the live model')
  skip('(groups 1 and 2 are what protect against the D21 drift; group 3 confirms the wiring)')
} else {
  {
    const { httpCode, error, result } = await callCloud(SCAM)
    check(httpCode === 200, 'the endpoint answers a scam with 200', JSON.stringify(error))
    if (result) {
      check(result.engineUsed === 'cloud', 'the result is stamped as the cloud engine')
      check(result.confidence >= 0.5, `it reads the KYC scam as a scam`, `confidence ${result.confidence.toFixed(2)}`)
      check(result.tactics.length > 0, 'with tactics to show', result.tactics.map((t) => t.name).join(', '))
      const resolved = result.tactics.flatMap((t) => t.evidence).filter((e) => e.start !== -1)
      check(resolved.length > 0, 'and evidence that resolves verbatim into the message', `${resolved.length} spans`)
    }
  }

  {
    const { httpCode, result } = await callCloud(LEGIT)
    check(httpCode === 200, 'the endpoint answers a legitimate message with 200')
    if (result) {
      check(
        result.tactics.length === 0,
        'the D21 briefing stops the model inventing tactics on a real bank alert',
        result.tactics.map((t) => `${t.name}[${t.evidence.map((e) => e.phrase).join('|')}]`).join(', '),
      )
      check(
        result.confidence < 0.35,
        'and it reads it as ordinary',
        `confidence ${result.confidence.toFixed(2)}`,
      )
    }
  }

  {
    // End to end through the orchestrator, which is what the app actually calls.
    const detector = {
      id: 'cloud',
      async isAvailable() {
        return true
      },
      async detect(input) {
        const { result } = await callCloud(input)
        if (!result) throw new Error('cloud unavailable')
        return result
      },
    }
    const scam = await analyze(SCAM, 'cloud', undefined, undefined, { cloud: detector })
    check(scam.verdict === 'danger', 'end to end: the scam lands on "This is a scam"', scam.verdict)

    const legit = await analyze(LEGIT, 'cloud', undefined, undefined, { cloud: detector })
    check(
      legit.verdict !== 'danger',
      'end to end: the real bank SMS is not called a scam',
      legit.verdict,
    )
    check(legit.verdict === 'safe', 'and it reads as "Looks legitimate"', legit.verdict)
  }
}

/* ================================================================== */
if (failed > 0) {
  console.log(`\n${C.red}${C.bold}${failed} check(s) failed${C.reset}\n`)
  process.exit(1)
}
console.log(`\n${C.green}${C.bold}PASS${C.reset}  ${C.dim}the cloud engine speaks the same prompt as the on-device one${C.reset}\n`)
