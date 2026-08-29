/**
 * Pick the script — SPEC.md §10.6, decision D17.
 *
 * A pure function. No React, no network, no engine import, no storage — the
 * same shape as `src/report/build.ts`, and for the same reasons: it is testable
 * in Node, it behaves identically behind all three engines, and it works with
 * the network cut.
 *
 * THE RULE THAT MATTERS: when nothing matches confidently, return `null` and
 * render nothing. A generic prediction — "they'll ask you for money" — is worse
 * than silence. It is unfalsifiable, it teaches the reader nothing they did not
 * already know from the verdict, and the first time one of these predictions
 * fails to come true in front of a user, every other one stops working too.
 */
import type { TacticName } from '../detector/types.ts'
import { PLAYBOOKS } from './playbooks.ts'
import type { Playbook, Prediction, PredictionInput } from './types.ts'

/**
 * A marker match is worth more than any amount of corroboration, so a playbook
 * that names the thing beats one that merely rhymes with it. Supporting hits
 * then separate two playbooks that both named it — "customs parcel" over plain
 * "digital arrest" on a message that says both.
 */
const MARKER_WEIGHT = 10

/**
 * At least one supporting signal is required on top of the marker.
 *
 * Without this floor a single stray word carries a whole script: "refund" alone
 * would predict an overpayment con on any message that happened to mention one,
 * including a genuine one. The marker says which script this could be; the
 * corroboration is what makes it worth saying out loud.
 */
const MIN_SUPPORTING = 1

function scoreOf(playbook: Playbook, text: string, present: Set<TacticName>): number | null {
  if (!playbook.requiresTactics.every((t) => present.has(t))) return null
  if (!playbook.marker.test(text)) return null

  const supporting = playbook.supporting.filter((re) => re.test(text)).length
  if (supporting < MIN_SUPPORTING) return null

  return MARKER_WEIGHT + supporting
}

/**
 * The best-matching script, or `null` when none of them earns it.
 *
 * Callers must handle the null rather than substitute something generic.
 */
export function predictNextLines(input: PredictionInput): Prediction | null {
  const { text } = input
  if (!text || text.trim().length === 0) return null

  const channel = input.channel ?? 'text'
  const present = new Set<TacticName>(input.tactics.map((t) => t.name))

  let best: Playbook | null = null
  let bestScore = 0

  for (const playbook of PLAYBOOKS) {
    if (playbook.channel && playbook.channel !== channel) continue

    const score = scoreOf(playbook, text, present)
    if (score === null) continue

    // Strictly greater, so ties fall to the earlier entry — PLAYBOOKS is
    // ordered most specific first precisely to make that the right answer.
    if (score > bestScore) {
      best = playbook
      bestScore = score
    }
  }

  if (!best) return null

  return { id: best.id, steps: best.steps, ending: best.ending }
}
