/**
 * The airplane-mode beat, automated — SPEC.md §11 P8, §13 beat 4.
 *
 * WHAT THIS PROVES: that an installed Kavach, with the network genuinely cut,
 * still boots from its own cache and still returns a correct verdict.
 *
 * WHAT IT DOES NOT PROVE, and cannot: that the on-device *model* answers
 * offline. A fresh browser profile has never downloaded model weights, so the
 * orchestrator falls back to rules (D2) — which is exactly the guarantee worth
 * asserting here, and is why the run below checks the verdict rather than the
 * engine. The model-offline half of P8's exit criterion is the phone's job:
 * open the app online once so the weights land in IndexedDB, then airplane
 * mode. See the on-device checklist in §11.
 *
 * Run: npm run test:offline
 */
import { chromium } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4180
const ORIGIN = `http://127.0.0.1:${PORT}`

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const SCAM =
  'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. ' +
  'Update your KYC immediately at http://sbi-kyc-verify.in/update to avoid suspension.'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? green('/') : red('x')} ${label}${detail ? ` ${dim(detail)}` : ''}`)
  if (!ok) failures++
}

/* -- build + serve --------------------------------------------------------- */
// The service worker only exists in a production build, so this gate cannot run
// against the dev server.
if (!existsSync(join(root, 'dist', 'sw.js'))) {
  console.log(dim('building...'))
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

/* -- run ------------------------------------------------------------------- */
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'allow',
})
const page = await context.newPage()

try {
  /* 1 - the manifest is installable ---------------------------------------- */
  console.log(`\n${bold('Manifest')}`)
  const manifest = await (await fetch(`${ORIGIN}/manifest.webmanifest`)).json()
  const icons = manifest.icons ?? []

  check('icons declared', icons.length > 0, icons.map((i) => i.sizes).join(' '))
  check(
    '192px present',
    icons.some((i) => i.sizes === '192x192'),
    'Chrome will not offer to install without it',
  )
  check(
    '512px present',
    icons.some((i) => i.sizes === '512x512'),
  )
  check(
    'maskable present',
    icons.some((i) => (i.purpose ?? '').includes('maskable')),
    'otherwise Android puts the mark on a white disc',
  )
  check('display standalone', manifest.display === 'standalone')
  check('id pinned', typeof manifest.id === 'string' && manifest.id.length > 0)

  // Every declared icon must actually be served as an image. This is the check
  // that catches an SPA rewrite swallowing /icons/* and returning index.html.
  for (const icon of icons) {
    const res = await fetch(`${ORIGIN}${icon.src}`)
    const type = res.headers.get('content-type') ?? ''
    check(`${icon.src} served`, res.ok && type.startsWith('image/'), `${res.status} ${type}`)
  }

  /* 2 - the service worker takes control ----------------------------------- */
  console.log(`\n${bold('Service worker')}`)
  await page.goto(ORIGIN, { waitUntil: 'load' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  // `clientsClaim` lands on the next navigation; reload so the page is
  // genuinely being served by the worker before the network is cut.
  await page.reload({ waitUntil: 'load' })

  check('page is controlled by the worker', await page.evaluate(() => !!navigator.serviceWorker.controller))

  const precached = await page.evaluate(async () => {
    const names = await caches.keys()
    let total = 0
    for (const n of names) total += (await (await caches.open(n)).keys()).length
    return total
  })
  check('app shell precached', precached > 0, `${precached} entries`)

  /* 3a - airplane mode with the app already open ---------------------------- */
  // The order the demo actually runs in (§13 beat 4): Kavach is on screen, the
  // network goes away underneath it, and the claim on Home changes by itself.
  console.log(`\n${bold('Offline — network cut while open')}`)
  await context.setOffline(true)
  check('browser reports offline', (await page.evaluate(() => !navigator.onLine)) === true)

  await page
    .waitForFunction(() => /No signal/i.test(document.querySelector('.privacy-line__text')?.textContent ?? ''), null, { timeout: 5000 })
    .catch(() => {})
  const offlineLine = (await page.textContent('.privacy-line__text')) ?? ''
  check(
    'the privacy line switches to its offline wording',
    /No signal/i.test(offlineLine),
    offlineLine.trim(),
  )

  /* 3b - cold launch with the network already gone -------------------------- */
  // Launching the installed icon in airplane mode. Everything below here is
  // served by the worker; nothing reaches a network.
  //
  // NOT ASSERTED HERE: that the privacy line reads "No signal" on this pass.
  // CDP's network emulation keeps blocking requests across a navigation but
  // `navigator.onLine` reports true again in the fresh document, so the app
  // reads the harness as online. A phone in real airplane mode reports false,
  // which is why the switch is asserted in 3a where the signal is trustworthy.
  console.log(`\n${bold('Offline — cold launch')}`)
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.home-actions', { timeout: 15000 })
  check('Home renders with the network cut', true)

  /* 4 - a verdict still arrives -------------------------------------------- */
  await page.click('.home-actions .choice')
  await page.waitForSelector('.composer__area', { timeout: 10000 })
  await page.fill('.composer__area', SCAM)
  await page.click('.composer__submit')

  await page.waitForSelector('.verdict', { timeout: 60000 })
  const verdictClass = (await page.getAttribute('.verdict', 'class')) ?? ''
  const head = (await page.textContent('.verdict__head'))?.trim() ?? ''

  check('a verdict arrives offline', verdictClass.includes('verdict--'), head)
  check(
    'the scam is called a scam offline',
    verdictClass.includes('verdict--danger'),
    verdictClass.replace('verdict ', ''),
  )

  // §4: no number about the message, in any state, including this one.
  const body = (await page.textContent('body')) ?? ''
  check('no percentage rendered (S4)', !/\d+\s?%/.test(body))

  /* 5 - and the message is still highlighted -------------------------------- */
  const marks = await page.$$eval('mark', (els) => els.length)
  check('evidence is highlighted offline', marks > 0, `${marks} spans`)
} catch (err) {
  console.error(red(`\nthrew: ${err.message}`))
  failures++
} finally {
  await context.close()
  await browser.close()
  stopServer()
}

console.log(
  failures === 0
    ? `\n  ${green('PASS')}  ${dim('installable, and it works with the network cut')}\n`
    : `\n  ${red('FAIL')}  ${failures} check${failures === 1 ? '' : 's'}\n`,
)
process.exit(failures === 0 ? 0 : 1)
