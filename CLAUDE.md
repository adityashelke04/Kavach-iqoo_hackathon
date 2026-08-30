# Kavach — agent rules

**Kavach** is an installable PWA that tells a person whether a message they
received is a scam. It runs a small LLM **on the user's own phone** (WebLLM +
WebGPU), with a cloud engine and a deterministic rules engine behind the same
interface. Built for the iQOO Hackathon 2026, Bengaluru City Battle.

## Read SPEC.md before writing any code

`SPEC.md` is the single source of truth. Read, in this order:

1. **§0** — rules of engagement, and what is frozen
2. **§3** — scope boundary. Check before adding anything.
3. **§11** — phase plan. **The first unchecked phase is your job.**
4. Then only the sections your phase touches (§6/§7 detector, §10 UI)

Do not read the whole spec first. Do not build ahead of your phase.

## Non-negotiables

1. **The `Detector` interface is the only seam.** UI never knows which engine
   ran. (§6)
2. **Never render a number about the message.** No score, no percentage, no
   confidence bar. `confidence` is internal only. Numbers about the *device*
   (§9) are fine; numbers about the *message* are not. (§4)
2b. **Plain language on every default screen** (D11). No "forensic", "verbatim",
   "threat vector", "telemetry", "protocol", "advisory". The engine, the
   latency and the DLT explanation live behind `How we checked`. A SAFE verdict
   highlights nothing and accuses nobody.
3. **The rules engine is invisible.** Never selectable, never named, never
   surfaced as an error or a degraded state. (§6, §8.3)
4. **Every engine returns a result and never throws.** Failure rejects the
   promise; the orchestrator catches and falls back silently. (§6)
5. **On-device is the default and is never traded away for convenience.** (D6, §9)
6. **Sender origin is classified in code, never by a model**, and only weighs
   heavily alongside the `authority` tactic — otherwise every WhatsApp forward
   gets flagged. Sender is optional everywhere. (D9, §5.5)
7. **UI layering: screens compose, components render, the detector decides.**
   No component imports an engine. No component hard-codes a colour, radius or
   duration — tokens only. (§10.3, §10.2)
8. **Original work only**, written inside the event window. npm packages and
   attributed React Bits components are fine; carried-in project code is not. (§0)

## How to work here

- **No subagents.** The session doing the work does the work. No dispatch, no
  delegation, no parallel fan-out.
- **One phase at a time.** Stop at its exit criterion.
- **Verify on the iQOO phone, not the laptop.** Every exit criterion is written
  to be checked on the device.
- **Finishing a phase = code + ticked checkbox in §11, in the same commit.**
  Add a line to the phase completion log at the end of §11.
- Changing anything marked frozen in §0 requires a Decision Log entry in §16
  first.

## Commands

```bash
npm run dev           # local dev server
npm run build         # production build
npm run test:corpus   # corpus regression through the RULES ENGINE ONLY (hard gate)
npm run test:cloud    # the cloud engine: api/analyze.ts duplicates the prompt
                      # by hand, so this compares the two copies and does a
                      # live round trip when OPENROUTER_API_KEY is set (skips
                      # cleanly without one). Two divergences have shipped (D21)
npm run test:falsepos # the same false-positive question, through the pipeline
                      # that actually ships: rules + model + fusion, against
                      # stub engines. You need both — test:corpus was green
                      # while a real SBI alert was being called a scam (D21)
npm run test:smoke    # renders every screen against real engine output
npm run test:fusion   # LLM JSON contract + rules/LLM fusion (D12)
npm run test:feedback # adaptive weighting, and that it cannot break the gate (D14)
npm run test:report   # report handoff: no total, nothing invented, every
                      # destination official and reachable-shaped (D16)
npm run test:predict  # predicted scripts: never fire on a legitimate message,
                      # predict the sender rather than instruct the reader (D17)
npm run test:listen   # Listen mode microphone lifecycle: nothing else holds a
                      # capture stream when recognition starts, restarts back
                      # off and give up, and a stopped call cannot follow you
                      # to the next one (D19)
npm run test:cancel   # exhibition latency + cancellation: no device auto-picks
                      # the heavy tier, every tier is a real WebLLM model, and a
                      # check cancelled before or during flight actually stops
                      # (D20)
npm run test:offline  # PWA: manifest installable, every icon really served,
                      # worker takes control, and a cold launch with the network
                      # cut still reaches a correct verdict (P8)
npm run icons         # regenerate public/icons from ShieldLogo. Only needed
                      # when the mark or the ground colour changes.

# NOT part of a normal gate run — downloads real model weights, takes minutes:
npm run test:local    # drives /dev/local in a real Chrome with a real GPU and
                      # runs the shipped localDetector path. Proves the JSON
                      # contract and the false-positive gate hold on-device.
                      # Proves nothing about the iQOO — open /dev/local on the
                      # phone for that (SPEC.md §11). See D18.
npm run test:mobile   # renders at 412x915 in Chrome; asserts no sideways
                      # scroll, no tap target under 44px, no percentage in the
                      # DOM, and drives Check -> Verdict for scam and legit
```

`test:mobile` writes `screenshots/mobile_*.png`. Do not replace it with
`chrome --screenshot --window-size=412,...`: Windows Chrome refuses to size a
window below ~500px and silently crops the shot, which looks exactly like
horizontal overflow that is not there.

Dev-only routes: `/dev/ui` (primitive gallery), `/dev/engines` (raw engine output).

## Current status

Rules engine, all four screens, and Listen mode are done and pass every gate.
The UI was rebuilt against D11 — read that entry before changing any copy.
The report handoff (D16) is built: a caught scam now ends in a complaint the
user files themselves on 1930 / Chakshu / 1909. Kavach never submits anything —
read D16 before touching it, especially before adding a submit button or a
count of findings to the receipt.

"What usually happens next" (D17) is built: three predicted lines, derived in
`src/predict/` from tactics already found, shown on Verdict and inside the
Listen interrupt mid-call. It is silent when nothing matches — never widen a
playbook into a catch-all to raise coverage, and never let one fire on a
legitimate message. `test:predict` guards both.

Listen mode's microphone lifecycle was rebuilt under D19 — read it before
touching `Listen.tsx`. The rule is one line: **exactly one thing on that screen
opens the microphone at a time.** Do not reintroduce a `getUserMedia` capture to
drive the equalizer; that is what made Android report "Chrome is currently
recording audio". `test:listen` guards it.

**`api/analyze.ts` duplicates the prompt from `src/detector/prompt.ts` by hand**
— it cannot import from `src/`. Change one, change the other, in the same commit.
This has already drifted twice (D20's token budget, D21's briefing), and both
times the cloud engine silently kept shipping the old behaviour. `test:cloud`
compares them; do not rely on the "kept in sync by hand" comments.

A real bank SMS was being called a scam — fixed under **D21**, read it before
touching `fuse.ts`, `verdict.ts` or `toBriefing`. The rules engine was never
wrong; four things downstream of it were. The briefing now carries **both halves
of the scan** (the legitimacy markers as well as the suspicious phrases) —
never send a model only the incriminating half again. The model's tactics are
**screened** against the deterministic subtotals before merging. And §4 has a
fifth override rule: **`danger` needs corroboration**, capped to `caution` when
the deterministic engine concluded `safe` and actively disagrees. Silence is not
disagreement — that distinction is what keeps novel-scam detection alive, so do
not simplify it away. `test:falsepos` guards all of it, and its third group
(every corpus scam re-sent through a registered header) is what stops anyone
"fixing" this by trusting the DLT header, which §5.5 forbids.

Model tiers and cancellation were rebuilt under **D20** — read it before
touching `models.ts`, `pickTier`, or anything that starts an analysis. Two rules
came out of it. **No device selects the `max` tier for itself**: `pickTier`
returns only `low` or `standard`, and `max` (now Qwen2.5-1.5B, not the 3B) is
reachable only through `setPreferredTier`. And **every analysis is started with
an `AbortSignal` that something can actually pull** — `App` owns one per run,
leaving `/check` cancels via an effect on `path` (not the back arrow: Android's
back button fires `popstate`), and Check has a Cancel button. `test:cancel`
guards both. This closes the abort half of P10; the triple-tap failsafe is what
remains there.

P3 (CloudDetector) is done. P8 (PWA + offline) is built and passes
`test:offline`, but like P2 and P7 it is **unverified on the phone** — all three
are blocked on one ten-minute on-device session, scripted in §11 under "The one
on-device session". Do that before building anything else. D20's latency numbers
are unproven there too: §8.1's load-time and tokens/sec columns are still empty
and only the iQOO can fill them.

Still open after it: P9 (device telemetry panel), P10 (orchestrator hardening +
triple-tap failsafe), P12 (tuning, rehearsal, freeze). See SPEC.md §11.
