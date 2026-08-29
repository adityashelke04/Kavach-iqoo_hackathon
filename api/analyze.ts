import { SYSTEM_PROMPT, buildUserPrompt } from '../src/detector/prompt.ts'
import type { Channel } from '../src/detector/types.ts'

/**
 * Cloud analysis proxy — SPEC.md §8.2.
 *
 * Runs as a standard Vercel Serverless Function on Node.js.
 * Holds the OPENROUTER_API_KEY securely and builds prompts server-side.
 */

const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite'
const MAX_CHARS = 4000
const UPSTREAM_TIMEOUT_MS = 12_000

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

  const channel: Channel = payloadBody.channel === 'voice' ? 'voice' : 'text'
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
