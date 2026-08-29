# LLM-Led Detection (D15) + Home Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder Kavach's detector pipeline so the LLM leads (briefed by rules, audited, and given one bounded chance to reconsider before rules' §4 override rules apply as the final backstop), removing the current "rules publishes first, LLM upgrades silently" flow — then, on the same touched screens, ship three layers of Home-screen visual craft (tactile depth, a one-time kinetic brand moment, a stretch ambient background) without touching the calm, plain register of Check→Verdict.

**Architecture:** Part A rewrites the detector layer (`src/detector/**`) and the two screens that read its progressive-publish contract (`App.tsx`, `Check.tsx`, `Verdict.tsx`), replacing a two-callback "instant/final" shape with a single `analyze()` call plus an optional phase-only status callback. Part B is purely visual (`tokens.css`, `app.css`, `Home.tsx`, `icons.tsx`) and depends on Part A only because it styles the same Check busy-state screen Part A rebuilds.

**Tech Stack:** TypeScript, React 19, Vite, Tailwind v4 tokens via `tokens.css`, `@mlc-ai/web-llm`, a Vercel Node serverless function (`api/analyze.ts`), plain Node test scripts (no test framework — see `scripts/test-fusion.mjs`'s `check()`/`group()` convention).

**Spec:** `SPEC.md` — read §16 **D15** (the decision this plan implements, including the corrected fusion-formula trade-off), the amended §6 "The orchestrator" and §7 `DetectionInput`/`RuleBriefing`, and §10.6's rewritten Home/Check subsections, before starting. This plan argues from that spec; where this plan and SPEC.md disagree, SPEC.md is the source of truth and the plan should be corrected, not the other way round.

## Global Constraints

- **No subagents for this project** (CLAUDE.md): if using `subagent-driven-development`, that skill's per-task dispatch is still "no subagents" at the *project* level — confirm with the user before choosing that execution mode; **Inline Execution (`executing-plans`) is the default for this repo.**
- **One phase at a time, verified on the iQOO phone, not just the laptop** (CLAUDE.md, SPEC.md §0). A task is not done because it passed on the laptop.
- **The rules engine is invisible** (D2): never named, never shown as a fallback, never surfaced as degraded. No task may add UI copy that names "rules" or "keyword scan" to the user — those phrases are for prompts and code comments only.
- **Never render a number about the message** (§4). The Check busy-state work in this plan shows numbers about the *device* (elapsed time, model tier) — never a confidence, percentage, or score.
- **The `Detector` interface signature never changes**: `detect(input: DetectionInput, signal: AbortSignal): Promise<DetectionResult>`. All new context (briefing, reconsideration) is threaded through `DetectionInput`, never a new parameter.
- **Tokens only** (§10.2, CLAUDE.md non-negotiable 7): no component may hard-code a colour, radius, or duration. If Part B needs a new value, it is added to `tokens.css` first.
- **`prefers-reduced-motion: reduce` must disable all non-essential motion** back to a fully static, fully readable screen (§10.4 guardrail 4) — there is currently no reduced-motion CSS anywhere in the codebase, so Part B must add the first one, not assume one exists.
- Existing test gates that must stay green throughout: `npm run test:corpus`, `npm run test:smoke`, `npm run test:mobile`, `npm run typecheck`. `npm run test:fusion` is rewritten by this plan (Task A4) and must pass its own new assertions.

---

## File Structure

**Part A — detector reorder:**

| File | Responsibility |
|---|---|
| `src/detector/types.ts` | Add `RuleBriefing`, `ReconsiderationPrompt` types; extend `DetectionInput` with `briefing?` and `reconsider?`. |
| `src/detector/rules.ts` | Add `toBriefing(result: DetectionResult): RuleBriefing \| undefined`, pure conversion, no new detection logic. |
| `src/detector/prompt.ts` | Extend `PromptContext` with `briefing?`/`reconsider?`; add `renderBriefing`/`renderReconsideration`; both folded into `buildUserPrompt`. |
| `src/detector/fuse.ts` | Flip `fuseConfidence` to the LLM-centred formula; add `findAuditGap`. |
| `src/detector/local.ts` | Pass `input.briefing`/`input.reconsider` into `buildUserPrompt`. No other change. |
| `src/detector/cloud.ts` | Pass `briefing`/`reconsider` in the POST body to `/api/analyze`. |
| `api/analyze.ts` | Mirror the same `renderBriefing`/`renderReconsideration` logic server-side (this file is intentionally self-contained for Vercel bundling — see its header comment — so the prompt logic is duplicated, not imported). |
| `src/detector/orchestrator.ts` | Rewrite `analyze()`: brief → await LLM → audit → reconsider-once → fuse → backstop. Remove `analyzeProgressive`, `AnalysisStage`, `Stage`. New split `ENGINE_TIMEOUTS`. Add an optional `onPhase` callback (status-only, never carries a verdict). |
| `src/App.tsx` | Replace the two-callback `analyzeProgressive` wiring with one `analyze()` call; track `phase` instead of `pending`; navigate once. |
| `src/screens/Check.tsx` | Busy state becomes a live view: elapsed-time counter, model tier/adapter (from `getDeviceTelemetry()`), and a phase status line. |
| `src/screens/Verdict.tsx` | Remove the `pending` prop and the "upgrading" banner block entirely. |
| `src/ui/copy.ts` | Remove `upgrading` (no longer referenced); add `analyzing_thinking` / `analyzing_reconsidering` status-line strings. |
| `scripts/test-fusion.mjs` | Rewrite the fusion-direction assertions for the new formula (with the corrected rationale from D15); add groups for `toBriefing`, `buildUserPrompt` briefing/reconsideration rendering, `findAuditGap`, and an orchestrator sequencing test using hand-rolled fake `Detector`s. |
| `scripts/smoke.mjs` | Drop the now-removed `pending={false}` prop from its `Verdict` render call. |

**Part B — Home redesign:**

| File | Responsibility |
|---|---|
| `src/ui/tokens.css` | Add motion/entrance tokens (`--dur-brand`, `--ease-emphasis` already exists and is reused) and the first `@media (prefers-reduced-motion: reduce)` block in the codebase. |
| `src/ui/app.css` | Tactile hover/press treatment for `.choice` and `.brand`; keyframes for the one-time brand entrance and the privacy-dot breathing pulse; the stretch ambient-background layer, clearly delimited and easy to delete. |
| `src/ui/icons.tsx` | `ShieldLogo`'s outer-shell `<path>` gets `pathLength={1}` so it can be stroke-drawn by CSS — no visual change to the icon itself, just an animation hook. |
| `src/screens/Home.tsx` | Apply the entrance class once per session (via a small `sessionStorage`-backed check, not a new hook file — this is a three-line concern), add the breathing dot markup to the privacy line. |

---

## Part A — Detector Reorder (D15)

### Task A1: `RuleBriefing` / `ReconsiderationPrompt` types

**Files:**
- Modify: `src/detector/types.ts`
- Test: `scripts/test-fusion.mjs` (new group, added in this task since the type has no runtime behaviour of its own to test in isolation — it's exercised by Task A2's test)

**Interfaces:**
- Produces: `RuleBriefing`, `ReconsiderationPrompt`, extended `DetectionInput`.

- [ ] **Step 1: Add the types**

In `src/detector/types.ts`, immediately after the existing `TacticName` export:

```ts
/**
 * What a fast, deterministic first pass over the message already found,
 * handed to whichever LLM engine runs as context for its own reading — never
 * as a verdict (D15).
 */
export interface RuleBriefing {
  tactics: {
    name: TacticName
    /** Exact phrases the deterministic scan matched, verbatim from the text. */
    matchedPhrases: string[]
  }[]
}

/**
 * Shown to an LLM engine on its second call, when the audit step (D15) found
 * a tactic the engine's first answer omitted despite concrete evidence.
 */
export interface ReconsiderationPrompt {
  /** The engine's own first-pass explanation, so it can be shown its prior answer. */
  priorExplanation: string
  /** The specific rules-found tactic the first pass did not address. */
  missingTactic: {
    name: TacticName
    matchedPhrases: string[]
  }
}
```

Then extend `DetectionInput`:

```ts
export interface DetectionInput {
  text: string
  sender?: string
  channel?: Channel
  /** The rules engine's own read of this message, for the LLM to read before deciding (D15). */
  briefing?: RuleBriefing
  /** Present only on the one bounded second call an engine may receive (D15). */
  reconsider?: ReconsiderationPrompt
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes (nothing consumes the new fields yet, so nothing can be wrong).

- [ ] **Step 3: Commit**

```bash
git add src/detector/types.ts
git commit -m "feat(detector): add RuleBriefing and ReconsiderationPrompt types (D15)"
```

---

### Task A2: `toBriefing` — turn a rules result into a briefing

**Files:**
- Modify: `src/detector/rules.ts`
- Test: `scripts/test-fusion.mjs`

**Interfaces:**
- Consumes: `RuleBriefing` (Task A1), `DetectionResult`, `Tactic` (existing).
- Produces: `toBriefing(result: DetectionResult): RuleBriefing | undefined`.

- [ ] **Step 1: Write the failing test**

Add near the top of `scripts/test-fusion.mjs`, after the existing imports, add one more:

```js
const { analyzeWithRules, toBriefing } = await import(mod('src/detector/rules.ts'))
```

(This replaces the existing `const { analyzeWithRules } = await import(mod('src/detector/rules.ts'))` line — just add `toBriefing` to the destructure.)

Add a new group, placed after the existing `group('mergeTactics')` block and before `group('fuse — end to end')`:

```js
/* ------------------------------------------------------------------ */
group('toBriefing')

{
  const scam = { text: 'Stay on the call and share the OTP now, do not tell anyone.', channel: 'text' }
  const rules = analyzeWithRules(scam, NO_SENDER)
  const briefing = toBriefing(rules)
  check(briefing !== undefined, 'a message with tactics produces a briefing')
  check(
    briefing.tactics.every((t) => t.matchedPhrases.length > 0),
    'every briefed tactic carries at least one matched phrase',
  )
  check(
    briefing.tactics.some((t) => t.name === 'extraction'),
    'the extraction tactic rules found is present in the briefing',
    JSON.stringify(briefing),
  )
}

{
  const legit = { text: 'Your OTP is 4821. Do not share this OTP with anyone.', channel: 'text' }
  const rules = analyzeWithRules(legit, NO_SENDER)
  const briefing = toBriefing(rules)
  check(briefing === undefined, 'a message rules found nothing in produces no briefing at all')
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:fusion`
Expected: FAIL — `toBriefing` is not exported from `rules.ts`.

- [ ] **Step 3: Implement `toBriefing`**

In `src/detector/rules.ts`, add near the bottom of the file (after `analyzeWithRules` is defined) — check the existing import line at the top of the file first and add `RuleBriefing` to whatever it imports from `./types.ts`:

```ts
/**
 * Convert a rules result into a briefing for the LLM (D15). `undefined` when
 * rules found nothing — an empty briefing paragraph in the prompt is noise,
 * not information.
 */
export function toBriefing(result: DetectionResult): RuleBriefing | undefined {
  const tactics = result.tactics
    .filter((t) => t.evidence.length > 0)
    .map((t) => ({
      name: t.name,
      matchedPhrases: t.evidence.map((e) => e.phrase),
    }))

  return tactics.length > 0 ? { tactics } : undefined
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:fusion`
Expected: PASS, including the two new `toBriefing` checks.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/detector/rules.ts scripts/test-fusion.mjs
git commit -m "feat(detector): add toBriefing, converting a rules result to LLM context (D15)"
```

---

### Task A3: Prompt rendering for briefing and reconsideration

**Files:**
- Modify: `src/detector/prompt.ts`
- Test: `scripts/test-fusion.mjs`

**Interfaces:**
- Consumes: `RuleBriefing`, `ReconsiderationPrompt` (Task A1).
- Produces: `buildUserPrompt` accepts `briefing?` and `reconsider?` on its `PromptContext`; new exported `renderBriefing`, `renderReconsideration` (exported so `api/analyze.ts` and the test file can each verify the exact text independently).

- [ ] **Step 1: Write the failing test**

Add to the import line for `prompt.ts` in `scripts/test-fusion.mjs` (a new import — `prompt.ts` was not previously imported by this file):

```js
const { buildUserPrompt, renderBriefing, renderReconsideration } = await import(
  mod('src/detector/prompt.ts')
)
```

New group, placed after `group('toBriefing')`:

```js
/* ------------------------------------------------------------------ */
group('buildUserPrompt — briefing and reconsideration (D15)')

{
  const plain = buildUserPrompt({ text: 'hello', channel: 'text', senderFact: null })
  check(!plain.includes('keyword scan'), 'no briefing text appears when none is given')
}

{
  const briefing = { tactics: [{ name: 'extraction', matchedPhrases: ['share the OTP'] }] }
  const withBriefing = buildUserPrompt({ text: 'hello', channel: 'text', senderFact: null, briefing })
  check(withBriefing.includes('share the OTP'), 'a briefed matched phrase is included verbatim')
  check(withBriefing.includes('extraction'), 'the briefed tactic name is included')
  check(
    renderBriefing(briefing).includes('confirm, refine, or add'),
    'the briefing text instructs the model to read for itself, not just repeat the scan',
  )
}

{
  const reconsider = {
    priorExplanation: 'This looks like a routine notice.',
    missingTactic: { name: 'isolation', matchedPhrases: ['do not tell anyone'] },
  }
  const withReconsider = buildUserPrompt({
    text: 'hello',
    channel: 'text',
    senderFact: null,
    reconsider,
  })
  check(withReconsider.includes('This looks like a routine notice.'), "the prior answer's explanation is shown back to the model")
  check(withReconsider.includes('do not tell anyone'), 'the specific missed phrase is shown')
  check(
    renderReconsideration(reconsider).includes('already answered'),
    'the reconsideration text tells the model this is a second look',
  )
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:fusion`
Expected: FAIL — `renderBriefing`/`renderReconsideration` not exported, `buildUserPrompt` does not accept `briefing`/`reconsider`.

- [ ] **Step 3: Implement**

In `src/detector/prompt.ts`, update the imports at the top to also bring in the new types:

```ts
import type { Channel, RuleBriefing, ReconsiderationPrompt } from './types.ts'
```

Add these two exported functions above `buildUserPrompt`:

```ts
/**
 * Render what a deterministic keyword scan already found, as context for the
 * model — never as a verdict, and never with a number (D15).
 */
export function renderBriefing(briefing: RuleBriefing): string {
  const lines = briefing.tactics.map(
    (t) => `${t.name} (matched: ${t.matchedPhrases.map((p) => `"${p}"`).join(', ')})`,
  )
  return [
    'A separate keyword scan already ran on this message and found possible signs of:',
    lines.join('; '),
    'It cannot read meaning, only match known phrases — read the message yourself and confirm, refine, or add to this. Check specifically for anything it would have missed.',
  ].join('\n')
}

/**
 * Render the one bounded second-look prompt an engine sees when the audit
 * step found a concrete gap in its first answer (D15).
 */
export function renderReconsideration(reconsider: ReconsiderationPrompt): string {
  const { priorExplanation, missingTactic } = reconsider
  return [
    `You already answered this once. Your explanation was: "${priorExplanation}"`,
    `A keyword scan independently found a possible ${missingTactic.name} signal your answer did not address, matching: ${missingTactic.matchedPhrases.map((p) => `"${p}"`).join(', ')}.`,
    'Look at the message again. If this changes your reading, update your tactics and confidence to reflect it. If you still disagree, keep your answer, but make sure "explanation" says why this specific point does not change your reading.',
  ].join('\n')
}
```

Update `PromptContext` and `buildUserPrompt`:

```ts
export interface PromptContext {
  text: string
  channel: Channel
  senderFact: string | null
  briefing?: RuleBriefing
  reconsider?: ReconsiderationPrompt
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

  if (briefing && briefing.tactics.length > 0) {
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:fusion`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
git add src/detector/prompt.ts scripts/test-fusion.mjs
git commit -m "feat(detector): render rule briefing and reconsideration context in the shared prompt (D15)"
```

---

### Task A4: Re-centre fusion on the LLM, add `findAuditGap`

**This is the task with a real behaviour change — read SPEC.md §16 D15 point 4 before touching the formula.** The new invariant is `fuseConfidence(rules, llm) >= llm` (not `>= rules`, which was D12's guarantee). A rules-confident, LLM-dismissed scam that has no tactic with concrete evidence for the audit step to catch **will** now fuse to a lower verdict than before — that is the accepted trade-off, and the existing "confidently wrong LLM cannot downgrade it" test must be rewritten to test the *new* real guarantee (the tactic union + §4 overrides), not the old numeric one.

**Files:**
- Modify: `src/detector/fuse.ts`
- Modify: `scripts/test-fusion.mjs` (rewrite the fusion-direction assertions)

**Interfaces:**
- Consumes: `Tactic`, `TacticName` (existing).
- Produces: `fuseConfidence` (same signature, new formula), `findAuditGap(rulesTactics, llmTactics): Tactic | null`.

- [ ] **Step 1: Update the failing/changed assertions first**

In `scripts/test-fusion.mjs`, replace the entire `group('Confidence fusion (weighted noisy-OR)')` block with:

```js
/* ------------------------------------------------------------------ */
group('Confidence fusion (weighted noisy-OR, re-centred on the LLM — D15)')

const table = [
  [0.2, 0.2, 'safe'],
  [0.5, 0.5, 'danger'],
  [0.9, 0.0, 'danger'], // a confident LLM alone still reaches danger
  [0.0, 0.8, 'danger'], // rules corroborating a confident LLM still reaches danger
  [0.0, 0.0, 'safe'],
]
for (const [l, r] of table) {
  const f = fuseConfidence(r, l)
  const expected = Math.min(1, l + LLM_WEIGHT * r * (1 - l))
  check(
    Math.abs(f - expected) < 1e-9,
    `fuse(rules=${r}, llm=${l}) = ${f.toFixed(3)}`,
    `expected ${expected.toFixed(3)}`,
  )
}

check(fuseConfidence(0.2, 0.2) < 0.35, 'two weak signals stay below the caution threshold')
check(fuseConfidence(0.5, 0.5) >= 0.7, 'two moderate signals agreeing reach danger')
check(fuseConfidence(0, 0.9) >= 0.7, 'a confident LLM alone can reach danger on a novel scam rules missed')

// The invariant flips with D15: the LLM is now the base the rules engine can
// only add to, never subtract from. See SPEC.md §16 D15 point 4 for why the
// old "rules is the floor" guarantee does not survive re-centring, and why
// that is an intentional trade rather than a regression.
let monotonic = true
for (let r = 0; r <= 1.0001; r += 0.05) {
  for (let l = 0; l <= 1.0001; l += 0.05) {
    if (fuseConfidence(r, l) < l - 1e-9) monotonic = false
  }
}
check(monotonic, 'rules can never lower the LLM confidence (441 combinations)')
```

Then find the existing test named `'a confidently wrong LLM cannot downgrade it'` inside `group('fuse — end to end')` (the second block under that group, using the KYC-scam fixture with `PERSONAL` sender) and replace its body with:

```js
{
  // D15: the numeric floor moved from rules to the LLM. What still holds is
  // the tactic union + §4 overrides — a concrete, evidenced tactic rules
  // found cannot be erased by a dismissive LLM, even though the raw fused
  // *number* can now come in under what rules alone would have scored.
  const scam = {
    text: 'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. Update your KYC immediately at http://sbi-kyc-verify.in/update to avoid suspension.',
    channel: 'text',
  }
  const rules = analyzeWithRules(scam, PERSONAL)
  const llm = asLlm(
    {
      confidence: 0.02,
      tactics: [],
      explanation: 'This looks like a routine bank notification.',
      nextMove: 'Nothing is being asked of you.',
    },
    scam,
    PERSONAL,
  )
  const fused = fuse({ rules, llm })
  check(rules.verdict === 'danger', 'rules alone calls the KYC scam danger')
  check(
    fused.tactics.some((t) => t.name === 'urgency' || t.name === 'extraction'),
    "rules' tactics survive into the fused result even though the LLM reported none",
    JSON.stringify(fused.tactics.map((t) => t.name)),
  )
  check(
    fused.verdict !== 'safe',
    'the merged tactic evidence keeps a dismissed scam off "safe" at minimum',
    `got ${fused.verdict}`,
  )
}
```

- [ ] **Step 2: Run to verify the new expectations fail against the old implementation**

Run: `npm run test:fusion`
Expected: FAIL on the new "Confidence fusion" group's formula checks and the monotonic-in-`llm` check (the old formula is monotonic in `rules`, not `llm`).

- [ ] **Step 3: Implement the new formula and `findAuditGap`**

In `src/detector/fuse.ts`, replace the `fuseConfidence` function and its doc comment:

```ts
/**
 * How much a confident rules signal can add on its own — SPEC.md §16 D15.
 *
 * Fusion is a weighted noisy-OR, now centred on the LLM: `fused = l + w·r·(1 − l)`.
 * The LLM is the primary reading; rules can still raise it, but the numeric
 * floor is the LLM's own confidence, not the rules engine's — the flip of
 * D12's guarantee. See SPEC.md §16 D15 point 4 for the accepted trade-off
 * this makes, and why the real protection against a wrong LLM moved to
 * `findAuditGap` and the §4 override rules rather than this formula.
 */
export const LLM_WEIGHT = 0.85

export function fuseConfidence(rules: number, llm: number): number {
  return Math.min(1, llm + LLM_WEIGHT * rules * (1 - llm))
}

/**
 * The rules-found tactic, with real evidence, that the LLM's raw answer is
 * missing — or `null` when there is nothing to reconsider (D15).
 *
 * When more than one is missing, the most diagnostic tactic is returned
 * first, matching §8.3's weighting guidance (isolation is the strongest
 * signal with almost no legitimate counterpart; urgency the weakest on its
 * own) — the single reconsideration call this drives should spend itself on
 * the finding most likely to actually change the verdict.
 */
const AUDIT_PRIORITY: readonly TacticName[] = ['isolation', 'extraction', 'authority', 'urgency']

export function findAuditGap(
  rulesTactics: readonly Tactic[],
  llmTactics: readonly Tactic[],
): Tactic | null {
  const llmNames = new Set(llmTactics.map((t) => t.name))
  const byName = new Map(rulesTactics.map((t) => [t.name, t] as const))

  for (const name of AUDIT_PRIORITY) {
    const candidate = byName.get(name)
    if (candidate && candidate.evidence.length > 0 && !llmNames.has(name)) {
      return candidate
    }
  }
  return null
}
```

Add `TacticName` to the type-only import at the top of `fuse.ts` (currently `import type { DetectionResult, Evidence, Tactic } from './types.ts'` — add `TacticName`).

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:fusion`
Expected: PASS, all groups.

- [ ] **Step 5: Add `findAuditGap` tests**

Add a new group after `group('mergeTactics')`:

```js
/* ------------------------------------------------------------------ */
group('findAuditGap')

{
  const rulesT = [
    { name: 'isolation', label: 'x', note: 'n', evidence: [{ phrase: 'do not tell anyone', start: 0, end: 18 }] },
  ]
  const llmT = []
  const gap = findAuditGap(rulesT, llmT)
  check(gap !== null && gap.name === 'isolation', 'a rules tactic missing from the LLM answer is returned')
}

{
  const rulesT = [
    { name: 'urgency', label: 'x', note: 'n', evidence: [{ phrase: 'blocked within 24 hours', start: 0, end: 10 }] },
  ]
  const llmT = [
    { name: 'urgency', label: 'x', note: 'n', evidence: [{ phrase: 'blocked within 24 hours', start: 0, end: 10 }] },
  ]
  check(findAuditGap(rulesT, llmT) === null, 'no gap when both engines already agree')
}

{
  const rulesT = [
    { name: 'authority', label: 'x', note: 'n', evidence: [] }, // no evidence — never a valid gap
  ]
  check(findAuditGap(rulesT, []) === null, 'a rules tactic with no evidence is never an audit gap')
}

{
  // Priority: isolation over extraction when both are missing.
  const rulesT = [
    { name: 'extraction', label: 'x', note: 'n', evidence: [{ phrase: 'share the OTP', start: 0, end: 10 }] },
    { name: 'isolation', label: 'x', note: 'n', evidence: [{ phrase: 'do not tell anyone', start: 20, end: 38 }] },
  ]
  const gap = findAuditGap(rulesT, [])
  check(gap.name === 'isolation', 'isolation is chosen over extraction when both are missing, per §8.3 priority')
}
```

Update the import destructure for `fuse.ts` at the top of the file to include `findAuditGap`:

```js
const { fuse, fuseConfidence, mergeTactics, findAuditGap, LLM_WEIGHT } = await import(mod('src/detector/fuse.ts'))
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm run test:fusion`
Expected: PASS, all groups including `findAuditGap`.

- [ ] **Step 7: Typecheck and commit**

```bash
git add src/detector/fuse.ts scripts/test-fusion.mjs
git commit -m "feat(detector): re-centre fusion on the LLM and add findAuditGap (D15)"
```

---

### Task A5: Thread briefing/reconsideration through `LocalDetector`

**Files:**
- Modify: `src/detector/local.ts`

**Interfaces:**
- Consumes: `buildUserPrompt` (Task A3, now accepting `briefing`/`reconsider`).

- [ ] **Step 1: Update the prompt call**

In `src/detector/local.ts`, inside `detect`, change:

```ts
content: buildUserPrompt({
  text: input.text,
  channel: input.channel ?? 'text',
  senderFact: fact,
}),
```

to:

```ts
content: buildUserPrompt({
  text: input.text,
  channel: input.channel ?? 'text',
  senderFact: fact,
  briefing: input.briefing,
  reconsider: input.reconsider,
}),
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Manual check via the dev engine harness**

Run: `npm run dev`, open `/dev/engines`, paste the isolation+extraction fixture (`"Stay on the call and share the OTP now, do not tell anyone."`) with local selected. This doesn't yet exercise briefing (orchestrator wiring is Task A7), so confirm only that nothing broke — the result should look identical to before this task.

- [ ] **Step 4: Commit**

```bash
git add src/detector/local.ts
git commit -m "feat(detector): thread rule briefing and reconsideration into LocalDetector's prompt (D15)"
```

---

### Task A6: Thread briefing/reconsideration through `CloudDetector` and `api/analyze.ts`

**Files:**
- Modify: `src/detector/cloud.ts`
- Modify: `api/analyze.ts`

**Interfaces:**
- Consumes: `RuleBriefing`, `ReconsiderationPrompt` (Task A1).
- Produces: extended POST body contract for `/api/analyze`.

- [ ] **Step 1: Extend the client request body**

In `src/detector/cloud.ts`, change the `fetch` call's body to include the new fields:

```ts
body: JSON.stringify({
  text: input.text,
  channel: input.channel ?? 'text',
  ...(fact ? { sender: fact } : {}),
  ...(input.briefing ? { briefing: input.briefing } : {}),
  ...(input.reconsider ? { reconsider: input.reconsider } : {}),
}),
```

- [ ] **Step 2: Mirror the prompt-rendering logic server-side**

`api/analyze.ts` cannot import from `src/detector/**` (it must stay self-contained for Vercel's bundler — see its header comment). Add the same two render functions and extend its own local `PromptContext`/`buildUserPrompt`, keeping this file's independent copy in sync with `src/detector/prompt.ts`'s Task A3 logic.

In `api/analyze.ts`, after the existing `VOICE_NOTE` constant, add:

```ts
interface RuleBriefing {
  tactics: { name: string; matchedPhrases: string[] }[]
}

interface ReconsiderationPrompt {
  priorExplanation: string
  missingTactic: { name: string; matchedPhrases: string[] }
}

function renderBriefing(briefing: RuleBriefing): string {
  const lines = briefing.tactics.map(
    (t) => `${t.name} (matched: ${t.matchedPhrases.map((p) => `"${p}"`).join(', ')})`,
  )
  return [
    'A separate keyword scan already ran on this message and found possible signs of:',
    lines.join('; '),
    'It cannot read meaning, only match known phrases — read the message yourself and confirm, refine, or add to this. Check specifically for anything it would have missed.',
  ].join('\n')
}

function renderReconsideration(reconsider: ReconsiderationPrompt): string {
  const { priorExplanation, missingTactic } = reconsider
  return [
    `You already answered this once. Your explanation was: "${priorExplanation}"`,
    `A keyword scan independently found a possible ${missingTactic.name} signal your answer did not address, matching: ${missingTactic.matchedPhrases.map((p) => `"${p}"`).join(', ')}.`,
    'Look at the message again. If this changes your reading, update your tactics and confidence to reflect it. If you still disagree, keep your answer, but make sure "explanation" says why this specific point does not change your reading.',
  ].join('\n')
}
```

Update `PromptContext` and `buildUserPrompt` in the same file:

```ts
export interface PromptContext {
  text: string
  channel: 'text' | 'voice'
  senderFact: string | null
  briefing?: RuleBriefing
  reconsider?: ReconsiderationPrompt
}

export function buildUserPrompt({ text, channel, senderFact, briefing, reconsider }: PromptContext): string {
  const parts: string[] = []

  if (channel === 'voice') parts.push(VOICE_NOTE)

  if (senderFact) {
    parts.push(`Established fact about the sender: ${senderFact}`)
  } else {
    parts.push('The sender is unknown. Do not speculate about it.')
  }

  if (briefing && briefing.tactics.length > 0) {
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
```

- [ ] **Step 3: Parse the new body fields in `handler`**

In `api/analyze.ts`'s `handler`, extend the `payloadBody` type and destructure, and pass the values through to `buildUserPrompt`:

```ts
const payloadBody = (body && typeof body === 'object' ? body : {}) as {
  text?: unknown
  sender?: unknown
  channel?: unknown
  briefing?: unknown
  reconsider?: unknown
}
```

```ts
const briefing =
  payloadBody.briefing && typeof payloadBody.briefing === 'object'
    ? (payloadBody.briefing as RuleBriefing)
    : undefined

const reconsider =
  payloadBody.reconsider && typeof payloadBody.reconsider === 'object'
    ? (payloadBody.reconsider as ReconsiderationPrompt)
    : undefined
```

and in the `fetch` call's body, change:

```ts
{ role: 'user', content: buildUserPrompt({ text, channel, senderFact }) },
```

to:

```ts
{ role: 'user', content: buildUserPrompt({ text, channel, senderFact, briefing, reconsider }) },
```

**Deliberately not accepting a raw `messages` array or arbitrary role list** — D12 already ruled that out (`api/analyze.ts`'s job is one narrow, fixed-system-prompt task, not a general LLM proxy on the owner's key). `briefing`/`reconsider` stay named, typed, bounded fields.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 5: Manual smoke test against the deployed function (or `vercel dev` if available locally)**

If a local Vercel dev server isn't set up, this step is verified once Task A7 wires the orchestrator end-to-end and `/dev/engines` can exercise the cloud path — note that dependency here and revisit after A7 if this step can't run standalone yet.

- [ ] **Step 6: Commit**

```bash
git add src/detector/cloud.ts api/analyze.ts
git commit -m "feat(api): mirror rule briefing and reconsideration in the cloud endpoint (D15)"
```

---

### Task A7: Rewrite the orchestrator

**This is the central task.** Read SPEC.md's amended §6 "The orchestrator" section in full before starting — this task implements that section's 8-step sequence exactly.

**Files:**
- Modify: `src/detector/orchestrator.ts`
- Test: `scripts/test-fusion.mjs`

**Interfaces:**
- Consumes: `toBriefing` (A2), `findAuditGap` (A4), `fuse`/`fuseConfidence` (A4), `RuleBriefing`/`ReconsiderationPrompt` (A1).
- Produces: `analyze(input, preference, signal?, onPhase?): Promise<DetectionResult>` (replaces both the old `analyze` and `analyzeProgressive`); `export type AnalysisPhase = 'thinking' | 'reconsidering'`.
- **Removes:** `analyzeProgressive`, `AnalysisStage`, `Stage`. Anything importing these (`App.tsx`, `Listen.tsx`, `Verdict.tsx`) is fixed in Tasks A8/A10 and a follow-up pass on `Listen.tsx` — grep for `analyzeProgressive` before finishing this task to make sure every call site is caught.

- [ ] **Step 1: Write failing orchestrator-sequencing tests**

These need fake engines, since the real ones need WebGPU/network. Add a new group to `scripts/test-fusion.mjs`, after the `group('fuse — end to end')` block, importing the orchestrator module fresh (add this import near the top with the others):

```js
const orchestratorMod = await import(mod('src/detector/orchestrator.ts'))
const { analyze } = orchestratorMod
```

```js
/* ------------------------------------------------------------------ */
group('orchestrator — brief, decide, audit, reconsider (D15)')

/** A fake Detector that returns canned answers per call, and records every
 *  DetectionInput it was called with so the test can inspect what it saw. */
function fakeEngine(id, answers) {
  const calls = []
  let i = 0
  return {
    detector: {
      id,
      async isAvailable() {
        return true
      },
      async detect(input) {
        calls.push(input)
        const answer = answers[Math.min(i, answers.length - 1)]
        i++
        if (answer instanceof Error) throw answer
        return answer
      },
    },
    calls,
  }
}

{
  // The LLM's first answer already agrees with rules — no reconsideration call.
  const scam = { text: 'Stay on the call and share the OTP now, do not tell anyone.', channel: 'text' }
  const agree = asLlm(
    {
      confidence: 0.8,
      tactics: [
        { name: 'isolation', evidence: ['do not tell anyone'], note: 'x' },
        { name: 'extraction', evidence: ['share the OTP'], note: 'x' },
      ],
      explanation: 'It isolates you and asks for your code.',
      nextMove: 'They want the OTP.',
    },
    scam,
  )
  const fake = fakeEngine('local', [agree])
  const result = await analyze(scam, 'local', undefined, undefined, { local: fake.detector })
  check(fake.calls.length === 1, 'no reconsideration call when the first answer already covers the rules findings')
  check(fake.calls[0].briefing !== undefined, 'the first call is briefed with the rules findings')
  check(result.verdict === 'danger', 'agreement on two tactics reaches danger')
}

{
  // The LLM misses isolation on its first pass, addresses it on reconsideration.
  const scam = { text: 'Stay on the call and share the OTP now, do not tell anyone.', channel: 'text' }
  const missed = asLlm(
    {
      confidence: 0.5,
      tactics: [{ name: 'extraction', evidence: ['share the OTP'], note: 'x' }],
      explanation: 'It asks for your code.',
      nextMove: 'They want the OTP.',
    },
    scam,
  )
  const corrected = asLlm(
    {
      confidence: 0.85,
      tactics: [
        { name: 'extraction', evidence: ['share the OTP'], note: 'x' },
        { name: 'isolation', evidence: ['do not tell anyone'], note: 'x' },
      ],
      explanation: 'It also isolates you from checking with anyone.',
      nextMove: 'They want the OTP.',
    },
    scam,
  )
  const fake = fakeEngine('local', [missed, corrected])
  const result = await analyze(scam, 'local', undefined, undefined, { local: fake.detector })
  check(fake.calls.length === 2, 'a missed tactic with real evidence triggers exactly one reconsideration call')
  check(fake.calls[1].reconsider?.missingTactic.name === 'isolation', 'the reconsideration call names the specific missed tactic')
  check(result.tactics.some((t) => t.name === 'isolation'), 'the corrected answer is reflected in the final result')
}

{
  // The LLM still disagrees after reconsidering — never a third call, and the
  // rules-found tactic still survives into the final result via the audit.
  const scam = { text: 'Stay on the call and share the OTP now, do not tell anyone.', channel: 'text' }
  const missed = asLlm(
    {
      confidence: 0.3,
      tactics: [{ name: 'extraction', evidence: ['share the OTP'], note: 'x' }],
      explanation: 'It asks for your code.',
      nextMove: 'They want the OTP.',
    },
    scam,
  )
  const stillMissed = asLlm(
    {
      confidence: 0.3,
      tactics: [{ name: 'extraction', evidence: ['share the OTP'], note: 'x' }],
      explanation: 'I disagree, this still just looks like a code request.',
      nextMove: 'They want the OTP.',
    },
    scam,
  )
  const fake = fakeEngine('local', [missed, stillMissed])
  const result = await analyze(scam, 'local', undefined, undefined, { local: fake.detector })
  check(fake.calls.length === 2, 'reconsideration is bounded to exactly one retry even when the model still disagrees')
  check(
    result.tactics.some((t) => t.name === 'isolation'),
    "the rules-found tactic is unioned into the final result even though the LLM never accepted it",
  )
  check(result.verdict !== 'safe', 'the merged evidence keeps the result off safe')
}

{
  // Every LLM call fails — silent rules-only fallback (D2), unchanged.
  const scam = { text: 'Stay on the call and share the OTP now, do not tell anyone.', channel: 'text' }
  const fake = fakeEngine('local', [new Error('model crashed')])
  const result = await analyze(scam, 'local', undefined, undefined, { local: fake.detector })
  check(fake.calls.length === 1, 'a failed engine is not retried as if it were a reconsideration')
  check(result.engineUsed === 'rules', 'a total engine failure falls back to the rules-only result')
  check(result.verdict === 'danger', 'the rules-only fallback still reaches the correct verdict on its own')
}
```

This test design needs `analyze` to accept an optional 5th parameter — an engine-override map — purely for testability. Add it as the plan implements in Step 3 below; production call sites never pass it.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:fusion`
Expected: FAIL — current `analyze` delegates to `analyzeProgressive` with a different signature and no reconsideration logic.

- [ ] **Step 3: Rewrite `orchestrator.ts`**

Replace the entire file contents with:

```ts
import type {
  DetectionInput,
  DetectionResult,
  Detector,
  ReconsiderationPrompt,
} from './types.ts'
import { analyzeWithRules, toBriefing } from './rules.ts'
import { classifySender } from './sender.ts'
import { validateResult } from './validate.ts'
import { cloudDetector } from './cloud.ts'
import { localDetector } from './local.ts'
import { fuse, findAuditGap } from './fuse.ts'

/**
 * The orchestrator — SPEC.md §6, decision D15.
 *
 * The UI calls only this and never touches an engine.
 *
 *   1. Classify the sender once, deterministically (D9).
 *   2. Run the rules engine synchronously. Its result is not shown — it
 *      becomes the briefing handed to the LLM.
 *   3. Await the LLM, briefed. Nothing is published before this resolves.
 *   4. Audit: does the LLM's answer cover every rules-found tactic with real
 *      evidence?
 *   5. If not, one bounded reconsideration call, showing the LLM its own
 *      first answer and the specific finding it missed.
 *   6. Fuse (re-centred on the LLM, D15) and decide via the shared §4 rules.
 *   7. If every LLM attempt failed or the engine is unavailable, the rules
 *      result stands, silently (D2) — the only path where a rules-only
 *      result is ever shown.
 *
 * The user never learns which engines ran, or that a second call happened.
 */

export type EnginePreference = 'local' | 'cloud' | 'none'

/** Status-only. Never carries a result — nothing is shown before `analyze`
 *  resolves (D15). Purely for a "still thinking" / "double-checking one
 *  detail" caption on the Check screen. */
export type AnalysisPhase = 'thinking' | 'reconsidering'

export const ENGINE_TIMEOUTS = {
  local: { first: 120_000, reconsider: 60_000 },
  cloud: { first: 15_000, reconsider: 15_000 },
} as const

const LLM_ENGINES: Record<Exclude<EnginePreference, 'none'>, Detector> = {
  local: localDetector,
  cloud: cloudDetector,
}

function withTimeout(
  ms: number,
  external?: AbortSignal,
): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)

  const forward = () => controller.abort()
  external?.addEventListener('abort', forward, { once: true })

  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', forward)
    },
  }
}

async function runOnce(
  engine: Detector,
  input: DetectionInput,
  budgetMs: number,
  external?: AbortSignal,
): Promise<DetectionResult | null> {
  const { signal, done } = withTimeout(budgetMs, external)
  try {
    if (!(await engine.isAvailable())) return null
    return validateResult(await engine.detect(input, signal))
  } catch (err) {
    console.info(`[kavach] ${engine.id} engine did not answer (${(err as Error).message}) — continuing`)
    return null
  } finally {
    done()
  }
}

/**
 * Analyse a message. Resolves once, with the final result. Never throws.
 *
 * `onPhase`, when given, is called zero or more times with a status label
 * only — never a `DetectionResult` — so a UI can show "thinking" /
 * "reconsidering" captions without anything resembling an early verdict.
 *
 * `engineOverride` exists only for tests: it substitutes a fake `Detector`
 * for the given preference instead of the real local/cloud engine. Never
 * pass it from application code.
 */
export async function analyze(
  input: DetectionInput,
  preference: EnginePreference = 'local',
  signal?: AbortSignal,
  onPhase?: (phase: AnalysisPhase) => void,
  engineOverride?: Partial<Record<Exclude<EnginePreference, 'none'>, Detector>>,
): Promise<DetectionResult> {
  const senderSignal = classifySender(input.sender)
  const rules = analyzeWithRules(input, senderSignal)

  if (preference === 'none') return rules

  const engine = engineOverride?.[preference] ?? LLM_ENGINES[preference]
  const budgets = ENGINE_TIMEOUTS[preference]
  const briefing = toBriefing(rules)

  onPhase?.('thinking')
  let llm = await runOnce(engine, { ...input, briefing }, budgets.first, signal)

  if (llm) {
    const gap = findAuditGap(rules.tactics, llm.tactics)
    if (gap) {
      const reconsider: ReconsiderationPrompt = {
        priorExplanation: llm.explanation,
        missingTactic: { name: gap.name, matchedPhrases: gap.evidence.map((e) => e.phrase) },
      }
      onPhase?.('reconsidering')
      const reconsidered = await runOnce(
        engine,
        { ...input, briefing, reconsider },
        budgets.reconsider,
        signal,
      )
      if (reconsidered) llm = reconsidered
    }
  }

  let result = rules
  if (llm) {
    try {
      result = fuse({ rules, llm })
    } catch (err) {
      console.error('[kavach] fusion produced an invalid result', err)
      result = rules
    }
  }

  console.info(
    `[kavach] ${llm ? `rules+${llm.engineUsed}` : 'rules'} · ${result.verdict} · ` +
      `${result.latencyMs}ms · conf ${result.confidence.toFixed(2)}` +
      (llm ? ` (rules ${rules.confidence.toFixed(2)}, llm ${llm.confidence.toFixed(2)})` : ''),
  )

  return result
}
```

Note what this removes relative to the old file: `analyzeProgressive`, `AnalysisStage`, `Stage`, and the `LLM_ENGINES` array-of-engines-per-preference shape (there was never more than one real engine per preference, so this simplifies to a direct map).

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:fusion`
Expected: PASS, including all four new orchestrator-group checks.

- [ ] **Step 5: Find every other call site**

Run: `grep -rn "analyzeProgressive\|AnalysisStage\|from './orchestrator" src/` (or the Grep tool) and fix every remaining reference. At minimum expect:
- `src/App.tsx` — fixed in Task A8.
- `src/screens/Verdict.tsx` — fixed in Task A10.
- `src/screens/Listen.tsx` — uses the orchestrator for the live loop with `preference: 'none'`, per D13's original reasoning (still valid: a rolling transcript re-analysed every few seconds should never trigger an LLM call per tick). Update its call to the new `analyze(input, 'none', signal)` signature — same behaviour, since `'none'` short-circuits to the rules result unconditionally in the new code too. If `Listen.tsx` also calls the full stack once when the user stops (per its original spec), update that call site to the new signature as well, with `preference` set to whatever the engine switch currently holds.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: will still fail at `App.tsx`/`Verdict.tsx`/`Listen.tsx` until Tasks A8/A10 land — that's expected at this point in the plan. Confirm the *only* errors remaining are in those three files, not elsewhere.

- [ ] **Step 7: Commit**

```bash
git add src/detector/orchestrator.ts scripts/test-fusion.mjs
git commit -m "feat(detector): rewrite orchestrator around brief/decide/audit/reconsider (D15)"
```

(`App.tsx`/`Verdict.tsx`/`Listen.tsx` are left broken by this commit on purpose — the next two tasks fix them. If your workflow requires every commit to typecheck clean, fold Tasks A7/A8/A10 into one commit instead; call this out to whoever executes the plan.)

---

### Task A8: `App.tsx` — single `analyze()` call, no progressive publish

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `analyze`, `AnalysisPhase` (Task A7).

- [ ] **Step 1: Replace the progressive wiring**

In `src/App.tsx`, change the import:

```ts
import { analyze, type AnalysisPhase, type EnginePreference } from './detector/orchestrator'
```

Replace the `pending` state with `phase`:

```ts
const [phase, setPhase] = useState<AnalysisPhase | null>(null)
```

Replace the body of `runCheck`:

```ts
const runCheck = useCallback(
  async (input: DetectionInput) => {
    const id = ++runId.current
    setBusy(true)
    setPhase(null)
    setAnalysed(input.text)

    try {
      const result = await analyze(input, enginePreference, undefined, (p) => {
        if (id === runId.current) setPhase(p)
      })
      if (id !== runId.current) return
      setResult(result)
      setBusy(false)
      setPhase(null)
      navigate('/result')
    } finally {
      if (id === runId.current) {
        setBusy(false)
        setPhase(null)
      }
    }
  },
  [navigate, enginePreference],
)
```

Remove `setPending`/`pending` everywhere else in the file (the `triggerFailsafe` callback and the `<Verdict pending={pending} .../>` prop). `triggerFailsafe` no longer needs to touch `pending` at all — delete that one line.

- [ ] **Step 2: Update the `Check` and `Verdict` props**

Pass `phase` into `Check` instead of nothing extra (Task A9 adds the prop to `Check`'s signature):

```tsx
if (path === '/check') {
  return <Check onBack={() => navigate('/')} onSubmit={runCheck} busy={busy} phase={phase} />
}
```

Remove the `pending={pending}` prop from the `<Verdict>` element (Task A10 removes it from `Verdict`'s signature).

- [ ] **Step 3: Update the file's own header comment**

The comment above `App` currently explains why analysis lives here "because it outlives [the Check] screen" under D13. Replace it:

```ts
/**
 * Screens compose, components render, the detector decides (§10.3).
 *
 * The analysis still lives here rather than in `Check` so that navigating
 * away and back (or a cancelled and restarted check) is unambiguous via
 * `runId` — but under D15 it no longer needs to outlive the screen the way
 * D13's progressive upgrade did: `analyze()` resolves once, and `App`
 * navigates to `/result` exactly once, with the final result.
 *
 * Routing is path-based so Android's back button leaves a screen rather than
 * closing the installed PWA.
 */
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: `App.tsx` now clean; remaining errors (if any) are in `Verdict.tsx`/`Listen.tsx`, fixed next.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): call analyze() once instead of the progressive two-stage publish (D15)"
```

---

### Task A9: `Check.tsx` — live busy view

**Files:**
- Modify: `src/screens/Check.tsx`
- Modify: `src/ui/copy.ts` (new status strings)

**Interfaces:**
- Consumes: `AnalysisPhase` (Task A7), `getDeviceTelemetry` (existing, `src/device/telemetry.ts`).

- [ ] **Step 1: Add the two status strings**

In `src/ui/copy.ts`, remove the now-unused `upgrading` line and add, near the existing `working: 'Reading the message…'` line:

```ts
working: 'Reading the message…',
analyzing_thinking: 'Reading your message on this phone…',
analyzing_reconsidering: 'Double-checking one detail…',
```

(Leave `working` as-is — it's still used as the initial/default caption before a phase is known.)

- [ ] **Step 2: Accept the new prop and build the live view**

In `src/screens/Check.tsx`, add the import and prop:

```ts
import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { AnalysisPhase } from '../detector/orchestrator.ts'
import { getDeviceTelemetry } from '../device/telemetry.ts'
```

```ts
export function Check({
  onSubmit,
  onBack,
  busy,
  phase,
}: {
  onSubmit: (input: DetectionInput) => void
  onBack: () => void
  busy: boolean
  /** null before a phase is known, or once analysis has finished (D15). */
  phase: AnalysisPhase | null
}) {
```

Add local state for the elapsed timer and the device summary, and a small effect driving both, right after the existing `useState`/`useMemo` declarations:

```ts
const [elapsedMs, setElapsedMs] = useState(0)
const [modelLabel, setModelLabel] = useState<string | null>(null)
const startedAt = useRef<number | null>(null)

useEffect(() => {
  if (!busy) {
    startedAt.current = null
    setElapsedMs(0)
    return
  }

  startedAt.current = Date.now()
  void getDeviceTelemetry().then((t) => setModelLabel(`${t.model.label} (${t.tier})`))

  const id = setInterval(() => {
    if (startedAt.current) setElapsedMs(Date.now() - startedAt.current)
  }, 250)

  return () => clearInterval(id)
}, [busy])

const elapsedLabel = `${(elapsedMs / 1000).toFixed(1)}s`
const statusLine =
  phase === 'reconsidering' ? copy.analyzing_reconsidering : phase === 'thinking' ? copy.analyzing_thinking : copy.working
```

Replace the existing busy block:

```tsx
{busy ? (
  <div className="working" role="status" aria-live="polite">
    <div className="working__pulse" aria-hidden="true" />
    <p className="working__text">{copy.working}</p>
  </div>
) : (
```

with:

```tsx
{busy ? (
  <div className="working" role="status" aria-live="polite">
    <div className="working__pulse" aria-hidden="true" />
    <p className="working__text">{statusLine}</p>
    <p className="working__meta">
      {elapsedLabel}
      {modelLabel ? ` · ${modelLabel}` : ''}
    </p>
  </div>
) : (
```

(The `.working` class already exists in `app.css` — Task B2 is the one that gives it real motion; this task just adds the `working__meta` line, which needs one small CSS addition alongside it. Add this to `app.css` right after the existing `.working__text` rule, reusing existing tokens only:)

```css
.working__meta {
  margin-top: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--text-faint);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open Check, paste a message, submit with no LLM engine available (e.g. in a browser/profile without WebGPU) — confirm the busy view shows briefly (rules-only path resolves fast) without ever showing a verdict first, then navigates to Verdict once. If a local model is loaded, confirm the elapsed counter visibly ticks up during the wait.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Check.tsx src/ui/copy.ts src/ui/app.css
git commit -m "feat(check): replace the placeholder busy pulse with a live progress view (D15)"
```

---

### Task A10: `Verdict.tsx` and `smoke.mjs` — remove `pending`

**Files:**
- Modify: `src/screens/Verdict.tsx`
- Modify: `scripts/smoke.mjs`

- [ ] **Step 1: Remove the prop and the banner**

In `src/screens/Verdict.tsx`, remove `pending = false` from the destructured props and its type (`/** An on-device engine is still working behind this verdict (D13). */ pending?: boolean`), and remove the entire block:

```tsx
{/* The honest version of a loading state: there is already an answer
    on screen, and the phone is still working on a better one. */}
{pending && (
  <div className="upgrading" role="status" aria-live="polite">
    <span className="upgrading__dot" aria-hidden="true" />
    <span>{copy.upgrading}</span>
  </div>
)}
```

- [ ] **Step 2: Update the smoke test**

In `scripts/smoke.mjs`, change:

```js
<Verdict result={r} text={input.text} pending={false} onAgain={noop} onBack={noop} />,
```

to:

```js
<Verdict result={r} text={input.text} onAgain={noop} onBack={noop} />,
```

- [ ] **Step 3: Remove the now-dead `.upgrading` CSS**

Grep `app.css` for `.upgrading` and remove the rule block(s) — they have no remaining consumer.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean across the whole project now.

- [ ] **Step 5: Run the full existing gate**

Run: `npm run test:corpus && npm run test:fusion && npm run test:smoke`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/screens/Verdict.tsx scripts/smoke.mjs src/ui/app.css
git commit -m "feat(verdict): remove the D13 progressive-upgrade banner, superseded by D15"
```

---

### Task A11: `Listen.tsx` call-site fix

**Files:**
- Modify: `src/screens/Listen.tsx`

- [ ] **Step 1: Find and update the orchestrator calls**

Grep `src/screens/Listen.tsx` for `analyze(` / `analyzeProgressive(` / `orchestrator`. Update each call to the new `analyze(input, preference, signal, onPhase?)` signature from Task A7. The live per-tick loop should keep passing `'none'` as `preference` (unchanged behaviour — D13's original reasoning for `'none'` still holds verbatim under D15, see SPEC.md orchestrator step 3). The one full-stack run on stop should pass whatever `EnginePreference` the engine switch currently holds, same as before.

- [ ] **Step 2: Typecheck and run the mobile check**

Run: `npm run typecheck && npm run test:mobile`
Expected: both pass; `test:mobile` still drives Check → Verdict correctly since Listen mode is a separate flow.

- [ ] **Step 3: Manual verification on the phone (per SPEC.md §0 — verify on-device)**

Play a recorded scam call fixture through Listen mode; confirm the rolling-transcript loop still behaves as before (no LLM call per tick) and the final full-stack analysis on stop still produces a correct verdict with no early flash.

- [ ] **Step 4: Commit**

```bash
git add src/screens/Listen.tsx
git commit -m "fix(listen): update orchestrator call sites to the new analyze() signature (D15)"
```

---

## Part B — Home Redesign

### Task B1: Tokens and the first reduced-motion block

**Files:**
- Modify: `src/ui/tokens.css`

- [ ] **Step 1: Add the brand-entrance duration token**

In the `/* ---- motion ---- */` block of `:root` in `tokens.css`, add one token (the existing `--ease-emphasis` and `--dur-slow` are reused for everything else in Part B, so only the entrance's own duration is new):

```css
--dur-brand: 900ms; /* the one-time shield draw-in, Home only (§10.6) */
```

- [ ] **Step 2: Add the first reduced-motion block in the codebase**

At the end of `tokens.css` (after the `:root[data-theme='light']` block), add:

```css
/* ---- reduced motion ----
 * Every animation this file's consumers add must be listed here or gated in
 * component code. §10.4 guardrail 4: the screen must be fully readable and
 * fully static with this preference set. */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: Typecheck / build**

Run: `npm run build`
Expected: succeeds (this is a CSS-only change).

- [ ] **Step 4: Commit**

```bash
git add src/ui/tokens.css
git commit -m "feat(tokens): add the brand-entrance duration token and the first reduced-motion block"
```

---

### Task B2: Tactile depth on Home's choice cards and brand mark

**Files:**
- Modify: `src/ui/app.css`

- [ ] **Step 1: Extend `.choice`'s hover/press treatment**

Replace the existing `.choice` and `.choice:active` rules in `app.css`:

```css
.choice {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  width: 100%;
  padding: var(--sp-5);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--surface);
  box-shadow: var(--shadow-1);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-out),
    border-color var(--dur-base) var(--ease-emphasis),
    background var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-emphasis);
}

@media (hover: hover) {
  .choice:hover {
    border-color: var(--heat-border);
    box-shadow: var(--shadow-2);
  }
}

.choice:active {
  transform: scale(0.985);
  background: var(--surface-2);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-1);
}
```

(`@media (hover: hover)` keeps this from sticking on touch devices that fake `:hover` after a tap — the iQOO is touch-only, so this specifically prevents a "stuck" glow after tapping through to Check.)

- [ ] **Step 2: Typecheck / build**

Run: `npm run build`

- [ ] **Step 3: Manual verification on the phone**

Load Home on the iQOO, tap each choice card, confirm the press state feels tactile and never sticks after navigating away and back.

- [ ] **Step 4: Commit**

```bash
git add src/ui/app.css
git commit -m "feat(home): tactile hover/press depth on the choice cards"
```

---

### Task B3: One-time kinetic brand moment

**Files:**
- Modify: `src/ui/icons.tsx` (add `pathLength` to `ShieldLogo`'s outer-shell path)
- Modify: `src/ui/app.css` (entrance keyframes, breathing-dot keyframes)
- Modify: `src/screens/Home.tsx` (apply the entrance class once per session, add the breathing-dot markup)

- [ ] **Step 1: Make the shield's outer shell drawable**

In `src/ui/icons.tsx`, find `ShieldLogo`'s first `<path>` (the "Armored Outer Shell" one, with `d="M24 4L7 11V22..."`). Add `pathLength={1}` to it:

```tsx
<path
  d="M24 4L7 11V22C7 33.1 14.3 43.4 24 46C33.7 43.4 41 33.1 41 22V11L24 4Z"
  fill="url(#kavachShieldCore)"
  stroke="url(#kavachShieldGrad)"
  strokeWidth="2.5"
  strokeLinecap="round"
  strokeLinejoin="round"
  filter="url(#kavachHeatGlow)"
  pathLength={1}
  className="shield-outline"
/>
```

`pathLength={1}` makes the path's total length exactly `1` regardless of its actual geometry, so the CSS in the next step can animate `stroke-dashoffset` from `1` to `0` without measuring the real SVG path length.

- [ ] **Step 2: Add the entrance and breathing-dot keyframes**

In `app.css`, in the "8. Home" section, after the existing `.privacy-line__text` rule, add:

```css
/* One-time brand entrance (§10.6) — runs once per session, applied via
   `.brand--entering` from Home.tsx, and removed after it finishes. */
.shield-outline {
  stroke-dasharray: 1;
  stroke-dashoffset: 0;
}

.brand--entering .shield-outline {
  stroke-dashoffset: 1;
  animation: shield-draw var(--dur-brand) var(--ease-emphasis) forwards;
}

@keyframes shield-draw {
  to {
    stroke-dashoffset: 0;
  }
}

.brand--entering .brand__tagline {
  opacity: 0;
  animation: tagline-in var(--dur-slow) var(--ease-out) forwards;
  animation-delay: calc(var(--dur-brand) * 0.55);
}

@keyframes tagline-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* The privacy line's "nothing is leaving this phone right now" dot. */
.privacy-line__dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: var(--safe-accent);
  margin-right: var(--sp-1);
  animation: privacy-breathe 2.4s var(--ease-out) infinite;
}

@keyframes privacy-breathe {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}
```

- [ ] **Step 3: Apply the entrance class once per session, and add the dot**

In `src/screens/Home.tsx`, add a tiny once-per-session check (no new file needed — this is three lines):

```tsx
const [entering] = useState(() => {
  try {
    const seen = sessionStorage.getItem('kavach-brand-seen')
    if (seen) return false
    sessionStorage.setItem('kavach-brand-seen', '1')
    return true
  } catch {
    return false // storage blocked (private mode) — skip the entrance, never crash for it
  }
})
```

(Add `useState` to the existing `import { useRef } from 'react'` line → `import { useRef, useState } from 'react'`.)

Apply the class on the `<header className="brand" ...>` element:

```tsx
<header
  className={`brand${entering ? ' brand--entering' : ''}`}
  onClick={handleBrandTap}
  style={{ cursor: 'pointer', userSelect: 'none' }}
  title="Kavach Shield"
>
```

Add the breathing dot to the privacy line, right before `{copy.home_privacy}`:

```tsx
<p className="privacy-line__text">
  <span className="privacy-line__dot" aria-hidden="true" />
  {copy.home_privacy}
</p>
```

- [ ] **Step 4: Typecheck / build**

Run: `npm run typecheck && npm run build`

- [ ] **Step 5: Manual verification on the phone**

Load Home fresh (clear site data or a new private tab): confirm the shield draws in once and the tagline settles in after it, then reload within the same session and confirm it does **not** replay. Toggle the OS-level "reduce motion" setting and reload: confirm the shield and tagline appear instantly, fully formed, with no animation, and the breathing dot does not pulse.

- [ ] **Step 6: Run `test:mobile`**

Run: `npm run test:mobile`
Expected: PASS — this test drives Home in a fresh context per run, so it will see the entrance state; confirm it doesn't assert anything about `.brand`'s class list that this task would break (it currently only asserts layout/overflow/tap-target/no-percentage rules per CLAUDE.md, so this should be unaffected — read the script if the run surprises you).

- [ ] **Step 7: Commit**

```bash
git add src/ui/icons.tsx src/ui/app.css src/screens/Home.tsx
git commit -m "feat(home): one-time kinetic brand entrance and a breathing on-device indicator"
```

---

### Task B4 (stretch — cut first under time pressure): Ambient background

**Files:**
- Modify: `src/ui/app.css`
- Modify: `src/screens/Home.tsx`

This task is explicitly the first thing to cut if time is short (§10.4's own table already flags this exact idea as "first thing cut" — this task just makes it real). Do not start it before Tasks A1–A11 and B1–B3 are all done and verified on the phone.

- [ ] **Step 1: Add the ambient layer**

In `app.css`:

```css
.home-ambient {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  opacity: 0.5;
  background:
    radial-gradient(circle at 20% 15%, var(--heat-tint), transparent 55%),
    radial-gradient(circle at 80% 85%, var(--surface-3), transparent 60%);
  animation: ambient-drift 18s ease-in-out infinite alternate;
}

@keyframes ambient-drift {
  from {
    transform: translate3d(0, 0, 0) scale(1);
  }
  to {
    transform: translate3d(-2%, 2%, 0) scale(1.05);
  }
}

/* Paused whenever the app signals real work is happening (§10.4 guardrail 3),
   via the `data-busy` attribute Home.tsx sets. */
.home-ambient[data-busy='true'] {
  animation-play-state: paused;
}
```

- [ ] **Step 2: Wire it to model-preload state**

In `Home.tsx`, the component already calls `preloadModel()` on mount via `localSupported()`. Track whether that's in flight using the existing `onModelProgress` subscription (already imported by `src/device/telemetry.ts` — import it directly here instead of duplicating logic):

```tsx
import { onModelProgress } from '../detector/local.ts'
```

```tsx
const [modelBusy, setModelBusy] = useState(false)

useEffect(() => {
  return onModelProgress((p) => setModelBusy(!p.done))
}, [])
```

Render the layer as the first child inside `<main className="screen screen--bare">`:

```tsx
<div className="home-ambient" data-busy={modelBusy} aria-hidden="true" />
```

- [ ] **Step 3: Typecheck / build**

Run: `npm run typecheck && npm run build`

- [ ] **Step 4: Manual verification on the phone**

Confirm the wash drifts subtly behind the content while idle, pauses while the model is downloading/loading, and disappears entirely under reduced motion (it's covered by the global `@media (prefers-reduced-motion: reduce)` block from Task B1, since it only uses `animation`).

- [ ] **Step 5: Commit, or cut**

```bash
git add src/ui/app.css src/screens/Home.tsx
git commit -m "feat(home): stretch ambient background, paused during model preload"
```

If time is short: skip this task entirely. Nothing in Tasks A1–A11 or B1–B3 depends on it.

---

## Self-Review

**1. Spec coverage.** SPEC.md §16 D15's four numbered points → Tasks A2/A3 (briefing), A4 (audit + fusion formula), A7 (reconsideration, bounded to one retry), A7/A9 (no early publish). §16 D15's "Consequences" bullets → A8 (App.tsx), A9 (Check.tsx live view), A6 (prompt paragraph, both client and server), A7 (`ENGINE_TIMEOUTS` split), A4/A9 (test files), A11 (phase placement note — no new phase number). §10.6's rewritten Home section → B2 (tactile depth), B3 (brand moment), B4 (stretch ambient, explicitly last). §3's new stretch row → B4. No spec requirement was left without a task.

**2. Placeholder scan.** No task in this plan contains "TBD," "handle appropriately," or an uncoded "write tests for the above" — every test task has literal `check(...)` assertions and every implementation step has literal code.

**3. Type consistency, checked across tasks:**
- `RuleBriefing.tactics[].matchedPhrases` (A1) is produced by `toBriefing` (A2) and consumed identically by `renderBriefing` (A3) and `findAuditGap`'s caller in the orchestrator (A7, via `gap.evidence.map((e) => e.phrase)` — note this reads from the rules `Tactic`'s `evidence`, not from a `RuleBriefing`, since `findAuditGap` operates on full `Tactic[]`, not briefings; this is correct and intentional — the briefing is prompt-only context, the audit compares real `Tactic` lists).
- `ReconsiderationPrompt.missingTactic` (A1) is produced in `orchestrator.ts` (A7) and consumed by `renderReconsideration` (A3) with matching field names (`name`, `matchedPhrases`) in both `src/detector/prompt.ts` and the mirrored copy in `api/analyze.ts` (A6).
- `AnalysisPhase` (A7) is produced by `analyze`'s `onPhase` callback and consumed by `App.tsx` (A8) and displayed via `Check.tsx`'s `phase` prop (A9) — same two string literals (`'thinking'`, `'reconsidering'`) used in all three places.
- `analyze`'s signature is `(input, preference, signal?, onPhase?, engineOverride?)` everywhere it's defined (A7) and everywhere it's called (A8, A11, and the test fakes in A7's own Step 1).

No gaps found on this pass.
