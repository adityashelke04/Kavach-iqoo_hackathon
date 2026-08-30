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
authority - poses as a bank, police, court, government, telecom or courier.
urgency - a deadline or threatened loss, to stop you checking.
isolation - tells you to tell nobody, stay on the line, keep it secret.
extraction - wants an OTP, PIN, CVV, card, UPI payment, fee, or an AnyDesk-type app.
`.trim()

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
