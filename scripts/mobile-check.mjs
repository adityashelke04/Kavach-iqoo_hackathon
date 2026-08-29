/**
 * Render every screen at true Android phone metrics, assert the layout does not
 * scroll sideways, and write a PNG per screen.
 *
 * Why the DevTools protocol rather than `chrome --screenshot`: on Windows,
 * Chrome refuses to size a window below roughly 500px, so `--window-size=412`
 * silently renders at ~500 and crops the screenshot. Every "overflow" it showed
 * was the capture, not the CSS. Emulation.setDeviceMetricsOverride sets the
 * viewport directly and is what a real device reports.
 *
 * Run: node scripts/mobile-check.mjs [--width 412] [--height 915] [--light]
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shots = join(root, 'screenshots')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const has = (name) => process.argv.includes(`--${name}`)

const WIDTH = Number(arg('width', '412'))
const HEIGHT = Number(arg('height', '915'))
const LIGHT = has('light')
const PORT = 4173
const CDP_PORT = 9333

// Forward slashes on purpose: they survive every shell and heredoc on Windows.
const CHROME = [
  process.env['CHROME_PATH'],
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
  .filter(Boolean)
  .find((p) => existsSync(p))

if (!CHROME) {
  console.error('Chrome not found. Set CHROME_PATH.')
  process.exit(1)
}

const SCREENS = [
  ['1_home', '/'],
  ['2_check', '/check'],
  ['3_verdict', '/result'],
  ['4_listen', '/listen'],
]

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`

mkdirSync(shots, { recursive: true })

/* -- build + serve --------------------------------------------------------- */
if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.log('building...')
  spawnSync('npm', ['run', 'build'], { cwd: root, shell: true, stdio: 'ignore' })
}

const server = spawn(
  'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort'],
  { cwd: root, shell: true, stdio: 'ignore' },
)

/* -- launch chrome --------------------------------------------------------- */
const profile = join(root, '.chrome-cdp-profile')
rmSync(profile, { recursive: true, force: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${CDP_PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const cleanup = () => {
  try {
    chrome.kill()
  } catch {}
  try {
    server.kill()
  } catch {}
  // Chrome can still hold the profile directory open for a moment after being
  // killed; failing to delete a temp dir is not a reason to fail the check.
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
}
process.on('exit', cleanup)

/* -- connect --------------------------------------------------------------- */
async function browserWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      const json = await res.json()
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await wait(250)
  }
  throw new Error('Chrome DevTools endpoint never came up')
}

async function serverUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await wait(250)
  }
  throw new Error('preview server never came up')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      } else if (msg.method) {
        this.listeners.get(msg.method)?.forEach((fn) => fn(msg.params))
      }
    })
  }

  static async open(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    return new Cdp(ws)
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }))
    })
  }

  once(method) {
    return new Promise((resolve) => {
      const fns = this.listeners.get(method) ?? []
      const fn = (params) => {
        this.listeners.set(
          method,
          (this.listeners.get(method) ?? []).filter((f) => f !== fn),
        )
        resolve(params)
      }
      this.listeners.set(method, [...fns, fn])
    })
  }
}

await serverUp()
const cdp = await Cdp.open(await browserWsUrl())

const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await cdp.send('Target.attachToTarget', {
  targetId,
  flatten: true,
})

await cdp.send('Page.enable', {}, sessionId)
await cdp.send('Runtime.enable', {}, sessionId)

// Real phone metrics. mobile:true makes the visual viewport behave like one.
await cdp.send(
  'Emulation.setDeviceMetricsOverride',
  {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: WIDTH,
    screenHeight: HEIGHT,
  },
  sessionId,
)
await cdp.send(
  'Emulation.setEmulatedMedia',
  { features: [{ name: 'prefers-color-scheme', value: LIGHT ? 'light' : 'dark' }] },
  sessionId,
)

/* -- the actual check ------------------------------------------------------ */
const PROBE = `(() => {
  const de = document.documentElement;
  const over = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > de.clientWidth + 1 || r.left < -1) {
      over.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '',
        left: Math.round(r.left),
        right: Math.round(r.right),
      });
    }
  }
  const small = [];
  for (const el of document.querySelectorAll('button, a, input, textarea, summary')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.height < 44) small.push({ tag: el.tagName.toLowerCase(), cls: el.className || '', h: Math.round(r.height) });
  }
  return JSON.stringify({
    clientWidth: de.clientWidth,
    scrollWidth: de.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflow: over.slice(0, 12),
    smallTargets: small.slice(0, 12),
    percentText: (document.body.innerText.match(/\\d+\\s?%/g) || []).slice(0, 5),
  });
})()`

let failures = 0
const suffix = LIGHT ? '_light' : ''

console.log(`\nMobile check — ${WIDTH}x${HEIGHT}, ${LIGHT ? 'light' : 'dark'}\n`)

for (const [name, path] of SCREENS) {
  const loaded = cdp.once('Page.loadEventFired')
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${path}` }, sessionId)
  await loaded
  await wait(700)

  const { result } = await cdp.send(
    'Runtime.evaluate',
    { expression: PROBE, returnByValue: true },
    sessionId,
  )
  const probe = JSON.parse(result.value)

  const scrolls = probe.scrollWidth > probe.clientWidth
  const label = name.replace(/^\d_/, '')

  if (scrolls || probe.overflow.length) {
    failures++
    console.log(
      red(`  x ${label}`) +
        `  viewport ${probe.clientWidth}  scrollWidth ${probe.scrollWidth}`,
    )
    for (const o of probe.overflow) {
      console.log(`      overflows: <${o.tag} class="${o.cls}"> right=${o.right}`)
    }
  } else {
    console.log(green(`  ok ${label}`) + `  no horizontal scroll at ${probe.clientWidth}px`)
  }

  if (probe.smallTargets.length) {
    failures++
    for (const t of probe.smallTargets) {
      console.log(red(`      tap target ${t.h}px < 44 — <${t.tag} class="${t.cls}">`))
    }
  }

  if (probe.percentText.length) {
    failures++
    console.log(red(`      percentage rendered (\u00a74 violation): ${probe.percentText.join(', ')}`))
  }

  const shot = await cdp.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false },
    sessionId,
  )
  writeFileSync(join(shots, `mobile_${name}${suffix}.png`), Buffer.from(shot.data, 'base64'))
}

/* -- end-to-end flows: drive the real UI, not a default route -------------- */
const clickByText = (text) => `(() => {
  const el = [...document.querySelectorAll('button')].find((b) =>
    b.textContent.includes(${JSON.stringify(text)}),
  );
  if (!el) return 'missing';
  el.click();
  return 'clicked';
})()`

const FLOWS = [
  ['5_verdict_safe', 'A real bank SMS', 'Looks legitimate'],
  ['6_verdict_scam', 'A fake police message', 'This is a scam'],
]

for (const [name, example, expect] of FLOWS) {
  const loaded = cdp.once('Page.loadEventFired')
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/check` }, sessionId)
  await loaded
  await wait(500)

  for (const expr of [clickByText(example), clickByText('Check this message')]) {
    const r = await cdp.send(
      'Runtime.evaluate',
      { expression: expr, returnByValue: true },
      sessionId,
    )
    if (r.result.value === 'missing') {
      failures++
      console.log(red(`  x ${name}: could not find a control to click`))
    }
    await wait(600)
  }

  const { result } = await cdp.send(
    'Runtime.evaluate',
    { expression: 'document.body.innerText', returnByValue: true },
    sessionId,
  )
  const body = result.value ?? ''
  const label = name.replace(/^\d_/, '')

  if (body.includes(expect)) {
    console.log(green(`  ok ${label}`) + `  reached "${expect}" through the UI`)
  } else {
    failures++
    console.log(red(`  x ${label}`) + `  expected "${expect}", did not find it`)
  }

  if (/\d+\s?%/.test(body)) {
    failures++
    console.log(red('      percentage rendered (\u00a74 violation)'))
  }

  const shot = await cdp.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: false },
    sessionId,
  )
  writeFileSync(join(shots, `mobile_${name}${suffix}.png`), Buffer.from(shot.data, 'base64'))
}


console.log(
  failures === 0
    ? green('\n  PASS  every screen fits the phone\n')
    : red(`\n  FAIL  ${failures} problem(s)\n`),
)

cleanup()
process.exit(failures === 0 ? 0 : 1)
