import type {
  DetectionInput,
  DetectionResult,
  Detector,
  Evidence,
  SenderSignal,
  Tactic,
  TacticName,
} from './types.ts'
import { TACTIC_NAMES } from './types.ts'
import { CONCLUSIVE, NEGATIVES, TERMS, VOICE_TERMS } from './terms.ts'
import { classifySender } from './sender.ts'
import { decideVerdict } from './verdict.ts'
import { TACTIC_LABELS } from '../ui/copy.ts'

/**
 * RuleDetector — SPEC.md §8.3.
 *
 * Pure TypeScript, synchronous, zero dependencies, no network, no GPU, cannot
 * fail. It is why the user always gets a verdict.
 *
 * It is INVISIBLE (D2): never selectable, never named in the UI, never
 * surfaced as a failure or a degraded state. It is not "the AI" in the pitch.
 * It is the safety net under the trapeze — and, because it is deterministic,
 * the only engine the corpus suite can meaningfully regression-test.
 */

// --- Tuning ---------------------------------------------------------------
// How much each tactic contributes at full saturation. Isolation is highest
// because almost no legitimate message asks you not to tell your family;
// urgency is lowest because real messages have real deadlines (§8.3).
// These do NOT sum to 1.0 on purpose. An earlier version made them sum to ~1
// across four tactics, which capped any single tactic far below the danger
// threshold — "install AnyDesk so I can access your banking app" scored 0.56
// and came back as merely 'caution'. A single overwhelming tactic must be able
// to reach danger on its own. Legitimate messages are held down by the
// negative terms and by saturation, not by small weights.
const TACTIC_WEIGHT: Record<TacticName, number> = {
  isolation: 0.62,
  extraction: 0.68,
  authority: 0.22,
  urgency: 0.3,
}

/** A tactic counts as present once its subtotal clears this. */
const PRESENCE: Record<TacticName, number> = {
  isolation: 1.0,
  extraction: 1.0,
  // Deliberately low: a bare institution name ("SBI") should register as an
  // identity claim, because the impersonation-mismatch rule (§4) depends on
  // it. It contributes almost nothing to the score on its own.
  authority: 0.75,
  urgency: 1.0,
}

/**
 * Diminishing returns. Five urgency phrases are not five times more urgent
 * than one, and linear scoring would let a single repetitive message
 * outrank a genuinely multi-tactic scam.
 */
function saturate(x: number): number {
  return x <= 0 ? 0 : 1 - Math.exp(-x / 1.6)
}

/**
 * Co-occurrence bonus. Scam-ness is superadditive: authority *and* urgency
 * *and* an ask is the signature, and each additional distinct tactic is worth
 * more than its own weight. Without this, two strong tactics land just under
 * the danger threshold.
 */
const SYNERGY_PER_EXTRA_TACTIC = 0.1

// Sender adjustments (§5.5). Asymmetric on purpose: a bad sender may raise
// the verdict decisively, a registered header may only lower it modestly.
const SENDER_ADJ = {
  highWithAuthority: 0.25,
  highAlone: 0.05,
  medium: 0.03,
  registered: -0.12,
} as const

// --- Matching -------------------------------------------------------------

interface Match {
  start: number
  end: number
  text: string
  w: number
}

function collect(input: string, terms: readonly { re: RegExp; w: number }[]): Match[] {
  const found: Match[] = []
  for (const term of terms) {
    // Fresh regex per use: a shared /g/ regex carries lastIndex between calls.
    const re = new RegExp(term.re.source, term.re.flags)
    for (const m of input.matchAll(re)) {
      if (m.index === undefined || m[0] === '') continue
      found.push({ start: m.index, end: m.index + m[0].length, text: m[0], w: term.w })
    }
  }
  return dedupe(found)
}

/**
 * Is this match inside a negation? "Do not share the OTP" contains the exact
 * substring "share the OTP" while meaning precisely the opposite — a real bank
 * says it, a scammer never does. Without this guard the conclusive-signal
 * floor would fire on every legitimate bank SMS and fail the §12 gate.
 */
function isNegated(text: string, matchStart: number): boolean {
  const lookback = text.slice(Math.max(0, matchStart - 28), matchStart)
  return /\b(do ?n[o']?t|never|no need to|will not|won'?t|kabhi)\b[^.!?]*$/i.test(lookback)
}

/**
 * Highest floor among the conclusive signals present (§8.3). Returns 0 when
 * none apply.
 */
function conclusiveFloor(text: string): { floor: number; why: string | null } {
  let best = 0
  let why: string | null = null

  for (const sig of CONCLUSIVE) {
    const [first, ...rest] = sig.all
    if (!first) continue

    // Legitimate contexts that neutralise this signal — a courier asking for a
    // delivery OTP is not an extraction attempt.
    if (sig.unless?.some((u) => new RegExp(u.source, u.flags).test(text))) continue

    // The first pattern is the one carrying the meaning, so it is the one we
    // negation-check.
    const hits = [...text.matchAll(new RegExp(first.source, first.flags))].filter(
      (m) => m.index !== undefined && !isNegated(text, m.index),
    )
    if (hits.length === 0) continue

    const restOk = rest.every((r) => new RegExp(r.source, r.flags).test(text))
    if (!restOk) continue

    if (sig.floor > best) {
      best = sig.floor
      why = sig.why
    }
  }
  return { floor: best, why }
}

/**
 * Drop matches fully contained in a longer one. "share the OTP" and "OTP"
 * both fire; counting both would double-score the same words.
 */
function dedupe(matches: Match[]): Match[] {
  const sorted = [...matches].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  )
  const kept: Match[] = []
  for (const m of sorted) {
    const covered = kept.some((k) => m.start >= k.start && m.end <= k.end)
    if (!covered) kept.push(m)
  }
  return kept
}

// --- Explanation ----------------------------------------------------------

const TACTIC_NOTE: Record<TacticName, string> = {
  authority:
    "They're claiming to be an official body so you don't question what comes next.",
  urgency: 'The deadline is there to stop you thinking it over.',
  isolation:
    "They're trying to keep you from checking with anyone who would talk you out of it.",
  extraction: 'This is the part where they ask for what they actually came for.',
}

/** Name the specific ask and the specific consequence (§5 `nextMove`). */
function describeNextMove(text: string, hasFindings: boolean): string {
  const has = (re: RegExp) => re.test(text)

  if (has(/any ?desk|team ?viewer|quick ?support|rust ?desk|screen ?shar/i)) {
    return 'They want you to install a screen-sharing app so they can operate your banking app while you watch.'
  }
  // Acronyms match their spoken forms too ("o t p"), see §5.6.
  if (has(/\bo[\s.]?t[\s.]?p\b|one[- ]time password|\d[- ]digit (code|number)/i)) {
    return "They want the OTP from your bank's SMS. That code is the only thing standing between them and your account."
  }
  if (
    has(
      /\bu[\s.]?p[\s.]?i\b|qr code|scan this|(send|transfer|pay) (rs\.?|₹|money|amount)|deposit|fee|rupees/i,
    )
  ) {
    return 'They want you to send money now and trust a refund later. There will be no refund.'
  }
  if (has(/\bc[\s.]?v[\s.]?v\b|card number|\bpin\b|password|login/i)) {
    return 'They want your card or login details, which is everything needed to empty the account.'
  }
  if (has(/bit\.ly|tinyurl|click here|https?:\/\/|verify your|update your/i)) {
    return 'They want you on a page that looks like your bank, so you type your login in yourself.'
  }
  if (has(/\b[6-9]\d{9}\b|call (this|back|immediately)|whats ?app/i)) {
    return 'They want you to call back on their number, where a second person will take over and ask for the codes.'
  }
  return hasFindings
    ? 'They want you to respond, so they can start asking for details.'
    : "This message isn't asking you for anything sensitive."
}

function describeExplanation(tactics: Tactic[], sender: SenderSignal): string {
  const names = new Set(tactics.map((t) => t.name))

  if (tactics.length === 0) {
    return sender.risk === 'high'
      ? "The wording looks ordinary, but it came from a personal number rather than a registered sender."
      : 'Nothing in this message tries to pressure you or ask for anything sensitive.'
  }

  const parts: string[] = []

  if (names.has('authority') && sender.risk === 'high') {
    parts.push(
      'This claims to come from an official body, but it was sent from a personal mobile number — real institutions cannot do that',
    )
  } else if (names.has('authority')) {
    parts.push('This claims to come from an official body')
  }

  if (names.has('urgency')) parts.push("it pushes you to act before you've had time to think")
  if (names.has('isolation')) parts.push('it tries to stop you checking with anyone else')
  if (names.has('extraction')) parts.push('and it asks for something a real sender never would')

  if (parts.length === 0) return 'Some of the wording here is worth a second look.'

  const first = parts[0]!
  const rest = parts.slice(1)
  const sentence = rest.length > 0 ? `${first}, ${rest.join(', ')}` : first
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

// --- The engine -----------------------------------------------------------

export function analyzeWithRules(
  input: DetectionInput,
  senderSignal?: SenderSignal,
): DetectionResult {
  const startedAt = Date.now()
  const text = input.text
  const sender = senderSignal ?? classifySender(input.sender)

  const subtotals: Record<TacticName, number> = {
    authority: 0,
    urgency: 0,
    isolation: 0,
    extraction: 0,
  }
  const evidenceByTactic: Record<TacticName, Evidence[]> = {
    authority: [],
    urgency: [],
    isolation: [],
    extraction: [],
  }

  // A transcript gets the voice term set merged on top (§5.6).
  const channel = input.channel ?? 'text'

  for (const name of TACTIC_NAMES) {
    const active =
      channel === 'voice' ? [...TERMS[name], ...VOICE_TERMS[name]] : TERMS[name]
    for (const m of collect(text, active)) {
      subtotals[name] += m.w
      evidenceByTactic[name].push({ phrase: m.text, start: m.start, end: m.end })
    }
  }

  // Negatives are subtracted BEFORE the presence check, so a genuine bank
  // message never registers extraction at all rather than merely scoring
  // lower. This is the false-positive defence (§8.3).
  let globalPenalty = 0
  for (const neg of NEGATIVES) {
    const hits = collect(text, [neg])
    if (hits.length === 0) continue
    const total = hits.reduce((s, h) => s + h.w, 0)
    if (neg.tactic) subtotals[neg.tactic] -= total
    else globalPenalty += total * 0.06
  }

  const tactics: Tactic[] = []
  let weighted = 0
  for (const name of TACTIC_NAMES) {
    if (subtotals[name] < PRESENCE[name]) continue
    weighted += TACTIC_WEIGHT[name] * saturate(subtotals[name])
    tactics.push({
      name,
      label: TACTIC_LABELS[name],
      evidence: evidenceByTactic[name].sort((a, b) => a.start - b.start),
      note: TACTIC_NOTE[name],
    })
  }

  const synergy = Math.max(0, tactics.length - 1) * SYNERGY_PER_EXTRA_TACTIC

  const hasAuthority = tactics.some((t) => t.name === 'authority')
  let senderAdj = 0
  if (sender.risk === 'high') {
    senderAdj = hasAuthority ? SENDER_ADJ.highWithAuthority : SENDER_ADJ.highAlone
  } else if (sender.risk === 'medium') {
    senderAdj = SENDER_ADJ.medium
  } else if (sender.kind === 'dlt_header') {
    senderAdj = SENDER_ADJ.registered
  }

  const scored = Math.max(0, weighted + synergy + senderAdj - globalPenalty)

  // A conclusive signal sets a floor rather than adding weight: its strength
  // does not depend on what else is in the message. Only applied when the
  // tactic it belongs to actually registered, so a floor can never produce a
  // danger verdict with nothing to show the user (§4 rule 4).
  const { floor } = conclusiveFloor(text)
  const confidence = Math.min(1, tactics.length > 0 ? Math.max(scored, floor) : scored)

  const verdict = decideVerdict(confidence, tactics, sender)

  return {
    verdict,
    confidence,
    tactics,
    senderSignal: sender,
    explanation: describeExplanation(tactics, sender),
    nextMove: describeNextMove(text, tactics.length > 0),
    engineUsed: 'rules',
    latencyMs: Date.now() - startedAt,
  }
}

export const ruleDetector: Detector = {
  id: 'rules',
  async isAvailable() {
    return true
  },
  async detect(input) {
    return analyzeWithRules(input)
  },
}
