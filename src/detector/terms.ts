import type { TacticName } from './types.ts'

/**
 * Weighted term sets for the rules engine — SPEC.md §8.3.
 *
 * Language coverage is English + Hinglish in Latin script (D4). The file is
 * keyed by tactic so a Devanagari or Kannada set can be added later as another
 * record without touching the scoring code (§15).
 *
 * Weight guidance:
 *   ~2.0+  near-conclusive on its own (isolation phrases, remote-access apps)
 *   ~1.3   strong
 *   ~1.0   moderate
 *   ~0.7   weak, only meaningful in combination
 *
 * NEGATIVE terms are the false-positive defence and matter more than any
 * positive one. A real bank OTP message says "do not share this OTP with
 * anyone" — the exact opposite of an extraction attempt. Without these, the
 * engine flags every legitimate bank SMS and the whole product is worthless.
 */

export interface Term {
  re: RegExp
  w: number
}

/** All patterns are case-insensitive and global so matchAll gives us offsets. */
const t = (source: string, w: number): Term => ({
  re: new RegExp(source, 'gi'),
  w,
})

// ---------------------------------------------------------------------------
// AUTHORITY — claiming an institutional identity
// ---------------------------------------------------------------------------
const authority: Term[] = [
  // Law enforcement and government
  t(String.raw`cyber ?crime|cyber cell`, 1.6),
  t(String.raw`crime branch`, 1.5),
  t(String.raw`\bcbi\b`, 1.6),
  t(String.raw`enforcement directorate`, 1.6),
  t(String.raw`narcotics|\bncb\b`, 1.5),
  t(String.raw`\bpolice\b|\bpolis\b`, 1.3),
  t(String.raw`\bsub[- ]?inspector\b|\binspector\b`, 1.2),
  t(String.raw`\bcommissioner\b`, 1.0),
  t(String.raw`income tax|\bit department\b`, 1.3),
  t(String.raw`\bcustoms\b|customs department`, 1.3),
  t(String.raw`\bf\.?i\.?r\.?\b`, 1.3),
  t(String.raw`arrest warrant|\bwarrant\b`, 1.2),
  t(String.raw`court summon|\bsummon(s|ed)?\b|magistrate|tribunal|judicial`, 1.1),
  t(String.raw`legal notice|show cause notice`, 1.2),
  t(String.raw`\btrai\b|department of telecom`, 1.3),
  t(String.raw`\buidai\b|aadha?ar (card|number|details)`, 1.0),
  t(String.raw`\brbi\b|reserve bank`, 1.3),
  t(String.raw`government of india|govt\.? of india|\bgovt\b`, 1.1),
  t(String.raw`passport office|embassy|consulate`, 1.0),
  t(String.raw`\bofficer\b`, 0.7),

  // Banks and institutions — a claim of identity, not manipulation by itself.
  // Weights are deliberately low: a real SBI message also says "SBI".
  t(String.raw`\bsbi\b|state bank of india`, 0.8),
  t(String.raw`\bhdfc\b|\bicici\b|\bkotak\b|\bpnb\b|axis bank|yes bank`, 0.8),
  t(String.raw`punjab national|bank of baroda|canara bank|union bank`, 0.8),
  t(String.raw`indian bank|indusind|\bidfc\b|federal bank`, 0.8),
  t(String.raw`\bnpci\b`, 1.0),
  t(String.raw`fraud (department|prevention|desk)|anti[- ]fraud`, 1.2),
  t(String.raw`bank (official|officer|representative)`, 1.1),
  t(String.raw`customer (care|support) (executive|team)`, 0.8),
  t(String.raw`paytm|phone ?pe|google pay|\bgpay\b|bhim`, 0.7),
  t(String.raw`\bfedex\b|\bdhl\b|blue dart|india post|speed post|dtdc`, 0.9),
  t(String.raw`courier (company|service|department)`, 0.8),
  t(String.raw`electricity (board|department|connection)|bijli connection`, 0.9),
  t(String.raw`\bbescom\b|\bmseb\b|\btneb\b|\bkseb\b`, 0.9),
  t(String.raw`amazon|flipkart|myntra`, 0.8),
  t(String.raw`netflix|hotstar|prime video|spotify|youtube premium`, 0.8),
  t(String.raw`\bjio\b|\bairtel\b|\bvodafone\b|\bbsnl\b`, 0.8),

  // Hinglish framing
  t(String.raw`se bol raha|se baat kar raha|se call kar rah[ae]`, 1.0),
]

// ---------------------------------------------------------------------------
// URGENCY — manufacturing a deadline
// ---------------------------------------------------------------------------
const urgency: Term[] = [
  t(String.raw`\bimmediate(ly)?\b|\bturant\b|\bfauran\b`, 1.1),
  t(String.raw`\burgent(ly)?\b`, 1.0),
  t(String.raw`within \d+ ?(hours?|hrs?|minutes?|mins?|days?)`, 1.3),
  t(String.raw`in the next \d+ ?(hours?|minutes?|days?)`, 1.2),
  t(String.raw`\b(24|48|2|3|6|12) ?(hours?|hrs?)\b`, 1.0),
  t(String.raw`last chance|final (notice|warning|reminder)|last warning`, 1.4),
  t(String.raw`expir(es|ing|ed) (today|tonight|soon)|expires in`, 1.2),
  t(
    String.raw`will be (blocked|suspended|deactivated|frozen|closed|terminated|cancelled|seized)`,
    1.4,
  ),
  t(String.raw`has been (blocked|suspended|frozen|seized|held)`, 1.2),
  t(String.raw`account (will be )?(block|suspend|freez|deactivat)`, 1.2),
  t(String.raw`before (6|5|8|9|10|11|12)? ?(pm|am|midnight|today|tomorrow)`, 0.9),
  t(String.raw`act now|hurry|do ?n[o']?t delay|without delay`, 1.2),
  t(String.raw`failure to (comply|respond|act|pay|verify)`, 1.4),
  t(String.raw`legal action (will|shall|may) be`, 1.3),
  t(String.raw`\barrest(ed)?\b`, 1.5),
  t(String.raw`penalty|fine (will|of) `, 1.0),
  t(String.raw`only \d+ ?(hours?|minutes?|days?) (left|remaining)|time is running`, 1.3),
  t(String.raw`to avoid (cancellation|suspension|disconnection|blocking|penalty|deactivation)`, 1.3),
  t(String.raw`payment (has )?(failed|declined|could not be processed)`, 0.8),

  // Hinglish
  t(String.raw`\bwarna\b|nahi to|nahin to`, 1.1),
  t(String.raw`band ho ja(yega|ega|egi)|block ho ja(yega|ega)`, 1.3),
  t(String.raw`\baaj hi\b|\babhi\b`, 0.9),
]

// ---------------------------------------------------------------------------
// ISOLATION — cutting the victim off from anyone who would stop them
// Highest-weighted tactic: almost no legitimate message asks you not to tell
// your family.
// ---------------------------------------------------------------------------
const isolation: Term[] = [
  t(String.raw`do ?n[o']?t tell (anyone|any ?one|anybody|your family|family)`, 2.2),
  t(String.raw`do not tell\b`, 2.2),
  t(
    String.raw`do ?n[o']?t (discuss|inform|reveal|mention) (this |the |your )?(case|matter|call|investigation)? ?(with|to) (anyone|any ?one|anybody|family)`,
    2.2,
  ),
  t(String.raw`kisi ko (mat|na|nahi) bat(a|aa)na|kisi ko mat bolna`, 2.2),
  t(String.raw`(strictly )?confidential (investigation|matter|case|proceeding)`, 1.8),
  t(String.raw`strictly confidential`, 1.8),
  t(String.raw`official secrets act`, 2.0),
  t(String.raw`stay on the (line|call|phone)`, 2.0),
  t(String.raw`do ?n[o']?t (disconnect|cut|end|hang ?up)`, 2.0),
  t(String.raw`call mat kaat|line p[ae]r? rah(iye|o|na)`, 2.0),
  t(String.raw`without informing (anyone|your|the)`, 1.6),
  t(String.raw`do ?n[o']?t (visit|go to) (the )?(branch|police|bank)`, 1.8),
  t(String.raw`keep this between us|between you and me`, 2.0),
  t(String.raw`non[- ]?co[- ]?operation`, 1.5),
  t(String.raw`do ?n[o']?t (contact|call) (the )?(police|bank|anyone)`, 2.0),
  t(String.raw`under surveillance|being monitored`, 1.4),
  t(String.raw`your family (will|may) (also )?be`, 1.3),
]

// ---------------------------------------------------------------------------
// EXTRACTION — the actual ask
// ---------------------------------------------------------------------------
const extraction: Term[] = [
  // Credentials
  t(String.raw`(share|send|provide|give|forward|tell)( me| us)? (the |your )?otp`, 1.9),
  t(String.raw`otp bhej|otp bata`, 1.9),
  t(String.raw`\botp\b`, 1.4),
  t(String.raw`one[- ]time password`, 1.5),
  t(String.raw`\bcvv\b`, 1.5),
  t(String.raw`\b(atm |card )?pin\b`, 1.1),
  t(String.raw`(debit|credit) card (number|details|info)`, 1.4),
  t(String.raw`card number`, 1.3),
  t(String.raw`net ?banking (password|login|credentials|details)`, 1.6),
  t(String.raw`\bpassword\b`, 1.0),
  t(String.raw`login (id|credentials|details)`, 1.3),
  t(String.raw`(aadha?ar|pan) (number|card) (details|copy)?`, 1.2),

  // Money movement
  t(String.raw`\bupi (id|pin|address)\b`, 1.4),
  t(String.raw`\bupi\b`, 1.0),
  t(String.raw`scan (this|the) qr|\bqr code\b`, 1.5),
  t(String.raw`(send|transfer|pay) (rs\.?|₹|inr|money|amount|the amount)`, 1.5),
  t(String.raw`refundable (security )?deposit|security deposit`, 1.7),
  t(String.raw`security (amount|money)|deposit (of )?(rs\.?|₹|\d)`, 1.5),
  t(String.raw`update your (payment|billing|card) (details|information|method)`, 1.5),
  t(String.raw`work from home|part[- ]time job|earn rs\.?|daily income|selected for`, 1.2),
  // A link. Low weight on purpose: legitimate messages carry URLs too
  // (amazon.in/orders), so this only matters in combination.
  t(String.raw`https?:\/\/[^\s]+|\b[a-z0-9][a-z0-9-]*\.(com|in|co|net|org|xyz|info|online|site|top)\/[^\s]*`, 0.7),
  t(
    String.raw`(processing|registration|verification|clearance|handling|convenience) (fee|charge)`,
    1.7,
  ),
  t(String.raw`customs duty|customs (fee|charge|clearance)`, 1.7),
  t(String.raw`gift ?card|gift voucher code`, 1.4),
  t(String.raw`you have won|lottery|prize money|lucky (winner|draw)`, 1.4),

  // Remote access — near-conclusive
  t(String.raw`any ?desk|team ?viewer|quick ?support|rust ?desk|air ?droid`, 2.2),
  t(String.raw`screen ?shar(e|ing)|share your screen|mirror your screen`, 1.8),
  t(String.raw`(install|download) (this|the|our) ?app`, 1.4),

  // Links and callbacks
  t(String.raw`bit\.ly|tinyurl|cutt\.ly|rb\.gy|shorturl|is\.gd|goo\.gl|t\.co/`, 1.7),
  t(String.raw`click (here|this link|on the link|below)`, 1.4),
  t(String.raw`verify your (kyc|account|identity|details|number)`, 1.4),
  t(String.raw`update your (kyc|account|details|pan|aadha?ar|record)`, 1.5),
  t(String.raw`\bkyc\b`, 1.0),
  t(String.raw`re[- ]?activate your (account|sim|number)`, 1.4),
  t(String.raw`whats ?app (me|us) (on|at)`, 1.5),
  // A personal mobile number in the body of a message claiming to be an
  // institution. Toll-free 1800 numbers are excluded by the leading [6-9].
  t(String.raw`\b[6-9]\d{9}\b`, 1.2),
  t(String.raw`call (this number|on this|back on|immediately on)`, 1.2),
]

export const TERMS: Record<TacticName, Term[]> = {
  authority,
  urgency,
  isolation,
  extraction,
}

// ---------------------------------------------------------------------------
// NEGATIVE TERMS — legitimacy markers
//
// Scoped to the tactic they defend, and subtracted BEFORE the presence
// threshold, so a genuine bank message never registers extraction at all
// rather than merely scoring lower.
// ---------------------------------------------------------------------------
export interface NegativeTerm extends Term {
  /** Which tactic this defends. Omit to subtract from overall confidence. */
  tactic?: TacticName
}

export const NEGATIVES: NegativeTerm[] = [
  // The single most important line in the file. A real bank tells you NOT to
  // share the OTP; a scammer asks you to.
  {
    ...t(
      String.raw`do ?n[o']?t (share|disclose|reveal) (your |this |the )?(otp|pin|cvv|password|card details|credentials)`,
      3.2,
    ),
    tactic: 'extraction',
  },
  {
    ...t(
      String.raw`never share (your |this |the )?(otp|pin|cvv|password|card details|credentials)`,
      3.2,
    ),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`(bank|we) (never|will never|do not|does not) ask`, 2.8),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`we (will )?never (call|ask|request)`, 2.5),
    tactic: 'extraction',
  },
  {
    ...t(
      String.raw`if (you|this was) (did ?n[o']?t|was not|not) (you|initiated|requested|authorised|authorized)`,
      2.0,
    ),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`to report (this |any )?(fraud|unauthorised|unauthorized|dispute)`, 2.0),
    tactic: 'extraction',
  },
  // Transaction-notification vocabulary: the shape of a real bank alert.
  {
    ...t(String.raw`(debited|credited) (from|to|by|in) (your )?a\/?c`, 1.8),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`avl(bl)? bal|available balance|a\/?c balance|closing balance`, 1.5),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`(txn|transaction|ref|reference|utr)[. ]?(id|no|number)`, 1.2),
    tactic: 'extraction',
  },
  { ...t(String.raw`\b1800[- ]?\d{3}[- ]?\d{3,4}\b|toll[- ]?free`, 1.5), tactic: 'extraction' },
  {
    ...t(String.raw`(has been|is) (delivered|shipped|dispatched|out for delivery)`, 1.2),
    tactic: 'extraction',
  },

  {
    ...t(String.raw`never ask(s|ed)? (you )?for (your |the )?(otp|pin|cvv|password)`, 2.8),
    tactic: 'extraction',
  },
  {
    ...t(String.raw`do ?n[o']?t share (it|this|these) with (anyone|any ?one|anybody)`, 2.0),
    tactic: 'extraction',
  },
  // A delivery or ride OTP is a real thing you are legitimately asked to
  // share. Found by holdout testing: an Uber "share OTP 7719 with your driver"
  // message was being flagged as danger — a false positive of exactly the kind
  // the §12 gate exists to prevent.
  {
    ...t(String.raw`delivery (otp|code|partner|executive|agent)`, 1.6),
    tactic: 'extraction',
  },
  {
    ...t(
      String.raw`with (your|the) (driver|delivery|cab|technician|executive|partner|rider)`,
      2.5,
    ),
    tactic: 'extraction',
  },

  // Global legitimacy markers
  { ...t(String.raw`this is an automated (message|sms|notification)`, 1.2) },
  { ...t(String.raw`do ?n[o']?t reply to this (message|sms|email)`, 1.0) },
  { ...t(String.raw`thank you for (banking|shopping|choosing|using)`, 1.0) },
]

// ---------------------------------------------------------------------------
// CONCLUSIVE SIGNALS
//
// Behaviours with essentially no legitimate counterpart. A bank never asks you
// to install AnyDesk. Nobody legitimate requires a fee before releasing a prize
// you have "won". These set a confidence FLOOR rather than adding weight,
// because their strength does not depend on what else is in the message.
//
// `all` patterns must ALL match. The first match is checked for negation:
// "Do not share the OTP" contains "share the OTP" and is the exact opposite of
// an extraction attempt, so a negated hit is discarded (see isNegated).
// ---------------------------------------------------------------------------
export interface ConclusiveSignal {
  all: RegExp[]
  floor: number
  why: string
  /** If any of these match, the signal is suppressed entirely. */
  unless?: RegExp[]
}

export const CONCLUSIVE: ConclusiveSignal[] = [
  {
    all: [/any ?desk|team ?viewer|quick ?support|rust ?desk|air ?droid/gi],
    floor: 0.78,
    why: 'remote-access app',
  },
  {
    all: [/(share|send|provide|give|forward|tell)( me| us)? (the |your )?otp|otp (bhej|bata)/gi],
    // Couriers and cab drivers legitimately ask for an OTP at handover.
    unless: [
      /with (your|the) (driver|delivery|cab|technician|executive|partner|rider)/i,
      /delivery (otp|code|partner|executive|agent)/i,
    ],
    floor: 0.74,
    why: 'asks for the OTP',
  },
  {
    all: [/(deposit|pay|send|transfer)(\s+\S+){0,4}\s+(security (amount|deposit)|refundable)/gi],
    floor: 0.74,
    why: 'upfront deposit demanded',
  },
  {
    all: [/(share|send|provide|give)( me| us)?.{0,30}(cvv|card number|card details|atm pin)/gi],
    floor: 0.74,
    why: 'asks for card credentials',
  },
  {
    all: [/refundable\s+(\w+\s+){0,2}(fee|charge|deposit)/gi],
    floor: 0.74,
    why: 'refundable fee — the classic advance-fee hook',
  },
  {
    all: [
      /(pay|paying|send|transfer|bhej)/gi,
      /(processing|registration|clearance|verification|handling) (fee|charge)/gi,
    ],
    floor: 0.74,
    why: 'advance fee demanded',
  },
  {
    all: [
      /you have won|lottery|prize money|lucky (draw|winner)|jeeta hai/gi,
      /(fee|charge|deposit|bank account number)/gi,
    ],
    floor: 0.74,
    why: 'prize that requires a payment or account details',
  },
  {
    all: [/(do ?n[o']?t|never) (tell|inform|discuss)/gi, /(anyone|any ?one|anybody|family)/gi],
    floor: 0.72,
    why: 'instructs you to hide it from everyone',
  },
]
