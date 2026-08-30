/**
 * Transcript ledger gate — SPEC.md §12, decision D23.
 *
 * The reported symptom was plain: a word said once printed several times, and
 * the longer the call ran the worse the paragraph got. The cause was not.
 *
 * On Android, `webkitSpeechRecognition` is brokered to Google Speech Services,
 * which streams **revisions**, not deltas: `results` is cumulative for the whole
 * session, finals are re-delivered as they are refined, and several Chrome
 * builds report `resultIndex: 0` on every event no matter what changed. Listen
 * appended "every final from `resultIndex` onward" into an append-only string,
 * so each event rewrote words already on screen.
 *
 * None of that reproduces on a laptop, and `test:listen`'s fake recogniser
 * could not express it — it only ever emitted a one-entry list at index 0. So
 * this gate models the recogniser Android actually is, and asserts the one
 * property that matters:
 *
 *   **every word spoken once appears in the transcript exactly once.**
 *
 * It is not a cosmetic property. `rules.ts` scores per occurrence and only
 * de-duplicates *overlapping* spans, so a phrase repeated by recogniser jitter
 * scores two or three times, clears the presence threshold on noise, and can
 * carry a call from `caution` to `danger`. A duplicated transcript is a
 * false-positive engine, which is the D21 failure wearing a different hat.
 *
 * Run: npm run test:transcript
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const mod = (rel) => pathToFileURL(join(root, rel)).href

const { TranscriptLedger, joinWithoutOverlap, normalise } = await import(
  mod('src/listen/transcript.ts')
)
const { analyzeWithRules } = await import(mod('src/detector/rules.ts'))

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  bold: '\x1b[1m',
}
const paint = (c, s) => `${c}${s}${C.reset}`

let failures = 0
const ok = (label, pass, detail = '') => {
  console.log(
    `  ${pass ? paint(C.green, '/') : paint(C.red, 'x')} ${label}` +
      (detail ? `\n      ${paint(C.dim, detail)}` : ''),
  )
  if (!pass) failures++
}
const section = (name) => console.log(`\n${paint(C.bold, name)}`)

const eq = (label, actual, expected) =>
  ok(label, actual === expected, actual === expected ? '' : `got:      ${actual}\n      expected: ${expected}`)

/** The word that repeats most, and how often. 1 means a clean transcript. */
function worstRepeat(text) {
  const counts = new Map()
  for (const w of normalise(text).toLowerCase().split(' ').filter(Boolean)) {
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  let word = ''
  let n = 0
  for (const [w, c] of counts) if (c > n) [word, n] = [w, c]
  return { word, n }
}

/** Build a `results` list the way Android does: cumulative, every final kept. */
const finals = (...texts) => texts.map((t) => ({ transcript: t, isFinal: true }))
const withInterim = (list, interim) => [...list, { transcript: interim, isFinal: false }]

/* ==========================================================================
   1. The join primitive
   ========================================================================== */
section('joinWithoutOverlap')

eq('joins two disjoint fragments', joinWithoutOverlap('hello sir', 'this is ravi'), 'hello sir this is ravi')
eq('drops a repeated tail', joinWithoutOverlap('hello sir this is', 'this is ravi'), 'hello sir this is ravi')
eq('drops a fully repeated fragment', joinWithoutOverlap('hello sir', 'hello sir'), 'hello sir')
eq('empty head', joinWithoutOverlap('', 'hello'), 'hello')
eq('empty tail', joinWithoutOverlap('hello', ''), 'hello')
eq('collapses whitespace', joinWithoutOverlap('hello   sir', '  this  is '), 'hello sir this is')

// The trim must never invent a word by welding two together.
eq('never welds words together', joinWithoutOverlap('please call', 'later today'), 'please call later today')

// A single-word overlap is left alone: people repeat words, and deleting one
// changes what the caller said in the text the detector goes on to score.
eq('keeps a genuinely doubled word', joinWithoutOverlap('please no', 'no i will not'), 'please no no i will not')
eq('keeps a doubled Hinglish word', joinWithoutOverlap('haan', 'haan bolo'), 'haan haan bolo')

/* ==========================================================================
   2. The Android shapes that produced the bug
   ========================================================================== */
section('Android recogniser shapes')

{
  // resultIndex 0 forever, cumulative list: the exact reported failure. The old
  // code re-appended every final on every event.
  const led = new TranscriptLedger()
  led.newSession()
  led.absorb(finals('madam this is'))
  led.absorb(finals('madam this is', 'sub inspector'))
  led.absorb(finals('madam this is', 'sub inspector', 'from cyber crime'))
  eq('cumulative list commits each result once', led.text, 'madam this is sub inspector from cyber crime')
}

{
  // The same event delivered twice — a re-fire with nothing changed.
  const led = new TranscriptLedger()
  led.newSession()
  led.absorb(finals('your account has been suspended'))
  const second = led.absorb(finals('your account has been suspended'))
  eq('a re-fired final adds nothing', led.text, 'your account has been suspended')
  ok('a re-fired final reports no change', second.changed === false)
}

{
  // A revision: the recogniser changes its mind about a result it already
  // marked final. The old words must LEAVE, which appending can never do.
  const led = new TranscriptLedger()
  led.newSession()
  led.absorb(finals('read out the o t p'))
  led.absorb(finals('read out the otp to me'))
  eq('a revised final replaces, not appends', led.text, 'read out the otp to me')
}

{
  // Interim text is rendered, never committed.
  const led = new TranscriptLedger()
  led.newSession()
  const out = led.absorb(withInterim(finals('hello sir'), 'i am calling from'))
  eq('interim is reported separately', out.interim, 'i am calling from')
  eq('interim never reaches the transcript', led.text, 'hello sir')
  led.absorb(finals('hello sir', 'i am calling from the bank'))
  eq('interim commits only once it is final', led.text, 'hello sir i am calling from the bank')
}

{
  // A restart: Android ends the session per utterance whatever `continuous`
  // says, and the new session numbers from 0 again. The words must survive and
  // the indices must not.
  const led = new TranscriptLedger()
  led.newSession()
  led.absorb(finals('this is a confidential investigation'))
  led.newSession()
  led.absorb(finals('do not tell anyone in your family'))
  eq(
    'words survive a restart, indices do not',
    led.text,
    'this is a confidential investigation do not tell anyone in your family',
  )
}

{
  // The restart seam re-recognises the tail of the previous utterance.
  const led = new TranscriptLedger()
  led.newSession()
  led.absorb(finals('stay on the line do not'))
  led.newSession()
  led.absorb(finals('do not disconnect the call'))
  eq('the restart seam does not repeat itself', led.text, 'stay on the line do not disconnect the call')
}

/* ==========================================================================
   3. A whole scam call, delivered the way the phone delivers it
   ========================================================================== */
section('A full call through a hostile recogniser')

const SPOKEN =
  'madam this is sub inspector from cyber crime branch your aadhaar number has been ' +
  'used in a money laundering case this is a confidential investigation do not tell ' +
  'anyone in your family we are recording this call stay on the line'

{
  // Every pathology at once: cumulative growth, resultIndex pinned at 0, each
  // utterance re-fired, a revision, and a restart every few utterances.
  const led = new TranscriptLedger()
  const words = SPOKEN.split(' ')
  const utterances = []
  for (let i = 0; i < words.length; i += 4) utterances.push(words.slice(i, i + 4).join(' '))

  led.newSession()
  let session = []
  for (const [n, utt] of utterances.entries()) {
    // Grow the utterance word by word, marked final each time (the revision
    // case), then re-fire the settled list (the re-delivery case).
    const parts = utt.split(' ')
    for (let k = 1; k <= parts.length; k++) {
      led.absorb(finals(...session, parts.slice(0, k).join(' ')))
    }
    led.absorb(finals(...session, utt))
    session.push(utt)

    if (n % 3 === 2) {
      led.newSession()
      session = []
    }
  }

  eq('the transcript is exactly what was said', led.text, SPOKEN)

  const worst = worstRepeat(led.text)
  const spokenWorst = worstRepeat(SPOKEN)
  ok(
    'no word appears more often than it was spoken',
    worst.n <= spokenWorst.n,
    worst.n <= spokenWorst.n ? '' : `"${worst.word}" x${worst.n}, spoken x${spokenWorst.n}`,
  )
}

/* ==========================================================================
   4. Why it is not cosmetic: duplication moves the verdict
   ========================================================================== */
section('Duplication is a detection bug, not a display bug')

/**
 * These two lines are not rhetoric. Said once they are ordinary; repeated by a
 * recogniser that is only stuttering, they cross a verdict boundary — because
 * `rules.ts` adds `m.w` per occurrence and `dedupe()` drops only *overlapping*
 * spans, never a phrase repeated further along.
 */
const DRIFTERS = [
  { text: 'madam there is a case against your aadhaar number', repeats: 3 },
  { text: 'your account has been suspended please listen carefully', repeats: 2 },
]

for (const { text, repeats } of DRIFTERS) {
  const clean = await analyzeWithRules({ text, channel: 'voice' })
  const dirty = await analyzeWithRules({
    text: Array(repeats).fill(text).join(' '),
    channel: 'voice',
  })

  ok(
    `repetition alone moves the verdict — ${JSON.stringify(text.slice(0, 34) + '…')}`,
    dirty.verdict !== clean.verdict,
    `said once: ${clean.verdict} · said ${repeats}x by a stuttering recogniser: ${dirty.verdict}` +
      '\n      this is the whole reason the ledger exists — the detector reads what the ledger writes',
  )

  // The ledger is what stands between the two. Feed it the pathological event
  // stream and it must hand the detector the sentence as spoken.
  const led = new TranscriptLedger()
  led.newSession()
  for (let i = 0; i < repeats; i++) {
    led.absorb(finals(text)) // the same final, re-delivered, exactly as Android does
  }
  eq(`  and the ledger holds the line`, led.text, text)
  const viaLedger = await analyzeWithRules({ text: led.text, channel: 'voice' })
  eq(`  so the verdict is the honest one`, viaLedger.verdict, clean.verdict)
}

{
  // The same, for a whole call: streamed through cumulative finals, the ledger
  // must reproduce the spoken text and leave the verdict where it belongs.
  const clean = await analyzeWithRules({ text: SPOKEN, channel: 'voice' })
  const led = new TranscriptLedger()
  led.newSession()
  const words = SPOKEN.split(' ')
  for (let k = 1; k <= words.length; k++) led.absorb(finals(words.slice(0, k).join(' ')))
  eq('a full call streams through verbatim', led.text, SPOKEN)
  const viaLedger = await analyzeWithRules({ text: led.text, channel: 'voice' })
  eq('with the verdict unchanged', viaLedger.verdict, clean.verdict)
}

/* ==========================================================================
   5. The preset path goes through the same door
   ========================================================================== */
section('Recorded call presets')

{
  const led = new TranscriptLedger()
  const text = 'hello sir i am outside your building with your amazon parcel'
  for (const w of text.split(' ')) led.append(w)
  eq('word-by-word preset streaming is verbatim', led.text, text)

  led.clear()
  eq('clear empties the ledger', led.text, '')
  led.newSession()
  led.absorb(finals('a new call'))
  eq('and the next call starts clean', led.text, 'a new call')
}

/* -------------------------------------------------------------------------- */
console.log()
if (failures) {
  console.log(paint(C.red, `${failures} check${failures === 1 ? '' : 's'} failed`))
  process.exit(1)
}
console.log(paint(C.green, 'transcript ledger: all checks passed'))
