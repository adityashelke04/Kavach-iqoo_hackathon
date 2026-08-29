/**
 * Does the on-device engine actually work? — SPEC.md §11 P7, §12.
 *
 * This drives `/dev/local` in a real Chrome with a real GPU, which means it
 * downloads real model weights the first time (hundreds of megabytes) and takes
 * minutes. It is NOT part of the default gate run for that reason — run it
 * deliberately, when the on-device path has changed.
 *
 * WHAT IT PROVES: that `localDetector` — prompt, JSON contract, evidence
 * resolution, verdict mapping — survives a real small model. Every contract
 * failure it reports is a case that silently falls back to rules in production
 * (§6), so a high rate means the on-device claim is decoration.
 *
 * WHAT IT DOES NOT PROVE: anything about the iQOO. A laptop GPU has a
 * `maxStorageBufferBindingSize` in the gigabytes; Chrome on Android commonly
 * caps it at 128 MiB, which is the entire reason `models.ts` picks a tier by
 * measurement (§8.1). Run the same page on the phone — that is what it is
 * built for.
 *
 * Run: npm run test:local [-- --tier low|standard|max] [--headed]
 */
import { chromium } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4186
const ORIGIN = `http://127.0.0.1:${PORT}`

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
// Smallest tier by default: this downloads real weights, and the point of the
// run is the contract, not the parameter count.
const TIER = arg('tier', 'low')
const HEADED = process.argv.includes('--headed')
// Model download plus eight generations. Generous on purpose.
const BUDGET_MS = Number(arg('budget', '1500000'))

const C = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', bold: '\x1b[1m' }
const paint = (c, s) => `${c}${s}${C.reset}`
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.log(paint(C.dim, 'building...'))
  spawnSync('npm', ['run', 'build'], { cwd: root, shell: true, stdio: 'ignore' })
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  shell: true,
  stdio: 'ignore',
})
const stopServer = () => {
  try {
    server.kill()
  } catch {}
}
process.on('exit', stopServer)

for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(ORIGIN)).ok) break
  } catch {
    /* not up yet */
  }
  await wait(250)
}

// A PERSISTENT profile, not an ephemeral one. An ephemeral context advertises a
// ~3 GB quota and then refuses the write at roughly 850 MB, so a 700 MB model
// dies partway through with "Quota exceeded" — which looks exactly like a bug in
// our code and is not one. A phone has a persistent profile; so does this.
//
// It also means the second run reads weights from cache rather than downloading
// again, which is the same property the offline demo depends on.
//
// A real GPU is the whole point, so no --disable-gpu here.
const profileDir = join(root, '.chrome-llm-profile')
const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',
  headless: !HEADED,
  viewport: { width: 412, height: 915 },
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=default'],
})
const browser = { close: () => context.close() }
const page = context.pages()[0] ?? (await context.newPage())

let rows = []
let tierUsed = null

try {
  page.on('console', (m) => {
    const t = m.text()
    if (/\[kavach\]|webllm|WebGPU|shader/i.test(t)) console.log(paint(C.dim, `  · ${t.slice(0, 160)}`))
  })

  await page.goto(`${ORIGIN}/dev/local`, { waitUntil: 'load' })

  const webgpu = await page.evaluate(async () => {
    if (!('gpu' in navigator)) return { ok: false, why: 'navigator.gpu absent' }
    try {
      const a = await navigator.gpu.requestAdapter()
      if (!a) return { ok: false, why: 'requestAdapter() returned null' }
      return { ok: true, limit: a.limits?.maxStorageBufferBindingSize ?? null }
    } catch (e) {
      return { ok: false, why: e.message }
    }
  })

  console.log(`\n${paint(C.bold, 'WebGPU')}`)
  if (!webgpu.ok) {
    console.log(
      `  ${paint(C.red, 'x')} ${webgpu.why}\n\n  ${paint(C.yellow, 'SKIPPED')} ` +
        paint(C.dim, 'no WebGPU in this browser — nothing on-device can be measured here\n'),
    )
    await browser.close()
    stopServer()
    process.exit(0)
  }
  console.log(
    `  ${paint(C.green, '/')} adapter available ` +
      paint(C.dim, `maxStorageBufferBindingSize ${Math.round((webgpu.limit ?? 0) / 1048576)} MB`),
  )

  // Pick the tier, then run.
  await page.getByRole('button', { name: TIER, exact: true }).click()
  console.log(`\n${paint(C.bold, `Running the fixture set on tier "${TIER}"`)}`)
  console.log(paint(C.dim, '  first run downloads model weights — this takes minutes\n'))

  await page.getByRole('button', { name: /Run \d+ messages on-device/ }).click()

  const started = Date.now()
  let lastCount = -1
  while (Date.now() - started < BUDGET_MS) {
    const state = await page.evaluate(() => window.__kavachLocal ?? null)
    if (state) {
      if (state.rows.length !== lastCount) {
        lastCount = state.rows.length
        const r = state.rows[state.rows.length - 1]
        if (r) {
          const good = r.error === null && r.got === r.expect
          console.log(
            `  ${good ? paint(C.green, '/') : paint(C.red, 'x')} ${r.id.padEnd(22)} ` +
              `want ${String(r.expect).padEnd(7)} got ${String(r.got ?? 'FAILED').padEnd(7)} ` +
              paint(C.dim, `${r.ms} ms  ${r.error ?? r.tactics}`),
          )
        }
      }
      if (state.done) {
        rows = state.rows
        tierUsed = state.tier
        break
      }
    }
    await wait(2000)
  }

  if (rows.length === 0) {
    console.log(`\n  ${paint(C.red, 'FAIL')} the run did not finish inside the budget\n`)
    await browser.close()
    stopServer()
    process.exit(1)
  }
} catch (err) {
  console.error(paint(C.red, `\nthrew: ${err.message}`))
  await browser.close()
  stopServer()
  process.exit(1)
}

await browser.close()
stopServer()

/* -- what the run means ---------------------------------------------------- */
const contractFails = rows.filter((r) => r.error !== null)
const falsePositives = rows.filter((r) => r.expect === 'safe' && r.got === 'danger')
const softFalsePositives = rows.filter((r) => r.expect === 'safe' && r.got === 'caution')
const missed = rows.filter((r) => r.expect === 'danger' && r.got === 'safe')
const unresolved = rows.reduce((n, r) => n + (r.unresolved ?? 0), 0)
const times = rows.filter((r) => r.error === null).map((r) => r.ms)
const median = times.sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0

console.log(`\n${paint(C.bold, `Result — tier ${tierUsed}`)}`)

let failures = 0
const ok = (label, pass, detail = '') => {
  console.log(
    `  ${pass ? paint(C.green, '/') : paint(C.red, 'x')} ${label}` +
      (detail ? ` ${paint(C.dim, detail)}` : ''),
  )
  if (!pass) failures++
}

// THE gate. §12's false-positive rule is not softened because a model is small.
ok(
  'no legitimate message called a scam',
  falsePositives.length === 0,
  falsePositives.map((r) => r.id).join(', ') || `${rows.filter((r) => r.expect === 'safe').length} legitimate messages`,
)
ok(
  'the model held the JSON contract',
  contractFails.length === 0,
  contractFails.map((r) => `${r.id}: ${r.error}`).join(' | ') || 'every response parsed',
)
ok(
  'every evidence phrase was found in the message',
  unresolved === 0,
  unresolved === 0 ? 'all highlightable' : `${unresolved} phrase(s) the model paraphrased`,
)
ok('no scam was called safe', missed.length === 0, missed.map((r) => r.id).join(', ') || 'none')

console.log(
  `  ${paint(C.dim, '·')} median ${median} ms per message` +
    (softFalsePositives.length
      ? paint(C.dim, ` · ${softFalsePositives.length} legitimate message(s) landed on caution`)
      : ''),
)

console.log(
  failures === 0
    ? `\n  ${paint(C.green, 'PASS')}  ${paint(C.dim, 'the on-device engine holds the contract and the false-positive gate')}\n`
    : `\n  ${paint(C.red, 'FAIL')}  ${failures} problem(s) in the on-device path\n`,
)
process.exit(failures === 0 ? 0 : 1)
