/**
 * Corpus regression harness — SPEC.md §12.
 *
 * Runs the deterministic rules engine over every corpus message and enforces
 * the ONE hard gate: no legitimate message may return `danger`.
 *
 * Everything else is reported as a soft target. The reasoning is in §12 — a
 * detector that flags everything red scores perfectly on scam recall and is
 * completely worthless, and a judge finds that out in one paste.
 *
 * Run: npm run test:corpus
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// Windows absolute paths must be file:// URLs for dynamic import.
const mod = (rel) => pathToFileURL(join(root, rel)).href

const { analyzeWithRules } = await import(mod('src/detector/rules.ts'))
const { classifySender } = await import(mod('src/detector/sender.ts'))
const { validateResult } = await import(mod('src/detector/validate.ts'))
const { buildSegments } = await import(mod('src/detector/evidence.ts'))

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  bold: '\x1b[1m',
}
const paint = (c, s) => `${c}${s}${C.reset}`

const corpusDir = join(root, 'corpus')
const files = readdirSync(corpusDir).filter((f) => f.endsWith('.json'))

/** @type {Array<{file:string, entry:any}>} */
const entries = []
for (const f of files) {
  const parsed = JSON.parse(readFileSync(join(corpusDir, f), 'utf8'))
  for (const entry of parsed) entries.push({ file: f, entry })
}

if (entries.length === 0) {
  console.error('No corpus entries found in /corpus. Nothing to test.')
  process.exit(1)
}

const VERDICT_COLOR = { danger: C.red, caution: C.yellow, safe: C.green }

let gateFailures = 0
let scamTotal = 0
let scamDanger = 0
let scamWarned = 0
let senderMismatches = 0
let invariantFailures = 0
const rows = []

for (const { entry } of entries) {
  const input = { text: entry.text }
  if (entry.sender) input.sender = entry.sender

  let result
  try {
    result = analyzeWithRules(input)
    validateResult(result)
  } catch (err) {
    invariantFailures++
    rows.push({
      id: entry.id,
      expect: entry.expect,
      actual: 'THREW',
      detail: String(err.message ?? err),
      bad: true,
    })
    continue
  }

  // Highlight invariant (§7): segments must reconstruct the input exactly.
  const spans = result.tactics.flatMap((t) =>
    t.evidence.map((e) => ({ start: e.start, end: e.end, tactic: t.name })),
  )
  const rebuilt = buildSegments(entry.text, spans)
    .map((s) => s.text)
    .join('')
  if (rebuilt !== entry.text) {
    invariantFailures++
    rows.push({
      id: entry.id,
      expect: entry.expect,
      actual: result.verdict,
      detail: 'HIGHLIGHT CORRUPTION — segments do not reconstruct the input',
      bad: true,
    })
    continue
  }

  // Sender classification check
  if (entry.expectSenderKind) {
    const kind = classifySender(entry.sender).kind
    if (kind !== entry.expectSenderKind) {
      senderMismatches++
      rows.push({
        id: entry.id,
        expect: entry.expect,
        actual: result.verdict,
        detail: `sender kind: expected ${entry.expectSenderKind}, got ${kind}`,
        bad: true,
      })
      continue
    }
  }

  const isLegit = entry.expect === 'safe'
  let bad = false
  let detail = result.tactics.map((t) => t.name).join(', ') || '—'

  if (isLegit) {
    // THE HARD GATE
    if (result.verdict === 'danger') {
      gateFailures++
      bad = true
      detail = `FALSE POSITIVE — legit message flagged as scam (${detail})`
    } else if (result.verdict === 'caution') {
      detail = `soft: landed in caution (${detail})`
    }
  } else {
    scamTotal++
    if (result.verdict === 'danger') scamDanger++
    if (result.verdict !== 'safe') scamWarned++
    else {
      bad = true
      detail = `MISS — scam returned safe (${detail})`
    }
  }

  rows.push({ id: entry.id, expect: entry.expect, actual: result.verdict, detail, bad })
}

// ---- report ---------------------------------------------------------------
console.log(`\n${C.bold}Kavach corpus regression${C.reset}  ${C.dim}(rules engine)${C.reset}\n`)

for (const r of rows) {
  const mark = r.bad ? paint(C.red, '✗') : paint(C.green, '✓')
  const actual = paint(VERDICT_COLOR[r.actual] ?? C.dim, (r.actual ?? '?').padEnd(8))
  console.log(
    `  ${mark} ${r.id.padEnd(16)} ${C.dim}want${C.reset} ${String(r.expect).padEnd(8)} ${C.dim}got${C.reset} ${actual} ${C.dim}${r.detail}${C.reset}`,
  )
}

const legitTotal = entries.filter((e) => e.entry.expect === 'safe').length
const recall = scamTotal ? ((scamDanger / scamTotal) * 100).toFixed(0) : '—'
const warned = scamTotal ? ((scamWarned / scamTotal) * 100).toFixed(0) : '—'

console.log(`\n${C.bold}Summary${C.reset}`)
console.log(`  corpus              ${entries.length} messages (${scamTotal} scam, ${legitTotal} legit)`)
console.log(`  scam -> danger      ${recall}%  ${C.dim}(soft target >=80%)${C.reset}`)
console.log(`  scam -> warned      ${warned}%  ${C.dim}(soft target >=95%)${C.reset}`)

const gateOk = gateFailures === 0 && invariantFailures === 0 && senderMismatches === 0
console.log(
  `\n  ${C.bold}FALSE-POSITIVE GATE${C.reset}  ${
    gateFailures === 0
      ? paint(C.green, 'PASS') + C.dim + '  no legit message flagged as danger' + C.reset
      : paint(C.red, `FAIL — ${gateFailures} legit message(s) flagged as danger`)
  }`,
)
if (invariantFailures > 0) {
  console.log(`  ${paint(C.red, `INVARIANTS       FAIL — ${invariantFailures}`)}`)
}
if (senderMismatches > 0) {
  console.log(`  ${paint(C.red, `SENDER KINDS     FAIL — ${senderMismatches}`)}`)
}
console.log('')

process.exit(gateOk ? 0 : 1)
