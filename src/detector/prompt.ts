import type { Channel, RuleBriefing, ReconsiderationPrompt } from './types.ts'

/**
 * The one prompt both LLM engines use — SPEC.md §8.1, §8.2.
 *
 * Local and cloud share this file on purpose. The whole reason §11 puts the
 * cloud engine before the on-device one is that the prompt and the JSON
 * contract get proved once, cheaply, and the on-device phase then only has to
 * solve WebGPU rather than debugging both at the same time.
 *
 * Two things the model is never asked to do:
 *
 * 1. **Judge the sender** (D9). Sender origin is a deterministic fact about a
 *    TRAI DLT header, decided in `sender.ts` and handed to the model as
 *    context. A model guessing at whether "VM-SBIINB" looks legitimate is
 *    exactly the failure D9 exists to prevent.
 * 2. **Decide the verdict.** It returns a confidence; §4's threshold table and
 *    its four override rules run in `verdict.ts`, in one place, for all three
 *    engines. That is what keeps the engines agreeing with each other.
 */

export const TACTIC_GUIDE = `
authority - poses as a bank, police, court, government, telecom or courier.
urgency - a deadline or threatened loss, to stop you checking.
isolation - tells you to tell nobody, stay on the line, keep it secret.
extraction - wants an OTP, PIN, CVV, card, UPI payment, fee, or an AnyDesk-type app.
`.trim()

/**
 * The shared system prompt — SPEC.md §8.4.
 *
 * **Rewritten short under D22, and shortness is the point.** Measured on the
 * iQOO 15, `/dev/llm` reports 6.1 tokens/second on Llama-3.2-1B, while a real
 * check was sending ~1340 tokens of prefill — 991 of them this prompt. At that
 * rate the prompt alone was minutes of work before a single output token, which
 * is why a bank alert needing ~100 tokens of answer took as long as anything
 * else. On a phone the prompt is not free context; it is the bill.
 *
 * The rewrite keeps every rule the long version had and drops the prose around
 * them. A/B against the live model over all 40 corpus messages: **37% fewer
 * prefill tokens (409 per message, ~67 seconds per check at 6.1 tok/s), 0/40
 * misjudged, 0 unparseable, 0 unquotable evidence** — identical quality.
 *
 * Rule 7's four bullets are not padding and must not be trimmed for length.
 * Each one is a false positive that a shorter draft actually produced: an
 * ICICI/Swiggy charge alert saying "report immediately", and an Uber message
 * saying "Share OTP 7719 with your driver", both came back at 0.9 confidence
 * until those lines existed. §12's false-positive gate outranks any token
 * saving.
 */
export const SYSTEM_PROMPT = `
You judge whether a message received in India is a scam. A keyword scanner runs
alongside you; confirm or correct it.

Reply with ONLY this JSON object, nothing else:
{
  "confidence": 0.0-1.0,
  "tactics": [{"name":"authority|urgency|isolation|extraction","evidence":["exact quote"],"note":"<=12 words"}],
  "explanation": "<=30 words",
  "nextMove": "<=15 words"
}

The four tactics, and no others:
${TACTIC_GUIDE}

Rules:
1. Every evidence string must be copied character-for-character from the message. Never paraphrase. If you cannot quote it, leave it out.
2. No tactic without at least one quote.
3. Never judge the sender. You are told what it is; that is already verified.
4. Plain words, for a frightened adult. No jargon, no "phishing".
5. confidence is a decimal 0-1, never a percentage or a rating.
6. Never put a score or percentage in any text field.
7. Ordinary messages are common and must come back with "tactics": [] and low confidence: transaction alerts, deliveries, ride and delivery OTPs, reminders, offers. Specifically, none of these is a scam signal:
   - "do not share your OTP" - a bank protecting you.
   - being told to share an OTP with your own driver or delivery partner at handover.
   - a card or account alert telling you to report an unrecognised charge on the institution's own published number, even if it says "immediately".
   - an institution named in a message that genuinely came from that institution - that is not impersonation.
   Wrongly flagging a real bank, ride or delivery SMS is the worst mistake you can make.
8. Be brief. This runs on the reader's phone and every word is time they wait.
`.trim()

/** Extra framing for a speech transcript rather than a text message (§5.6). */
export const VOICE_NOTE = `
This is an automatic transcript of a phone call, not a text message. It has no
punctuation or capitalisation, it may contain transcription errors, and
acronyms are usually spelled out as separate letters — "o t p" means OTP, "u p
i" means UPI, "k y c" means KYC. Judge the conversation, not the spelling. Copy
evidence phrases exactly as they appear in the transcript, errors included.
`.trim()

export interface PromptContext {
  text: string
  channel: Channel
  /** Plain description of the sender, or null when none was given (D9). */
  senderFact: string | null
  /** The rules engine's own read of this message, as context, not a verdict (D15). */
  briefing?: RuleBriefing
  /** Present only on the one bounded second call an engine may receive (D15). */
  reconsider?: ReconsiderationPrompt
}

/**
 * Render what a deterministic keyword scan already found, as context for the
 * model — never as a verdict, and never with a number (D15).
 *
 * **Both halves of the scan, since D21.** This used to render the matched
 * manipulation phrases and nothing else. For a genuine SBI debit alert the
 * entire briefing read *"found possible signs of: authority (matched: "SBI")"*
 * — one incriminating detail about a legitimate message, with the four
 * legitimacy markers the same scan had matched, and the scan's own `safe`
 * conclusion, both withheld. The model convicted, which is what it had been
 * shown. A briefing that carries only the prosecution's half is not context.
 */
/**
 * The deterministic scan's reading, as context for the model (D15, D21).
 *
 * **Both halves, in as few tokens as possible (D22).** D21 established that
 * sending only the incriminating half talks a model into convicting a real bank
 * alert, and that is not negotiable. What was negotiable was the wording: this
 * rendered ~254 tokens per check, and on the iQOO every token is ~0.16s of
 * prefill. The closing paragraph in particular restated guidance that now lives
 * in system prompt rule 7, so it was being paid for twice.
 *
 * Same information, a quarter of the tokens. Do not drop the legitimacy markers
 * or the conclusion to save more — those are the halves D21 exists to send.
 */
export function renderBriefing(briefing: RuleBriefing): string {
  const parts: string[] = []

  if (briefing.tactics.length > 0) {
    parts.push(
      'Scan flagged: ' +
        briefing.tactics
          .map((t) => `${t.name} (${t.matchedPhrases.map((p) => `"${p}"`).join(', ')})`)
          .join('; '),
    )
  } else {
    parts.push('Scan flagged nothing.')
  }

  const markers = briefing.legitimacyMarkers ?? []
  if (markers.length > 0) {
    parts.push(
      'Scan also matched genuine-message markers: ' + markers.map((m) => `"${m}"`).join(', '),
    )
  }

  const assessment = briefing.assessment ?? null
  if (assessment !== null) {
    parts.push(
      assessment === 'looks-legitimate'
        ? 'Scan concluded: looks legitimate.'
        : 'Scan concluded: worth concern.',
    )
  }

  parts.push('It matches phrases, not meaning. Confirm, correct, or add what it missed.')
  return parts.join('\n')
}

/**
 * Render the one bounded second-look prompt an engine sees when the audit
 * step found a concrete gap in its first answer (D15).
 */
export function renderReconsideration(reconsider: ReconsiderationPrompt): string {
  const { priorExplanation, missingTactic } = reconsider
  return [
    `You already answered this once. Your explanation was: "${priorExplanation}"`,
    `A keyword scan independently found a possible ${missingTactic.name} signal your answer did not address, matching: ${missingTactic.matchedPhrases.map((p) => `"${p}"`).join(', ')}.`,
    'Look at the message again. If this changes your reading, update your tactics and confidence to reflect it. If you still disagree, keep your answer, but make sure "explanation" says why this specific point does not change your reading.',
  ].join('\n')
}

/** The user-turn content. Kept separate from the system prompt so a local
 *  model with a small context window can be given the same thing. */
export function buildUserPrompt({
  text,
  channel,
  senderFact,
  briefing,
  reconsider,
}: PromptContext): string {
  const parts: string[] = []

  if (channel === 'voice') parts.push(VOICE_NOTE)

  if (senderFact) {
    parts.push(`Established fact about the sender: ${senderFact}`)
  } else {
    parts.push('The sender is unknown. Do not speculate about it.')
  }

  if (briefing && briefing.tactics.length > 0) {
    parts.push(renderBriefing(briefing))
  }

  if (reconsider) {
    parts.push(renderReconsideration(reconsider))
  }

  parts.push(
    channel === 'voice' ? 'Transcript to analyse:' : 'Message to analyse:',
    '"""',
    text,
    '"""',
  )

  return parts.join('\n\n')
}
