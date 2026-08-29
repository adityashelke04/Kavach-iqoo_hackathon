/**
 * Kavach data contracts — SPEC.md §7. FROZEN.
 *
 * Changing anything in this file requires a Decision Log entry in SPEC.md §16.
 * Three engines and every screen depend on these shapes.
 */

export type Verdict = 'danger' | 'caution' | 'safe'

export type EngineId = 'local' | 'cloud' | 'rules'

export type TacticName = 'authority' | 'urgency' | 'isolation' | 'extraction'

export const TACTIC_NAMES: readonly TacticName[] = [
  'authority',
  'urgency',
  'isolation',
  'extraction',
]

/**
 * Where the text came from (§5.6). A speech transcript is not an SMS: it has
 * no sender, no punctuation, spells acronyms out as "o t p", and carries
 * call-centre framing that never appears in a text message.
 */
export type Channel = 'text' | 'voice'

/** What the user gives us to analyse. Sender is always optional (§5.5). */
export interface DetectionInput {
  text: string
  /** Sender ID or number as the user typed it. Absent is normal. */
  sender?: string
  /** Defaults to 'text'. Listen mode passes 'voice' (§5.6). */
  channel?: Channel
}

export type SenderKind =
  | 'dlt_header' // VM-SBIINB — TRAI-registered, the shape of a real one
  | 'shortcode' // 5-6 digits
  | 'phone_number' // 10-digit Indian mobile (6-9 lead), optional +91 / 0
  | 'telemarketer' // 140-prefixed
  | 'international' // + and a country code that is not +91
  | 'email_or_other'
  | 'unknown' // not provided — never penalised

export type SenderRisk = 'high' | 'medium' | 'none'

export interface SenderSignal {
  /** Exactly what the user typed, for display. */
  raw: string
  kind: SenderKind
  risk: SenderRisk
  /** One plain-language sentence. Empty when kind is 'unknown'. */
  note: string
}

/** A phrase in the user's message that triggered a tactic. */
export interface Evidence {
  /** Exact substring as it appears in the input, verbatim. */
  phrase: string
  /** Character offset into the original input. -1 when unresolved. */
  start: number
  /** Exclusive end offset. -1 when unresolved. */
  end: number
}

export interface Tactic {
  name: TacticName
  /** User-facing label, e.g. "Pretending to be someone official". */
  label: string
  evidence: Evidence[]
  /** One plain-language sentence explaining this tactic in this message. */
  note: string
}

export interface DetectionResult {
  verdict: Verdict
  /**
   * INTERNAL ONLY. Drives the §4 threshold table.
   * Rendering this value in any form is a spec violation. See §4.
   */
  confidence: number
  tactics: Tactic[]
  /**
   * Always present. `kind: 'unknown'` when the user gave no sender.
   * Classified deterministically in the orchestrator, never by a model (§5.5).
   */
  senderSignal: SenderSignal
  /** 1-2 sentences, plain language, no jargon. */
  explanation: string
  /** What the sender wants next. Always populated, including on 'safe'. */
  nextMove: string
  /** Debug/console only. Never rendered. */
  engineUsed: EngineId
  latencyMs: number
}

export interface Detector {
  readonly id: EngineId
  /** Cheap, non-throwing capability probe. Never downloads anything. */
  isAvailable(): Promise<boolean>
  /** Analyse a message. See the engine contract in §6. */
  detect(input: DetectionInput, signal: AbortSignal): Promise<DetectionResult>
}
