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
6. Never put a number, a percentage or a score in any string you return.
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

export interface PromptContext {
  text: string
  channel: 'text' | 'voice'
  senderFact: string | null
}

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
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt({ text, channel, senderFact }) },
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
