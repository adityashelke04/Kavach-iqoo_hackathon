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
3. **The rules engine is invisible.** Never selectable, never named, never
   surfaced as an error or a degraded state. (§6, §8.3)
4. **Every engine returns a result and never throws.** Failure rejects the
   promise; the orchestrator catches and falls back silently. (§6)
5. **On-device is the default and is never traded away for convenience.** (D6, §9)
6. **UI layering: screens compose, components render, the detector decides.**
   No component imports an engine. No component hard-codes a colour, radius or
   duration — tokens only. (§10.3, §10.2)
7. **Original work only**, written inside the event window. npm packages and
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
```

Dev-only routes: `/dev/ui` (primitive gallery), `/dev/engines` (raw engine output).

## Current status

Phase: **P0 not started.** Repo contains `SPEC.md` and this file only.
