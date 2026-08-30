/**
 * Listen mode microphone lifecycle (see the Decision Log entry on the Android
 * microphone handle).
 *
 * The bug this guards against does not reproduce on a laptop: on Android,
 * `webkitSpeechRecognition` is brokered to Google Speech Services, a separate
 * app that opens the microphone itself and cannot share it with a page that is
 * already holding a `getUserMedia` capture. What the phone shows is
 * "Chrome is currently recording audio", which looks like a permissions problem
 * and is not one.
 *
 * So we do not test on hardware — we test the contract that hardware needs:
 *
 *   1. The screen never holds a capture stream open while the recogniser runs.
 *   2. A recogniser that keeps failing backs off and stops, rather than
 *      hammering the platform several times a second forever.
 *   3. Stopping tears the session down explicitly, so no abandoned recogniser
 *      keeps the microphone or keeps writing into a cleared transcript.
 *   4. A deep analysis still in flight from the previous call cannot land on
 *      the next one.
 *
 * Both the recogniser and getUserMedia are replaced with instrumented fakes
 * installed before the app boots, so every one of these is observable.
 *
 * Run: node scripts/test-listen.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4176
const CDP_PORT = 9336

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const green = (s) => `\x1b[32m${s}\x1b[0m`
const red = (s) => `\x1b[31m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

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

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.log('building...')
  spawnSync('npm', ['run', 'build'], { cwd: root, shell: true, stdio: 'ignore' })
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  shell: true,
  stdio: 'ignore',
})

const profile = join(root, '.chrome-listen-profile')
rmSync(profile, { recursive: true, force: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
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
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
}
process.on('exit', cleanup)

/* -- CDP ------------------------------------------------------------------- */
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

async function browserWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const json = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl
    } catch {}
    await wait(250)
  }
  throw new Error('Chrome DevTools endpoint never came up')
}

async function serverUp() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return
    } catch {}
    await wait(250)
  }
  throw new Error('preview server never came up')
}

await serverUp()
const cdp = await Cdp.open(await browserWsUrl())
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
await cdp.send('Page.enable', {}, sessionId)
await cdp.send('Runtime.enable', {}, sessionId)
await cdp.send(
  'Emulation.setDeviceMetricsOverride',
  { width: 412, height: 915, deviceScaleFactor: 2, mobile: true },
  sessionId,
)

// userGesture matters: without it an AudioContext never leaves 'suspended', so
// anything awaiting resume() hangs and the screen looks broken for the wrong
// reason. A real tap carries the gesture; this makes the fake tap carry it too.
const evalIn = async (expr) => {
  const res = await cdp.send(
    'Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true },
    sessionId,
  )
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? 'evaluate threw')
  }
  return res.result.value
}

/* --------------------------------------------------------------------------
   The fakes.

   Installed via Page.addScriptToEvaluateOnNewDocument so they are in place
   before the app's first render — the real ctor is captured at mount.
   -------------------------------------------------------------------------- */
const FAKES = `
window.__mic = {
  openStreams: 0,        // capture streams held open right now
  peakConcurrent: 0,     // most ever held at once
  starts: 0,             // recogniser start() calls
  live: 0,               // recognisers currently started
  overlapped: 0,         // starts that happened while a capture was open
  aborts: 0,
  stops: 0,
  orphanEvents: 0,       // events delivered by a recogniser after teardown
  startLog: [],          // ms timestamps, to read the backoff off
  failEveryStart: false, // make every start fail like a busy microphone
};

navigator.mediaDevices = navigator.mediaDevices || {};
navigator.mediaDevices.getUserMedia = async () => {
  const track = {
    kind: 'audio',
    stop() {
      if (!this.__stopped) { this.__stopped = true; window.__mic.openStreams--; }
    },
  };
  window.__mic.openStreams++;
  window.__mic.peakConcurrent = Math.max(window.__mic.peakConcurrent, window.__mic.openStreams);
  return { getTracks: () => [track], getAudioTracks: () => [track] };
};

class FakeRecognition {
  constructor() {
    this.continuous = false; this.interimResults = false; this.lang = '';
    this.onresult = null; this.onerror = null; this.onend = null;
    this.__started = false; this.__dead = false;
    window.__mic.instances = (window.__mic.instances || []); window.__mic.instances.push(this);
  }
  start() {
    const m = window.__mic;
    m.starts++; m.startLog.push(Date.now());
    // The defect being guarded: a live capture stream when the platform
    // recogniser reaches for the microphone.
    if (m.openStreams > 0) m.overlapped++;
    this.__started = true; m.live++;
    if (m.failEveryStart) {
      setTimeout(() => {
        this.__emit('onerror', { error: 'audio-capture' });
        this.__emit('onend');
        this.__started = false; m.live--;
      }, 5);
    }
  }
  stop() { window.__mic.stops++; this.__finish(); }
  abort() { window.__mic.aborts++; this.__finish(); }
  __finish() {
    if (this.__started) { this.__started = false; window.__mic.live--; }
    this.__dead = true;
  }
  /** Deliver an event, counting it if this recogniser was already torn down. */
  __emit(name, arg) {
    const fn = this[name];
    if (!fn) return false;
    if (this.__dead) window.__mic.orphanEvents++;
    fn(arg);
    return true;
  }
  /** Speak into whichever recogniser is currently wired up. */
  static speak(text, isFinal) {
    const live = (window.__mic.instances || []).filter((r) => r.onresult);
    const rec = live[live.length - 1];
    if (!rec) return false;
    rec.__emit('onresult', {
      resultIndex: 0,
      results: { length: 1, 0: { 0: { transcript: text }, isFinal: !!isFinal, length: 1 } },
    });
    return true;
  }
}
window.SpeechRecognition = FakeRecognition;
window.webkitSpeechRecognition = FakeRecognition;
window.__FakeRecognition = FakeRecognition;
`

await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKES }, sessionId)

/* -- helpers --------------------------------------------------------------- */
const clickByText = (text) => `(() => {
  const el = [...document.querySelectorAll('button')].find(
    (b) => (b.getAttribute('aria-label') || b.innerText || '').toLowerCase().includes(${JSON.stringify(
      text.toLowerCase(),
    )})
  );
  if (!el) return false;
  el.click();
  return true;
})()`

const bodyText = `document.body.innerText`

/** Poll until the page satisfies a condition, rather than guessing a sleep. */
async function waitFor(expr, label, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evalIn(expr)) return true
    await wait(100)
  }
  throw new Error(`timed out waiting for ${label}`)
}

/**
 * Clear the full-screen interrupt if one is up.
 *
 * Stopping runs a deep analysis of the whole transcript, so a scam call can
 * raise the interrupt a second time after the live one was dismissed. That is
 * the screen behaving correctly, but it covers everything behind it — so the
 * test has to clear it deliberately instead of racing it.
 */
async function dismissInterrupt() {
  const onInterrupt = () => evalIn(`!!document.querySelector('.interrupt')`)
  if (!(await onInterrupt())) return false
  await evalIn(clickByText('keep listening'))
  await waitFor(`!document.querySelector('.interrupt')`, 'the interrupt to close')
  return true
}

async function openListen() {
  const loaded = cdp.once('Page.loadEventFired')
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/listen` }, sessionId)
  await loaded
  await wait(700)
}

let failures = 0
const check = (ok, label, detail) => {
  if (ok) {
    console.log(`  ${green('PASS')}  ${label}`)
  } else {
    failures++
    console.log(`  ${red('FAIL')}  ${label}`)
    if (detail !== undefined) console.log(dim(`        ${detail}`))
  }
}

console.log('\nListen — microphone lifecycle\n')

/* == 1. The microphone is never held by two things at once ================== */
await openListen()
await evalIn(clickByText('start listening'))
// Priming the permission grant, releasing it, and the settle wait.
await wait(900)

let m = await evalIn('JSON.stringify(window.__mic)')
m = JSON.parse(m)

check(
  m.starts > 0,
  'recognition actually starts',
  `starts=${m.starts}`,
)
check(
  m.overlapped === 0,
  'no capture stream is open when recognition starts',
  `${m.overlapped} of ${m.starts} start(s) raced an open getUserMedia stream — this is what Android reports as "Chrome is currently recording audio"`,
)
check(
  m.openStreams === 0,
  'the priming stream is released, not held for the session',
  `${m.openStreams} stream(s) still open while listening`,
)
check(
  m.peakConcurrent <= 1,
  'at most one capture stream is ever opened',
  `peak concurrent = ${m.peakConcurrent}`,
)

/* == 2. Stopping tears the session down explicitly ========================== */
await evalIn(`window.__FakeRecognition.speak('hello there', true)`)
await wait(300)
await evalIn(clickByText('stop'))
await wait(400)

m = JSON.parse(await evalIn('JSON.stringify(window.__mic)'))
check(
  m.live === 0,
  'stopping leaves no recogniser holding the microphone',
  `${m.live} recogniser(s) still live after stop`,
)
check(
  m.aborts + m.stops > 0,
  'stopping ends the recognition session explicitly',
  `abort()=${m.aborts} stop()=${m.stops} — dropping the reference alone does not release the handle`,
)

// A late result from the abandoned recogniser must not reach the screen.
const beforeOrphan = m.orphanEvents
await evalIn(`(() => {
  const dead = (window.__mic.instances || []).filter((r) => r.__dead);
  dead.forEach((r) => r.__emit('onresult', {
    resultIndex: 0,
    results: { length: 1, 0: { 0: { transcript: 'GHOSTWORD' }, isFinal: true, length: 1 } },
  }));
  return dead.length;
})()`)
await wait(250)
const ghost = await evalIn(bodyText)
check(
  !ghost.includes('GHOSTWORD'),
  'an abandoned recogniser cannot write into the transcript',
  `a torn-down session still delivered a result (orphan events before=${beforeOrphan})`,
)

/* == 3. A failing recogniser backs off and gives up ========================= */
await openListen()
await evalIn('window.__mic.failEveryStart = true')
await evalIn(clickByText('start listening'))
await wait(6000)

m = JSON.parse(await evalIn('JSON.stringify(window.__mic)'))
check(
  m.starts <= 8,
  'a persistently busy microphone is not retried in a tight loop',
  `${m.starts} start attempts in ~6s — the old 150ms restart made this unbounded, which is what repeated the Android toast`,
)

const gaps = m.startLog.slice(1).map((t, i) => t - m.startLog[i])
check(
  gaps.length === 0 || gaps[gaps.length - 1] > gaps[0],
  'the retry gap grows between attempts',
  `gaps: ${gaps.join(', ')}ms`,
)

const busyText = await evalIn(bodyText)
check(
  /microphone/i.test(busyText) && !/Listening…/.test(busyText),
  'a busy microphone is explained, not left spinning as "Listening…"',
  `screen reads: ${JSON.stringify(busyText.slice(0, 160))}`,
)

/* == 4. A stale deep analysis cannot land on the next call ================== */
await openListen()
await evalIn(clickByText('start listening'))
await wait(900)
// A scam, recognised. The live interrupt firing here is the feature working,
// so dismiss it the way a person would before the part we are actually testing.
await evalIn(
  `window.__FakeRecognition.speak('madam this is sub inspector from cyber crime branch your aadhaar number has been used in a money laundering case do not tell anyone we are recording this call', true)`,
)
await waitFor(`!!document.querySelector('.interrupt')`, 'the live scam interrupt')
check(true, 'a scam heard on the call still raises the interrupt')
await dismissInterrupt()

// Stopping kicks off a deep analysis of this scam transcript, which may raise
// the interrupt again. Clear it, then walk the route a demo actually walks:
// start again, pick the legitimate call.
check(await evalIn(clickByText('stop')), 'the call can be stopped', 'no Stop button on screen')
await waitFor(
  `!!document.querySelector('.interrupt') || !!document.body.innerText.match(/Start again/i)`,
  'the stopped screen to settle',
)
await dismissInterrupt()

await evalIn(clickByText('start again'))
await waitFor(
  `[...document.querySelectorAll('button')].some((b) => /a real delivery call/i.test(b.innerText))`,
  'the call presets',
)
const tapped = await evalIn(clickByText('a real delivery call'))
check(tapped, 'the legitimate call preset is reachable after stopping', 'preset button not found')
// Long enough for the recorded call to finish streaming and for any analysis
// still in flight from the scam call to have resolved and tried to land.
await wait(3500)

const afterSwitch = await evalIn(bodyText)
check(
  !/aadhaar|money laundering|sub inspector/i.test(afterSwitch),
  'switching to another call clears the previous transcript',
  `screen still shows the old call: ${JSON.stringify(afterSwitch.slice(0, 200))}`,
)
check(
  !/Kavach thinks this is a scam|Hang up/i.test(afterSwitch),
  'a deep analysis of the previous call cannot raise its interrupt over the next one',
  `an interrupt from the stopped call landed on the legitimate one: ${JSON.stringify(
    afterSwitch.slice(0, 200),
  )}`,
)

/* == 5. The same race, with the window held open ============================
   Case 4 walks the real journey, but on a laptop the deep analysis resolves in
   milliseconds — far too fast to catch a result landing late. The race only
   bites where the engine is slow, which is the phone. So we reproduce "slow"
   honestly: switch to the cloud engine and make its fetch take 2.5 seconds.
   The analysis of the scam call is then still in flight, for certain, while the
   legitimate call is already on screen. */
{
  const loaded = cdp.once('Page.loadEventFired')
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }, sessionId)
  await loaded
  await wait(600)

  // Slow, then fail — the orchestrator falls back to the rules engine, so a
  // real verdict still arrives, just late. That is exactly the on-device shape.
  await evalIn(`(() => {
    const real = window.fetch;
    window.fetch = (...args) =>
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow-cloud-stub')), 2500));
    window.__realFetch = real;
    return true;
  })()`)

  check(await evalIn(clickByText('cloud')), 'the cloud engine can be selected', 'no Cloud chip')
  await wait(200)
  check(
    await evalIn(clickByText('listen to a call')),
    'Listen opens without a reload, keeping that choice',
    'no Listen entry on Home',
  )
  await waitFor(clickByText('start listening'), 'the Listen screen')
  await wait(900)

  await evalIn(
    `window.__FakeRecognition.speak('madam this is sub inspector from cyber crime branch your aadhaar number has been used in a money laundering case do not tell anyone we are recording this call', true)`,
  )
  await waitFor(`!!document.querySelector('.interrupt')`, 'the live scam interrupt')
  await dismissInterrupt()

  // Stop starts a deep analysis that cannot possibly finish for 2.5s. Leave
  // immediately, the way a person moving on to the next demo does.
  await evalIn(clickByText('stop'))
  await evalIn(clickByText('start again'))
  await waitFor(
    `[...document.querySelectorAll('button')].some((b) => /a real delivery call/i.test(b.innerText))`,
    'the call presets',
  )
  await evalIn(clickByText('a real delivery call'))

  // Past the point where the stalled analysis resolves and tries to land.
  await wait(4000)

  const late = await evalIn(bodyText)
  check(
    !(await evalIn(`!!document.querySelector('.interrupt')`)),
    'a slow analysis of the previous call never raises its interrupt over the next',
    `the scam interrupt landed 2.5s late, on the legitimate call: ${JSON.stringify(
      late.slice(0, 180),
    )}`,
  )
  check(
    !/aadhaar|money laundering|sub inspector/i.test(late),
    'nothing from the previous call survives on screen',
    `screen still shows: ${JSON.stringify(late.slice(0, 180))}`,
  )
}

console.log(
  failures === 0
    ? green('\n  PASS  the microphone is handed over cleanly\n')
    : red(`\n  FAIL  ${failures} problem(s)\n`),
)

cleanup()
process.exit(failures === 0 ? 0 : 1)
