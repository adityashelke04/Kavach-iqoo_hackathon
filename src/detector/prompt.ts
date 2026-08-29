import type { Channel } from './types.ts'

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
- authority: pretends to be a bank, the police, a court, a government office,
  a telecom operator or a delivery company, in order to borrow their power.
- urgency: manufactures a deadline or a threatened loss so the reader acts
  before checking. "within 24 hours", "account will be blocked", "final notice".
- isolation: tries to stop the reader checking with anyone else. "do not tell
  your family", "stay on the line", "this is confidential", "do not visit the
  branch".
- extraction: asks for the thing the scam actually wants — an OTP, a PIN, a
  CVV, card details, a UPI payment, a fee, or the installation of a
  screen-sharing app such as AnyDesk or TeamViewer.
`.trim()

export const SYSTEM_PROMPT = `
You analyse messages received by people in India and decide whether they are
scams. You are one of two engines; a deterministic rules engine runs alongside
you, so report what you actually observe rather than trying to be decisive.

Return ONLY a JSON object. No prose, no markdown, no code fence.

{
  "confidence": <number 0-1, how strongly this looks like a scam>,
  "tactics": [
    {
      "name": "authority" | "urgency" | "isolation" | "extraction",
      "evidence": ["<phrase copied EXACTLY from the message>", ...],
      "note": "<one plain sentence about this tactic in this message>"
    }
  ],
  "explanation": "<1-2 plain sentences on why, or why it looks fine>",
  "nextMove": "<one sentence: what the sender wants the reader to do next>"
}

The four tactics, and nothing else:
${TACTIC_GUIDE}

Rules you must follow:

1. Every string in "evidence" must be copied character-for-character from the
   message. Do not paraphrase, re-case, fix spelling or trim words. A phrase
   that cannot be found in the message verbatim cannot be highlighted, and an
   unhighlightable claim is worth less to the reader than no claim.
2. Only include a tactic you can support with at least one evidence phrase.
3. Do not comment on who sent the message. You are told the sender's type as a
   fact; it has already been checked against India's DLT sender registry.
4. Write "explanation" and "nextMove" for a frightened adult with no technical
   background. No jargon: not "phishing", "social engineering", "threat
   vector", "credential harvesting". Say what is happening in ordinary words.
5. "confidence" must be a decimal between 0 and 1, such as 0.15 or 0.9. Never
   a percentage, never a rating out of 5 or 10. A value outside 0-1 makes the
   whole response unusable and it is discarded.
6. Never put a number, a percentage or a score in any string you return.
7. Ordinary legitimate messages exist and are common: transaction alerts,
   delivery updates, OTP notifications from a real bank, appointment reminders,
   promotions. For these, return an empty "tactics" array and a low confidence.
   A real bank SMS almost always contains the words "do not share your OTP with
   anyone" — that is the bank protecting the reader, not a scam extracting
   anything. Flagging these is the single most damaging mistake you can make.
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
}

/** The user-turn content. Kept separate from the system prompt so a local
 *  model with a small context window can be given the same thing. */
export function buildUserPrompt({ text, channel, senderFact }: PromptContext): string {
  const parts: string[] = []

  if (channel === 'voice') parts.push(VOICE_NOTE)

  if (senderFact) {
    parts.push(`Established fact about the sender: ${senderFact}`)
  } else {
    parts.push('The sender is unknown. Do not speculate about it.')
  }

  parts.push(
    channel === 'voice' ? 'Transcript to analyse:' : 'Message to analyse:',
    '"""',
    text,
    '"""',
  )

  return parts.join('\n\n')
}
