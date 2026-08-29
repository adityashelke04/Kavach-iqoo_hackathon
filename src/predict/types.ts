/**
 * What happens next — SPEC.md §10.6, decision D17.
 *
 * A scam is a script. The person running it has said these lines a thousand
 * times, and the target is hearing them for the first time — that asymmetry is
 * the whole con. Naming the next three lines before they arrive removes it.
 *
 * This is a PREDICTION, derived from what the detector already found. It is not
 * a detection, it never changes a verdict, and it is never evidence — which is
 * why it does not appear on the report receipt (D16). The copy says "usually"
 * because that is the honest word.
 *
 * Nothing here imports an engine or touches `DetectionResult` (§7 is frozen).
 * The whole module is a pure function of tactics, text and channel, so it works
 * identically behind all three engines and works offline.
 */
import type { Channel, TacticName } from '../detector/types.ts'

/**
 * One known scam script.
 *
 * These are the arcs that actually run in India at volume. Each one is a
 * recognisable shape with a recognisable ending, and each is written from
 * reporting on how the call or thread actually unfolds — not invented to fill a
 * table. Adding one is cheap; inventing one is a lie told to a frightened
 * person, so a new entry needs a real-world basis.
 */
export interface Playbook {
  id: string
  /**
   * The defining marker. At least one of these must appear in the message for
   * this playbook to be considered at all.
   */
  marker: RegExp
  /** Every one of these tactics must be present in the result. */
  requiresTactics: TacticName[]
  /** When set, the playbook only applies on this channel. */
  channel?: Channel
  /**
   * Extra corroboration. Each one that matches makes this playbook a better fit
   * than a rival that also matched its marker — this is how "customs parcel"
   * beats plain "authority" on the same message.
   */
  supporting: RegExp[]
  /**
   * Exactly three lines, in the order they arrive.
   *
   * Written as "They'll …" — a prediction about the sender, never an
   * instruction to the reader. Three because it is the most a frightened person
   * will hold, and because the third is where the money moves.
   */
  steps: [string, string, string]
  /** One line naming what the last step actually costs. */
  ending: string
}

/** The matched script, ready to render. */
export interface Prediction {
  /** Which playbook matched. Internal — never rendered (§10.7, D11). */
  id: string
  steps: [string, string, string]
  ending: string
}

/** Everything the matcher needs. Kept explicit so it stays a pure function. */
export interface PredictionInput {
  text: string
  tactics: readonly { name: TacticName }[]
  /** Defaults to 'text'. */
  channel?: Channel
}
