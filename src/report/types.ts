/**
 * The Report Handoff — SPEC.md §10.6, decision D16.
 *
 * Kavach is a courier, not a reporting portal. Nothing in this module submits
 * anything, holds an account, or talks to a backend. It composes a complaint on
 * the device and hands it to the person, who files it themselves on the
 * government's own site.
 *
 * These shapes carry no number that describes the message. §4 applies here at
 * full strength — a document laid out like a bill invites a total, and there
 * must not be one. See D16.
 */
import type { DetectionResult, Verdict } from '../detector/types.ts'

/**
 * What the user tells us has already happened.
 *
 * This is the only question the report asks, and it drives everything: the
 * urgency block, and which destinations are correct. It is about the user's own
 * situation — never about how suspicious the message was.
 */
export type Disclosure =
  /** Money has already left the account. */
  | 'money'
  /** An OTP, password, PIN or card detail was shared. No money yet. */
  | 'credentials'
  /** Nothing was sent. The message itself is what is being reported. */
  | 'nothing'
  /** Not fraud — unwanted marketing. */
  | 'nuisance'

/** How a destination is reached. `tel` dials; `web` opens a page. */
export type RouteAction = 'tel' | 'web'

/** One official place a complaint can go. Data only — see `routes.ts`. */
export interface ReportRoute {
  id: string
  /** The real name of the body or facility, as they call it themselves. */
  name: string
  /** Who runs it, in a word or two. Grounds it as official. */
  operator: string
  /** One plain line on what this one is for. */
  purpose: string
  action: RouteAction
  /** `tel:1930` or an https URL. Never anything else. */
  href: string
  /** What the user will see when they get there, so it is not a surprise. */
  expect: string
  /** Which disclosures this route is correct for. */
  appliesTo: Disclosure[]
  /** Lower sorts first within a disclosure. The urgent one leads. */
  order: number
}

/**
 * One line item on the receipt.
 *
 * A row exists only when the underlying field was actually populated — this is
 * what "nothing is invented" means in practice (D16).
 */
export interface ReportRow {
  /** e.g. "Claimed to be". */
  label: string
  /** e.g. "your bank's fraud department". */
  value: string
}

/** The finished record, ready to render and ready to turn into text. */
export interface Report {
  /** A local reference for the person's own records. Not a case number. */
  reference: string
  /** ISO timestamp of when the report was prepared. */
  preparedAt: string
  verdict: Verdict
  /** The verdict headline, reused verbatim from the copy deck. */
  headline: string
  /** The line-item rows. Never a count, never a score. */
  rows: ReportRow[]
  /** The user's message, exactly as they gave it. */
  message: string
  /** `nextMove` from the result, unchanged. */
  whatTheyWanted: string
  /** The destinations correct for this disclosure, already sorted. */
  routes: ReportRoute[]
  /** True when the disclosure means something is already in motion. */
  urgent: boolean
}

/** Everything `buildReport` needs. Kept explicit so the function stays pure. */
export interface ReportInput {
  result: DetectionResult
  /** The message as analysed. */
  text: string
  disclosure: Disclosure
  /** Injectable so tests get a stable reference and timestamp. */
  now?: Date
}
