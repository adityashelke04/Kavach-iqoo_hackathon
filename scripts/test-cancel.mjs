/**
 * Exhibition latency and cancellation — SPEC.md §8.1, §6, decision D20.
 *
 * Two failures were reported from a real session and they compound each other:
 *
 *   1. The heaviest model tier was being selected *automatically*, so a visitor
 *      tapping a sample message paid for a multi-gigabyte download and a 3B
 *      generation nobody chose.
 *   2. Nothing cancelled it. `App` passed `undefined` where `analyze()` takes an
 *      `AbortSignal`, so leaving the screen — by the on-screen arrow or by
 *      Android's back button — left the generation running on the GPU and left
 *      `busy` true, which is why coming back showed the same spinner and why
 *      the next check queued behind a dead one.
 *
 * This gate holds both closed. It runs against fake detectors rather than real
 * weights, so it belongs in a normal gate run — unlike `test:local`, which
 * downloads a model and proves a different thing.
 *
 * Run: npm run test:cancel
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const mod = (rel) => pathToFileURL(join(root, rel)).href
const src = (rel) => readFileSync(join(root, rel), 'utf8')

const { MODELS, CEILING_PROBES, DESKTOP_PROBES, pickTier } = await import(
  mod('src/detector/models.ts')
)
const { analyze, ENGINE_TIMEOUTS, LOCAL_COLD_LOAD_TIMEOUT_MS } = await import(
  mod('src/detector/orchestrator.ts')
)
const { MAX_TOKENS, GENERATION_TIMEOUT_MS } = await import(mod('src/detector/local.ts'))
const { resultFromLlm } = await import(mod('src/detector/llm.ts'))
const { classifySender } = await import(mod('src/detector/sender.ts'))
const { prebuiltAppConfig } = await import('@mlc-ai/web-llm')

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m' }
let failed = 0
const ok = (m) => console.log(`  ${C.green}✓${C.reset} ${m}`)
const bad = (m, d) => {
  failed++
  console.log(`  ${C.red}✗ ${m}${C.reset}`)
  if (d) console.log(`      ${C.dim}${d}${C.reset}`)
}
const check = (cond, m, d) => (cond ? ok(m) : bad(m, d))
const group = (n) => console.log(`\n${C.bold}${n}${C.reset}`)

const SCAM = {
  text: 'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. Update your KYC immediately at http://sbi-kyc-verify.in/update to avoid suspension.',
  sender: '+91 98765 43210',
}

console.log(`\n${C.bold}Kavach exhibition latency + cancellation (D20)${C.reset}`)

/* ------------------------------------------------------------------ */
group('The tier a device picks for itself is never the stage tier')

/**
 * The reported bug, exactly: a machine with a generous WebGPU buffer cap
 * volunteered itself for `max`. Capability is not consent — §8.1 has said
 * `standard` is the default since P7.
 */
const DEVICES = [
  ['a laptop-class GPU', { maxStorageBufferBindingSize: 4096 * 1024 * 1024, deviceMemoryGB: 32 }],
  ['a roomy 1 GiB cap', { maxStorageBufferBindingSize: 1024 * 1024 * 1024, deviceMemoryGB: 16 }],
  ['the iQOO, 128 MiB cap', { maxStorageBufferBindingSize: 128 * 1024 * 1024, deviceMemoryGB: 12 }],
  ['a mid Android', { maxStorageBufferBindingSize: 256 * 1024 * 1024, deviceMemoryGB: 8 }],
  ['nothing measurable', { maxStorageBufferBindingSize: null, deviceMemoryGB: null }],
]
for (const [name, limits] of DEVICES) {
  const tier = pickTier(limits)
  check(tier !== 'max', `${name} does not auto-select "max"`, `got "${tier}"`)
}

check(
  pickTier({ maxStorageBufferBindingSize: 256 * 1024 * 1024, deviceMemoryGB: 3 }) === 'low',
  'a device under 4 GB of RAM still falls to "low"',
)
check(
  pickTier({ maxStorageBufferBindingSize: 128 * 1024 * 1024, deviceMemoryGB: 12 }) === 'standard',
  'the Android buffer ceiling still lands on "standard"',
)

/* ------------------------------------------------------------------ */
group('Every tier is a model this build can actually load')

const prebuilt = new Set(prebuiltAppConfig.model_list.map((m) => m.model_id))
for (const tier of ['low', 'standard', 'max']) {
  const spec = MODELS[tier]
  check(prebuilt.has(spec.modelId), `${tier} → ${spec.modelId} exists in WebLLM's prebuilt list`)
  check(
    spec.modelId.includes('q4f16_1'),
    `${tier} is q4f16_1, the quantisation WebLLM ships for mobile (§8.1)`,
    spec.modelId,
  )
}

/**
 * The ceiling D7 set and D20 kept: 4B is measured as too slow and too heavy for
 * a phone demo. `max` sitting at 2.5 GB was inside that letter and outside its
 * spirit — it is the tier a visitor waits on, so it is capped by what a visitor
 * will wait for, not by what the device could survive.
 */
check(
  MODELS.max.vramMB <= 2000,
  'the "max" tier stays under 2 GB of declared VRAM (D20)',
  `${MODELS.max.label} declares ${MODELS.max.vramMB} MB`,
)
check(
  MODELS.max.vramMB > MODELS.standard.vramMB,
  '"max" is still visibly more device work than "standard" — the tier has a point',
)
check(MODELS.standard.vramMB >= MODELS.low.vramMB, 'the tiers are ordered low ≤ standard < max')

const probeIds = [...CEILING_PROBES, ...DESKTOP_PROBES].map((m) => m.modelId)
check(
  probeIds.includes('Qwen2.5-3B-Instruct-q4f16_1-MLC'),
  'the demoted 3B is kept as a probe candidate rather than deleted',
)
check(
  !probeIds.includes(MODELS.max.modelId),
  'no shipped tier is simultaneously an unproven probe',
)

/* ------------------------------------------------------------------ */
group('Generation is budgeted for someone standing there')

check(MAX_TOKENS <= 500, `max_tokens is ${MAX_TOKENS}, within §8.1's 500`, String(MAX_TOKENS))
check(
  LOCAL_COLD_LOAD_TIMEOUT_MS <= 600_000,
  'a cold on-device call has a ceiling a person could actually reach',
  `${LOCAL_COLD_LOAD_TIMEOUT_MS}ms`,
)
check(
  LOCAL_COLD_LOAD_TIMEOUT_MS > ENGINE_TIMEOUTS.local.first,
  'a cold call still gets more room than a warm one — the download is not generation',
)

/**
 * D22: the cold budget covers a several-hundred-megabyte download, and it was
 * silently bounding generation too. On the iQOO that let a check run past 300
 * seconds at ~0.3 tokens/second instead of falling back. Generation now has its
 * own clock, started when the weights are resident.
 */
check(
  GENERATION_TIMEOUT_MS < LOCAL_COLD_LOAD_TIMEOUT_MS,
  'generation is bounded far tighter than the download it used to share a budget with',
  `${GENERATION_TIMEOUT_MS}ms vs ${LOCAL_COLD_LOAD_TIMEOUT_MS}ms`,
)
check(
  GENERATION_TIMEOUT_MS <= 60_000,
  'and tightly enough that someone standing at a stand still gets an answer',
  `${GENERATION_TIMEOUT_MS}ms`,
)

/* ------------------------------------------------------------------ */
group('An analysis in flight can be abandoned')

/** A detector that never finishes on its own, and reports what it saw. */
function hangingDetector() {
  const seen = { calls: 0, aborted: 0, generated: 0 }
  return {
    seen,
    detector: {
      id: 'local',
      async isAvailable() {
        return true
      },
      detect(_input, signal) {
        seen.calls++
        return new Promise((_resolve, reject) => {
          if (signal.aborted) {
            seen.aborted++
            reject(new Error('aborted'))
            return
          }
          const timer = setTimeout(() => {
            seen.generated++
            reject(new Error('this should never be reached in a cancelled run'))
          }, 5_000)
          signal.addEventListener(
            'abort',
            () => {
              seen.aborted++
              clearTimeout(timer)
              reject(new Error('aborted'))
            },
            { once: true },
          )
        })
      },
    },
  }
}

{
  // Cancelled before the engine is even reached — a user who taps back at once.
  const { seen, detector } = hangingDetector()
  const controller = new AbortController()
  controller.abort()
  const started = Date.now()
  const result = await analyze(SCAM, 'local', controller.signal, undefined, { local: detector })
  const elapsed = Date.now() - started
  check(elapsed < 1_000, 'an already-cancelled check returns immediately', `${elapsed}ms`)
  check(seen.generated === 0, 'nothing was generated for a screen the user had left')
  check(result.engineUsed === 'rules', 'the deterministic answer stands, silently (§6 step 8)')
  check(typeof result.verdict === 'string', 'and it is a real result, not an error')
}

{
  // Cancelled mid-flight — the reported case: tap Check, then tap back.
  const { seen, detector } = hangingDetector()
  const controller = new AbortController()
  const started = Date.now()
  const pending = analyze(SCAM, 'local', controller.signal, undefined, { local: detector })
  setTimeout(() => controller.abort(), 50)
  const result = await pending
  const elapsed = Date.now() - started
  check(seen.calls === 1, 'the engine was asked exactly once')
  check(seen.aborted === 1, 'the abort reached the engine rather than stopping at the UI')
  check(elapsed < 2_000, 'and the call ended on the abort, not on its own timeout', `${elapsed}ms`)
  check(seen.generated === 0, 'the generation never completed for the abandoned run')
  check(result.engineUsed === 'rules', 'a cancelled analysis still resolves with a valid result')
}

{
  // No cancellation: the same harness must not report success by doing nothing.
  const detector = {
    id: 'local',
    async isAvailable() {
      return true
    },
    async detect(input) {
      return resultFromLlm(
        JSON.stringify({
          confidence: 0.9,
          tactics: [
            {
              name: 'urgency',
              evidence: ['will be blocked within 24 hours'],
              note: 'It sets a deadline so you act before checking.',
            },
          ],
          explanation: 'It pushes you to act fast on a link that is not the bank.',
          nextMove: 'It wants you to open the link and enter your details.',
        }),
        {
          input,
          senderSignal: classifySender(input.sender),
          engineId: 'local',
          latencyMs: 40,
        },
      )
    },
  }
  const result = await analyze(SCAM, 'local', undefined, undefined, { local: detector })
  check(
    result.engineUsed === 'local',
    'an uncancelled run still reaches the engine — the test is not passing by accident',
    result.engineUsed,
  )
}

/* ------------------------------------------------------------------ */
group('The UI wires the signal it is given')

const app = src('src/App.tsx')
check(/new AbortController\(\)/.test(app), 'App owns an AbortController for the run in flight')
check(
  !/analyze\([^)]*undefined,\s*\(p\)/s.test(app),
  'App no longer passes `undefined` where analyze() takes a signal',
)
check(
  /useEffect\([\s\S]{0,400}path === '\/check'[\s\S]{0,300}cancelRun\(\)/.test(app),
  "leaving /check cancels, via an effect on `path` so Android's back button is covered",
)

const checkScreen = src('src/screens/Check.tsx')
check(/onCancel/.test(checkScreen), 'the Check screen takes an onCancel')
check(/copy\.cta_cancel/.test(checkScreen), 'and renders a Cancel control while busy (§6, P10)')

/* ------------------------------------------------------------------ */
if (failed > 0) {
  console.log(`\n${C.red}${C.bold}${failed} check(s) failed${C.reset}\n`)
  process.exit(1)
}
console.log(`\n${C.green}${C.bold}All checks passed${C.reset}\n`)
