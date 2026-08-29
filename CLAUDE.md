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
npm run test:corpus   # corpus regression + false-positive gate (hard gate)
npm run test:smoke    # renders every screen against real engine output
npm run test:fusion   # LLM JSON contract + rules/LLM fusion (D12)
npm run test:feedback # adaptive weighting, and that it cannot break the gate (D14)
npm run test:offline  # PWA: manifest installable, every icon really served,
                      # worker takes control, and a cold launch with the network
                      # cut still reaches a correct verdict (P8)
npm run icons         # regenerate public/icons from ShieldLogo. Only needed
                      # when the mark or the ground colour changes.
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

P3 (CloudDetector) is done. P8 (PWA + offline) is built and passes
`test:offline`, but like P2 and P7 it is **unverified on the phone** — all three
are blocked on one ten-minute on-device session, scripted in §11 under "The one
on-device session". Do that before building anything else.

Still open after it: P9 (device telemetry panel), P10 (orchestrator hardening +
triple-tap failsafe), P12 (tuning, rehearsal, freeze). See SPEC.md §11.
