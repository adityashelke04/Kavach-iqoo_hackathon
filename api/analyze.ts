import { SYSTEM_PROMPT, buildUserPrompt } from '../src/detector/prompt.ts'
import type { Channel } from '../src/detector/types.ts'

/**
 * Cloud analysis proxy — SPEC.md §8.2.
 *
 * Kavach is a static PWA. Any `VITE_*` value is compiled into the bundle and
 * readable by anyone who opens devtools, so an OpenRouter key cannot live in
 * the client: it would be public within minutes of a deploy and billable to
 * whoever found it. This function is the whole reason the cloud engine has a
 * server side at all — it holds the key, and the browser only ever talks to
 * this endpoint.
 *
 * It also builds the prompt here rather than accepting one from the client.
 * Accepting a caller-supplied prompt would turn the endpoint into a free
 * general-purpose LLM proxy on the owner's account.
 *
 * Environment (Vercel project settings, not committed):
 *   OPENROUTER_API_KEY   required
 *   KAVACH_CLOUD_MODEL   optional, defaults below
 */

// Module-scoped rather than pulling in @types/node: this is the only file in
// the project that runs on a server, and widening the global type environment
// for it would change what `setTimeout` returns everywhere in `src`.
declare const process: { env: Record<string, string | undefined> }

const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite'
const MAX_CHARS = 4000
const UPSTREAM_TIMEOUT_MS = 12_000

interface AnalyzeBody {
  text?: unknown
  sender?: unknown
  channel?: unknown
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // The browser calls this from the same origin; nothing else needs it.
      'cache-control': 'no-store',
    },
  })

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Use POST.' }, 405)
  }

  const apiKey = process.env['OPENROUTER_API_KEY']
  if (!apiKey) {
    // A missing key is a deployment problem, not a user-facing failure. The
    // client treats any non-200 as an engine failure and falls back silently,
    // so the user still gets a verdict from the rules engine (§6).
    return json({ error: 'OPENROUTER_API_KEY is not set on this deployment.' }, 503)
  }

  let body: AnalyzeBody
  try {
    body = (await request.json()) as AnalyzeBody
  } catch {
    return json({ error: 'Body must be JSON.' }, 400)
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (text === '') return json({ error: 'text is required.' }, 400)
  if (text.length > MAX_CHARS) {
    return json({ error: `text must be at most ${MAX_CHARS} characters.` }, 413)
  }

  const channel: Channel = body.channel === 'voice' ? 'voice' : 'text'
  const senderFact = typeof body.sender === 'string' && body.sender.trim() !== ''
    ? body.sender.trim().slice(0, 200)
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
        // Deterministic-ish: this is a classification, not a creative task.
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
      return json(
        {
          error: 'Upstream model call failed.',
          status: upstream.status,
          // Surfaced so a wrong KAVACH_CLOUD_MODEL is diagnosable from the
          // network tab rather than looking like a silent fallback.
          detail: detail.slice(0, 400),
        },
        502,
      )
    }

    const payload = (await upstream.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = payload.choices?.[0]?.message?.content

    if (typeof content !== 'string' || content.trim() === '') {
      return json({ error: 'Model returned an empty response.' }, 502)
    }

    // The raw model string goes back to the browser, which parses it with the
    // same `resultFromLlm` the on-device engine uses. One parser, one set of
    // repair rules, one place for a contract bug to live.
    return json({ content }, 200)
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return json({ error: aborted ? 'Upstream timed out.' : 'Upstream request failed.' }, 504)
  } finally {
    clearTimeout(timer)
  }
}
