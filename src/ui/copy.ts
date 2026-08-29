/**
 * Copy deck — SPEC.md §10.7. Every user-facing string lives here.
 *
 * Register: plain first. The reader is someone's parent who has just been
 * frightened by a text message, not a security analyst. Second person, present
 * tense, under 12 words where possible.
 *
 * Banned outright: percentages and scores (§4), and the security-console
 * vocabulary this screen drifted into — "forensic", "verbatim", "threat
 * vector", "telemetry", "protocol", "advisory". A tool that talks like malware
 * analysis is a tool a scared person closes. The technical detail is not
 * deleted; it moves behind "How we checked" (§10.6).
 */
export const copy = {
  app_name: 'Kavach',
  app_tagline: 'Check a message before you trust it',

  // --- Check ---------------------------------------------------------------
  paste_placeholder: 'Paste the message here — SMS, WhatsApp, anything',
  cta_check: 'Check this message',
  cta_again: 'Check another message',
  cta_paste: 'Paste',
  cta_clear: 'Clear',
  cta_edit: 'Edit',
  cta_done: 'Done',
  too_short: 'Paste a bit more of the message',
  truncated: 'Long message — we checked the first part',
  try_example: 'Or try an example',
  working: 'Reading the message…',
  analyzing_thinking: 'Reading your message on this phone…',
  analyzing_reconsidering: 'Double-checking one detail…',

  // --- Verdict -------------------------------------------------------------
  verdict_danger_head: 'This is a scam',
  verdict_danger_sub: 'Do not reply. Do not send money or codes.',
  verdict_caution_head: "Something's off here",
  verdict_caution_sub: 'Check before you act.',
  verdict_safe_head: 'Looks legitimate',
  verdict_safe_sub: 'Nothing manipulative found.',

  // Adaptive weighting (D14). Phrased as a question about this answer, not as
  // "train the AI" — the person is telling us we got it wrong, not volunteering
  // for a labelling task.
  feedback_q: 'Was this right?',
  feedback_yes: 'Yes',
  feedback_no: 'No',
  feedback_thanks_right: 'Thanks — noted.',
  feedback_thanks_wrong: 'Thanks. Kavach will weigh this differently next time.',
  learned_title: 'What this phone has learned',
  learned_none: 'Nothing yet. Your answers never leave this phone.',
  learned_more: 'more sensitive to',
  learned_less: 'less sensitive to',
  learned_reset: 'Reset what it learned',
  why_title: 'Why we think so',
  message_title: 'The message',
  message_hint: 'The orange marks are the parts that worried us.',
  phrases_found: 'Phrases we flagged',
  tactics_title: 'How it tries to work on you',
  next_move_title: 'What to do now',
  cta_copy: 'Copy',
  cta_copied: 'Copied',
  cta_share: 'Share',

  // --- How we checked (the technical proof, one tap away) ------------------
  how_title: 'How we checked',
  how_engine: 'Checked by',
  how_engine_local: 'This phone',
  how_engine_cloud: 'Kavach servers',
  how_time: 'Time taken',
  how_sent: 'Sent anywhere',
  how_sent_no: 'Nothing',
  how_note:
    'Kavach reads the message on your phone. It looks at who it came from, how it pressures you, and what it asks for.',

  // --- Sender (§5.5) -------------------------------------------------------
  sender_label: 'Who sent it?',
  sender_label_optional: 'Who sent it? (optional)',
  sender_placeholder: 'e.g. VM-SBIINB or +91 98765 43210',
  sender_detected: 'We spotted the sender',
  sender_card_title: 'Who it came from',
  sender_hint:
    'Real banks send from a short name like VM-SBIINB. Scammers send from ordinary phone numbers.',
  // The strongest single line in the app: the message claims to be an
  // institution, but it arrived from a personal number.
  sender_mismatch_note:
    'This claims to be official, but it came from a personal mobile number. Real banks and government offices can only send from a registered sender ID — they cannot text you from a normal number.',
  sender_personal_note:
    'This came from a personal mobile number, not a registered business sender.',
  sender_registered_note:
    'This came from a registered business sender ID, which is how real companies send SMS.',
  sender_international_note: 'This came from an international number.',
  sender_telemarketer_note: 'This came from a registered telemarketing number.',
  sender_shortcode_note: 'This came from a service shortcode.',
  sender_other_note: 'This came from an unusual kind of sender.',

  // --- Home & Engine Switch (§10.6, §10.7) --------------------------------
  home_check_title: 'Check a message',
  home_check_sub: 'SMS, WhatsApp, email — anything you can copy',
  home_listen_title: 'Listen to a call',
  home_listen_sub: 'Kavach warns you while the call is happening',
  home_privacy:
    'Messages are checked on your phone. Nothing you paste is sent anywhere.',

  // --- Engine & Privacy Switch (§10.6, §10.7) -------------------------------
  // "Engine" dropped: the two choices below (On-device / Cloud) already say
  // what they are without the internal word for them.
  engine_title: 'Privacy',
  engine_local: 'On-device',
  engine_local_badge: 'Private',
  engine_cloud: 'Cloud',
  engine_cloud_badge: 'Fast',
  engine_local_note: 'The AI runs on your phone. Nothing you paste leaves it.',
  engine_cloud_note: 'Faster on older phones. Your message is sent to be analysed.',
  cloud_unavailable: 'No connection — checking on your phone instead',

  // --- Listen --------------------------------------------------------------
  listen_title: 'Listen to a call',
  listen_prime: 'Put the call on speaker. Kavach will listen and warn you.',
  listen_privacy_note:
    "Live transcription uses Google's speech service, so Listen mode isn't offline. Checking a pasted message still is.",
  listen_denied: 'Kavach needs microphone access',
  listen_denied_note:
    'Allow the microphone in your browser settings, then tap Start again.',
  listen_unsupported: 'This browser cannot listen',
  listen_unsupported_note:
    'Listen mode needs Chrome on Android. You can still try it with an example below, or check a pasted message.',
  listen_idle: 'Put the call on speaker, then tap Start',
  listen_active: 'Listening…',
  listen_active_speech: 'Hearing the call…',
  listen_stopped: 'Stopped listening',
  listen_clear: 'Nothing worrying so far',
  listen_checking: 'Checking what was said…',
  listen_start: 'Start listening',
  listen_start_again: 'Start again',
  listen_stop: 'Stop',
  listen_transcript: 'What Kavach heard',
  listen_waiting: 'Waiting for the call audio…',
  listen_interrupt: 'Hang up. This is a scam.',
  listen_lang_en: 'English',
  listen_lang_hi: 'हिन्दी',
  listen_examples_title: 'Or hear an example',
  listen_examples_sub: 'Plays a recorded call so you can see what happens',
  listen_keep: 'Keep listening',
  listen_hangup: 'Hang up and go back',

  about_disclaimer:
    'Kavach is a second opinion, not a guarantee. When in doubt, call the company on a number you looked up yourself.',
} as const

/** The label shown on each tactic. */
export const TACTIC_LABELS = {
  authority: 'Pretending to be someone official',
  urgency: 'Rushing you',
  isolation: 'Keeping you alone',
  extraction: 'Getting what they came for',
} as const
