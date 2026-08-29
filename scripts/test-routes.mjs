import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4173
const CDP_PORT = 9335

const CHROME = [
  process.env['CHROME_PATH'],
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
  .filter(Boolean)
  .find((p) => existsSync(p))

const server = spawn(
  'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort'],
  { cwd: root, shell: true, stdio: 'ignore' },
)

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--remote-debugging-port=${CDP_PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function testRoutes() {
  await wait(2000)
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
  const json = await res.json()
  const ws = new WebSocket(json.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))

  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const cur = ++id
      pending.set(cur, { resolve, reject })
      ws.send(JSON.stringify({ id: cur, method, params, ...(sessionId && { sessionId }) }))
    })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: 412, height: 915, deviceScaleFactor: 3, mobile: true, screenWidth: 412, screenHeight: 915 },
    sessionId,
  )

  const routes = ['/dev/probe', '/dev/engines', '/dev/llm', '/listen', '/check', '/result', '/']
  for (const r of routes) {
    console.log(`Checking route: ${r}`)
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}${r}` }, sessionId)
    await wait(800)
    const result = await send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const de = document.documentElement;
          const over = [];
          for (const el of document.querySelectorAll('body *')) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            if (rect.right > de.clientWidth + 1 || rect.left < -1) {
              over.push({ tag: el.tagName, cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '', right: Math.round(rect.right), left: Math.round(rect.left) });
            }
          }
          return JSON.stringify({
            scrollWidth: de.scrollWidth,
            clientWidth: de.clientWidth,
            over: over.slice(0, 5),
            title: document.title,
            bodyText: document.body.innerText.slice(0, 100)
          });
        })()`,
        returnByValue: true,
      },
      sessionId,
    )
    const parsed = JSON.parse(result.result.value)
    console.log(`  clientWidth: ${parsed.clientWidth}, scrollWidth: ${parsed.scrollWidth}`)
    if (parsed.scrollWidth > parsed.clientWidth) {
      console.error(`  ❌ OVERFLOW ON ${r}:`, parsed.over)
    } else {
      console.log(`  ✅ NO OVERFLOW ON ${r}`)
    }
  }

  chrome.kill()
  server.kill()
  process.exit(0)
}

testRoutes().catch((e) => {
  console.error(e)
  chrome.kill()
  server.kill()
  process.exit(1)
})
