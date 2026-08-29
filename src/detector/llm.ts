import type {
  DetectionInput,
  DetectionResult,
  EngineId,
  SenderSignal,
  Tactic,
  TacticName,
} from './types.ts'
import { TACTIC_NAMES } from './types.ts'
import { resolveEvidence } from './evidence.ts'
import { decideVerdict } from './verdict.ts'
import { validateResult } from './validate.ts'
import { TACTIC_LABELS } from '../ui/copy.ts'

/**
 * Turning model output into a `DetectionResult` — SPEC.md §7, §8.
 *
 * Shared by the cloud engine and the on-device engine, because the failure
 * modes are identical: a model returns JSON wrapped in a code fence, invents a
 * fifth tactic, paraphrases an evidence phrase so it can no longer be found in
 * the message, or returns a confidence of 95 when the contract says 0-1.
 *
 * The engine contract in §6 is that a bad result is an engine *failure*, not
 * something to patch up and show the user. So this module is strict: it
 * repairs only the well-understood shape problems (fences, stray prose,
 * percentage-scaled confidence) and throws on anything it cannot honestly fix.
 * The orchestrator catches, and the rules engine carries the answer.
 */

export class LlmContractError extends Error {
  constructor(reason: string) {
    super(`LLM contract violated: ${reason}`)
    this.name = 'LlmContractError'
  }
}

interface RawTactic {
  name?: unknown
  evidence?: unknown
  note?: unknown
}

interface RawPayload {
  confidence?: unknown
  tactics?: unknown
  explanation?: unknown
  nextMove?: unknown
}

/**
 * Pull a JSON object out of whatever the model actually said.
 *
 * Models wrap JSON in ```json fences, prefix it with "Here is the analysis:",
 * or append a closing remark. Rather than one more instruction in the prompt
 * that a 1B model will ignore, we take the first balanced object in the string.
 */
export function extractJson(raw: string): string {
  const trimmed = raw.trim()

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence?.[1] ?? trimmed

  const start = body.indexOf('{')
  if (start === -1) throw new LlmContractError('no JSON object in the response')

  // Walk the string tracking depth, ignoring braces inside strings, so a
  // message quoted in "evidence" cannot end the object early.
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < body.length; i++) {
    const ch = body[i]!

    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return body.slice(start, i + 1)
    }
  }

  throw new LlmContractError('JSON object is not closed')
}

/**
 * Read the model's confidence, or reject the whole result.
 *
 * An earlier version rescaled anything above 1 as a percentage, on the theory
 * that models often answer 0-100. That is a silent downgrade waiting to
 * happen: a model answering `4` on some scale of its own became 0.04, which is
 * "safe", and a scam would have been waved through with no trace in the logs.
 * We cannot tell 4-percent from 4-out-of-5, and guessing wrong is only
 * dangerous in one direction.
 *
 * So the contract is enforced rather than repaired. An out-of-range confidence
 * is an engine failure (§6): the orchestrator drops this engine and the rules
 * result stands, which is the fail-safe outcome.
 */
function readConfidence(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new LlmContractError(`confidence is not a number: ${JSON.stringify(value)}`)
  }
  if (n < 0 || n > 1) {
    throw new LlmContractError(`confidence must be between 0 and 1, got ${n}`)
  }
  return n
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LlmContractError(`${field} is missing or empty`)
  }
  return value.trim()
}

const isTacticName = (v: unknown): v is TacticName =>
  typeof v === 'string' && (TACTIC_NAMES as readonly string[]).includes(v)

/**
 * Build the tactic list from raw model output.
 *
 * Unknown tactic names are dropped rather than rejected: a model inventing
 * "financial_fraud" alongside three valid tactics is still useful, and §5's
 * taxonomy is frozen, so the answer is to ignore the fifth, not to widen it.
 */
function readTactics(value: unknown, message: string): Tactic[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new LlmContractError('tactics is not an array')
  }

  const byName = new Map<TacticName, Tactic>()

  for (const entry of value as RawTactic[]) {
    if (typeof entry !== 'object' || entry === null) continue
    if (!isTacticName(entry.name)) continue

    const phrases = Array.isArray(entry.evidence)
      ? entry.evidence.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
      : []

    // §8: a tactic with nothing to show for it cannot be rendered, and §4
    // rule 4 forbids a verdict we cannot justify on screen.
    if (phrases.length === 0) continue

    const evidence = phrases.map((p) => resolveEvidence(message, p))
    const note =
      typeof entry.note === 'string' && entry.note.trim() !== ''
        ? entry.note.trim()
        : `This message uses ${entry.name}.`

    const existing = byName.get(entry.name)
    if (existing) {
      // One card per tactic (§7 invariant); merge rather than duplicate.
      existing.evidence.push(...evidence)
    } else {
      byName.set(entry.name, {
        name: entry.name,
        label: TACTIC_LABELS[entry.name],
        evidence,
        note,
      })
    }
  }

  return [...byName.values()]
}

export interface LlmParseContext {
  input: DetectionInput
  senderSignal: SenderSignal
  engineId: EngineId
  latencyMs: number
}

/**
 * Parse raw model output into a validated `DetectionResult`.
 *
 * The verdict is not taken from the model. It is computed here by the same
 * `decideVerdict` the rules engine uses, so §4's threshold table and its four
 * override rules apply identically no matter which engine ran.
 */
export function resultFromLlm(raw: string, ctx: LlmParseContext): DetectionResult {
  let parsed: RawPayload
  try {
    parsed = JSON.parse(extractJson(raw)) as RawPayload
  } catch (err) {
    if (err instanceof LlmContractError) throw err
    throw new LlmContractError(`response is not valid JSON: ${(err as Error).message}`)
  }

  const confidence = readConfidence(parsed.confidence)
  const tactics = readTactics(parsed.tactics, ctx.input.text)
  const explanation = readString(parsed.explanation, 'explanation')
  const nextMove = readString(parsed.nextMove, 'nextMove')

  const result: DetectionResult = {
    verdict: decideVerdict(confidence, tactics, ctx.senderSignal),
    confidence,
    tactics,
    senderSignal: ctx.senderSignal,
    explanation,
    nextMove,
    engineUsed: ctx.engineId,
    latencyMs: ctx.latencyMs,
  }

  // Throws on anything still inconsistent, which the orchestrator treats as an
  // engine failure and falls through to rules.
  return validateResult(result)
}

/**
 * A plain sentence describing the sender, handed to the model as an
 * established fact so it never has to guess (D9).
 */
export function senderFact(signal: SenderSignal): string | null {
  if (signal.kind === 'unknown') return null
  return signal.note
}
