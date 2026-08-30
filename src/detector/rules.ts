import type {
  DetectionInput,
  DetectionResult,
  Detector,
  Evidence,
  RuleBriefing,
  SenderSignal,
  Tactic,
  TacticName,
  Verdict,
} from './types.ts'
import { TACTIC_NAMES } from './types.ts'
import { CONCLUSIVE, NEGATIVES, TERMS, VOICE_TERMS } from './terms.ts'
import { classifySender } from './sender.ts'
import { decideVerdict } from './verdict.ts'
import { TACTIC_LABELS } from '../ui/copy.ts'
import { tacticAdjustment } from './feedback.ts'

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
 * says it, a scammer never does. Defends against both English prefix ("never share OTP")
 * and Hindi postfix ("OTP share mat karna", "kisi ko na batayein").
 */
function isNegated(text: string, matchStart: number, matchEnd: number): boolean {
  // 1. Prefix lookback (extended to 60 characters)
  const lookback = text.slice(Math.max(0, matchStart - 60), matchStart)
  const prefixNegated = /\b(do ?n[o']?t|never|no need to|will not|won'?t|kabhi (bhi )?(mat|nahi|na)?|mat|na|nahi|kripya.*(na|mat)|मत|नहीं|ना|कभी नहीं)\b[^.!?]*$/i.test(
    lookback,
  )
  if (prefixNegated) return true

  // 2. Postfix lookahead (checks up to 45 characters following the term)
  const lookahead = text.slice(matchEnd, Math.min(text.length, matchEnd + 45))
  const postfixNegated = /^(?:[\s\w,\u0900-\u097F]+)?\b(mat|na|nahi|kabhi nahi|mat karna|mat batana|mat dena|na karein|na de|do not share|never share|मत दें|मत बताएं|न करें|मत करें|साझा न करें)\b/i.test(
    lookahead,
  )
  return postfixNegated
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
      (m) => m.index !== undefined && !isNegated(text, m.index, m.index + m[0].length),
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
  // With nothing flagged, none of the phrase rules below may speak. A genuine
  // bank SMS says "do not share OTP/CVV/PIN" in almost every message, and
  // matching that would tell the reader a legitimate alert is after their code.
  if (!hasFindings) {
    return "This message isn't asking you for anything sensitive."
  }

  const has = (re: RegExp) => re.test(text)

  if (has(/any ?desk|team ?viewer|quick ?support|rust ?desk|screen ?shar|एनीडेस्क|टीमव्यूअर|क्विकसपोर्ट|स्क्रीन\s*शेयर/i)) {
    return 'They want you to install a screen-sharing app so they can operate your banking app while you watch.'
  }
  // Acronyms match their spoken forms too ("o t p"), see §5.6.
  if (has(/\bo[\s.]?t[\s.]?p\b|one[- ]time password|\d[- ]digit (code|number)|ओटीपी|ओ\s*टी\s*पी|कोड|पासवर्ड/i)) {
    return "They want the OTP from your bank's SMS. That code is the only thing standing between them and your account."
  }
  if (
    has(
      /\bu[\s.]?p[\s.]?i\b|qr code|scan this|(send|transfer|pay) (rs\.?|₹|money|amount)|deposit|fee|rupees|यूपीआई|क्यूआर|पैसे|रुपये|डिपॉजिट|शुल्क/i,
    )
  ) {
    return 'They want you to send money now and trust a refund later. There will be no refund.'
  }
  if (has(/\bc[\s.]?v[\s.]?v\b|card number|\bpin\b|password|login|सीवीवी|पिन|कार्ड नंबर/i)) {
    return 'They want your card or login details, which is everything needed to empty the account.'
  }
  if (has(/bit\.ly|tinyurl|click here|https?:\/\/|verify your|update your|केवाईसी|लिंक/i)) {
    return 'They want you on a page that looks like your bank, so you type your login in yourself.'
  }
  if (has(/\b[6-9]\d{9}\b|call (this|back|immediately)|whats ?app|व्हाट्सएप/i)) {
    return 'They want you to call back on their number, where a second person will take over and ask for the codes.'
  }
  return hasFindings
    ? 'They want you to respond, so they can start asking for details.'
    : "This message isn't asking you for anything sensitive."
}

function describeExplanation(
  tactics: Tactic[],
  sender: SenderSignal,
  verdict: Verdict,
): string {
  const names = new Set(tactics.map((t) => t.name))

  // The clauses below are written to justify a warning. On a safe verdict they
  // read as an accusation the headline just contradicted: a genuine bank alert
  // trips the authority tactic without ever crossing the threshold, and
  // "This claims to come from an official body." is a strange reason to give
  // for "Looks legitimate".
  if (verdict === 'safe') {
    if (sender.kind === 'dlt_header') {
      return 'Nothing here pressures you or asks for anything sensitive, and it came from a registered business sender.'
    }
    return names.size > 0
      ? 'Some of the wording sounds official, but nothing here pressures you or asks for anything sensitive.'
      : 'Nothing in this message tries to pressure you or ask for anything sensitive.'
  }

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

/**
 * What the deterministic scan saw, before any threshold is applied.
 *
 * Split out of `analyzeWithRules` for D21. The scan has always computed both
 * halves of the picture — the phrases that look like manipulation, and the
 * legitimacy markers that argue against it — and then thrown the second half
 * away, keeping only a single scalar `confidence`. That scalar cannot express
 * disagreement: "I found nothing" and "I found four separate signs this is a
 * genuine bank alert" are both 0.
 *
 * Both halves are now reachable, because two callers need them:
 *
 * - `toBriefing` — so the LLM is told what the scan found *for* the message as
 *   well as against it. Sending only the positives was priming it to convict.
 * - `fuse` — so the negative defence §8.3 describes ("subtracted BEFORE the
 *   presence check, so a genuine bank message never registers extraction at
 *   all") applies to the LLM's tactics too, and not only to the scan's own.
 */
export interface DeterministicScan {
  /** Positives minus negatives, per tactic, before the presence threshold. */
  subtotals: Record<TacticName, number>
  evidenceByTactic: Record<TacticName, Evidence[]>
  /** Legitimacy phrases matched, verbatim from the text. */
  legitimacyMarkers: string[]
  globalPenalty: number
}

export function scanDeterministically(input: DetectionInput): DeterministicScan {
  const text = input.text

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
  const legitimacyMarkers: string[] = []
  for (const neg of NEGATIVES) {
    const hits = collect(text, [neg])
    if (hits.length === 0) continue
    const total = hits.reduce((s, h) => s + h.w, 0)
    if (neg.tactic) subtotals[neg.tactic] -= total
    else globalPenalty += total * 0.06
    for (const h of hits) {
      if (!legitimacyMarkers.includes(h.text)) legitimacyMarkers.push(h.text)
    }
  }

  return { subtotals, evidenceByTactic, legitimacyMarkers, globalPenalty }
}

export function analyzeWithRules(
  input: DetectionInput,
  senderSignal?: SenderSignal,
): DetectionResult {
  const startedAt = Date.now()
  const text = input.text
  const sender = senderSignal ?? classifySender(input.sender)
  const channel = input.channel ?? 'text'

  const { subtotals, evidenceByTactic, globalPenalty } = scanDeterministically(input)

  const tactics: Tactic[] = []
  let weighted = 0
  for (const name of TACTIC_NAMES) {
    if (subtotals[name] < PRESENCE[name]) continue
    // The learned multiplier (D14) is clamped to +/-25% and is 1 until the
    // user has corrected something, so this line is a no-op on a fresh install
    // and in the corpus harness, which runs without localStorage.
    weighted += TACTIC_WEIGHT[name] * tacticAdjustment(name) * saturate(subtotals[name])
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

  // In voice mode (live phone calls), there is no sender header to supply
  // highWithAuthority (+0.25). Multi-tactic live voice scams receive a calibration
  // bonus so spoken extortion calls reliably trigger the danger takeover.
  const voiceBonus = channel === 'voice' && tactics.length >= 2 ? 0.08 : 0

  const scored = Math.max(0, weighted + synergy + senderAdj + voiceBonus - globalPenalty)

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
    explanation: describeExplanation(tactics, sender, verdict),
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

/**
 * Convert a rules result into a briefing for the LLM (D15). `undefined` when
 * rules found nothing — an empty briefing paragraph in the prompt is noise,
 * not information.
 */
export function toBriefing(
  result: DetectionResult,
  input?: DetectionInput,
): RuleBriefing | undefined {
  const tactics = result.tactics
    .filter((t) => t.evidence.length > 0)
    .map((t) => ({
      name: t.name,
      matchedPhrases: t.evidence.map((e) => e.phrase),
    }))

  /**
   * The other half of the scan — D21.
   *
   * Until D21 this function returned the suspicious phrases and nothing else,
   * and `renderBriefing` opened with "a separate keyword scan already ran and
   * found possible signs of: ...". For a genuine SBI debit alert that briefing
   * read, in full: *authority (matched: "SBI")*. We were handing a 1B model one
   * incriminating detail about a legitimate message, withholding the four
   * legitimacy markers the same scan had just matched — "do not share OTP",
   * "Avl Bal", the 1800 number, "debited from" — and withholding that the scan's
   * own conclusion was `safe`. The model did what it was primed to do.
   *
   * A briefing is only worth the name if it carries the reading, not the
   * prosecution's half of it.
   */
  const legitimacyMarkers = input ? scanDeterministically(input).legitimacyMarkers : []

  // Nothing at all to say: no suspicious phrases and no legitimacy markers.
  // An empty briefing paragraph in the prompt is noise, not information.
  if (tactics.length === 0 && legitimacyMarkers.length === 0) return undefined

  return {
    tactics,
    legitimacyMarkers,
    assessment: result.verdict === 'safe' ? 'looks-legitimate' : 'has-concerns',
  }
}
