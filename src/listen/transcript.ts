/**
 * The transcript ledger — SPEC.md §5.6, §10.6, decision D23.
 *
 * D19's rule was "exactly one thing on the Listen screen opens the microphone
 * at a time". D23's is its twin: **exactly one thing appends to the transcript,
 * and it commits each recognised result once.**
 *
 * Why this is not a one-liner in the screen. On Android, `webkitSpeechRecognition`
 * is brokered to Google Speech Services, and that recogniser does not stream
 * deltas — it streams *revisions*. The same utterance is re-delivered as it is
 * refined, `results` is cumulative for the whole session, and several Android
 * Chrome builds report `resultIndex: 0` on every event regardless of what
 * actually changed. Code that appends "everything final from `resultIndex`
 * onward" therefore re-appends words it has already written, and because the
 * transcript was append-only there was nothing to reconcile it against. One
 * spoken word became many printed ones, worse the longer the call ran.
 *
 * That is not only ugly. `rules.ts` scores **per occurrence** — a phrase
 * repeated three times scores three times, clears the presence threshold on
 * jitter alone, and can carry a call from `caution` to `danger`. A duplicated
 * transcript is a false-positive engine.
 *
 * So the ledger below is deliberately boring and deliberately pure: no React,
 * no DOM, no recogniser. It holds the committed text and what every result
 * index has already contributed, and it is the only thing allowed to grow the
 * transcript. Everything platform-specific stays in the screen.
 */

/** One result as the Web Speech API hands it over, reduced to what we use. */
export interface ResultLike {
  transcript: string
  isFinal: boolean
}

export interface CommitOutcome {
  /** The full committed transcript after this event. */
  text: string
  /** Interim (non-final) text, to render live but never to commit. */
  interim: string
  /** True when this event actually changed the committed transcript. */
  changed: boolean
}

/** Collapse whitespace; the recogniser is inconsistent about it across builds. */
export function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Join `tail` onto `head`, dropping any overlap between them.
 *
 * The last line of defence, and the reason it exists: even with the index
 * ledger below doing its job, Android finals arrive cumulatively — "hello",
 * then "hello sir", then "hello sir this is". A recogniser that revises rather
 * than deltas would otherwise write the shared prefix again every time it
 * changed its mind about the end of the sentence.
 *
 * Overlap is measured in **whole words**, never characters. A character-wise
 * trim will happily weld "call" and "later" into "callater" the moment one word
 * ends with the letters another begins with, and a transcript that quietly
 * invents words is worse than one that repeats them.
 *
 * And it takes **two words minimum**, never one. People really do say "no no"
 * and "haan haan", and a one-word rule deletes the second one — silently
 * changing what the caller said, in the text the detector then scores. A
 * stray repeated word is a blemish; a deleted word is a lie. The single-word
 * case is left alone on purpose.
 */
const MIN_OVERLAP_WORDS = 2

export function joinWithoutOverlap(head: string, tail: string): string {
  const a = normalise(head)
  const b = normalise(tail)
  if (!a) return b
  if (!b) return a

  const aw = a.split(' ')
  const bw = b.split(' ')

  // Longest suffix of `a` that is also a prefix of `b`. Bounded: an overlap
  // longer than the incoming text cannot exist, and comparing more than a
  // sentence of context finds coincidences rather than repetitions.
  const max = Math.min(aw.length, bw.length, 12)
  for (let n = max; n >= MIN_OVERLAP_WORDS; n--) {
    let same = true
    for (let i = 0; i < n; i++) {
      if (aw[aw.length - n + i]?.toLowerCase() !== bw[i]?.toLowerCase()) {
        same = false
        break
      }
    }
    if (same) {
      const rest = bw.slice(n).join(' ')
      return rest ? `${a} ${rest}` : a
    }
  }

  return `${a} ${b}`
}

/**
 * The committed transcript of a Listen session.
 *
 * `results` indices are **session-scoped**: a recogniser restart begins
 * numbering at 0 again and says nothing about what the previous session wrote.
 * So the ledger keeps two things — `carried`, the text finished sessions left
 * behind, and `byIndex`, what the current session's results have contributed.
 * A restart moves the second into the first and starts counting again.
 */
export class TranscriptLedger {
  /** Text from finished sessions and from presets. Never rebuilt. */
  private carried = ''
  /** What each result index of the *current* session has contributed. */
  private byIndex = new Map<number, string>()
  /** carried + the current session, cached. */
  private committed = ''

  constructor(carry = '') {
    this.carried = normalise(carry)
    this.committed = this.carried
  }

  get text(): string {
    return this.committed
  }

  /**
   * Begin a new recogniser session: keep the words, drop the indices.
   *
   * Called on every restart, and Android restarts constantly — it ends the
   * session after each utterance whatever `continuous` says. Without this the
   * new session's result 0 would be mistaken for the old session's result 0 and
   * silently discarded as already committed, losing the whole utterance.
   */
  newSession(): void {
    this.carried = this.committed
    this.byIndex.clear()
  }

  /**
   * Absorb one `onresult` event.
   *
   * `resultIndex` is deliberately **not** used as a commit boundary — that is
   * the defect this class exists to remove. We walk the entire cumulative list
   * and let the ledger decide what is new, which is correct whether the
   * platform reports a truthful `resultIndex`, a stale one, or zero forever.
   */
  absorb(results: readonly ResultLike[]): CommitOutcome {
    let changed = false
    let interim = ''

    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (!r) continue
      const chunk = normalise(r.transcript)

      if (!r.isFinal) {
        interim = interim ? `${interim} ${chunk}` : chunk
        continue
      }
      if (!chunk) continue

      const seen = this.byIndex.get(i)
      // Already written, unchanged: the recogniser is repeating itself. This is
      // the ordinary Android case, and doing nothing about it is the whole fix.
      if (seen === chunk) continue

      this.byIndex.set(i, chunk)
      changed = true
    }

    if (changed) this.rebuild()
    return { text: this.committed, interim, changed }
  }

  /**
   * Append text no recogniser produced — the recorded call presets.
   *
   * It goes through the same door as everything else on purpose: one writer, so
   * the preset path cannot drift away from the live one the way it had.
   */
  append(text: string): string {
    const chunk = normalise(text)
    if (!chunk) return this.committed
    this.carried = joinWithoutOverlap(this.committed, chunk)
    this.byIndex.clear()
    this.committed = this.carried
    return this.committed
  }

  clear(): void {
    this.carried = ''
    this.committed = ''
    this.byIndex.clear()
  }

  /**
   * Recompute the committed text from the carried prefix and this session.
   *
   * Rebuilding rather than appending is what makes a *revision* safe: when the
   * recogniser changes its mind about result 3, result 3's old words have to
   * leave the transcript, and no amount of appending will remove them.
   */
  private rebuild(): void {
    const indices = [...this.byIndex.keys()].sort((x, y) => x - y)
    let session = ''
    for (const i of indices) {
      session = joinWithoutOverlap(session, this.byIndex.get(i) ?? '')
    }
    this.committed = joinWithoutOverlap(this.carried, session)
  }
}
