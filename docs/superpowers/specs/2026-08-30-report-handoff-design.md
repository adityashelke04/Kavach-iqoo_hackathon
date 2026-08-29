# The Report Handoff — design

**Date:** 2026-08-30
**Status:** approved for build
**Touches:** SPEC.md §2 (non-goals), §3 (scope table), §4 (no-score rule), §10.3
(layering), §10.6 (screens), §10.7 (copy deck), §16 (new decision D16)

---

## 1 · The problem

The Verdict screen is a dead end. It says *this is a scam*, proves it, and names
what the sender wants — and then offers "Check another message". A person who
has just learned they are being defrauded, and who in the worst case has already
sent money, is handed nothing to do about it.

India has the machinery for this and almost nobody uses it, because the machinery
is a blank government form and the person filling it in is frightened, in a
hurry, and does not know which of four portals is theirs.

## 2 · The reframe that keeps this in scope

§2 lists "a fraud reporting portal" as an explicit non-goal: *"No backend, no
accounts, no submissions."*

This feature does not violate that. It honours every clause:

- **No backend.** The report is composed in the browser from a
  `DetectionResult` that is already in memory.
- **No accounts.** Nothing to sign into.
- **No submissions.** Kavach never sends a complaint anywhere. It writes one,
  puts it on the clipboard, and opens the official portal. The user files it, on
  the government's own site, in their own session.

**Kavach is not a reporting portal. It is a courier.** That distinction is the
whole design, and it is what a §16 entry has to record so a later session does
not "helpfully" add a submit button.

## 3 · What gets built

### 3.1 · The Evidence Receipt

A formal-looking record of the incident — deliberately shaped like a statement
or a notice rather than like another app screen, because a document is what a
person takes to an authority, and because looking official is what makes someone
act on it.

Anatomy, top to bottom:

| Block | Contents |
|---|---|
| Masthead | `KAVACH · INCIDENT RECORD`, a local reference, date and time |
| Verdict strip | The same headline the Verdict screen gave, in the same role colour |
| Findings | Line-item rows: who the sender claimed to be, what they wanted, what pressure was applied, and what kind of number it came from |
| The message | Verbatim, quoted, in a monospaced block so it reads as evidence rather than as prose |
| What this means | The `nextMove` sentence, unchanged |
| Where to report | The routing block, §3.2 |
| Footer | "Prepared on this phone. Nothing was sent anywhere." |

**The no-score rule applies with full force here (§4).** A document laid out like
a bill invites a total, and there must not be one. Specifically forbidden:

- no count of tactics found ("3 findings" is "4 of 5 signals" wearing a hat)
- no severity, rating, risk level or confidence, in any form
- no progress or meter of any kind

Numbers that *are* allowed, and why they are not the same thing: the date, the
time, and the reference are facts about the record. An amount of money is a fact
the **user** supplied about their own loss — it is required by the portals and it
is not a judgment of the message. The test enforces the distinction by asserting
no percentage and no bare tactic count anywhere in the built report.

### 3.2 · The routing — one question, four destinations

The right destination genuinely differs by what has already happened, and getting
this wrong wastes the only hour that matters. So the sheet asks one plain
question — *has anything already been sent?* — and routes on the answer.

| Answer | Destination | Why this one |
|---|---|---|
| Money has gone | **1930**, by phone, then the National Cyber Crime Reporting Portal | Financial fraud is time-critical; a call reaches a human faster than a form |
| A code, password or card detail was shared, no money yet | **1930**, and the bank's own number | The account is live right now; this is the same emergency |
| Nothing was sent — it is the message itself | **Chakshu**, on Sanchar Saathi | The DoT facility built specifically for reporting a suspected fraud call or SMS |
| It is nuisance marketing, not fraud | **1909 / DND** | TRAI's channel; filing it as cybercrime helps nobody |

Each destination carries: its real name, one line on what it is for, and the
action — a `tel:` link that dials, or an `https:` link that opens.

**Destinations are data, in one file** (`src/report/routes.ts`), so a URL that
changes is a one-line edit and not a hunt.

### 3.3 · Damage control — before the report

When the answer is "money has gone" or "I shared a code", the sheet leads with an
ordered list of what to do in the next few minutes, *above* the report. Naming
the specific action beats naming the feeling:

1. Do not reply to them again. They will call back; that call is part of it.
2. Call **1930** now. Keep this message on your phone — they will ask what it said.
3. Call your bank on the number printed on your card, never a number from the message.
4. Then file the written complaint. Kavach has it ready to paste.

This is the highest-stakes surface in the product and it is four sentences.

### 3.4 · The complaint text

One block of plain text, built on the device, ready to paste into whichever
portal the user lands on. It contains only facts already on screen: the message
verbatim, the sender as typed and what kind of sender it is, what the sender was
trying to obtain, the tactics in plain words, and the local reference and
timestamp. Nothing is inferred, nothing is invented, and a field the user did not
supply simply does not appear as a line.

Two actions: **Copy** (primary) and **Share** (Web Share API, so it can go
straight into a family WhatsApp thread or an email to a bank).

### 3.5 · Offline behaviour

The receipt and the complaint text are built entirely on the device, so they work
in airplane mode — which matters, because §13 beat 4 is exactly that. What cannot
work offline is opening a portal. So when there is no network the sheet says so
in one line and promotes **Copy** over the portal links, since a clipboard
survives until there is signal again.

## 4 · Architecture

Layering (§10.3) is preserved exactly: **screens compose, components render, the
detector decides.** Nothing here touches `src/detector/`.

```
src/report/
  types.ts       Report, ReportRoute, Disclosure — no React, no engine imports
  routes.ts      The four official destinations, as data
  build.ts       buildReport(result, text, disclosure) -> Report   [pure]
  text.ts        toComplaintText(report) -> string                 [pure]

src/ui/components/ReportSheet.tsx    renders a Report
src/screens/Report.tsx               composes the sheet + the routing question
src/screens/Verdict.tsx              gains one action: "Report this"
src/App.tsx                          routes '/report' off existing state
```

`build.ts` and `text.ts` are pure functions over a `DetectionResult`. That is what
makes them testable without a browser, and it is why the gate in §6 can be a Node
script like every other gate in this repo.

**No new state and no storage.** `App.tsx` already holds `result` and `analysed`
for the Verdict screen; `/report` reads the same two values. Nothing is
persisted, so §2's no-archive stance is untouched.

## 5 · What is deliberately not built

Naming non-goals is scope defence, same as §2 does:

- **No auto-submission.** Kavach never posts a complaint. Ever.
- **No form filling on the portal.** No injecting values into a government site.
- **No account, no login, no history.** A report is built, used, and gone.
- **No case tracking.** We have no backend and will not pretend to.
- **No report on a `safe` verdict.** You do not report a legitimate message, and
  offering to would undermine the discrimination the product is judged on.

## 6 · Testing

New gate: `npm run test:report`.

1. **§4 survives into the new surface** — no percentage, no rating, and no bare
   tactic count in either the receipt data or the complaint text.
2. **Nothing is invented** — with no sender supplied, no sender line appears;
   with no tactics, no tactic lines appear. Every line traces to a field that was
   actually populated.
3. **The message is verbatim** — the complaint text contains the input exactly as
   given, uncut and unaltered.
4. **Every route is well-formed** — each destination has a name, a purpose line,
   and an action whose scheme is `tel:` or `https:`.
5. **Routing is total** — every disclosure answer maps to at least one
   destination; there is no dead end.
6. **A `safe` verdict yields no report** — `buildReport` refuses it.

Existing gates that must stay green: `test:corpus`, `test:smoke`, `test:mobile`
(the new screen has to fit 412×915 with no tap target under 44px and no
percentage in the DOM), `test:offline`.

## 7 · Spec changes this requires

- **§16 · D16** — the courier reframe, the no-total rule for a document shaped
  like a bill, and the non-goals in §5 above. Written before the code, per §0.
- **§3** — a row in the scope table. Adding one requires the D16 entry above.
- **§10.6** — a Report screen subsection.
- **§10.7** — the new copy keys.

## 8 · Build order

Each step leaves the tree green.

1. SPEC.md: D16 in §16, the §3 row, the §10.6 subsection.
2. `src/report/types.ts`, `routes.ts` — data and shapes, no logic.
3. `src/report/build.ts`, `text.ts` — the pure core.
4. `scripts/test-report.mjs` + the npm script. Gate goes green here, before any UI.
5. Copy keys in `src/ui/copy.ts`.
6. `ReportSheet` component + styles in `app.css`, tokens only.
7. `Report` screen, the `/report` route, and the Verdict action.
8. Re-run every gate; `test:mobile` and `test:offline` included.
