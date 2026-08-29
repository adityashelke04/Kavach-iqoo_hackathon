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

/**
 * Pull a sender out of pasted text so the user does not have to type one.
 *
 * People paste in a few recognisable shapes: a "From: X" header, a WhatsApp
 * export line, or the sender ID on its own first line the way Android's
 * message app shows it. When we find one we lift it out of the body, because
 * leaving "From: +91 98765 43210" in the message would make the body's own
 * phone-number pattern fire and double-count the same fact.
 *
 * Returns the original text unchanged when nothing recognisable is found —
 * guessing wrong is worse than not guessing.
 */
export function splitSender(pasted: string): { sender: string | null; body: string } {
  const text = pasted.replace(/\r\n/g, '\n')

  // "From: VM-SBIINB" / "Sender - +91 98765 43210"
  const labelled = /^[ \t]*(?:from|sender|sent by)[ \t]*[:\-][ \t]*(.+?)[ \t]*$/im.exec(text)
  if (labelled?.[1]) {
    const candidate = labelled[1].trim()
    if (looksLikeSender(candidate)) {
      return { sender: candidate, body: text.replace(labelled[0], '').trim() }
    }
  }

  // WhatsApp export: "[28/08/26, 9:14 pm] +91 98765 43210: message"
  const wa = /^\[[^\]]+\]\s*([^:]{3,40}):\s*/m.exec(text)
  if (wa?.[1] && looksLikeSender(wa[1].trim())) {
    return { sender: wa[1].trim(), body: text.replace(wa[0], '').trim() }
  }

  // A bare sender on its own first line, as Android's messaging app shows it.
  const lines = text.split('\n')
  const first = lines[0]?.trim() ?? ''
  if (lines.length > 1 && first.length <= 40 && looksLikeSender(first)) {
    return { sender: first, body: lines.slice(1).join('\n').trim() }
  }

  return { sender: null, body: pasted }
}

/** Only shapes we can actually classify count as a sender (§5.5 table). */
function looksLikeSender(s: string): boolean {
  const kind = classifySender(s).kind
  return kind !== 'unknown' && kind !== 'email_or_other'
}

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
