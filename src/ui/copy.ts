/**
 * Copy deck — SPEC.md §10.7. Every user-facing string lives here.
 *
 * Writing rules: second person, present tense, no percentages or scores (§4),
 * no security jargon ("phishing", "social engineering"), under 12 words where
 * possible. The reader is someone's parent, not a security analyst.
 */
export const copy = {
  app_name: 'Kavach',
  app_tagline: 'Check a message before you trust it',

  paste_placeholder: 'Paste the message here — SMS, WhatsApp, anything',
  cta_check: 'Check this message',
  cta_again: 'Check another message',
  cta_cancel: 'Cancel',
  too_short: 'Paste a bit more of the message',
  truncated: 'Long message — we checked the first part',
  try_example: 'Try an example',
  example_scam: 'A scam message',
  example_legit: 'A real bank SMS',

  verdict_danger_head: 'This is a scam',
  verdict_danger_sub: 'Do not reply. Do not send money or codes.',
  verdict_caution_head: "Something's off here",
  verdict_caution_sub: 'Check before you act.',
  verdict_safe_head: 'Looks legitimate',
  verdict_safe_sub: 'Nothing manipulative found.',

  tactic_authority: 'Pretending to be someone official',
  tactic_urgency: 'Rushing you',
  tactic_isolation: 'Keeping you alone',
  tactic_extraction: 'Getting what they came for',

  next_move_title: 'What they want next',
  phrases_found: 'Phrases we flagged',

  sender_label: 'Who sent it? (optional)',
  sender_placeholder: 'e.g. VM-SBIINB or +91 98765 43210',
  sender_hint_registered: 'Registered business sender',
  sender_hint_personal: 'Personal mobile number',
  sender_card_title: 'Who it came from',
  // The strongest single line in the app: the message claims to be an
  // institution but arrived from a personal number (§5.5).
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

  engine_title: 'Privacy',
  engine_local: 'On-device',
  engine_cloud: 'Cloud',
  engine_local_note: 'The AI runs on your phone. Nothing you paste leaves it.',
  engine_cloud_note:
    'Faster on older phones. Your message is sent to be analysed.',
  cloud_unavailable: 'No connection — checking on your phone instead',
  tier_downgraded: 'Switched to the smaller model — this phone ran out of memory',

  device_panel_title: 'Running on this device',
  device_panel_summary: 'On-device · nothing sent',
  model_why:
    'This runs on your phone, so it works offline and nothing you paste leaves the device.',
  model_ready: 'Ready — works offline now',
  no_webgpu: "This phone can't run the on-device AI. Cloud mode still works.",

  listen_title: 'Listen to a call',
  listen_prime:
    'Put the call on speaker. Kavach will listen through the mic and warn you if it hears a scam.',
  listen_privacy_note:
    "Live transcription uses Google's speech service, so Listen mode isn't offline. Paste mode still is.",
  listen_denied: 'Kavach needs microphone access to listen',
  listen_active: 'Listening…',
  listen_stop: 'Stop listening',
  listen_interrupt: 'Hang up. This is a scam.',

  about_disclaimer:
    'Kavach is a second opinion, not a guarantee. When in doubt, call the company on a number you looked up yourself.',
} as const

/** The label shown on each tactic card. */
export const TACTIC_LABELS = {
  authority: copy.tactic_authority,
  urgency: copy.tactic_urgency,
  isolation: copy.tactic_isolation,
  extraction: copy.tactic_extraction,
} as const
