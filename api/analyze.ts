/**
 * Cloud analysis proxy — SPEC.md §8.2.
 *
 * Runs as a standard Vercel Serverless Function on Node.js.
 * Self-contained so Vercel can bundle and execute it without external filesystem dependencies.
 */

declare const process: { env: Record<string, string | undefined> }

const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite'
const MAX_CHARS = 4000
const UPSTREAM_TIMEOUT_MS = 12_000

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
6. Never state a confidence score, a percentage or a rating in "explanation",
   "nextMove" or a tactic's "note" — that judgment belongs only in the
   "confidence" field above. A concrete fact already in the message, such as
   an amount the scam is asking for, may still appear in plain prose when it
   helps the reader understand what is being asked of them.
7. Ordinary legitimate messages exist and are common: transaction alerts,
   delivery updates, OTP notifications from a real bank, appointment reminders,
   promotions. For these, return an empty "tactics" array and a low confidence.
   A real bank SMS almost always contains the words "do not share your OTP with
   anyone" — that is the bank protecting the reader, not a scam extracting
   anything. Flagging these is the single most damaging mistake you can make.
`.trim()

export const VOICE_NOTE = `
This is an automatic transcript of a phone call, not a text message. It has no
punctuation or capitalisation, it may contain transcription errors, and
acronyms are usually spelled out as separate letters — "o t p" means OTP, "u p
i" means UPI, "k y c" means KYC. Judge the conversation, not the spelling. Copy
evidence phrases exactly as they appear in the transcript, errors included.
`.trim()

export interface RuleBriefing {
  tactics: { name: string; matchedPhrases: string[] }[]
  /** Legitimacy markers the same scan matched, verbatim (D21). */
  legitimacyMarkers?: string[]
  /** The deterministic engine's own conclusion (D21). */
  assessment?: 'looks-legitimate' | 'has-concerns'
}

export interface ReconsiderationPrompt {
  priorExplanation: string
  missingTactic: { name: string; matchedPhrases: string[] }
}

export interface PromptContext {
  text: string
  channel: 'text' | 'voice'
  senderFact: string | null
  briefing?: RuleBriefing
  reconsider?: ReconsiderationPrompt
}

/**
 * Render what a deterministic keyword scan already found, as context for the
 * model — never as a verdict, and never with a number (D15). Kept in sync by
 * hand with src/detector/prompt.ts's identical function — this file cannot
 * import from src/ (see the header comment above on Vercel bundling).
 *
 * **`npm run test:cloud` asserts that sync, because hand-syncing failed.** D21
 * rewrote this function in `prompt.ts` and did not rewrite it here, so for one
 * revision the on-device engine got the full briefing and the cloud engine kept
 * getting the one-sided one. Measured against the live model, three runs each,
 * on a genuine SBI debit alert:
 *
 *   no briefing  -> confidence 0.10, no tactics
 *   old briefing -> confidence 0.30, THREE tactics invented
 *   new briefing -> confidence 0.05, no tactics
 *
 * The old briefing did not merely fail to help; it talked a correct model into
 * a wrong answer. And three tactics trip §4 override rule 2, which forces
 * `danger` regardless of the confidence — so a 0.30 reading became "This is a
 * scam" on a real bank message.
 */
export function renderBriefing(briefing: RuleBriefing): string {
  const parts: string[] = ['A separate keyword scan already ran on this message.']

  if (briefing.tactics.length > 0) {
    const lines = briefing.tactics.map(
      (t) => `- ${t.name} (matched: ${t.matchedPhrases.map((p) => `"${p}"`).join(', ')})`,
    )
    parts.push('Possible signs of manipulation it matched:', lines.join('\n'))
  } else {
    parts.push('It matched no signs of manipulation.')
  }

  const markers = briefing.legitimacyMarkers ?? []
  if (markers.length > 0) {
    parts.push(
      'Markers of a genuine message it also matched. These are things real banks, couriers and services say, and scams generally do not:',
      markers.map((m) => `- "${m}"`).join('\n'),
    )
  }

  const assessment = briefing.assessment ?? null
  if (assessment !== null) {
    parts.push(
      assessment === 'looks-legitimate'
        ? 'Weighing both lists, the scan concluded this message looks legitimate.'
        : 'Weighing both lists, the scan concluded this message is worth concern.',
    )
  }

  parts.push(
    'It cannot read meaning, only match known phrases — read the message yourself and confirm, refine, or correct it. It can miss a scam written in wording nobody has listed yet, so add anything it missed. It can also match an ordinary phrase in a perfectly normal message, so a match is not proof: an institution named in a message that genuinely came from that institution is not impersonating anyone, and a published helpline the message tells you to call is not the same as a message asking you for a code or a payment.',
  )

  return parts.join('\n')
}

/**
 * Render the one bounded second-look prompt an engine sees when the audit
 * step found a concrete gap in its first answer (D15). Kept in sync by hand
 * with src/detector/prompt.ts's identical function.
 */
export function renderReconsideration(reconsider: ReconsiderationPrompt): string {
  const { priorExplanation, missingTactic } = reconsider
  return [
    `You already answered this once. Your explanation was: "${priorExplanation}"`,
    `A keyword scan independently found a possible ${missingTactic.name} signal your answer did not address, matching: ${missingTactic.matchedPhrases.map((p) => `"${p}"`).join(', ')}.`,
    'Look at the message again. If this changes your reading, update your tactics and confidence to reflect it. If you still disagree, keep your answer, but make sure "explanation" says why this specific point does not change your reading.',
  ].join('\n')
}

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

  // Not `tactics.length > 0`: since D21 a briefing can carry only legitimacy
  // markers, and that is exactly the case worth sending — it is the one that
  // stops the model convicting an ordinary bank alert.
  if (
    briefing &&
    (briefing.tactics.length > 0 || (briefing.legitimacyMarkers?.length ?? 0) > 0)
  ) {
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

interface IncomingLike {
  method?: string
  body?: unknown
}

interface ResponseLike {
  status(code: number): ResponseLike
  json(data: unknown): void
  setHeader(name: string, value: string): ResponseLike
}

export default async function handler(req: IncomingLike, res: ResponseLike): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Use POST.' })
    return
  }

  const apiKey = process.env['OPENROUTER_API_KEY']
  if (!apiKey) {
    res.status(503).json({ error: 'OPENROUTER_API_KEY is not set on this deployment.' })
    return
  }

  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      res.status(400).json({ error: 'Body must be JSON.' })
      return
    }
  }

  const payloadBody = (body && typeof body === 'object' ? body : {}) as {
    text?: unknown
    sender?: unknown
    channel?: unknown
    briefing?: unknown
    reconsider?: unknown
  }

  const text = typeof payloadBody.text === 'string' ? payloadBody.text.trim() : ''
  if (text === '') {
    res.status(400).json({ error: 'text is required.' })
    return
  }
  if (text.length > MAX_CHARS) {
    res.status(413).json({ error: `text must be at most ${MAX_CHARS} characters.` })
    return
  }

  const channel = payloadBody.channel === 'voice' ? 'voice' : 'text'
  const senderFact =
    typeof payloadBody.sender === 'string' && payloadBody.sender.trim() !== ''
      ? payloadBody.sender.trim().slice(0, 200)
      : null

  // Named, typed, bounded fields only — never a raw messages array. Extending
  // this to two possible turns still keeps the endpoint doing exactly one
  // narrow job (D12), not acting as a general-purpose LLM proxy.
  const briefing =
    payloadBody.briefing && typeof payloadBody.briefing === 'object'
      ? (payloadBody.briefing as RuleBriefing)
      : undefined

  const reconsider =
    payloadBody.reconsider && typeof payloadBody.reconsider === 'object'
      ? (payloadBody.reconsider as ReconsiderationPrompt)
      : undefined

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env['KAVACH_CLOUD_MODEL']?.trim() || DEFAULT_MODEL,
        temperature: 0,
        // 500, matching §8.1 and the on-device engine's MAX_TOKENS (D20).
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildUserPrompt({
              text,
              channel,
              senderFact,
              ...(briefing ? { briefing } : {}),
              ...(reconsider ? { reconsider } : {}),
            }),
          },
        ],
      }),
    })

    if (!upstream.ok) {
      const detail = await upstream.text()
      res.status(502).json({
        error: 'Upstream model call failed.',
        status: upstream.status,
        detail: detail.slice(0, 400),
      })
      return
    }

    const payload = (await upstream.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = payload.choices?.[0]?.message?.content

    if (typeof content !== 'string' || content.trim() === '') {
      res.status(502).json({ error: 'Model returned an empty response.' })
      return
    }

    res.setHeader('cache-control', 'no-store')
    res.status(200).json({ content })
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    res.status(504).json({ error: aborted ? 'Upstream timed out.' : 'Upstream request failed.' })
  } finally {
    clearTimeout(timer)
  }
}
