import type { SenderSignal, SenderKind, SenderRisk } from './types.ts'
import { copy } from '../ui/copy.ts'

/**
 * Sender-origin classification — SPEC.md §5.5.
 *
 * The insight: under TRAI's DLT regime an Indian bank, government body or
 * courier *must* send SMS through a registered alphanumeric header
 * (VM-SBIINB). Scammers cannot get one, so they send from ordinary mobile
 * numbers. "Your SBI account is blocked" from +91 98xxxxxxxx is a
 * contradiction on its face.
 *
 * This runs in code, in every engine path, always. A regex parses a phone
 * number exactly and for free; a 1B model does not. The LLM is *told* the
 * answer (§8.4) and never asked to work it out.
 */

/** Strip the punctuation people actually type into a sender field. */
function normalise(raw: string): string {
  return raw.trim().replace(/[\s\-().]/g, '')
}

/**
 * A DLT header is conventionally `XY-ABCDEF`: a two-character access-provider
 * prefix, a hyphen, then a six-character alphanumeric header. Real-world
 * headers vary a little (4-8 chars after the hyphen is common), so the shape
 * check is deliberately a little looser than the strict convention — being
 * slightly generous here is safe, because a registered header may only *lower*
 * the score modestly and can never force a `safe` verdict (§5.5).
 */
const DLT_HEADER = /^[A-Z]{2}-[A-Z0-9]{3,9}$/i

/** Some operators present the header with no hyphen at all. */
const DLT_HEADER_NO_HYPHEN = /^[A-Z]{2}[A-Z0-9]{4,8}$/i

/** Indian mobile: 10 digits leading 6-9, optionally +91 / 91 / 0 prefixed. */
const INDIAN_MOBILE = /^(?:\+?91|0)?([6-9]\d{9})$/

/** Telemarketing series. */
const TELEMARKETER = /^(?:\+?91|0)?140\d*$/

/** 5-6 digit operator/service shortcode. */
const SHORTCODE = /^\d{5,6}$/

const INTERNATIONAL = /^\+(\d{1,4})\d{6,}$/

export function classifySender(raw: string | undefined | null): SenderSignal {
  const original = (raw ?? '').trim()

  if (original === '') {
    return { raw: '', kind: 'unknown', risk: 'none', note: '' }
  }

  const n = normalise(original)
  const make = (kind: SenderKind, risk: SenderRisk, note: string): SenderSignal => ({
    raw: original,
    kind,
    risk,
    note,
  })

  // Order matters. Telemarketer before mobile, because 140-series numbers
  // would otherwise be caught by nothing; shortcode before mobile because a
  // 6-digit code must not be read as a truncated number.
  if (TELEMARKETER.test(n)) {
    return make('telemarketer', 'medium', copy.sender_telemarketer_note)
  }

  if (SHORTCODE.test(n)) {
    return make('shortcode', 'none', copy.sender_shortcode_note)
  }

  if (INDIAN_MOBILE.test(n)) {
    return make('phone_number', 'high', copy.sender_personal_note)
  }

  if (INTERNATIONAL.test(n)) {
    // +91 followed by something that is not a valid mobile still reads as
    // domestic-but-odd rather than foreign.
    const cc = INTERNATIONAL.exec(n)?.[1]
    if (cc && !n.startsWith('+91')) {
      return make('international', 'high', copy.sender_international_note)
    }
    return make('email_or_other', 'medium', copy.sender_other_note)
  }

  if (DLT_HEADER.test(original.trim()) || DLT_HEADER_NO_HYPHEN.test(n)) {
    return make('dlt_header', 'none', copy.sender_registered_note)
  }

  return make('email_or_other', 'medium', copy.sender_other_note)
}
