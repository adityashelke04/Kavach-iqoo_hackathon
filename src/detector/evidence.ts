import type { Evidence } from './types.ts'

/**
 * Evidence resolution and highlight-span merging — SPEC.md §7.
 *
 * An LLM returns evidence as *text*, often with different casing, collapsed
 * whitespace or stray punctuation. To highlight it we need character offsets
 * into the original input. This module bridges the two, and it is the most
 * likely thing for a cold session to get subtly wrong.
 *
 * The rules engine does not need `resolveEvidence` — it matches with regexes
 * against the original string, so it already has exact offsets.
 */

const UNRESOLVED: Omit<Evidence, 'phrase'> = { start: -1, end: -1 }

/**
 * Build a map from positions in a whitespace-collapsed string back to
 * positions in the original.
 */
function collapse(input: string): { text: string; map: number[] } {
  const out: string[] = []
  const map: number[] = []
  let prevWasSpace = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    const isSpace = /\s/.test(ch)
    if (isSpace) {
      if (prevWasSpace) continue
      out.push(' ')
      map.push(i)
      prevWasSpace = true
    } else {
      out.push(ch)
      map.push(i)
      prevWasSpace = false
    }
  }
  return { text: out.join(''), map }
}

/**
 * Locate `phrase` inside `input`, trying progressively looser strategies.
 * Returns `start: -1` when it cannot be found — the caller renders those as
 * plain chips rather than inline highlights (§10.6), never discards them.
 */
export function resolveEvidence(input: string, phrase: string): Evidence {
  const p = phrase.trim()
  if (p === '') return { phrase, ...UNRESOLVED }

  // 1. Exact
  const exact = input.indexOf(p)
  if (exact !== -1) return { phrase: p, start: exact, end: exact + p.length }

  // 2. Case-insensitive. Lowercasing preserves length for the characters we
  //    care about, so indices map back unchanged.
  const ciIdx = input.toLowerCase().indexOf(p.toLowerCase())
  if (ciIdx !== -1) {
    return { phrase: input.slice(ciIdx, ciIdx + p.length), start: ciIdx, end: ciIdx + p.length }
  }

  // 3. Whitespace-normalised, translating offsets back through the map.
  const ci = collapse(input)
  const cp = collapse(p)
  const nIdx = ci.text.toLowerCase().indexOf(cp.text.toLowerCase())
  if (nIdx !== -1) {
    const start = ci.map[nIdx]
    const lastIdx = nIdx + cp.text.length - 1
    const lastOrig = ci.map[lastIdx]
    if (start !== undefined && lastOrig !== undefined) {
      const end = lastOrig + 1
      return { phrase: input.slice(start, end), start, end }
    }
  }

  // 4. Trim surrounding punctuation and retry the cheap strategies.
  // \p{M} preserves Indic dependent vowel signs (matras), virama, and anusvara.
  const stripped = p.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, '')
  if (stripped !== '' && stripped !== p) {
    const again = resolveEvidence(input, stripped)
    if (again.start !== -1) return again
  }

  // 5. Give up — but keep the phrase.
  return { phrase: p, ...UNRESOLVED }
}

export interface HighlightSegment {
  text: string
  /** Empty when this is a plain, un-highlighted run. */
  tactics: string[]
}

/**
 * Resolve all occurrences of evidence phrases across a target text string.
 * Used for live streaming transcripts so all matching phrases stay highlighted
 * regardless of buffer windowing.
 */
export function resolveAllEvidence(
  targetText: string,
  tactics: ReadonlyArray<{ name: string; evidence: ReadonlyArray<{ phrase: string }> }>,
): Array<{ start: number; end: number; tactic: string }> {
  if (!targetText || tactics.length === 0) return []
  const spans: Array<{ start: number; end: number; tactic: string }> = []
  const lower = targetText.toLowerCase()

  for (const t of tactics) {
    for (const e of t.evidence) {
      const phrase = e.phrase.trim().toLowerCase()
      if (!phrase) continue
      let idx = 0
      while ((idx = lower.indexOf(phrase, idx)) !== -1) {
        spans.push({ start: idx, end: idx + phrase.length, tactic: t.name })
        idx += phrase.length
      }
    }
  }
  return spans
}

/**
 * Turn overlapping evidence spans into a flat, non-overlapping list of
 * segments covering the whole input.
 *
 * INVARIANT, asserted in the test suite: the concatenation of every segment's
 * text equals the original input exactly. The user must be able to read their
 * own message unchanged — a highlighter that drops or duplicates a character
 * is a P0 bug, because this is the screen where trust is earned or lost.
 */
export function buildSegments(
  input: string,
  spans: ReadonlyArray<{ start: number; end: number; tactic: string }>,
): HighlightSegment[] {
  const valid = spans
    .filter((s) => s.start >= 0 && s.end > s.start && s.end <= input.length)
    .sort((a, b) => a.start - b.start || b.end - a.end)

  // Merge overlaps, unioning the tactic labels they carry.
  const merged: { start: number; end: number; tactics: Set<string> }[] = []
  for (const s of valid) {
    const last = merged[merged.length - 1]
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end)
      last.tactics.add(s.tactic)
    } else {
      merged.push({ start: s.start, end: s.end, tactics: new Set([s.tactic]) })
    }
  }

  const out: HighlightSegment[] = []
  let cursor = 0
  for (const m of merged) {
    if (m.start > cursor) {
      out.push({ text: input.slice(cursor, m.start), tactics: [] })
    }
    out.push({ text: input.slice(m.start, m.end), tactics: [...m.tactics] })
    cursor = m.end
  }
  if (cursor < input.length) {
    out.push({ text: input.slice(cursor), tactics: [] })
  }
  return out
}
