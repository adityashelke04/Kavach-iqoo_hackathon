# KAVACH — Master Specification

**Status:** Frozen contract, v1.0
**Owner:** Aditya Shelke
**Repo:** `Kavach-iqoo_hackathon` · branch `master`
**Event:** iQOO Hackathon 2026 — Bengaluru City Battle — Open Innovation track

> Kavach is an installable web app (PWA) that tells a person whether a message
> they just received is a scam — running the AI **on their own phone**, offline,
> with nothing sent to a server unless they choose otherwise.

---

## §0 · How to use this document

This spec exists because the build spans many separate agent sessions, each one
starting cold with no memory of the last. Everything needed to continue the work
lives here. If it is not written down here, it did not happen.

### Read order for a session starting cold

1. §0 (this section) — the rules of engagement
2. §3 — scope boundary. **Check before adding anything.**
3. §11 — phase plan. Find the first unchecked phase. That is your job.
4. The sections your phase touches (§6/§7 for detector work, §10 for UI work)

Do not read the whole document before starting. Read §0, §3, §11, then the two
or three sections your phase actually needs.

### Frozen vs open

| Frozen — changing it requires a Decision Log entry | Open — use judgment |
|---|---|
| §4 verdict model (three states, no score) | Wording of individual copy strings |
| §5 tactic taxonomy (the four tactics) | Which phrases go in the rules term lists |
| §6 `Detector` interface + engine contract | Internals of any single engine |
| §7 data contracts (`types.ts`) | Prompt wording, as long as output validates |
| §10.3 UI layering rule | Visual design within the token system |
| D1–D8 in §16 | Everything not listed as frozen |

**To change something frozen:** append a new dated entry to §16 stating what
changed and why, edit the frozen section, and say so in the commit message.
Never silently edit a frozen contract — a later session will trust it.

### Working rules

- **No subagents.** The session doing the work does the work. No dispatch, no
  delegation, no parallel fan-out.
- **One phase at a time.** Stop at the phase's exit criterion. Verify it on the
  phone. Then check the box in §11 and commit.
- **Finishing a phase = code + ticked checkbox in §11, in the same commit.**
  A phase whose box is unticked is not done, whatever the code says.
- **Test on the phone, not the laptop.** Every exit criterion in §11 is written
  to be verified on the iQOO device. A thing that works in desktop Chrome and
  not on the phone is not working.

### Originality constraint (event rule — non-negotiable)

All code must be **original work written inside the event window**. Prior
personal projects may be cited as relevant experience in the pitch, but no
existing code may be carried in or reused. Third-party libraries installed from
npm are fine and normal. Components copied from public component libraries
(React Bits — see §10.4) are fine and normal, and are attributed in the file.
Do not import code from any of the author's earlier projects.

---

## §1 · Problem and positioning

### The problem

Message-based fraud is the largest and fastest-growing consumer attack surface
in India. SMS-delivered scams rose sharply through 2025–26, and the messages
have got good: they are well-written, they carry real-looking sender IDs, and
they arrive alongside genuine bank and delivery messages in the same inbox.

The person being targeted is usually not naive. They are busy, or they are
older, or the message arrived at a moment where it was plausible. What they lack
in that moment is not intelligence — it is **a second opinion**.

Existing protections do not fill this gap:

- Spam filters classify the *sender*, not the *manipulation*. A scam from a new
  number goes straight through.
- Link scanners check the *URL*, not the *message*. Plenty of scams never send a
  link — they ask for an OTP, or a UPI transfer, or a phone call.
- On-device scam detection ships on Google Pixel 9 and above, English only, off
  by default. That is a rounding error of the Indian market.

### The product's answer

Paste the message. Get a plain-language second opinion in about a second, on the
device, offline, with the manipulative phrases highlighted so the user can see
*why* — not just be told.

### Why messages and not live call audio

Kavach analyses text. It does not tap live call audio. This is a deliberate,
defensible choice, and it is stated openly in the pitch rather than hidden:

- **Android does not permit it.** Third-party apps cannot access the live
  call-audio stream. This is an OS-level restriction, not a gap in effort. True
  in-call detection requires holding the **default dialer role** — a different
  product with a different distribution path.
- **Messages are the bigger surface anyway.** More people are defrauded by
  message than by live call, and the message leaves evidence that can be
  analysed calmly.

**Roadmap position:** in-call detection via the default-dialer role is v2. It is
on the roadmap slide, named as requiring the dialer role, so that a judge who
knows the platform sees that we know it too.

Listen mode (§10.6, §11 P11) is the honest middle ground: the user puts a call on
speakerphone and Kavach listens through the *microphone* — which is permitted —
and runs the same detector on the live transcript.

### The closing line (keep consistent across all sessions and slides)

> "Google ships this only on Pixel 9 and above, in English, off by default.
> We're building it for everyone else."

---

## §2 · Product definition

### What Kavach is

A **second opinion on a suspicious message**, delivered in about a second, on the
user's own device, in language their parents could read.

Three things it does, in order of importance:

1. **Judges** — one of three clear states, never a number (§4).
2. **Shows the evidence** — the exact phrases that triggered the judgment,
   highlighted in the message itself (§7 evidence resolution).
3. **Names the ask** — what the sender is trying to get next: an OTP, a UPI
   transfer, a remote-access app install, a callback (§5 `nextMove`).

### What Kavach is explicitly not

Naming non-goals is scope defence. If a future session is about to build one of
these, it is off-spec and needs a Decision Log entry first.

| Not this | Why not |
|---|---|
| A spam blocker | We do not touch the SMS inbox, block senders, or filter. Android does not grant it and it is not the insight. |
| A link/URL scanner | We analyse manipulation language. URL reputation needs a network call, which breaks the offline claim. |
| An antivirus or permissions auditor | Different problem entirely. |
| A fraud reporting portal | No backend, no accounts, no submissions. |
| A message archive | Nothing is stored or synced. Privacy is the pitch; storing messages contradicts it. |
| A confidence-score dashboard | See §4. Numbers invite the user to negotiate with a scam. |

### Hard architecture constraints

- **No custom backend server.** The only network calls the product makes are the
  optional cloud engine (§8.2) and the one-time model download (§8.1).
- **No accounts, no login, no analytics, no telemetry sent anywhere.** The device
  panel (§9) measures locally and displays locally. Nothing leaves.
- **Deployed on Vercel over HTTPS.** HTTPS is required for microphone access and
  service-worker install.
- **Runs on and is pitched from the iQOO 15 loaner device** (Snapdragon,
  Android 12+, WebGPU confirmed working).

---

## §3 · Scope boundary

**Check this table before building anything.** If it is not in the MVP column and
the MVP column is not fully green, do not build it.

### MVP — must ship

| Item | Why it is in |
|---|---|
| Paste a message → verdict | The core product. Everything else is decoration without it. |
| Three-state verdict with highlighted evidence | The judgment plus the reason. Highlighting is what makes it trustworthy rather than magic. |
| Sender-origin check (DLT header vs personal number) | The highest-signal, lowest-ambiguity check available in the Indian market, and it costs a regex. See §5.5. |
| On-device engine (WebLLM, WebGPU) | The headline claim and the scored behaviour (§9). |
| Cloud engine + user switch between them | The user-controlled privacy toggle is a named key feature. |
| Rules engine as invisible fallback | Guarantees a verdict always appears. Never shown to the user. |
| Preset example messages (scam + legit) | The legit example is what proves the detector discriminates rather than flagging everything. |
| Device-work panel | Turns "it's local" into a checkable on-screen claim (§9). |
| Design system: tokens + primitives | The UI is judged (D8) and will be redesigned. Tokens first makes that cheap. |
| PWA install + offline operation | The airplane-mode demo beat depends on it. |
| Listen mode | Chosen as MVP (D3). Timeboxed with a kill-criterion (§11). |
| Triple-tap failsafe | Insurance against a live failure on stage. |

### Stretch — only once every MVP row is green

| Item | Why it waits |
|---|---|
| Web Share Target (share an SMS into Kavach from Android's share sheet) | Strong "real product" signal, but manifest + handler work that does not change the demo. |
| Scan history | Contradicts the no-storage stance unless carefully designed. Needs thought we do not have time for. |
| Haptics on verdict | Cheap and genuinely improves the DANGER moment. First thing to add if time allows. |

### Deferred — specified, explicitly not promised

| Item | Note |
|---|---|
| Hindi (Devanagari) and Kannada | D4. Needs a second term set, and the small local model degrades on non-Latin script. Roadmap slide, not build. |
| In-call detection via default dialer role | §1. v2, different product surface. |
| Sender-reputation / URL checks | Requires network, contradicts the offline claim. |
| Model fine-tuning on the corpus | No time. The corpus is for testing, not training. |

**Rule for future sessions:** adding a row to MVP requires a Decision Log entry in
§16. Moving a row *out* of MVP requires the same. The table is the contract.

---

## §4 · Verdict model

### The three states — frozen (D1)

Kavach returns exactly one of three states. There is no fourth state, no
"unknown", no "probably".

| State | Headline shown to user | Sub-line | Meaning |
|---|---|---|---|
| `danger` | **This is a scam** | Do not reply. Do not send money or codes. | Multiple manipulation tactics present, or one extraction tactic with supporting pressure. |
| `caution` | **Something's off here** | Check before you act. | Manipulation signals present but weak, ambiguous, or isolated. |
| `safe` | **Looks legitimate** | Nothing manipulative found. | No meaningful manipulation signal. |

Colour roles are in §10.2 (`--verdict-danger`, `--verdict-caution`,
`--verdict-safe`). Colour never carries the verdict alone — an icon and the
headline text always accompany it (§10.8).

### The no-score rule — frozen, and the most violable rule in this spec

**No number describing the message is ever rendered.** Not a percentage, not a
0–100 score, not a progress bar of risk, not "4 of 5 signals", not a star
rating, not the word "87%" anywhere in any state.

Why this rule exists, so no future session talks itself out of it:

1. **A number invites negotiation.** A person who wants the money to be real
   will read "72% risk" as "28% chance it's fine" and proceed. "This is a scam"
   has no such gap to crawl through.
2. **The number would be fiction.** A 1B-parameter model's self-reported
   confidence is not calibrated. Displaying it dresses a guess as a measurement.
3. **It breaks the reading level.** The target user is someone's parent. Three
   coloured states with a sentence each is the whole interaction budget.

`DetectionResult.confidence` exists in the type (§7) **for engine-internal
thresholding only**. Rendering it in any form, in any screen, is a spec
violation and should be reverted, not debated.

**Not covered by this rule:** the device-work panel (§9) shows numbers about the
*machine* — megabytes cached, tokens per second, bytes fetched. Those are
measurements of hardware, not judgments of the message. The distinction is:
**numbers about the phone are fine, numbers about the message are forbidden.**

### Internal confidence → verdict mapping

Every engine produces a `confidence` in `0.0–1.0` and maps it through this
single shared table. The mapping lives in one place —
`src/detector/verdict.ts` — and every engine calls it. No engine implements its
own thresholds.

| `confidence` | `verdict` |
|---|---|
| `>= 0.70` | `danger` |
| `0.35 – 0.69` | `caution` |
| `< 0.35` | `safe` |

**Override rules, applied in order after the table:**

1. **Extraction floor.** If the `extraction` tactic is present with at least one
   resolved piece of evidence, the verdict is at minimum `caution`. A message
   asking for an OTP is never `safe`, whatever the model scored.
2. **Three-tactic rule.** If three or more distinct tactics are present, the
   verdict is `danger` regardless of the confidence value. Authority + urgency +
   extraction in one message is a scam by construction.
3. **Impersonation mismatch.** If the `authority` tactic is present **and**
   `senderSignal.risk === 'high'` (the message claims to be an institution but
   arrived from a personal number — §5.5), the verdict is at minimum `caution`.
   If `extraction` is also present, the verdict is `danger`. This is the
   strongest single combination in the Indian SMS landscape and it is decided
   deterministically, not by the model.
4. **Empty-finding ceiling.** If no tactics were detected **and**
   `senderSignal.risk !== 'high'`, the verdict is `safe`. A `danger` verdict with
   nothing to show the user is unexplainable and must not be rendered.

Rule 4 is the one that protects the demo: a verdict we cannot justify on screen
is worse than no verdict. Note that a high-risk sender is itself something we can
show (the SenderCard, §10.6), so it satisfies rule 4's requirement on its own.

### Tie-breaking and degenerate input

| Input | Behaviour |
|---|---|
| Empty or whitespace only | Do not run any engine. Keep the user on Home with the button disabled. |
| Under 10 characters | Button disabled, hint copy: `too_short` (§10.7). |
| Over 4,000 characters | Truncate to the first 4,000 for analysis; tell the user it analysed the beginning. Highlighting still maps to the visible text. |
| Non-text paste (emoji only, URLs only) | Runs normally. A bare URL with no language usually lands `caution` via the rules engine, which is the honest answer. |

---

## §5 · Tactic taxonomy

### The four tactics — frozen (D5)

Every scam message in scope works by combining some of these four. They are the
vocabulary of the whole product: the model is prompted in these terms, the rules
engine scores in these terms, and the UI shows cards in these terms.

Adding a fifth tactic is a §16 Decision Log change, and touches §5, §7
(`TacticName`), §8.1/§8.2 (prompts), §8.3 (term lists) and §10.7 (copy deck).

---

#### 5.1 · `authority` — "Pretending to be someone official"

**Definition:** the sender claims an institutional identity that would make
refusal feel risky — police, CBI, a court, a bank's fraud desk, a telecom
regulator, a courier company, a government scheme, the user's own employer.

**Why scammers use it:** authority short-circuits scrutiny. People do not
cross-examine a police officer. It also supplies a ready-made reason for every
strange request that follows.

**What it looks like — English:**
- "This is Inspector Sharma from Mumbai Cyber Crime Branch."
- "Your parcel has been seized by Customs. Case ID FED/2026/8841."
- "We are calling from the SBI fraud prevention department."
- "Notice from Income Tax Department regarding your PAN."

**What it looks like — Hinglish:**
- "Main CBI se bol raha hoon, aapke naam pe case file hua hai."
- "SBI bank se call kar rahe hain, aapka account verify karna hai."

**Canonical trigger phrases** (seed set for §8.3; extend from the corpus):
`cyber crime`, `cbi`, `police`, `inspector`, `customs`, `income tax`,
`enforcement directorate`, `trai`, `fraud department`, `legal notice`,
`fir has been`, `arrest warrant`, `court summon`, `narcotics`, `officer`

**User-facing explanation template:**
> They're claiming to be {authority} so that you don't question what comes next.
> Real {authority} never contacts people this way.

---

#### 5.2 · `urgency` — "Rushing you"

**Definition:** an artificial deadline or threatened consequence that makes
thinking feel expensive — account freeze, arrest, expiry, a window closing in
minutes.

**Why scammers use it:** the entire scam depends on the victim not pausing. A
pause means a phone call to a family member, and the scam ends. Urgency buys the
scammer the victim's undivided, un-consulted attention.

**What it looks like — English:**
- "Your account will be blocked within 2 hours."
- "Failure to comply will result in immediate arrest."
- "Last chance — offer expires today at midnight."
- "Update KYC before 6 PM or services will be suspended."

**What it looks like — Hinglish:**
- "Turant KYC update karein warna account band ho jayega."
- "Aaj hi karna hoga, kal se late fees lagega."

**Canonical trigger phrases:**
`immediately`, `within 24 hours`, `within 2 hours`, `turant`, `urgent`,
`last chance`, `expires today`, `will be blocked`, `will be suspended`,
`will be deactivated`, `legal action`, `arrest`, `final notice`, `act now`,
`failure to comply`

**User-facing explanation template:**
> The deadline is there to stop you thinking. Nothing real gets decided in
> {timeframe}.

---

#### 5.3 · `isolation` — "Keeping you alone"

**Definition:** instructions that separate the victim from anyone who might talk
them out of it — do not tell your family, stay on the line, do not discuss this
with bank staff, this is confidential.

**Why scammers use it:** it is the single strongest signal of criminal intent.
There is no legitimate reason for a bank, a courier, or a police officer to ask
you not to tell your family. Its presence should weigh heavily.

**What it looks like — English:**
- "Do not discuss this case with anyone, including family members."
- "Stay on the call. Disconnecting will be treated as non-cooperation."
- "This is a confidential investigation under the Official Secrets Act."
- "Do not visit the branch. We will handle it over the phone."

**What it looks like — Hinglish:**
- "Kisi ko batana mat, ye confidential matter hai."
- "Call mat kaatna, line pe rahiye."

**Canonical trigger phrases:**
`do not tell`, `don't tell anyone`, `kisi ko mat batana`, `confidential`,
`stay on the line`, `do not disconnect`, `call mat`, `without informing`,
`do not visit the branch`, `keep this between us`, `non-cooperation`

**User-facing explanation template:**
> They're trying to keep you from checking with anyone. No real institution asks
> you to hide a case from your own family.

---

#### 5.4 · `extraction` — "Getting what they came for"

**Definition:** the actual ask — an OTP, a UPI PIN or payment, card details, a
remote-access app install (AnyDesk, TeamViewer, QuickSupport), a "verification
fee", a link to a credential-harvesting page, or a callback to a number they
control.

**Why scammers use it:** it is the point. Everything before it is set-up. Its
presence triggers the extraction floor in §4.

**What it looks like — English:**
- "Share the 6-digit OTP you just received to verify your identity."
- "Pay a refundable security deposit of ₹4,999 to this UPI ID."
- "Install AnyDesk so our technician can resolve the issue remotely."
- "Click here to re-verify your KYC: bit.ly/sbi-kyc-verify"
- "Call 08xxxxxxxx immediately to speak to your case officer."

**What it looks like — Hinglish:**
- "OTP bhejiye verify karne ke liye."
- "Is UPI id pe ₹2000 bhej dijiye, refund ho jayega."

**Canonical trigger phrases:**
`otp`, `one time password`, `cvv`, `pin`, `upi id`, `scan this qr`,
`send money`, `transfer`, `refundable deposit`, `processing fee`,
`anydesk`, `teamviewer`, `quicksupport`, `screen share`, `install this app`,
`click here`, `verify your kyc`, `update your kyc`, `bit.ly`, `tinyurl`,
`call this number`, `whatsapp me on`

**User-facing explanation template:**
> This is what they actually want: {ask}. Sharing it hands them {consequence}.

---

### §5.5 · Sender origin — a signal, not a tactic

**The insight:** in India, legitimate commercial and institutional SMS cannot
legally arrive from a personal mobile number. Under TRAI's DLT regime, banks,
government bodies, couriers and merchants must send through a **registered
alphanumeric header** — `VM-SBIINB`, `AD-HDFCBK`, `JD-AMAZON`, `TX-ICICIB`.

A scam almost always cannot. Scammers send from an ordinary 10-digit mobile
number, a WhatsApp account, or an international number, because registering a
DLT header requires a real registered business entity.

So: **"Your SBI account is blocked" arriving from +91 98xxxxxxxx is a
contradiction on its face.** A real bank message from a personal number does not
exist. This is one of the highest-signal, lowest-ambiguity checks available in
this market, and it costs a regex.

#### Why it is not a fifth tactic

The four tactics in §5 describe **manipulation inside the message text**, and
each one is evidenced by phrases with character offsets that get highlighted in
the message body (§7). Sender origin is **metadata about the envelope** — it has
no span inside the message and nothing to highlight.

Mixing the two would corrupt the `Evidence` contract. So sender origin is a
separate field, `senderSignal` (§7), rendered as its own card in the UI (§10.6)
so it still reads to the user as a flagged finding.

#### Classification — deterministic, in code, always

`src/detector/sender.ts` exports `classifySender(raw: string): SenderSignal`.

**This runs in code, in every engine path, regardless of which engine is
active.** A regex parses a phone number exactly and for free; a 1B model does
not. The LLM is *told* the classification as a fact — it never performs it.

| Kind | Shape | Risk | Meaning |
|---|---|---|---|
| `dlt_header` | `XY-ABCDEF` — 2-char prefix, hyphen, 6 alphanumeric | `none` | A registered sender. The normal shape of a real bank/courier/government SMS. |
| `shortcode` | 5–6 digits | `none` | Operator or service shortcode. |
| `phone_number` | 10 digits starting 6–9, optionally `+91`/`0` prefixed | **`high`** | A personal Indian mobile. No legitimate institution sends from one. |
| `telemarketer` | Starts `140` | `medium` | Registered telemarketing. Legal, but commercial and worth noting. |
| `international` | `+` and a country code that is not `+91` | **`high`** | Common for large-scale fraud operations. |
| `email_or_other` | Anything else | `medium` | Unusual origin; worth noting, not conclusive. |
| `unknown` | Not provided by the user | `none` | Sender is **optional**. Absence is never penalised. |

#### The context rule — this is what stops false positives

**A personal number is only damning when the message claims to be an
institution.** Your cousin forwarding you a WhatsApp message is a personal
number too, and flagging that would make the app useless.

So `senderSignal.risk === 'high'` carries heavy weight **only in combination
with the `authority` tactic** (§4 override rule 3). On its own, a personal
number is worth a small nudge and a neutral note, nothing more.

The pairing is the signal: **claiming to be a bank + not being able to send like
one.** Neither half means much alone.

#### A registered header is not a free pass

`dlt_header` reduces the score modestly. It never forces `safe` and never
short-circuits the tactic analysis. Header spoofing and misuse of legitimately
registered headers both happen, and a scam message that reaches the user through
a real header is exactly the case where our text analysis has to still work.

**Rule:** the sender signal may raise the verdict decisively. It may only lower
it modestly.

#### Sender is optional everywhere

The user may not have the sender, may not think to enter it, or may be pasting
from WhatsApp where there is no header at all. Listen mode has no sender by
definition. When `sender` is absent:

- `senderSignal.kind === 'unknown'`, `risk === 'none'`
- No override rule fires
- No score adjustment in either direction
- The SenderCard does not render

Detection without a sender is exactly as good as it was before this feature. The
sender is a bonus signal, never a prerequisite.

---

### §5.6 · Voice — a transcript is not an SMS

Listen mode (§10.6, §11 P11) feeds a live speech transcript through the **same
`Detector` interface** — that is the point of §6, and Listen mode adds no
detection logic of its own. But the *text* it produces is a different animal
from an SMS, and treating them identically loses real scams.

`DetectionInput.channel` is `'text'` (default) or `'voice'`.

#### What actually differs

| | SMS | Transcript |
|---|---|---|
| Sender | Often available — drives §5.5 | **Never available.** The impersonation-mismatch rule cannot fire, so the language has to carry the whole judgment. |
| Acronyms | `OTP`, `KYC`, `UPI` | `o t p`, `k y c`, `u p i` — speech recognition spells them out |
| App names | `AnyDesk` | `any desk` |
| Amounts | `Rs.4999` | `four thousand nine hundred rupees` |
| Punctuation | Present | Absent — no sentence boundaries |
| Framing | Written notice | Call-centre script: "I am calling from…", "please listen carefully", "transferring your call" |
| Completeness | Whole message at once | A rolling buffer of a conversation still in progress |

#### How acronyms are handled — and why not by normalising

The obvious fix is to rewrite `o t p` to `otp` before matching. **Do not.**
Rewriting changes character offsets, and evidence offsets are what drive
highlighting (§7). A normalisation pass would silently corrupt every highlight
in Listen mode.

Instead the patterns themselves match both forms: `o[\s.]?t[\s.]?p`
matches `OTP`, `o t p` and `o.t.p` alike, and offsets stay exact. Same for CVV,
KYC and UPI.

#### Voice-only terms

`VOICE_TERMS` in `terms.ts` is merged on top of `TERMS` when the channel is
voice. These are patterns that do not occur in an SMS, so keeping them out of
the text path avoids inventing false positives there.

The strongest voice-only signal by a distance is **"are you alone" / "is anyone
with you" / "go to a quiet room"**. A real bank has no reason to establish
whether you are unsupervised. A scammer running a digital-arrest script always
does, and it has essentially no legitimate counterpart on a phone call.

#### The legitimate-call trap

Delivery and cab drivers really do call and ask you to read out a code. Those
are the voice equivalent of the legitimate bank OTP SMS, and the corpus carries
them as regression guards (`voice-legit-001`, `voice-legit-002`). Any change to
the voice terms must keep them `safe`.

### `nextMove` — required on every result

`DetectionResult.nextMove` (§7) is **always populated**, including on `safe`
verdicts. It answers the question the user is actually asking, which is not
"what is this" but "what happens if I go along with it".

| Situation | Example `nextMove` |
|---|---|
| OTP requested | "They want the OTP from your bank's SMS. That code is the only thing standing between them and your account." |
| UPI transfer requested | "They want you to send money now and trust a refund later. There will be no refund." |
| Remote-access app | "They want you to install a screen-sharing app so they can operate your banking app while you watch." |
| Callback number | "They want you to call back on their number, where a second person will take over and ask for the codes." |
| Link | "They want you on a page that looks like your bank, so you type your login in yourself." |
| Nothing found (`safe`) | "This message isn't asking you for anything sensitive." |

**Writing rule:** name the specific thing, then the specific consequence. Never
generic ("be careful", "stay alert") — a generic `nextMove` is a bug.

---

## §6 · Architecture

### The one rule

**Everything goes through one interface. The UI never knows which engine ran.**

Three very different things — a browser-resident LLM, a remote API, and a
keyword scorer — are interchangeable behind a single function signature. That
substitutability is what lets the product survive a dead network, a device
without WebGPU, and a rate-limited API key, all without a code path in the UI.

### Layering

```
  src/screens/*          ← calls the orchestrator, holds screen state
        │
        ▼
  src/detector/orchestrator.ts    ← picks the engine, enforces timeout, falls back
        │
        ├── LocalDetector   (WebLLM + WebGPU)     §8.1
        ├── CloudDetector   (OpenRouter)          §8.2
        └── RuleDetector    (pure TS)             §8.3
```

**Import rules — enforced at review:**

- `src/ui/**` may not import from `src/detector/**`. Components receive a
  `DetectionResult` as a prop and render it. Nothing more.
- `src/screens/**` imports only `orchestrator.ts` and the types. A screen never
  imports `LocalDetector` directly.
- `src/detector/**` may not import from `src/ui/**` or `src/screens/**`. The
  detector has no idea a UI exists.

A future session that wires a React component straight to WebLLM has broken the
product's main structural claim, and the redesign runbook (§15) along with it.

### The interface — frozen

```ts
// src/detector/types.ts

export interface Detector {
  readonly id: EngineId
  /** Cheap, non-throwing capability probe. Never downloads anything. */
  isAvailable(): Promise<boolean>
  /** Analyse a message. See the engine contract below. */
  detect(input: DetectionInput, signal: AbortSignal): Promise<DetectionResult>
}
```

`DetectionInput` (§7) carries the message text plus the **optional** sender
string. It is an object rather than positional arguments specifically so that a
future signal can be added without changing the signature of three engines and
every call site.

### The engine contract — frozen, mandatory for all three implementations

1. **`detect` never throws synchronously.** Failures reject the returned
   promise. The orchestrator is the only thing that catches.
2. **`detect` honours `signal`.** On abort it stops work and rejects with an
   `AbortError`. A cancelled analysis must not keep burning the GPU.
3. **`detect` validates before returning.** The object leaving an engine has
   already been checked against the schema (§7). An engine never hands the
   orchestrator a malformed result and lets the UI find out.
4. **`isAvailable` is cheap and never throws.** It returns `false` rather than
   rejecting. `RuleDetector.isAvailable()` returns `true` unconditionally.
5. **Engines are stateless per call**, except for `LocalDetector`'s loaded model
   handle, which is a module-level singleton (loading it twice is a bug).

### The orchestrator

```ts
// src/detector/orchestrator.ts
export async function analyze(
  input: DetectionInput,
  preference: 'local' | 'cloud',
  signal: AbortSignal,
): Promise<DetectionResult>
```

Behaviour, in order:

1. **Classify the sender deterministically** via `classifySender` (§5.5). This
   happens once, in the orchestrator, before any engine runs — so all three
   engines receive the same `SenderSignal` as an input fact rather than each
   deriving it.
2. Select the primary engine from the user's switch (`preference`). **Default is
   `local`** (D6).
3. If `await primary.isAvailable()` is false, skip to step 5.
4. Race `primary.detect(input, signal)` against the timeout budget for that
   engine (§8). On success, take the result.
5. **Fall back to `RuleDetector`.** It is synchronous, always available, and
   cannot fail. Take its result.
6. Attach the `SenderSignal`, apply the §4 override rules (including the
   impersonation mismatch, which depends on it), and stamp `engineUsed` and
   `latencyMs`.

Step 1 is deliberate: the sender check is the one part of detection that is
identical and exact across every engine, including the fallback. Even a total
engine failure still produces a correct sender verdict.

**Fallback is silent.** The user is never shown an error, a retry prompt, a
degraded-mode banner, or the word "offline" as a consequence of fallback. They
paste a message and get a verdict. Which engine produced it is
`console.info`-level information for us, never UI (§8.3, §9).

The one exception: if the user has explicitly selected `cloud` and the device is
offline, Home shows a quiet inline note that on-device will be used instead
(copy key `cloud_unavailable`, §10.7). That is informing a choice the user made,
not reporting a failure.

### Timeout budget

| Engine | Budget | On expiry |
|---|---|---|
| `local` | 8,000 ms | Abort, fall through to rules |
| `cloud` | 6,000 ms | Abort, fall through to rules |
| `rules` | — | Synchronous, no timeout possible |

8 seconds is chosen to be longer than a Max-tier (§8.1) inference on the iQOO
and shorter than a judge's patience. The number lives in one constant,
`ENGINE_TIMEOUTS` in `orchestrator.ts`.

---

## §7 · Data contracts

### `src/detector/types.ts` — frozen, reproduce exactly

```ts
export type Verdict = 'danger' | 'caution' | 'safe'

export type EngineId = 'local' | 'cloud' | 'rules'

export type TacticName = 'authority' | 'urgency' | 'isolation' | 'extraction'

/** What the user gives us to analyse. Sender is always optional (§5.5). */
export interface DetectionInput {
  text: string
  /** Sender ID or number as the user typed it. Absent is normal. */
  sender?: string
}

export type SenderKind =
  | 'dlt_header'      // VM-SBIINB — TRAI-registered, the shape of a real one
  | 'shortcode'       // 5-6 digits
  | 'phone_number'    // 10-digit Indian mobile (6-9 lead), optional +91 / 0
  | 'telemarketer'    // 140-prefixed
  | 'international'   // + and a country code that is not +91
  | 'email_or_other'
  | 'unknown'         // not provided — never penalised

export type SenderRisk = 'high' | 'medium' | 'none'

export interface SenderSignal {
  /** Exactly what the user typed, for display. */
  raw: string
  kind: SenderKind
  risk: SenderRisk
  /** One plain-language sentence. Empty when kind is 'unknown'. */
  note: string
}

/** A phrase in the user's message that triggered a tactic. */
export interface Evidence {
  /** Exact substring as it appears in the input, verbatim. */
  phrase: string
  /** Character offset into the original input. -1 when unresolved. */
  start: number
  /** Exclusive end offset. -1 when unresolved. */
  end: number
}

export interface Tactic {
  name: TacticName
  /** User-facing label, e.g. "Pretending to be someone official". */
  label: string
  evidence: Evidence[]
  /** One plain-language sentence explaining this tactic in this message. */
  note: string
}

export interface DetectionResult {
  verdict: Verdict
  /**
   * INTERNAL ONLY. Drives the §4 threshold table.
   * Rendering this value in any form is a spec violation. See §4.
   */
  confidence: number
  tactics: Tactic[]
  /**
   * Always present. `kind: 'unknown'` when the user gave no sender.
   * Classified deterministically in the orchestrator, never by a model (§5.5).
   */
  senderSignal: SenderSignal
  /** 1-2 sentences, plain language, no jargon. */
  explanation: string
  /** What the sender wants next. Always populated, including on 'safe'. */
  nextMove: string
  /** Debug/console only. Never rendered. */
  engineUsed: EngineId
  latencyMs: number
}
```

### Invariants

Checked by `validateResult()` in `src/detector/validate.ts`, which every engine
calls before returning:

- `confidence` is a finite number in `[0, 1]`.
- `verdict` agrees with the §4 mapping *after* the override rules are applied.
- `tactics` contains no duplicate `name` values — one card per tactic, with all
  its evidence collected inside it.
- `explanation` and `nextMove` are non-empty after trimming.
- Every `Evidence.phrase` is non-empty.
- `senderSignal` is present, and its `kind`/`risk` pair is consistent with the
  §5.5 table (a `dlt_header` may not carry `risk: 'high'`).
- If `verdict === 'danger'` then `tactics.length >= 1` **or**
  `senderSignal.risk === 'high'` (§4 rule 4) — there must be something to show.

A result failing validation is treated as an engine failure: the engine rejects,
and the orchestrator falls through to rules. It is never patched up and shown.

### Evidence resolution — the algorithm that makes highlighting work

An LLM returns phrases as *text*. It frequently returns them with different
casing, collapsed whitespace, stripped punctuation, or lightly paraphrased. To
highlight, we need **character offsets into the original input**. This function
bridges the two, and it is the single most likely thing for a cold session to
get wrong.

```ts
// src/detector/evidence.ts
export function resolveEvidence(input: string, phrase: string): Evidence
```

Try each strategy in order; the first that produces a match wins:

1. **Exact.** `input.indexOf(phrase)`.
2. **Case-insensitive.** Lowercase both, `indexOf`, map the index back to the
   original string (same length, so the index is valid unchanged).
3. **Whitespace-normalised.** Collapse runs of whitespace in both to a single
   space, keeping an index map from normalised positions back to original
   positions. Match, then translate the offsets back through the map.
4. **Trimmed punctuation.** Strip leading/trailing punctuation from the phrase
   and retry strategies 1–3.
5. **Give up.** Return `{ phrase, start: -1, end: -1 }`.

**Unresolved evidence is not discarded.** It is rendered as a plain chip below
the message rather than as an inline highlight (§10.6, Verdict screen). The
phrase still tells the user something even if we could not locate it.

### Rendering highlights safely

`HighlightedMessage` (§10.3) receives the original text plus a flat list of all
resolved evidence spans across all tactics, and:

1. **Discards** spans with `start === -1`.
2. **Sorts** by `start`.
3. **Merges overlaps.** Two tactics often flag overlapping phrases. Overlapping
   spans merge into one highlight carrying both tactic names; nested spans are
   absorbed by the outer one. Never render overlapping `<mark>` elements — that
   is how the displayed text gets corrupted or duplicated.
4. **Walks the string** emitting alternating plain and highlighted segments.

**Non-negotiable:** the concatenation of all emitted segments must equal the
original input exactly. The user must be able to read their own message
unchanged. A highlighter that drops or duplicates a character is a P0 bug — this
is the screen where trust is either earned or lost.

Highlight styling carries the verdict colour but must remain readable: a
background tint plus an underline, never a colour so strong the text beneath it
stops being legible (§10.2, §10.8).

---

## §8 · Engine specifications

All three implement `Detector` (§6) and obey the engine contract. They share one
prompt (§8.4) and one validator, so improving the prompt improves both LLM
engines at once.

---

### §8.1 · `LocalDetector` — WebLLM on WebGPU

**The headline engine.** This is the claim the pitch rests on and the behaviour
the judges' device instrumentation rewards (§9).

`src/detector/local.ts`

**Runtime:** `@mlc-ai/web-llm`. Inference runs in the browser on WebGPU. Model
weights download once and are cached in IndexedDB by the library, so subsequent
loads — including with the network fully off — read from disk.

**Verified facts (tested before the event, do not re-litigate):**
- WebGPU works in Android Chrome on the target hardware.
- WebLLM genuinely runs inference client-side, not on a server.
- After first load, the model is served from IndexedDB and works in airplane mode.
- A 4B model is too slow and too heavy for a phone demo. Do not use one.

#### Model tiers (D7)

Three tiers, declared in one config table in `src/detector/models.ts`. The tier
is user-selectable in Settings; `standard` is the default.

| Tier | Class | Role | Notes |
|---|---|---|---|
| `low` | ≈0.5B | Emergency fallback | Only if `standard` will not load on the device. Weakest reasoning. |
| `standard` | ≈1B | **Default** | The demo-safe balance of latency and quality. |
| `max` | ≈3B | Pitch / heavy | Deliberately exercised on stage (§9, §13). Slower, noticeably more device work. |

Exact model IDs are chosen at P7 from the WebLLM prebuilt list and **written
into this table at that time**, together with measured numbers, so no later
session re-benchmarks:

| Tier | Model ID | Download size | Load time (iQOO 15) | Tokens/sec | Fill after P7 |
|---|---|---|---|---|---|
| `low` | _TBD_ | _TBD_ | _TBD_ | _TBD_ | ☐ |
| `standard` | _TBD_ | _TBD_ | _TBD_ | _TBD_ | ☐ |
| `max` | _TBD_ | _TBD_ | _TBD_ | _TBD_ | ☐ |

Switching tiers triggers a fresh download. That is acceptable and is itself a
demonstrable moment (a visible, honest cost of running locally).

**Selection criteria if a listed model is unavailable:** prefer instruction-tuned
models with reliable JSON output, `q4f16_1` quantisation, and the smallest
context window that fits a 4,000-character message plus the prompt.

#### Loading

- **Preload on app open**, not lazily on first analysis (§9a). The user sees
  honest progress on the Model-loading screen while the app remains usable with
  the rules engine underneath.
- Report progress through WebLLM's `initProgressCallback` into a store the
  Model-loading screen reads.
- The engine instance is a **module-level singleton**. Loading twice is a bug
  and will exhaust device memory.
- `isAvailable()` returns `true` only when `navigator.gpu` exists **and** an
  adapter is obtainable **and** the model is loaded. It never triggers a
  download.

#### Generation parameters

- `temperature: 0.1` — this is a classification task, not creative writing.
- `max_tokens: 500` — enough for the JSON, tight enough to stay fast.
- Response format: JSON, requested both via the API's JSON mode where supported
  and by instruction in the prompt.

#### Failure modes

| Failure | Handling |
|---|---|
| No WebGPU / no adapter | `isAvailable()` false → orchestrator uses rules. Settings shows why. |
| Model download fails | Retry once, then `isAvailable()` false. |
| Out of memory on `max` tier | Catch, drop to `standard`, tell the user in Settings copy `tier_downgraded`. |
| Malformed JSON output | One repair retry (§8.4), then reject → rules. |
| Exceeds 8s budget | Orchestrator aborts → rules. |

#### Standalone test

A dev-only route `/dev/engines` runs the full corpus (§12) through this engine
and prints per-message verdicts and latencies. Used at P7 to confirm the engine
works before any UI depends on it.

---

### §8.2 · `CloudDetector` — OpenRouter

`src/detector/cloud.ts`

The privacy trade-off the user can consciously make: faster and stronger, but
the message text leaves the device. Positioned in the UI as the choice for a
weak device or a hurry — **never** as the default (D6).

- **Provider:** OpenRouter. Fast free-tier instruct model.
- **Key:** `VITE_OPENROUTER_API_KEY`, via `.env.local`, never committed.
  `.env.example` documents the variable name with an empty value.
- **Prompt:** identical to §8.4. Same validator. Same repair retry.
- **Timeout:** 6,000 ms, enforced by the orchestrator via `AbortSignal` passed
  into `fetch`.
- `isAvailable()`: returns `navigator.onLine && Boolean(apiKey)`. It does **not**
  make a network probe — that would cost a round-trip on every keystroke-adjacent
  check.

**Known limitation, stated rather than hidden:** the key ships in the client
bundle. That is acceptable for a hackathon build with a free-tier key and is
disclosed in §14. A production build would proxy this through a server, which we
do not have by constraint (§2).

| Failure | Handling |
|---|---|
| Offline | `isAvailable()` false → rules, plus the `cloud_unavailable` note (§6). |
| 401 / 429 / 5xx | Reject → rules. Logged to console with the status. |
| Timeout | Orchestrator aborts → rules. |
| Malformed JSON | One repair retry, then reject → rules. |

---

### §8.3 · `RuleDetector` — deterministic scoring

`src/detector/rules.ts`

**The floor.** Pure TypeScript, synchronous, zero dependencies, no network, no
GPU, cannot fail. It is why the user always gets a verdict.

**It is invisible (D2).** It is never selectable in the UI, never named in the
UI, and its use is never surfaced as a failure or a degraded state. It is not
"the AI" in the pitch and must not be presented as one. It is the safety net
under the trapeze.

#### Scoring model

For each of the four tactics (§5), a term list of weighted phrases and regexes:

```ts
type Term = { pattern: string | RegExp; weight: number }
type TermSet = Record<TacticName, Term[]>
```

- Match case-insensitively against the input.
- Each match contributes its weight to that tactic's subtotal, and records an
  `Evidence` entry via `resolveEvidence` (§7).
- A tactic is **present** when its subtotal crosses that tactic's presence
  threshold.
- `confidence` = a normalised, saturating combination of the present tactics'
  subtotals, weighted by how diagnostic each tactic is.

**Weighting guidance:**

| Tactic | Relative weight | Reasoning |
|---|---|---|
| `isolation` | Highest | Almost no legitimate message asks you not to tell your family. Near-zero false-positive rate. |
| `extraction` | High | Strong, but legitimate bank messages also mention OTPs — see the negative terms below. |
| `authority` | Medium | Real couriers and banks do identify themselves. |
| `urgency` | Lowest | Real messages have real deadlines. Weak on its own; meaningful in combination. |

**Sender contribution (§5.5).** The `SenderSignal` is computed by the
orchestrator and handed to this engine; it does not classify the sender itself.

| Signal | Effect on score |
|---|---|
| `risk: 'high'` **and** `authority` present | Large positive — the impersonation mismatch. §4 rule 3 also fires. |
| `risk: 'high'`, no `authority` | Small positive nudge only. A personal number is normal for a WhatsApp forward (§5.5 context rule). |
| `risk: 'medium'` | Small positive nudge. |
| `kind: 'dlt_header'` | **Modest negative.** Never zeroes the score, never forces `safe` (§5.5). |
| `kind: 'unknown'` | Zero. No adjustment in either direction. |

#### Conclusive signals

Some behaviours have essentially no legitimate counterpart: a bank never asks
you to install AnyDesk, and nobody legitimate requires a fee before releasing a
prize you have won. These set a confidence **floor** rather than adding weight,
because their strength does not depend on what else is in the message.

Added after the first tuning pass, when holdout testing showed the weighting
model capped any single tactic well below the danger threshold — "install
AnyDesk and share the code with me" scored 0.56 and came back as merely
`caution`, which is wrong.

Two guards, both load-bearing:

1. **Negation guard.** "Do not share the OTP" contains the exact substring
   "share the OTP" and means the opposite. A conclusive match preceded by a
   negator within the same clause is discarded. Without this, every legitimate
   bank SMS trips the floor and the §12 gate fails.
2. **`unless` contexts.** A courier or cab driver legitimately asks for an OTP
   at handover. Found by holdout testing: an Uber "share OTP 7719 with your
   driver" message was being returned as `danger`.

A floor only applies when at least one tactic registered, so it can never
produce a `danger` verdict with nothing to show the user (§4 rule 4).

#### Negative terms — the false-positive defence

This is what keeps a genuine bank SMS out of the red, and it is the measure that
actually matters (§12). Phrases that indicate *legitimacy* subtract from the
score:

`do not share this otp`, `never share your otp`, `bank never asks`,
`we will never call you`, `if you did not request`, `to report fraud call`,
`this is an automated message`, `do not reply to this message`

A real bank OTP message contains "do not share this OTP with anyone" — the exact
opposite of an extraction attempt. Without negative terms the rules engine flags
every legitimate OTP message, and the demo dies on the second beat.

#### Language coverage (D4)

English and Hinglish (Latin script) term sets, held in one file
`src/detector/terms.ts` and structured so a Devanagari or Kannada set can be
added later as an additional record without touching the scoring code (§15).

#### Standalone test

`npm run test:corpus` runs this engine over the whole corpus. Because it is
deterministic, it is the only engine that can be regression-tested meaningfully,
which makes it the anchor of the test suite (§12).

---

### §8.4 · The shared prompt contract

Used verbatim by both LLM engines. Lives in `src/detector/prompt.ts` as the
single exported constant `SYSTEM_PROMPT` plus a `buildUserPrompt(text)`.

**System prompt requirements:**

- Assign the role: an assistant that analyses SMS/chat messages for scam
  manipulation tactics, for users in India.
- Define the four tactics (§5) in the same words the spec uses.
- Require the output to be **JSON only** — no prose, no markdown fence, no
  preamble.
- **State the sender classification as a given fact**, not a question. The user
  prompt includes a line such as
  `Sender: +91 98xxxxxxxx (a personal mobile number — not a registered business sender)`
  when a sender was supplied, and omits the line entirely when it was not.
  Instruct the model to weigh a personal-number sender heavily **only when the
  message claims to be a bank, government body, or company** (§5.5 context
  rule), and to reflect that contradiction in `explanation` when it applies.
  The model must not attempt to classify the sender itself — that has already
  been done exactly, in code.
- Require every `evidence.phrase` to be **an exact substring copied verbatim
  from the message**, never paraphrased. Say this twice; it is the instruction
  small models most often ignore, and paraphrase is what breaks highlighting.
- Require `explanation` and `nextMove` in plain language, second person, at most
  two sentences.
- Forbid mentioning scores, percentages, or probabilities in any string field
  (§4) — a small model will otherwise happily write "85% likely a scam" into the
  explanation and put a number on screen through the back door.
- State that a legitimate message must be reported as such with an empty
  `tactics` array. Small models are eager to please and will invent tactics if
  not explicitly told that finding nothing is a valid, expected answer.

**Expected output shape** (the model returns this; the engine adds `engineUsed`,
`latencyMs`, and the §4-derived `verdict`):

```json
{
  "confidence": 0.0,
  "tactics": [
    { "name": "extraction", "evidence": ["exact substring"], "note": "one sentence" }
  ],
  "explanation": "one or two sentences",
  "nextMove": "one sentence naming the specific ask"
}
```

**Parsing and repair:**

1. Strip markdown fences if present (small models add them despite instructions).
2. Extract the outermost `{...}` block.
3. `JSON.parse`.
4. Map to `DetectionResult`: resolve each evidence string via `resolveEvidence`,
   attach `label` from the copy deck (§10.7), attach the `SenderSignal` supplied
   by the orchestrator, and derive `verdict` from `confidence` through the shared
   §4 mapping including all four override rules.
5. `validateResult()`.
6. **On any failure:** one repair attempt — re-prompt with the invalid output and
   an instruction to return only valid JSON matching the schema. If that also
   fails, reject. The orchestrator falls through to rules.

**The model never chooses the verdict string.** It reports `confidence` and
tactics; §4's shared mapping decides `danger`/`caution`/`safe`. This keeps the
three engines consistent with each other and keeps the override rules (extraction
floor, three-tactic rule, impersonation mismatch, empty-finding ceiling)
authoritative.

---

## §9 · Device-work telemetry and scoring alignment

The event instruments the device: CPU, RAM, storage and network activity are
read as evidence of whether real computation is happening locally. Kavach is an
on-device AI product, so this instrumentation measures exactly what we are
actually doing. Two consequences follow.

### §9a · Engineering defaults lean local

| Default | Rationale |
|---|---|
| `local` is the default engine (D6) | It is the pitch, and it is the behaviour being measured. |
| Model **preloads on app open** | The load is real work, and doing it early means it is done before the demo, not during it. |
| `standard` tier default, `max` tier available | Real headroom to run heavier on demand (§13). |
| **No result caching in the demo path** | Each analysis runs a real forward pass. Caching would fake speed and hide the work. |
| Cloud framed as the low-end/patchy-data option | Never the happy path. |

### §9b · The app measures and shows its own work

A **"Running on this device"** panel: collapsed on Home, expanded in Settings,
and opened deliberately as a demo beat (§13). Every value is read from a real
browser API. Nothing is estimated, and nothing is invented.

| Metric | Source | If unavailable |
|---|---|---|
| Model name + tier | `models.ts` config | Always available |
| Model size on disk | `navigator.storage.estimate().usage` | Show "—", hide the row |
| Storage quota used | `navigator.storage.estimate()` | Hide the row |
| JS heap in use | `performance.memory.usedJSHeapSize` | Chromium-only. Hide the row entirely on other engines — never show a zero. |
| Inference time | Measured per analysis (`latencyMs`) | Always available |
| Tokens/sec | Measured from the last generation | Show after first analysis |
| **Bytes sent for this analysis** | `0` when `engineUsed === 'local'` | The headline number |
| WebGPU adapter / backend | `navigator.gpu.requestAdapter()` info | Show "WebGPU unavailable" |
| Offline-capable | Service worker state + model cached | Always available |

**Rule:** a metric whose API is unavailable has its row **hidden**, never shown
as `0` or `N/A`. A panel full of zeros reads as broken and undermines the exact
claim it exists to support.

This panel is a pitch asset as much as a feature. It converts "trust us, it runs
locally" into something a judge can look at and check, and it reads the same
instruments they are reading.

### §9c · Integrity line — read this before optimising for the metric

Kavach may legitimately **do more real work**: run a larger model tier, preload
at startup, skip result caching, run a warm-up pass. Those are genuine
engineering choices with genuine user-facing justifications, and they happen to
show up in device measurements because they are really happening.

Kavach must **never manufacture load it does not need**. No busy-loops, no
artificial delays, no fake progress, no padding computation, no inflated
numbers in the panel.

The reason is practical as well as ethical: a judge who asks "what is that CPU
spike doing?" gets a real answer if it is a 3B model doing inference, and gets
caught if it is a spin loop. **Genuinely running a 3B model on a phone is a far
stronger answer than any faked number**, and it is available to us. Take the
real version.

### §9d · Where telemetry lives in the code

`src/device/metrics.ts` — a single module exporting one async
`readDeviceMetrics(): Promise<DeviceMetrics>`. Every API access is individually
wrapped in `try/catch` and yields `undefined` on failure; the panel hides
`undefined` rows. No component calls a browser measurement API directly (§10.3).

---

## §10 · UI/UX specification

The interface is a judged feature (D8), not a wrapper around a detector. It is
also **going to be redesigned** — that is a stated expectation, not a risk — so
it is built in layers that come apart cleanly.

**Context of use, which drives every decision below:** a phone held at arm's
length, one-handed, in a loud and badly-lit hall, by someone who has about four
seconds of attention. Nothing subtle survives that environment.

---

### §10.1 · Design principles

Five principles. Each one has a concrete consequence; a principle with no
consequence is decoration.

**1. The verdict is the interface.**
The state and its headline occupy the top of the Verdict screen and nothing
competes with them. No logo, no nav bar, no engine badge, no settings gear above
the fold. *Consequence:* the Verdict screen has no persistent chrome.

**2. Readable by someone's parent.**
Second person, present tense, short sentences, no jargon, no percentages. If a
string needs a security concept explained, the string is wrong.
*Consequence:* every user-facing string lives in the copy deck (§10.7) where it
can be read as a set and judged for reading level.

**3. Show the evidence, not the reasoning.**
A highlighted phrase in the user's own message is more convincing than a
paragraph about why. The user should be able to see the trap.
*Consequence:* the message-with-highlights sits directly under the verdict,
above the tactic cards — evidence before explanation.

**4. Calm under alarm.**
A DANGER screen must feel serious without looking like malware. Aggressive
red-on-black with warning triangles and shake animations reads as a scam itself,
which is a genuine trap for security UI. Confidence is quieter than panic.
*Consequence:* one saturated accent against a deep neutral surface; generous
space; no flashing, no shake, no alarm iconography beyond a single clear glyph.

**5. Every state is designed.**
Loading, empty, too-short, offline, model-downloading, no-WebGPU, mic-denied.
*Consequence:* §10.6 lists every state per screen, and a phase is not done until
each one is reachable and looks deliberate on the phone.

---

### §10.2 · Design tokens

`src/ui/tokens.css` defines every colour, size, radius and duration as a CSS
custom property. **This file is the redesign surface** (§15).

**Rule, enforced at review:** no component contains a hex colour, a raw `px`
radius, a shadow, or a hard-coded duration. If a value is needed that does not
exist as a token, add the token.

Dark is the default theme. Light is defined and correct, but the demo runs dark.

```css
:root {
  /* ---- surfaces & text (dark, default) ---- */
  --bg:            #0B0D10;
  --surface:       #14181D;
  --surface-2:     #1C222A;
  --border:        #2A323C;
  --text:          #F2F5F8;
  --text-muted:    #98A4B3;
  --text-faint:    #6B7785;

  /* ---- verdict roles ----
     -accent : the saturated state colour (icon, rule, key text)
     -tint   : low-chroma surface behind a verdict region
     -on-tint: text colour guaranteed AA on -tint            */
  --danger-accent:   #E5484D;
  --danger-tint:     #2A1416;
  --danger-on-tint:  #FFB8BA;

  --caution-accent:  #FFB224;
  --caution-tint:    #2A2009;
  --caution-on-tint: #FFD584;

  --safe-accent:     #30A46C;
  --safe-tint:       #0D2018;
  --safe-on-tint:    #74D6A5;

  /* ---- highlight (evidence in the message body) ---- */
  --hl-bg:         color-mix(in srgb, var(--danger-accent) 22%, transparent);
  --hl-underline:  var(--danger-accent);

  /* ---- type scale ---- */
  --fs-xs:  0.75rem;   /* 12 - metadata, panel labels          */
  --fs-sm:  0.875rem;  /* 14 - secondary copy, notes           */
  --fs-md:  1rem;      /* 16 - body, message text (min size)   */
  --fs-lg:  1.25rem;   /* 20 - card titles, sub-headline       */
  --fs-xl:  1.75rem;   /* 28 - screen titles                   */
  --fs-2xl: 2.5rem;    /* 40 - verdict headline                */
  --lh-tight: 1.2;
  --lh-body:  1.55;

  /* ---- spacing (4px base) ---- */
  --sp-1: 0.25rem;  --sp-2: 0.5rem;  --sp-3: 0.75rem;
  --sp-4: 1rem;     --sp-6: 1.5rem;  --sp-8: 2rem;   --sp-12: 3rem;

  /* ---- radii ---- */
  --r-sm: 8px;  --r-md: 12px;  --r-lg: 16px;  --r-xl: 24px;  --r-full: 999px;

  /* ---- elevation ---- */
  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.4);
  --shadow-2: 0 8px 24px rgb(0 0 0 / 0.45);

  /* ---- motion ---- */
  --dur-fast: 120ms;  --dur-base: 200ms;  --dur-slow: 320ms;
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);

  /* ---- layout ---- */
  --tap-min: 44px;          /* never smaller (§10.8) */
  --content-max: 34rem;     /* readable measure on tablets/desktop */
}
```

Light theme redefines the same names under `[data-theme='light']`. No new names,
no component-level overrides.

**Contrast obligations (verified at P4, re-verified at P12):**

| Pair | Requirement |
|---|---|
| `--text` on `--bg` / `--surface` / `--surface-2` | ≥ 7:1 |
| `--text-muted` on `--surface` | ≥ 4.5:1 |
| each `--*-on-tint` on its `--*-tint` | ≥ 4.5:1 |
| each `--*-accent` on `--bg` | ≥ 3:1 (used for icons and rules, not body text) |
| message text over `--hl-bg` | ≥ 4.5:1 — **the highlight must never reduce legibility of the user's own message** |

---

### §10.3 · UI architecture — built to be replaced

```
src/ui/tokens.css        design tokens — the redesign surface
src/ui/primitives/       Button · Card · Sheet · Switch · Chip · Progress ·
                         Skeleton · Icon
src/ui/components/       VerdictBanner · HighlightedMessage · TacticCard ·
                         SenderCard · SenderField · EngineSwitch · DevicePanel ·
                         PresetList · ListenWave · ModelProgress
src/screens/             Home · Analyzing · Verdict · Listen · Settings
src/detector/            engines, orchestrator, types, prompt, rules
src/device/              metrics.ts
```

**The layering rule — frozen:**

> **Screens compose. Components render. The detector decides.**

Which means, concretely:

- A component in `src/ui/**` receives everything it displays as props. It does
  not import from `src/detector/**` or `src/device/**`, does not call an engine,
  does not hold detection logic, and does not measure the device.
- A screen in `src/screens/**` imports `orchestrator.ts` and the types, owns the
  async state (idle / running / done / aborted), and passes plain data down.
- `src/detector/**` imports nothing from `src/ui/**` or `src/screens/**`.

**Why this is frozen:** it is the only thing that makes the promised redesign
cheap. If `VerdictBanner` knows what WebLLM is, then swapping the UI means
rewriting the detector, and at 3am nobody will.

**Component contract:** every component in `src/ui/components/` is a pure
function of its props with no internal fetch, no timers driving business logic,
and an explicit prop for each state it can render (`loading`, `error`, `empty`).

---

### §10.4 · React Bits usage

[React Bits](https://reactbits.dev) supplies the motion and effect components.
Its distribution model — copy the component source into your own repo rather
than installing a dependency — is exactly the ownership model we want: the code
is ours to retarget at our tokens, and it satisfies the originality constraint
as attributed third-party component code rather than carried-in project code
(§0).

**Candidate uses, in priority order:**

| Use | Where | Value |
|---|---|---|
| Verdict reveal animation | Verdict screen | The single most important moment in the app. Worth the most polish. |
| Count-up on device metrics | DevicePanel | Makes real measurements feel measured. |
| Staggered list entrance | TacticCard list | Cheap, reads as considered. |
| Title text treatment | Home | Brand moment, one place only. |
| Background effect | Home | Only if it costs nothing while idle. First thing cut. |

**Guardrails:**

1. **Vendored components land in `src/ui/primitives/` or `src/ui/components/`**
   and are immediately re-pointed at our tokens. No vendor palette, no magic
   numbers, no inline hex left behind. Add a one-line attribution comment at the
   top of each vendored file.
2. **No component-level animation library sprawl.** Pick one motion library at
   P4 and use only that.
3. **Animation budget — hard constraint.** Decorative animation must not run
   while inference is running. We are deliberately loading a 1–3B model onto the
   same device (D6/D7); a looping background effect competing with WebGPU for
   frame time damages the exact metric we are being judged on and makes the app
   feel slower than it is.
   - Looping and heavy effects **pause** when analysis starts and resume when it
     ends. Wire this to the same state that drives the Analyzing screen.
   - The Analyzing state itself uses only compositor-cheap animation —
     `transform` and `opacity`. No layout-triggering properties, no canvas, no
     per-frame JS.
4. **`prefers-reduced-motion: reduce` disables all non-essential motion.** The
   verdict must be completely readable with every animation off. Test this.
5. **Motion serves comprehension.** The verdict reveal exists to draw the eye to
   the judgment. Animation that does not direct attention is removed.

---

### §10.5 · Mobbin as pattern reference

[Mobbin](https://mobbin.com) is a library of real, shipped mobile flows. It is a
**reference for interaction patterns, not a source of code or visual style**.

**Process, before designing each screen in §10.6:** look up the closest proven
pattern, and record in the screen's subsection which pattern is being followed
and why. Solving an interaction problem that a hundred shipped apps have already
solved is a waste of a 25-hour window.

| Screen | Pattern to look up |
|---|---|
| Home | Compose / paste-input screens with a primary action and example chips |
| Analyzing | Inline processing state with cancel |
| Verdict | Result / detail screens with a strong status header |
| Listen | Voice-capture screens with live transcript and a stop control |
| Model loading | First-run download-progress and setup screens |
| Settings | Grouped settings lists with inline switches and a diagnostics block |
| Mic permission | **Permission priming** — an in-app explanation shown *before* the OS prompt |

**Boundary:** reference the interaction pattern and the information hierarchy.
Do not copy any product's brand, illustration, iconography, or copy.

---

### §10.6 · Screen specifications

Each screen: purpose, anatomy top-to-bottom, states, interactions, pattern.

---

#### Home — `src/screens/Home.tsx`

**Purpose:** get a message into the app with as little friction as possible.

**Anatomy:**
1. App title (small; brand, not chrome)
2. Paste field — large, auto-focused, min 6 lines visible, `--fs-md` minimum
3. **SenderField** — one short optional input, label `sender_label`, placeholder
   `sender_placeholder`. Sits directly under the paste field. Never required,
   never blocks the primary action (§5.5).
4. Primary action — "Check this message", full-width, thumb-reachable bottom
5. Preset chips — "Try an example": one scam, one legit bank SMS
6. Engine switch — On-device ⇄ Cloud, with a one-line privacy caption
7. Device panel, collapsed — one summary line, tap to expand
8. Listen mode entry point

**SenderField behaviour:**
- Optional, and visibly optional — the label says so. A required-looking field
  the user cannot fill is worse than no field.
- Live classification as they type: once the input matches a known shape, show a
  quiet inline hint (`sender_hint_registered` / `sender_hint_personal`). This
  teaches the DLT distinction *before* the verdict, which is the part most users
  have never heard of.
- Presets fill it automatically — the scam preset with a 10-digit number, the
  legit preset with a real DLT header. This is what makes the contrast land in
  the demo (§13).

**Layout rule:** the primary action sits in the bottom third. The whole flow must
be operable with one thumb on a large phone.

**States:**

| State | Behaviour |
|---|---|
| Empty | Placeholder copy `paste_placeholder`. Button disabled. |
| Typing / pasted | Button enabled once ≥10 characters. |
| Too short | Button disabled, hint `too_short` under the field. |
| Over 4,000 chars | Accept, note `truncated` (§4). |
| Cloud selected, offline | Inline note `cloud_unavailable` (§6). |
| Model still downloading | Everything works; ModelProgress shows as a slim bar under the title. Never block input on the model. |

**Pattern:** compose screen with example chips.

---

#### Analyzing — inline state on Home, not a route

**Purpose:** cover 0.5–8 seconds honestly without inviting a second tap.

**Anatomy:** the paste field collapses to a two-line preview; a progress
indicator and status line replace the button; a "Cancel" text button sits below.

**States:** running · cancelling · (transitions out to Verdict).

**Rules:**
- Cancel is always available and actually aborts (§6 `AbortSignal`).
- Compositor-only animation (§10.4).
- If it completes in under 400ms, hold the state for 400ms before transitioning.
  An instantaneous flash reads as "it did not really do anything" — which, given
  that the whole pitch is that real work happened on the device, is precisely the
  wrong impression.

---

#### Verdict — `src/screens/Verdict.tsx`

**Purpose:** deliver the judgment, prove it, and say what the sender wants.
The most important screen in the product.

**Anatomy, in order:**
1. **VerdictBanner** — full-bleed `--*-tint` background, `--*-accent` icon,
   headline at `--fs-2xl`, sub-line at `--fs-md` (§4 table). Icon + text always;
   never colour alone.
2. **HighlightedMessage** — the user's message, verbatim, with evidence
   highlighted inline (§7). This is the proof.
3. **Unresolved evidence chips** — any evidence with `start === -1`, as chips
   below the message, labelled `phrases_found`.
4. **SenderCard** — renders whenever `senderSignal.kind !== 'unknown'`, and sits
   **first in the findings list, above the tactic cards**. Shows the sender as
   typed, what kind of sender it is, and the plain-language note. Styled like a
   TacticCard so it reads as a finding, but visually distinguished by a sender
   glyph rather than a tactic glyph.
   - `risk: 'high'` + `authority` present → the strong copy
     (`sender_mismatch_note`), in the danger role. This is the single most
     persuasive card in the app.
   - `risk: 'high'` alone → neutral note (`sender_personal_note`), caution role.
   - `kind: 'dlt_header'` → reassuring note (`sender_registered_note`), safe
     role — shown even on a `danger` verdict, because "registered sender but the
     text is still manipulative" is exactly the case a user needs explained.
5. **TacticCard list** — one card per detected tactic: label, plain-language
   note, and its evidence phrases. Absent entirely on a clean `safe` result.
6. **"What they want next"** — `nextMove`, in its own emphasised block. On a
   `safe` verdict this still renders, with the reassuring variant.
7. **Actions** — "Check another message" (primary), "Share this result"
   (secondary, stretch).

**Scroll behaviour:** the VerdictBanner scrolls away normally — do not pin it.
A sticky red bar over a scrolling message is oppressive and fights principle 4.

**States:** danger · caution · safe · safe-with-no-tactics (cards omitted) ·
no-sender-supplied (SenderCard omitted).

**Pattern:** result screen with a strong status header.

---

#### Listen — `src/screens/Listen.tsx`

**Purpose:** run the same detector against a live speakerphone conversation.

**Anatomy:**
1. Status line — "Listening…" with an animated level indicator
2. Live transcript, newest at the bottom, auto-scrolling
3. Stop button — large, always reachable
4. **Interrupt overlay** — full-screen `--danger-tint` takeover when a scam
   pattern is detected mid-call, with the headline and the tactics found

**Mechanics:**
- Web Speech API (`SpeechRecognition`), `continuous: true`,
  `interimResults: true`.
- Maintain a rolling buffer of the last ~400 characters of finalised transcript.
- Debounce: run the detector at most every 3 seconds, and only when the buffer
  has grown meaningfully since the last run.
- Feed the buffer through the **same orchestrator** (§6). Listen mode adds no
  detection logic of its own — this is the point of the interface.
- Trigger the interrupt overlay on `danger`. Once fired, do not re-fire for the
  same buffer.

**States:** permission-priming · permission-denied · listening · analyzing ·
interrupted · stopped · unsupported-browser.

**Honesty note, stated in the UI and the pitch:** Web Speech recognition on
Android Chrome sends audio to Google for transcription. **Listen mode is
therefore not offline and not private in the way paste mode is.** Say so in the
Listen screen's caption (`listen_privacy_note`). Do not let the offline claim
bleed across from paste mode — a judge who knows this will check, and the honest
version is the stronger position.

**Pattern:** voice capture with live transcript; permission priming before the
OS prompt.

---

#### Model loading — `ModelProgress`, shown on Home and Settings

**Purpose:** make the slowest moment in the product feel like value being
delivered rather than time being wasted. This is the moment most likely to lose
a judge.

**Anatomy:** what is downloading, how big it is, progress, and one line on why
it is worth it ("This runs on your phone, so it works offline and nothing you
paste leaves the device").

**States:** idle · downloading (with percentage of *download*, which is a number
about the file, not about a message — permitted) · loading into GPU · ready ·
failed.

**Rule:** the app is fully usable throughout. The rules engine covers the gap
silently (§6). Never block the paste field on the model.

---

#### Settings — `src/screens/Settings.tsx`

**Anatomy:**
1. Engine switch (same component as Home) with the privacy explanation in full
2. Model tier selector — `low` / `standard` / `max`, each with size and speed
   from the §8.1 table, and a clear warning that switching downloads a new model
3. Device panel, expanded (§9b)
4. About: what Kavach does, what it does not do, the call-audio limitation (§1),
   and a plain disclaimer that it is an assistant and not a guarantee
5. Version and build

**Pattern:** grouped settings list with inline switches and a diagnostics block.

---

### §10.7 · Copy deck

Every user-facing string, in one table. Single source for edits, review, and
later translation. Lives in `src/ui/copy.ts` as a flat exported object.

| Key | Text |
|---|---|
| `app_name` | Kavach |
| `app_tagline` | Check a message before you trust it |
| `paste_placeholder` | Paste the message here — SMS, WhatsApp, anything |
| `cta_check` | Check this message |
| `cta_again` | Check another message |
| `cta_cancel` | Cancel |
| `too_short` | Paste a bit more of the message |
| `truncated` | Long message — we checked the first part |
| `try_example` | Try an example |
| `example_scam` | A scam message |
| `example_legit` | A real bank SMS |
| `verdict_danger_head` | This is a scam |
| `verdict_danger_sub` | Do not reply. Do not send money or codes. |
| `verdict_caution_head` | Something's off here |
| `verdict_caution_sub` | Check before you act. |
| `verdict_safe_head` | Looks legitimate |
| `verdict_safe_sub` | Nothing manipulative found. |
| `tactic_authority` | Pretending to be someone official |
| `tactic_urgency` | Rushing you |
| `tactic_isolation` | Keeping you alone |
| `tactic_extraction` | Getting what they came for |
| `next_move_title` | What they want next |
| `phrases_found` | Phrases we flagged |
| `sender_label` | Who sent it? (optional) |
| `sender_placeholder` | e.g. VM-SBIINB or +91 98765 43210 |
| `sender_hint_registered` | Registered business sender |
| `sender_hint_personal` | Personal mobile number |
| `sender_card_title` | Who it came from |
| `sender_mismatch_note` | This claims to be from {institution}, but it came from a personal mobile number. Real banks and government offices can only send from a registered sender ID — they cannot text you from a normal number. |
| `sender_personal_note` | This came from a personal mobile number, not a registered business sender. |
| `sender_registered_note` | This came from a registered business sender ID, which is how real companies send SMS. |
| `sender_international_note` | This came from an international number. |
| `sender_telemarketer_note` | This came from a registered telemarketing number. |
| `engine_title` | Privacy |
| `engine_local` | On-device |
| `engine_cloud` | Cloud |
| `engine_local_note` | The AI runs on your phone. Nothing you paste leaves it. |
| `engine_cloud_note` | Faster on older phones. Your message is sent to be analysed. |
| `cloud_unavailable` | No connection — checking on your phone instead |
| `tier_downgraded` | Switched to the smaller model — this phone ran out of memory |
| `device_panel_title` | Running on this device |
| `device_panel_summary` | On-device · nothing sent |
| `model_downloading` | Getting the AI ready — {size} |
| `model_why` | This runs on your phone, so it works offline and nothing you paste leaves the device. |
| `model_ready` | Ready — works offline now |
| `no_webgpu` | This phone can't run the on-device AI. Cloud mode still works. |
| `listen_title` | Listen to a call |
| `listen_prime` | Put the call on speaker. Kavach will listen through the mic and warn you if it hears a scam. |
| `listen_privacy_note` | Live transcription uses Google's speech service, so Listen mode isn't offline. Paste mode still is. |
| `listen_denied` | Kavach needs microphone access to listen |
| `listen_active` | Listening… |
| `listen_stop` | Stop listening |
| `listen_interrupt` | Hang up. This is a scam. |
| `about_disclaimer` | Kavach is a second opinion, not a guarantee. When in doubt, call the company on a number you looked up yourself. |

**Writing rules for anyone adding a string:** second person; present tense; no
percentages or scores (§4); no security jargon ("phishing", "social
engineering", "vector"); under 12 words wherever possible.

---

### §10.8 · Accessibility

Not a compliance checkbox — the target user skews older, and the demo hall is
dark and loud.

- **Never colour alone.** Every verdict carries an icon and a text headline.
- **Contrast** per the §10.2 table, verified at P4 and again at P12.
- **Tap targets** ≥ `--tap-min` (44px). No exceptions, including the engine
  switch and preset chips.
- **Body text** never below `--fs-md` (16px). The message body especially.
- **Live region:** the Verdict headline is announced via `role="status"` /
  `aria-live="polite"` when a result lands, so the verdict reaches a screen
  reader without the user hunting for it.
- **Focus order** follows visual order; the Verdict screen moves focus to the
  banner on mount.
- **`prefers-reduced-motion: reduce`** disables all non-essential motion
  (§10.4). The verdict reveal degrades to an instant render, never to nothing.
- **Highlight legibility:** evidence highlighting uses a background tint *plus*
  an underline, so it survives greyscale and colour-blind viewing.
- **Zoom:** layout must not break at 200% text zoom.

---

## §11 · Phase plan

**How to use this section:** find the first unchecked phase. That is your job.
Do only that phase. Verify its exit criterion **on the iQOO phone**. Tick the
box and commit the tick together with the code.

**Do not build ahead.** A later phase built early against an unfinished earlier
phase is the most reliable way to lose a night.

### Budget

Window: Sat 11:00 → Sun 12:00. **Code freeze 09:00 Sunday** for rehearsal.
The timeboxes below sum to roughly the whole build window with no slack — which
is the point. If a phase overruns, the overrun comes out of P11 (Listen), not
out of the phases after it.

### The ordering principle

Two rules produced this order, and a future session changing it should preserve
both:

1. **Retire the biggest unknown as early and as cheaply as possible.** WebLLM
   running on the actual iQOO is the existential risk — the entire pitch rests
   on it. So P2 is a 45-minute throwaway spike that answers *only* that
   question, at roughly hour 4. If it fails we re-plan with 18 hours left
   instead of 11. The full engine is still built later, at P7, once there is a
   UI worth putting it behind.
2. **After the first end-to-end build, every phase boundary is shippable.** From
   P6 onward, stopping at any point leaves a coherent demo rather than a
   half-finished one. See the ladder below.

### The demo ladder

If time runs out, this is what you have:

| After | You can demo |
|---|---|
| P6 | Paste → verdict, scam and legit, on the phone. Beats 1–2. |
| P7 | The same, running **on-device**. Beats 1–3. |
| **P8** | **Add airplane mode. Beats 1, 2, 4, 6 — the complete winning demo.** |
| P9 | Device panel open during a Max-tier run. Beat 3 in full. |
| P10 | Insurance: failsafe and silent fallback under failure. |
| P11 | Beat 5, Listen mode. |
| P12 | Rehearsed and frozen. |

**P8 is the milestone that matters.** Everything after it is additive. Aim to be
there by roughly hour 14, which leaves the whole second half for polish, the
optional beats, and rehearsal rather than for panic.

### Priority under time pressure

**P7 and P8 outrank P11.** On-device inference and the offline demo are the two
things actually being judged (D6, D8). If the night runs short, Listen mode is
cut before anything on-device, offline, or UI quality is compromised.

---

### ☐ P0 — Scaffold, deploy, WebGPU probe · ~1h

**Goal:** a deployed, installable shell reachable from the phone, and the first
byte of risk retired.

**Do:** Vite + React + TypeScript + Tailwind. `vite-plugin-pwa`. Folder
structure per §10.3. Minimal internal router (no dependency) so Android's back
button behaves. `.env.example` with `VITE_OPENROUTER_API_KEY=`. Push to GitHub.
Connect Vercel with auto-deploy on push. **A `/dev/probe` route reporting
WebGPU adapter presence, IndexedDB availability, service-worker state and user
agent.**

**Exit criterion:** the Vercel URL loads on the iQOO over HTTPS, and
`/dev/probe` reports a WebGPU adapter present on that device.

**Note:** do this during a Green Light window. Installs and first deploys are
miserable over remote-control.

**⚠ Secure-context trap — read before debugging any WebGPU failure.**
WebGPU, service workers and the microphone all require a *secure context*.
`localhost` counts; **a LAN address like `http://192.168.x.x:5173` does not.**

So opening the dev server on the phone over wifi will report **no WebGPU
adapter** — not because the iQOO cannot do it, but because the page is not
secure. That failure looks identical to a dead device and is the single most
likely way to waste an hour panicking about hardware that is fine.

**Always test device capability against the deployed HTTPS URL.** `/dev/probe`
reports `isSecureContext` as its first row precisely so this is visible at a
glance rather than inferred.

---

### ☑ P1 — Detector core · ~2h  — **DONE**

**Goal:** a working detector with zero dependencies, and a test that pins it.

**Do:** `src/detector/types.ts` exactly as §7. `validate.ts`. `verdict.ts` (the
§4 mapping plus all four override rules). `evidence.ts` (§7 resolution
algorithm). `sender.ts` (§5.5 `classifySender`). `terms.ts` (§8.3 term sets,
seeded from §5). `rules.ts` including the sender contribution table.
`/corpus/*.json` (§12). `npm run test:corpus`.

**Seed the corpus yourself** with a starter set drawn from §5's example phrases
so this phase is never blocked waiting on Maharishi. Real messages replace the
seeds as they arrive; the harness must run on a partial corpus either way.

**Exit criterion:** `npm run test:corpus` runs and **passes the false-positive
gate** — no legit message returns `danger`. Sender classification unit tests
pass for every row of the §5.5 table, including `+91`-prefixed, `0`-prefixed and
space-separated formats.

**Why this early:** from here on there is always something demoable, and the LLM
engines are never on the critical path to *having something to show*.

---

### ☐ P2 — WebLLM spike · ~45m · **go/no-go for the whole pitch**

**Goal:** answer the one question that decides the strategy, before anything is
built on top of the answer.

**Do:** install `@mlc-ai/web-llm`. A dev-only route `/dev/llm` that loads the
**smallest** available model, runs one hardcoded prompt, and prints: adapter
info, download size, load time, output, tokens/sec. No UI, no types, no
integration, no prompt engineering. Throwaway code — P7 rewrites it properly.

**Exit criterion:** on the iQOO, over HTTPS, the model loads and produces
tokens, with the numbers printed on screen. Then reload and confirm the second
load is served from IndexedDB.

**Before declaring failure, check `/dev/probe` first.** If `isSecureContext` is
false you are on the LAN dev server, not the deployed URL, and WebGPU is absent
for that reason alone — see the trap noted under P0.

**If it fails:** stop and re-plan immediately. Do not attempt to fix it inside
this timebox and do not proceed to P3 assuming it will work later. The fallback
strategy is cloud-first with the rules engine, and the on-device story becomes an
honest "here is why this is hard, and here is how far we got" — which is still a
respectable Open Innovation entry, but only if we pivot with 18 hours left
rather than 11.

**This phase exists purely to move that decision from hour 10 to hour 4.**

---

### ☐ P3 — CloudDetector and the shared prompt · ~1h

**Goal:** validate the shared prompt and JSON contract cheaply, before spending
GPU time on it.

**Do:** `prompt.ts` (§8.4), including the sender-classification line. `cloud.ts`
(§8.2). Parsing, repair retry, validation. A minimal `orchestrator.ts` — sender
classification, engine selection, timeout, fallback to rules. Dev route
`/dev/engines` that runs a message through a chosen engine and dumps the raw
result.

**Exit criterion:** a real scam SMS pasted at `/dev/engines` returns a valid,
schema-passing `DetectionResult` with correctly resolved evidence offsets and a
correct `senderSignal`.

**Why before the local engine:** P7 then inherits a proven prompt and only has to
solve WebGPU. Debugging a bad prompt and a bad WebGPU setup simultaneously is how
the night gets eaten.

---

### ☐ P4 — Design system · ~1.5h

**Goal:** the token layer and the primitives the next two screens actually need.

**Do:** `src/ui/tokens.css` per §10.2, wired into Tailwind's theme. Light theme.
`src/ui/copy.ts` from §10.7. Choose the motion library. Dev route `/dev/ui`
rendering every primitive in every state.

**Build only the primitives P5 and P6 need** — Button, Card, Chip, Switch,
Progress, Icon. Sheet and Skeleton wait until a screen actually calls for them.
Building an unused primitive at hour 6 is the cheapest thing to cut.

**Exit criterion:** `/dev/ui` renders on the phone; every primitive is driven
entirely by tokens; the §10.2 contrast table is verified; toggling
`prefers-reduced-motion` visibly changes behaviour.

**Why before screens:** retrofitting a token layer onto finished screens at 3am
is the version of this that fails, and D8 promises a redesign.

---

### ☐ P5 — Verdict screen and highlighting · ~2h

**Goal:** the most important screen, driven by fixture data.

**Do:** `VerdictBanner`, `HighlightedMessage` (§7 merge algorithm), `TacticCard`,
`SenderCard` (§10.6), the `nextMove` block. Drive it from static fixtures — not a
live engine — so the screen can be built and reviewed without inference in the
loop. Include a fixture for each SenderCard variant, and one with no sender.

**Exit criterion:** every corpus message rendered through fixtures highlights
correctly; **the concatenated segments equal the original text for all of them**
(assert this in the test suite, not by eye); all three verdict states and all
SenderCard variants look right on the phone.

---

### ☐ P6 — Home screen, end to end · ~1.5h · **first demoable build**

**Goal:** close the loop.

**Do:** `Home.tsx` with paste field, `SenderField` (§10.6), presets, primary
action, the Analyzing inline state, `EngineSwitch`. Wire to the orchestrator
(rules + cloud at this point).

**Exit criterion:** paste → verdict works end-to-end on the phone, one-handed,
for both a scam preset and the legit preset, with each preset auto-filling its
sender and the SenderCard rendering correctly for both.

**Commit this and be glad it exists.** It is the first build that would survive
being shown to someone.

---

### ☐ P7 — LocalDetector, full · ~2.5h · **headline phase**

**Goal:** the claim the whole pitch rests on, properly built.

**Do:** `models.ts` tier table. `local.ts` (§8.1): WebGPU probe, singleton
engine, preload on app open, progress reporting, generation, parse, repair,
validate. `ModelProgress`. Delete the P2 spike code. **Fill in the §8.1
measurement table with real numbers from the iQOO.**

**Exit criterion:** an on-device verdict on the phone with the network on; reload
and confirm the second load reads from IndexedDB rather than re-downloading;
§8.1 table filled in.

The spike (P2) already proved this is possible, so this phase is engineering, not
discovery — which is why it is 2.5h rather than 3.

---

### ☐ P8 — PWA hardening and the offline demo · ~1.5h · **the milestone**

**Goal:** the signature demo beat, and the point at which the core demo is
complete.

**Do:** manifest (name, icons, theme colour from tokens, standalone display),
service worker precaching the app shell, install prompt handling, offline
fallback. Confirm the model cache survives alongside the SW cache.

**Exit criterion:** installed to the iQOO home screen from Chrome; then
**airplane mode on, launch from the home screen icon, paste a scam message with
On-device selected, and get a correct verdict.**

**Rehearse §13 beats 1, 2, 4 and 6 here, end to end.** From this point the demo
exists and everything else improves it. If the night goes badly from here, you
still have a complete story.

---

### ☐ P9 — Device panel and tier selector · ~1.5h

**Goal:** make the local claim checkable on screen (§9).

**Do:** `src/device/metrics.ts` with every API access individually try/caught.
`DevicePanel` (collapsed on Home, expanded in Settings). `Settings.tsx` with the
tier selector. Count-up animation on the metrics.

**Exit criterion:** the panel shows real storage, heap, tokens/sec and adapter
values on the iQOO; unavailable rows are **hidden, not zeroed**; the `max` tier
downloads, loads and returns a verdict on the device.

---

### ☐ P10 — Orchestrator hardening and failsafe · ~1h

**Goal:** the user always gets a verdict, whatever breaks.

**Do:** harden `orchestrator.ts` (§6): full timeout budget, abort propagation,
silent fallback, `engineUsed`/`latencyMs` stamping, `console.info` engine
logging. The `cloud_unavailable` note. **Triple-tap the app title → pre-baked
demo verdict**, using a fixture, for insurance against a live failure on stage.

**Exit criterion:** with an analysis in flight, kill the network (or force the
engine to throw) and confirm the user still receives a verdict with no error UI;
cancel aborts genuinely; triple-tap works on the phone.

---

### ☐ P11 — Listen mode · ~2.5h · **timeboxed, kill-criterion below**

**Goal:** live-call detection through the mic.

**Do:** `Listen.tsx` per §10.6: permission priming before the OS prompt, Web
Speech recognition, rolling buffer, 3s debounce, same orchestrator, full-screen
interrupt overlay, the `listen_privacy_note` caption.

**Exit criterion:** playing a recorded scam call on speaker from a second phone
produces a live transcript that drives the detector and fires the interrupt
overlay.

**☠ Kill-criterion — pre-approved, not a failure:** if the exit criterion is not
met when the timebox expires, **cut it**. Hide the entry point, commit, move to
P12. The demo runs on paste + offline alone, which is already a complete story.
No session may take time from P12 to rescue P11.

**Known hazards:** Android Chrome `SpeechRecognition` stops on silence — restart
it on the `end` event. Recognition needs network, so Listen mode is not part of
the offline claim (§10.6). Do not demo Listen and airplane mode in the same
breath.

---

### ☐ P12 — Polish, tuning, rehearsal, freeze · ~2.5h

**Goal:** arrive at 09:00 Sunday with something rehearsed.

**Do:** run the full corpus and tune the §8.3 term weights against the
false-positive gate. UI checklist (§12) on the phone. Re-verify the §10.2
contrast table. Rehearse §13 end-to-end at least three times on the actual
device. Fix only what the rehearsal breaks.

**Exit criterion:** three consecutive clean run-throughs of §13 on the iQOO.
**Then stop committing.**

---

### Phase completion log

Append one line per phase as it lands: phase, time finished, anything the next
session needs to know that is not already in this document.

| Phase | Finished | Notes for the next session |
|---|---|---|
| P0 | code complete | Deployed URL + on-device WebGPU check still pending. `/dev/probe` reports `isSecureContext` first — see the secure-context trap above. |
| P1 | done | Corpus at 40 messages, gate PASS, 100% scam->danger. Conclusive-signal floors added (§8.3) after holdout testing showed single-tactic scams capped below the threshold. `/dev/engines` is the hand-test surface. |
| | | |

---

## §12 · Test and QA plan

### The corpus

`/corpus/` — plain JSON, editable by someone who does not write code. This file
format is the interface between the code workstream and the corpus workstream,
so it stays boring on purpose.

```jsonc
// /corpus/scam-en.json
[
  {
    "id": "scam-en-001",
    "lang": "en",
    "sender": "+91 98765 43210",
    "text": "Dear customer, your SBI account will be blocked...",
    "expect": "danger",
    "expectTactics": ["authority", "urgency", "extraction"],
    "expectSenderKind": "phone_number",
    "source": "received by team member, Aug 2026"
  }
]
```

**`sender` is required in the corpus even though it is optional in the app.**
Capturing the real sender is the whole point of collecting real messages — a
corpus of scam texts with the senders stripped cannot test §5.5 at all, and the
sender is the field a contributor is most likely to forget. Legit entries carry
their real DLT headers (`VM-SBIINB`, `AD-HDFCBK`); scam entries carry the real
originating number, digits masked only if the contributor prefers.

At least three entries must have `"sender": null` so the no-sender path stays
tested.

| File | Contents | Target count |
|---|---|---|
| `scam-en.json` | English scam messages | ~20 |
| `scam-hinglish.json` | Hinglish (Latin script) scam messages | ~10 |
| `legit.json` | Real bank / OTP / delivery / OTP-with-warning messages | ~15 |

`expectTactics` is advisory — used to report drift, not to fail the build. Only
`expect` is enforced.

### The false-positive gate — the metric that actually matters

```
No message in legit.json may return `danger`.
```

This is a **hard gate**: `npm run test:corpus` exits non-zero if it fails, and a
phase cannot be ticked while it is failing.

Everything else is a soft target reported as a summary. The reasoning: a
detector that flags everything red scores 100% on scam recall and is completely
worthless, and a judge will find that out in one paste. The legit bank SMS
returning green is the second beat of the demo (§13) precisely because it is the
claim that is hard to fake.

**Soft targets, reported not enforced:** ≥80% of scam messages return `danger`;
≥95% return `danger` or `caution`. A scam landing in `caution` is a miss but not
a disaster — the user was still warned.

### `npm run test:corpus`

A plain Node script, no test framework needed:

1. Load all corpus files.
2. Run each message through `RuleDetector` (deterministic, so it is the only
   engine worth regression-testing).
3. Print a table: id, expected, actual, tactics found.
4. Print the summary: false-positive gate PASS/FAIL, scam recall, near-misses.
5. Exit non-zero on gate failure.

Optionally accept `--engine=cloud` to spot-check the LLM path manually. Never
gate the build on a non-deterministic engine.

### Holdout testing — do this every time the engine is tuned

The corpus is a regression net, not a measure of quality. Tuning against it and
then reporting its own numbers is circular: the first tuning pass reached 100%
on the corpus while still returning `safe` for a job scam and `danger` for a
legitimate Uber OTP message.

**Before believing any corpus number, write five to ten fresh messages the
engine has never seen and run those.** Every bug found this way then gets
promoted into the corpus as a permanent regression guard — the entries marked
`holdout —` in the corpus files came from exactly that loop, and each one
represents a real failure that the corpus alone had hidden.

### Unit tests worth writing (only these)

Time is short; these three earn their keep:

- `evidence.ts` — each resolution strategy, and the give-up path.
- `sender.ts` — every row of the §5.5 table, plus the formats a real user
  actually types: `+91 98765 43210`, `+919876543210`, `09876543210`,
  `9876543210`, `VM-SBIINB`, `AD-HDFCBK`, `140xxxxxxx`, empty string, and
  garbage. This is pure string handling with no ambiguity, so it should be
  exhaustively correct rather than approximately correct.
- `HighlightedMessage` segment merge — **assert that concatenated output equals
  the input** for every corpus message, including overlapping and nested spans.
- `verdict.ts` — the §4 threshold table plus all four override rules, including
  the impersonation mismatch with and without a sender present.

### On-device manual matrix

Run on the iQOO at P9 and again at P11. Not on the laptop.

| Check | Pass condition |
|---|---|
| Install to home screen | Launches standalone, no browser chrome |
| Airplane mode + on-device | Correct verdict, no error UI |
| First run, cold cache | Model progress is honest; app usable throughout |
| Slow network (throttled) | Cloud times out and falls back silently |
| Mic permission denied | Listen shows the denied state, does not crash |
| Long message (4,000+ chars) | Truncation note shown, highlighting still aligned |
| Rotate device mid-analysis | No crash, state preserved |
| Battery saver on | Still returns a verdict (may be slower) |

### UI checklist — run each phase that touches UI

- Every state listed in §10.6 is reachable and looks deliberate
- Contrast table (§10.2) verified
- All tap targets ≥44px
- `prefers-reduced-motion` honoured; verdict fully readable with motion off
- Whole flow operable one-handed
- **No dropped frames during analysis** — the §10.4 animation budget holds
- Text zoom to 200% does not break layout

---

## §13 · Demo script

**Target: ~90 seconds.** Rehearse on the iQOO at least three times at P12.
Every beat below is a thing that works, not a thing we hope works.

| # | Beat | Time | What is said |
|---|---|---|---|
| 1 | Paste a real scam SMS **with its sender**. Red verdict, tactics highlighted, SenderCard on top. | ~20s | "This is a real message someone in Bengaluru received last month. Kavach shows you the trap — the fake authority, the deadline, the OTP they want. And look at the top: it claims to be SBI, but it came from a personal mobile number. A real bank *cannot* text you from a normal number — they're legally required to use a registered sender ID. That one mismatch is the tell." |
| 2 | Paste a **real bank SMS** with its real `VM-SBIINB` header. Green verdict. | ~12s | "And this is a genuine SBI message, from the registered sender. Green. It doesn't just flag everything red — that's the hard part." |
| 3 | **Open the device panel while a Max-tier analysis runs.** | ~15s | "That was the AI running on this phone. Two gigabytes of model, cached on device, zero bytes sent." |
| 4 | **Airplane mode on. Paste a scam message. Same verdict.** | ~25s | "Nothing to fall back on. No network at all. Same answer — because the model is on the phone." |
| 5 | Listen mode: play a recorded scam call on speaker from a second phone. Live transcript, mid-call interrupt. *(Cut if P11 was killed.)* | ~30s | "And it works on live calls through the speaker, on the same detector." |
| 6 | Close. | ~10s | "Google ships this only on Pixel 9 and above, in English, off by default. We're building it for everyone else." |

**Beats 1 and 2 together are the sender story**, and it is the most
locally-credible thing in the demo: an Indian judge knows immediately that a
bank cannot SMS from a personal number, and most people outside India have never
heard of DLT headers. Lead with the mismatch, then let beat 2's registered
header make the contrast concrete.

**Beat 2 is the one that wins the argument.** Anyone can build something that
says "scam" every time. Showing a legitimate message coming back green is the
proof that there is a real detector underneath.

**Beat 4 is the signature moment.** Do not rush it. Show the airplane-mode toggle
on screen. Let the silence sit.

### Failsafe

**Triple-tap the app title** → a pre-baked verdict from a fixture (P10). Insurance
against a dead model, a wedged GPU, or a phone that decided to update itself.

Rules for its use: it exists so that a technical failure does not become dead air
in front of judges. **Do not use it to fake a capability we do not have**, and do
not present a fixture as a live inference. If it fires, say the honest thing:
"the live model hiccuped — here's the result from a run a minute ago", and move
on. A recovered demo is fine. A dishonest one is not.

### If a beat fails live

- **Beat 1 or 2 fails:** switch to Cloud in Settings and re-run. The switch is
  one tap and is itself part of the story.
- **Beat 4 fails:** do not troubleshoot on stage. Move to beat 6.
- **Beat 5 fails:** skip it. It was already the optional beat.

---

## §14 · Risks and mitigations

Pre-decided, so nobody has to improvise at 3am.

| Risk | Likelihood | Mitigation |
|---|---|---|
| WebGPU unavailable on the judging device | Low — verified on iQOO 15 | Demo from our own device. Cloud mode and the rules engine both still work; `no_webgpu` copy exists. |
| `max` tier too slow or OOMs on the phone | Medium | `standard` is the default. Tier switch is one tap. `tier_downgraded` handles OOM automatically (§8.1). |
| Model download too slow on venue wifi | **High** | Download and cache during a Green Light window, well before the demo. Never download live on stage. Verify the cache after. |
| Web Speech needs network / stops on silence | High | Restart on `end`. Listen mode is excluded from the offline claim (§10.6). P11 has a kill-criterion. |
| OpenRouter rate limit or key expiry | Medium | Silent fallback to rules (§6). Cloud is not the demo path anyway (D6). |
| False positives on legit bank SMS | Medium | The hard gate in §12. Negative terms in §8.3. Tuned at P12. |
| Sender check flagging ordinary WhatsApp forwards from friends | **High if built naively** | The §5.5 context rule: a personal number only weighs heavily *with* the `authority` tactic. Covered by corpus entries of harmless personal-number messages. |
| Users leave the sender field blank | Certain, and fine | Sender is optional everywhere (§5.5). Detection without it is exactly as good as before. Presets fill it so the demo always shows it. |
| Over-trusting a registered DLT header | Medium | §5.5: the header may only lower the score modestly, never force `safe`. Header spoofing and misused registered headers both occur. |
| Decorative animation stealing frame time from inference | Medium | §10.4 animation budget — effects pause during analysis. |
| UI polish consuming time P7/P8 need | **High** | The §11 priority rule. P4 gives a system so polish is cheap later; P12 is the only phase where polish is the job. |
| Red Light window blocking laptop access | Certain | Do installs, model downloads and deploys during Green Light. Red Light is for coding against an already-working setup. |
| Highlighting corrupts the user's message | Low but fatal | Asserted in the test suite at P5 (§12), not checked by eye. |
| API key visible in the client bundle | Certain | Accepted for a hackathon build with a free-tier key. Disclosed here. A production build would proxy it; we have no backend by constraint (§2). |
| A session builds ahead and breaks a later phase | Medium | §11's "do only your phase" rule, and the completion log. |

---

## §15 · Extension guide

Written for the sessions that come after the hackathon — and, given D8, for the
redesign that is already expected.

### Redesign the UI without touching the detector

This is the path D8 promises will be cheap. In increasing order of effort:

1. **Restyle** — edit `src/ui/tokens.css` only. New palette, type scale,
   radii, motion. No component changes. Re-verify the §10.2 contrast table.
2. **Re-skin** — replace the files in `src/ui/primitives/`. Keep the prop
   signatures. Screens and components are unaffected.
3. **Re-layout** — replace files in `src/ui/components/` and rearrange
   `src/screens/`. `src/detector/**` and `src/device/**` are untouched.

At no point should a redesign require opening `src/detector/`. If it does, the
§10.3 layering rule has been broken somewhere — find it and fix that instead.

### Add a fifth tactic

Touches: §5 (definition, phrases, template) → §7 `TacticName` → §8.4 prompt →
§8.3 term list → §10.7 copy deck (`tactic_*`). **The UI needs no changes** —
`TacticCard` renders whatever tactics arrive. Add a Decision Log entry (§5 is
frozen).

### Add a fourth engine

Implement `Detector` (§6), obey the engine contract, register it in the
orchestrator's selection logic. The UI needs no changes — it never knew which
engine was running. This is the whole point of §6.

### Add a language (Hindi, Kannada — D4, deferred)

1. Add a term set to `src/detector/terms.ts` keyed by language. The scoring code
   does not change.
2. Add corpus files (`scam-hi.json`, `scam-kn.json`) and extend the gate.
3. Add translated strings alongside `src/ui/copy.ts` — the copy deck exists in
   one flat object specifically so this is a file copy, not a hunt.
4. **Re-evaluate the model tier.** Small quantised models degrade sharply on
   non-Latin scripts; the `standard` tier may not be adequate. Measure before
   promising.

### Things that would need real re-architecture (know before you promise)

- **In-call audio** — requires the Android default-dialer role. Not a PWA. A
  different product (§1).
- **Storing scan history** — contradicts §2. Would need an explicit privacy
  model and user consent, designed properly.
- **Sender reputation** — needs a network call and a backend, both excluded by
  §2's constraints.

---

## §16 · Decision log

Append-only. Newest at the bottom. To change something frozen (§0), add an entry
here first.

### 2026-08-29 — Initial decisions D1–D8

**D1 · Three verdict states, no score.**
DANGER / CAUTION / SAFE. No percentage, no numeric score, no confidence bar
anywhere in the UI. A number invites the user to negotiate with a scam
("72% risk" reads as "28% fine"), a small model's self-reported confidence is
not calibrated enough to deserve display, and three coloured states is the
entire interaction budget of the target user. `confidence` stays in the type for
internal thresholding. See §4.

**D2 · Two-way engine switch, invisible rules engine.**
The user controls On-device ⇄ Cloud. The rules engine is a silent safety net,
never selectable and never surfaced. Showing "fell back to rules" turns a
successful recovery into a visible failure, on stage, in front of judges. See
§6, §8.3.

**D3 · Listen mode is in the MVP.**
Chosen deliberately for demo payoff despite the risk. Mitigated with a hard
timebox and a pre-approved kill-criterion so it cannot sink the paste flow
(§11 P11).

**D4 · English + Hinglish only.**
Covers the overwhelming majority of real Indian scam SMS. Devanagari and Kannada
deferred: they need a second term set, and small quantised models degrade on
non-Latin scripts. Roadmap, not build. See §3, §15.

**D5 · Four tactics.**
Authority, Urgency, Isolation, Extraction. These are the vocabulary of the whole
product — prompts, scoring, and UI all speak in these terms. See §5.

**D6 · On-device is the default.**
Not merely available — the default and the pitch. The event instruments device
resource usage as evidence of genuine local computation, and Kavach genuinely is
an on-device AI product, so the product should do its work on the device rather
than shed it. Cloud is the opt-out for weak devices and patchy data. See §9.

**D7 · Three model tiers instead of one compromise model.**
`low` ≈0.5B (emergency), `standard` ≈1B (default), `max` ≈3B (pitch/heavy).
Supersedes the earlier working assumption of "0.5B only". A single model forced
a bad trade between demo latency and demonstrated capability; tiers let us keep
`standard` safe for the flow and exercise `max` deliberately. 4B remains
excluded — measured as too slow and too heavy on a phone. See §8.1.

**D8 · The UI is a primary, judged feature, and will be redesigned.**
Built on an explicit token system, with React Bits for motion components and
Mobbin for proven mobile patterns. Because a redesign is expected rather than
hypothetical, the layering rule (§10.3) is frozen and the token file is the
single redesign surface. See §10, §15.

### 2026-08-29 — D9, sender origin as a first-class signal

**D9 · Sender origin (DLT header vs personal number) is a core detection
signal.**

Under TRAI's DLT regime, Indian institutions must send SMS through a registered
alphanumeric header (`VM-SBIINB`). Scammers send from ordinary 10-digit mobile
numbers, because registering a header requires a real business entity. A message
claiming to be from a bank that arrived from a personal number is a contradiction
on its face — the highest-signal, lowest-ambiguity check available in this
market, and it costs a regex.

Design choices made with it, and why:

- **Not a fifth tactic.** Tactics are manipulation *inside the text*, evidenced
  by highlightable character spans. Sender origin is envelope metadata with no
  span. Making it a tactic would corrupt the `Evidence` contract, so it is a
  separate `senderSignal` field rendered as its own card (§5.5, §10.6).
- **Classified deterministically in the orchestrator, never by the model.** A
  regex parses a number exactly and free; a 1B model does not. The LLM receives
  the classification as a stated fact. This also means the check is identical
  across all three engines, including the rules fallback.
- **Context-gated.** A personal number only weighs heavily when the `authority`
  tactic is present (§4 override rule 3). Without that gate, every WhatsApp
  forward from a friend would be flagged and the app would be useless.
- **Asymmetric.** A high-risk sender may raise the verdict decisively; a
  registered header may only lower it modestly. Header spoofing and misuse of
  legitimately registered headers both happen, and a scam arriving through a real
  header is precisely where the text analysis still has to work.
- **Optional everywhere.** Absent sender means no adjustment in either
  direction. Listen mode has no sender at all.

**Contract changes this forced** (frozen sections, edited per §0): `Detector.detect`
now takes a `DetectionInput` object rather than a bare string — chosen so a
future signal costs no further signature churn; `DetectionResult` gains
`senderSignal`; §4 gains override rule 3 and its rule 4 now accepts a high-risk
sender as showable evidence. Free to do now because P0 has not started.

**Also corrected in this pass:** §4's second override rule was labelled "Two-tactic
rule" while its text said "three or more". It is now "Three-tactic rule". The
text was always the intended behaviour.

---

### 2026-08-29 — D10, voice as a first-class channel

**D10 · `DetectionInput.channel` distinguishes text from voice.**

Listen mode runs through the same `Detector` and the same orchestrator — no
parallel detection path, per §6. But a transcript differs from an SMS in ways
that measurably lose scams: no sender, no punctuation, acronyms spelled out as
"o t p", app names split as "any desk", amounts spoken as words, and call-centre
framing that never appears in writing.

Measured before the change: a textbook vishing transcript ("...just read out the
o t p to me for verification") scored 0.63 and returned `caution` instead of
`danger`, purely because `otp` does not match `o t p`.

Two implementation choices worth preserving:

- **Acronyms are matched in both forms by one pattern, not normalised.**
  Rewriting the transcript would shift character offsets and corrupt every
  highlight (§7). `o[\s.]?t[\s.]?p` costs nothing and keeps offsets exact.
- **Voice terms are additive, not a replacement.** They are merged only when
  `channel === 'voice'`, so call-centre patterns cannot create false positives
  in the text path.

After the change: 10/10 on held-out transcripts, including the two legitimate
delivery calls that ask you to read out a code. See §5.6.

---

**Scoping note · call audio.**
Kavach analyses messages, not live call audio, because Android does not permit
third-party access to the call-audio stream without the default-dialer role.
This is stated openly in the pitch and placed on the roadmap rather than hidden.
See §1.

---

## §17 · Glossary

| Term | Meaning |
|---|---|
| **Kavach** | कवच — "armour", "shield". The product. |
| **Verdict** | One of the three states in §4. Never a number. |
| **Tactic** | One of the four manipulation categories in §5. |
| **Evidence** | An exact phrase from the user's message that triggered a tactic, with character offsets so it can be highlighted. See §7. |
| **Engine** | An implementation of the `Detector` interface: `local`, `cloud`, or `rules`. See §6. |
| **Orchestrator** | The single function that picks an engine, enforces the timeout, and falls back silently. See §6. |
| **DLT** | Distributed Ledger Technology — TRAI's registration regime for Indian commercial SMS. Senders must register a header and their message templates. |
| **DLT header / sender ID** | The registered alphanumeric sender a real institution must use, e.g. `VM-SBIINB`. Cannot be obtained without a registered business entity — which is why scammers use plain mobile numbers instead. See §5.5. |
| **Impersonation mismatch** | The §4 override rule: the message claims institutional authority but arrived from a personal number. The strongest single combination in the Indian SMS landscape. |
| **Corpus** | The JSON test set of real scam and legitimate messages. See §12. |
| **False-positive gate** | The hard test rule that no legitimate message may return `danger`. The metric that actually matters. See §12. |
| **Tier** | Which on-device model size is loaded: `low`, `standard`, `max`. See §8.1. |
| **Red Light / Green Light** | Event windows. Red Light restricts direct laptop use to remote-control from the phone; Green Light allows both devices freely. |
| **Extraction floor** | The §4 override rule that a message asking for an OTP or a payment is never `safe`. |
