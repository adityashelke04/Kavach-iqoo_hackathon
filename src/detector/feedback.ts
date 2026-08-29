import type { DetectionResult, TacticName } from './types.ts'
import { TACTIC_NAMES } from './types.ts'

/**
 * On-device adaptive weighting — SPEC.md §8.3, decision D14.
 *
 * The verdict screen asks "was this right?". A correction nudges the weight of
 * whichever tactics actually fired, the adjustment is stored on the device, and
 * the next analysis uses it. Nothing is sent anywhere and nothing is shared
 * between users.
 *
 * WHAT THIS IS, PRECISELY.
 *
 * It is a bounded online weight update driven by a reward signal — closest in
 * shape to a perceptron update or a contextual bandit. It is **not** deep
 * reinforcement learning: there is no policy network, no value function, no
 * episode, and no credit assignment across time. Describing it as "on-device
 * adaptive weighting" and then explaining the mechanism is both more accurate
 * and more convincing than calling it RL and being asked which algorithm.
 *
 * WHY IT CANNOT BREAK THE FALSE-POSITIVE GATE.
 *
 * A learning system that a user can push around is a system a user can break,
 * and the one thing this product cannot afford is to start flagging real bank
 * messages. Four constraints, all enforced here rather than by good intentions:
 *
 * 1. **Multipliers are clamped to ±25%.** Feedback can shade a decision; it can
 *    never invent or erase one. The §4 override rules — the extraction floor,
 *    the three-tactic rule, the impersonation mismatch — are untouched by it.
 * 2. **Only tactics that actually fired are adjusted.** With no evidence there
 *    is nothing to attribute the correction to, so nothing moves.
 * 3. **Agreement decays adjustments back toward neutral.** Corrections do not
 *    ratchet: a run of "that was right" pulls the weights home again.
 * 4. **The corpus gate never sees them.** The harness runs in Node, where
 *    there is no `localStorage`, so `tacticAdjustment` returns 1 and the gate
 *    measures the shipped defaults. `usingDefaults()` asserts that.
 */

const STORAGE_KEY = 'kavach.feedback.v1'

/** How far one correction moves a weight. Four consistent ones reach the clamp. */
const LEARNING_RATE = 0.06

/** Pull back toward neutral when the user confirms we were right. */
const DECAY_RATE = 0.03

const MIN_ADJUSTMENT = 0.75
const MAX_ADJUSTMENT = 1.25

export interface FeedbackState {
  adjustments: Record<TacticName, number>
  /** Corrections that could not be attributed to any tactic. */
  unattributedMisses: number
  agreed: number
  corrected: number
}

const neutral = (): Record<TacticName, number> =>
  Object.fromEntries(TACTIC_NAMES.map((n) => [n, 1])) as Record<TacticName, number>

function emptyState(): FeedbackState {
  return { adjustments: neutral(), unattributedMisses: 0, agreed: 0, corrected: 0 }
}

/**
 * Held in memory so the rules engine can stay synchronous.
 *
 * `analyzeWithRules` is a pure synchronous function and the whole architecture
 * leans on that — the instant verdict in D13 exists because of it. An async
 * store would force it to become async, or force a load-order bug where the
 * first analysis silently runs on defaults.
 */
let state: FeedbackState = emptyState()
let loaded = false

const clamp = (n: number) => Math.min(MAX_ADJUSTMENT, Math.max(MIN_ADJUSTMENT, n))

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    // Private mode and some embedded webviews throw on access rather than
    // returning null.
    return null
  }
}

/** Read persisted adjustments. Safe to call more than once. */
export function loadFeedback(): FeedbackState {
  if (loaded) return state
  loaded = true

  const store = storage()
  if (!store) return state

  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return state

    const parsed = JSON.parse(raw) as Partial<FeedbackState>
    const next = emptyState()

    for (const name of TACTIC_NAMES) {
      const v = parsed.adjustments?.[name]
      if (typeof v === 'number' && Number.isFinite(v)) next.adjustments[name] = clamp(v)
    }
    next.unattributedMisses = Number(parsed.unattributedMisses) || 0
    next.agreed = Number(parsed.agreed) || 0
    next.corrected = Number(parsed.corrected) || 0

    state = next
  } catch {
    // Corrupt or foreign data: fall back to defaults rather than guessing.
    state = emptyState()
  }

  return state
}

function persist() {
  const store = storage()
  if (!store) return
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* quota or private mode — the in-memory state still applies this session */
  }
}

/**
 * The multiplier for one tactic's weight. Synchronous, always finite, and 1
 * whenever nothing has been learned or storage is unavailable.
 */
export function tacticAdjustment(name: TacticName): number {
  if (!loaded) loadFeedback()
  return state.adjustments[name] ?? 1
}

/** True when no adjustment has moved off neutral. Asserted by the corpus gate. */
export function usingDefaults(): boolean {
  if (!loaded) loadFeedback()
  return TACTIC_NAMES.every((n) => state.adjustments[n] === 1)
}

export function feedbackState(): FeedbackState {
  if (!loaded) loadFeedback()
  return {
    adjustments: { ...state.adjustments },
    unattributedMisses: state.unattributedMisses,
    agreed: state.agreed,
    corrected: state.corrected,
  }
}

/**
 * Record what the user said about a verdict.
 *
 * `wasRight === false` means the verdict was wrong in whichever direction it
 * was given: a warning on a message that was fine, or a clean bill of health
 * on a scam. The direction is read from the verdict, not asked for, because
 * one extra question is one more thing between a frightened person and the
 * answer they came for.
 */
export function recordFeedback(result: DetectionResult, wasRight: boolean): FeedbackState {
  if (!loaded) loadFeedback()

  const fired = result.tactics
    .filter((t) => t.evidence.length > 0)
    .map((t) => t.name)

  if (wasRight) {
    state.agreed++
    // Constraint 3: agreement decays adjustments home, so corrections cannot
    // ratchet a weight to the clamp and leave it there forever.
    for (const name of fired) {
      const current = state.adjustments[name] ?? 1
      state.adjustments[name] = clamp(current + (1 - current) * DECAY_RATE)
    }
    persist()
    return feedbackState()
  }

  state.corrected++

  // Constraint 2: no evidence, nothing to attribute the correction to.
  if (fired.length === 0) {
    state.unattributedMisses++
    persist()
    return feedbackState()
  }

  // A warning the user rejected means these tactics over-fired; a clean
  // verdict the user rejected means they under-fired.
  const overFired = result.verdict !== 'safe'
  const direction = overFired ? -1 : 1

  for (const name of fired) {
    const current = state.adjustments[name] ?? 1
    state.adjustments[name] = clamp(current * (1 + direction * LEARNING_RATE))
  }

  persist()
  return feedbackState()
}

/** Back to shipped defaults. Offered in the UI, and used by tests. */
export function resetFeedback(): FeedbackState {
  state = emptyState()
  loaded = true
  const store = storage()
  try {
    store?.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to do */
  }
  return feedbackState()
}
