/**
 * Render smoke test — proves the screens actually render with real detector
 * output, not just that they typecheck.
 *
 * TypeScript catches wrong props; it does not catch a component that throws at
 * render time. This bundles the app with esbuild and renders each screen to a
 * string, which exercises the real component tree against a real result.
 *
 * Run: npm run test:smoke
 */
import { build } from 'esbuild'
import { readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'kavach-smoke-'))
const entry = join(out, 'entry.tsx')
const bundle = join(out, 'bundle.mjs')

const fail = (msg) => {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`)
  process.exitCode = 1
}
const pass = (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`)

// An entry that renders every screen against real engine output.
const src = `
import { renderToString } from 'react-dom/server'
import { Home } from ${JSON.stringify(join(root, 'src/screens/Home.tsx'))}
import { Check } from ${JSON.stringify(join(root, 'src/screens/Check.tsx'))}
import { Verdict } from ${JSON.stringify(join(root, 'src/screens/Verdict.tsx'))}
import { Listen } from ${JSON.stringify(join(root, 'src/screens/Listen.tsx'))}
import { analyzeWithRules } from ${JSON.stringify(join(root, 'src/detector/rules.ts'))}
import { splitSender } from ${JSON.stringify(join(root, 'src/detector/sender.ts'))}

const noop = () => {}

export function run() {
  const results = {}

  results.home = renderToString(<Home onCheck={noop} onListen={noop} />)
  results.check = renderToString(<Check onSubmit={noop} onBack={noop} busy={false} />)
  results.listen = renderToString(<Listen onBack={noop} />)

  // Every verdict state, driven by the real engine.
  const cases = {
    danger: {
      text: 'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. Update your KYC immediately at http://sbi-kyc-verify.in/update to avoid suspension.',
      sender: '+91 98765 43210',
    },
    safe: {
      text: 'Dear Customer, Rs.2,500.00 has been debited from A/c XX8842 on 28-Aug-26. Avl Bal Rs.18,340.20. Do not share OTP/CVV/PIN with anyone. -SBI',
      sender: 'VM-SBIINB',
    },
    nosender: {
      text: 'URGENT: Your Amazon order of iPhone 15 worth Rs.79,999 has been confirmed. If you did not place this order click here to cancel: bit.ly/amzn-cancel-order',
    },
  }

  results.verdicts = {}
  for (const [name, input] of Object.entries(cases)) {
    const r = analyzeWithRules(input)
    results.verdicts[name] = {
      verdict: r.verdict,
      html: renderToString(
        <Verdict result={r} text={input.text} onAgain={noop} onBack={noop} />,
      ),
    }
  }

  results.split = splitSender('From: VM-SBIINB\\nYour account statement is ready.')
  return results
}
`
import { writeFileSync } from 'node:fs'
writeFileSync(entry, src)

await build({
  entryPoints: [entry],
  bundle: true,
  outfile: bundle,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/server'],
  logLevel: 'silent',
})

const { run } = await import(pathToFileURL(bundle).href)

let r
try {
  r = run()
} catch (err) {
  fail(`a screen threw during render: ${err.stack ?? err}`)
  rmSync(out, { recursive: true, force: true })
  process.exit(1)
}

console.log('\n\x1b[1mKavach render smoke test\x1b[0m\n')

// --- screens render at all -------------------------------------------------
for (const name of ['home', 'check', 'listen']) {
  if (typeof r[name] === 'string' && r[name].length > 100) pass(`${name} screen renders`)
  else fail(`${name} screen produced no meaningful output`)
}

// --- verdict screens, per state --------------------------------------------
const expectHead = {
  danger: 'This is a scam',
  safe: 'Looks legitimate',
  nosender: 'This is a scam',
}
for (const [name, got] of Object.entries(r.verdicts)) {
  const head = expectHead[name]
  if (!got.html.includes(head)) {
    fail(`verdict "${name}" (${got.verdict}) did not render headline "${head}"`)
  } else {
    pass(`verdict "${name}" renders as ${got.verdict}`)
  }
}

// --- the invariant that matters: the message survives highlighting ---------
const dangerHtml = r.verdicts.danger.html
if (dangerHtml.includes('<mark')) pass('evidence is highlighted in the message')
else fail('no <mark> in a danger verdict — highlighting is not rendering')

// The impersonation mismatch is the strongest card in the app; make sure it
// actually reaches the screen.
if (dangerHtml.includes('personal mobile number')) pass('sender mismatch card renders')
else fail('sender mismatch card missing from a phone-number scam')

// A safe verdict must not show tactic cards (§10.6).
if (!r.verdicts.safe.html.includes('Rushing you')) pass('safe verdict hides tactic cards')
else fail('safe verdict is showing tactic cards')

// --- no score may ever reach the UI (§4) ----------------------------------
const allHtml = Object.values(r.verdicts).map((v) => v.html).join('') + r.home + r.check
if (/\d+%/.test(allHtml)) fail('a percentage reached the UI — §4 violation')
else pass('no score or percentage in any rendered screen')

// --- the rules-only fallback never names itself or claims a specific engine
// ran (D2). All three fixtures above go through analyzeWithRules directly, so
// engineUsed is 'rules' for each — this is exactly the path that silently
// runs when a user's chosen engine (cloud or local) is unavailable, and it
// must never look like a WebGPU/on-device LLM run actually happened.
if (allHtml.includes('Deterministic engine')) {
  fail('the rules-fallback "How we checked" label names the engine (D2 violation)')
} else {
  pass('the rules-fallback label never names an engine')
}

// --- sender auto-detect ----------------------------------------------------
if (r.split.sender === 'VM-SBIINB' && !r.split.body.includes('From:')) {
  pass('sender auto-detected and lifted out of the body')
} else {
  fail(`sender auto-detect wrong: ${JSON.stringify(r.split)}`)
}

rmSync(out, { recursive: true, force: true })
console.log('')
