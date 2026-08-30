import { resolveEvidence, buildSegments, resolveAllEvidence } from '../src/detector/evidence.ts'
import { classifySender, splitSender } from '../src/detector/sender.ts'
import { analyzeWithRules } from '../src/detector/rules.ts'
import { decideVerdict, applyOverrides, THRESHOLDS } from '../src/detector/verdict.ts'
import { validateResult, InvalidResultError } from '../src/detector/validate.ts'
import { resultFromLlm, extractJson, LlmContractError, senderFact } from '../src/detector/llm.ts'
import { fuse, fuseConfidence, mergeTactics } from '../src/detector/fuse.ts'
import { recordFeedback, feedbackState, resetFeedback, tacticAdjustment, usingDefaults } from '../src/detector/feedback.ts'
import { pickTier, MODELS } from '../src/detector/models.ts'
import { SYSTEM_PROMPT, buildUserPrompt } from '../src/detector/prompt.ts'

console.log('=== STARTING EXTENSIVE AUTOMATED TESTING ===\n')

const failures = []
function assert(name, condition, details) {
  if (!condition) {
    failures.push({ name, details })
    console.error(`❌ FAIL: ${name}`, details ? `— ${details}` : '')
  } else {
    console.log(`✅ PASS: ${name}`)
  }
}

// -------------------------------------------------------------
// 1. EVIDENCE RESOLUTION & HIGHLIGHT SEGMENTS INVARIANTS
// -------------------------------------------------------------
console.log('\n--- 1. Evidence Resolution & Highlighting ---')

const sampleTexts = [
  'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC.',
  'SBI Bank alert: Your A/c XX1234 has been credited with Rs. 5000. Do not share OTP.',
  'CBI Digital Arrest: Aapke naam pe money laundering case file hua hai. Kisi ko mat batana.',
  'Special characters: ₹ 1,000.00 / (50%) & [test] {bracket} *asterisk* +plus =equal ?question !exclamation "quote" \'single\'',
  'Emoji test: 🚨 URGENT: Your account 💳 is blocked 🛑 click here 🔗 to verify ⚠️',
  'Devanagari: आपका खाता 24 घंटे में ब्लॉक हो जाएगा। तुरंत केवाईसी अपडेट करें।',
  'Multiline:\nLine 1: Dear customer\nLine 2: Your account will be blocked\nLine 3: Call immediately',
  'Repeated words: otp otp otp otp otp OTP Otp o t p',
  'Whitespace runs:   Lots    of    weird    spaces \t\t and \n\n newlines   here.  ',
  'Punctuation boundaries: ...OTP... !!!KYC??? ---SBI---',
]

for (let i = 0; i < sampleTexts.length; i++) {
  const text = sampleTexts[i]
  const words = text.split(/\s+/).filter(w => w.length > 2)
  for (const word of words) {
    const ev = resolveEvidence(text, word)
    if (ev.start !== -1) {
      const slice = text.slice(ev.start, ev.end)
      assert(`resolveEvidence exact slice match for "${word}"`, slice.toLowerCase().includes(word.toLowerCase().replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, '').toLowerCase()), `Got "${slice}" from text "${text}"`)
    }
  }

  // Segment concatenation invariant
  const spans = [
    { start: 0, end: Math.min(10, text.length), tactic: 'authority' },
    { start: Math.min(5, text.length), end: Math.min(15, text.length), tactic: 'urgency' },
    { start: Math.min(12, text.length), end: Math.min(25, text.length), tactic: 'extraction' },
  ]
  const segments = buildSegments(text, spans)
  const recombined = segments.map(s => s.text).join('')
  assert(`buildSegments concatenation invariant [sample ${i}]`, recombined === text, `Expected length ${text.length}, got ${recombined.length}`)
}

// Edge cases for resolveEvidence
const evEmpty = resolveEvidence('hello world', '')
assert('resolveEvidence empty phrase returns start: -1', evEmpty.start === -1)

const evWhitespace = resolveEvidence('hello world', '   ')
assert('resolveEvidence whitespace phrase returns start: -1', evWhitespace.start === -1)

const evNotFound = resolveEvidence('hello world', 'nonexistent phrase')
assert('resolveEvidence not found returns start: -1', evNotFound.start === -1)

const evOverlapping = buildSegments('abcdefghij', [
  { start: 2, end: 6, tactic: 'authority' },
  { start: 4, end: 8, tactic: 'urgency' },
  { start: 1, end: 9, tactic: 'isolation' },
])
assert('buildSegments handles nested/overlapping spans correctly', 
  evOverlapping.map(s => s.text).join('') === 'abcdefghij' &&
  evOverlapping.some(s => s.tactics.includes('authority') && s.tactics.includes('urgency') && s.tactics.includes('isolation')),
  JSON.stringify(evOverlapping)
)

const evInvalidSpans = buildSegments('abcdefghij', [
  { start: -1, end: 5, tactic: 'invalid' },
  { start: 5, end: 2, tactic: 'backwards' },
  { start: 8, end: 100, tactic: 'outOfBounds' },
])
assert('buildSegments discards invalid spans and preserves text', 
  evInvalidSpans.map(s => s.text).join('') === 'abcdefghij',
  JSON.stringify(evInvalidSpans)
)

// -------------------------------------------------------------
// 2. SENDER CLASSIFICATION & SPLIT SENDER
// -------------------------------------------------------------
console.log('\n--- 2. Sender Classification & splitSender ---')

const senderTestCases = [
  { raw: 'VM-SBIINB', expectedKind: 'dlt_header', expectedRisk: 'none' },
  { raw: 'AD-HDFCBK', expectedKind: 'dlt_header', expectedRisk: 'none' },
  { raw: 'JK-KOTAKB', expectedKind: 'dlt_header', expectedRisk: 'none' },
  { raw: 'AXISBK', expectedKind: 'dlt_header', expectedRisk: 'none' },
  { raw: '567676', expectedKind: 'shortcode', expectedRisk: 'none' },
  { raw: '12345', expectedKind: 'shortcode', expectedRisk: 'none' },
  { raw: '9876543210', expectedKind: 'phone_number', expectedRisk: 'high' },
  { raw: '+91 98765 43210', expectedKind: 'phone_number', expectedRisk: 'high' },
  { raw: '+91-98765-43210', expectedKind: 'phone_number', expectedRisk: 'high' },
  { raw: '09876543210', expectedKind: 'phone_number', expectedRisk: 'high' },
  { raw: '+919876543210', expectedKind: 'phone_number', expectedRisk: 'high' },
  { raw: '6123456789', expectedKind: 'phone_number', expectedRisk: 'high' },
  { raw: '7123456789', expectedKind: 'phone_number', expectedRisk: 'high' },
  { raw: '8123456789', expectedKind: 'phone_number', expectedRisk: 'high' },
  { raw: '1409876543', expectedKind: 'telemarketer', expectedRisk: 'medium' },
  { raw: '+911409876543', expectedKind: 'telemarketer', expectedRisk: 'medium' },
  { raw: '+1 555 123 4567', expectedKind: 'international', expectedRisk: 'high' },
  { raw: '+44 7911 123456', expectedKind: 'international', expectedRisk: 'high' },
  { raw: '+92 300 1234567', expectedKind: 'international', expectedRisk: 'high' },
  { raw: 'support@bank.com', expectedKind: 'email_or_other', expectedRisk: 'medium' },
  { raw: '', expectedKind: 'unknown', expectedRisk: 'none' },
  { raw: '   ', expectedKind: 'unknown', expectedRisk: 'none' },
  { raw: null, expectedKind: 'unknown', expectedRisk: 'none' },
  { raw: undefined, expectedKind: 'unknown', expectedRisk: 'none' },
]

for (const tc of senderTestCases) {
  const res = classifySender(tc.raw)
  assert(`classifySender("${tc.raw}") -> kind:${tc.expectedKind} risk:${tc.expectedRisk}`,
    res.kind === tc.expectedKind && res.risk === tc.expectedRisk,
    `Got kind:${res.kind}, risk:${res.risk}`
  )
}

// splitSender testing
const split1 = splitSender('From: VM-SBIINB\nYour account has been credited.')
assert('splitSender extracts "From: VM-SBIINB"', split1.sender === 'VM-SBIINB' && split1.body === 'Your account has been credited.', JSON.stringify(split1))

const split2 = splitSender('Sender: +91 98765 43210\nYour account is blocked.')
assert('splitSender extracts "Sender: +91 98765 43210"', split2.sender === '+91 98765 43210' && split2.body === 'Your account is blocked.', JSON.stringify(split2))

const split3 = splitSender('[28/08/26, 9:14 pm] +91 98765 43210: Hello please send OTP')
assert('splitSender extracts WhatsApp sender', split3.sender === '+91 98765 43210' && split3.body === 'Hello please send OTP', JSON.stringify(split3))

const split4 = splitSender('VM-SBIINB\nYour account Rs 500 debited.')
assert('splitSender extracts bare first line sender', split4.sender === 'VM-SBIINB' && split4.body === 'Your account Rs 500 debited.', JSON.stringify(split4))

const split5 = splitSender('Just a regular message without a sender.')
assert('splitSender leaves body intact when no sender', split5.sender === null && split5.body === 'Just a regular message without a sender.', JSON.stringify(split5))

// -------------------------------------------------------------
// 3. RULES DETECTOR & OVERRIDE RULES
// -------------------------------------------------------------
console.log('\n--- 3. Rules Engine & Override Rules ---')

// 3.1 Override Rule 1: Extraction floor
const rExtraction = analyzeWithRules({ text: 'Please send the OTP for verification.' })
assert('Override Rule 1: Extraction present forces at least caution', rExtraction.verdict === 'caution' || rExtraction.verdict === 'danger', `Got ${rExtraction.verdict}`)

// 3.2 Override Rule 2: Three-tactic rule
const rThreeTactics = analyzeWithRules({
  text: 'This is Inspector Sharma from Delhi Police. Your account will be blocked within 2 hours. Do not tell anyone in your family.',
})
assert('Override Rule 2: 3 tactics forces danger', rThreeTactics.verdict === 'danger', `Got ${rThreeTactics.verdict}, tactics: ${rThreeTactics.tactics.map(t=>t.name).join(',')}`)

// 3.3 Override Rule 3: Impersonation mismatch
const rMismatchCaution = analyzeWithRules({
  text: 'This message is from State Bank of India regarding your account verification.',
  sender: '+91 98765 43210'
})
assert('Override Rule 3: Authority + high-risk sender forces at least caution', rMismatchCaution.verdict === 'caution' || rMismatchCaution.verdict === 'danger', `Got ${rMismatchCaution.verdict}`)

const rMismatchDanger = analyzeWithRules({
  text: 'This is State Bank of India. Please share your OTP immediately.',
  sender: '+91 98765 43210'
})
assert('Override Rule 3: Authority + Extraction + high-risk sender forces danger', rMismatchDanger.verdict === 'danger', `Got ${rMismatchDanger.verdict}`)

// 3.4 Override Rule 4: Empty-finding ceiling
const rEmptyFinding = analyzeWithRules({ text: 'Hey, let us meet for coffee tomorrow at 5pm.' })
assert('Override Rule 4: No tactics + no high-risk sender forces safe', rEmptyFinding.verdict === 'safe' && rEmptyFinding.tactics.length === 0, `Got ${rEmptyFinding.verdict}, confidence: ${rEmptyFinding.confidence}`)

// 3.5 Degenerate inputs
const rDegenerateShort = analyzeWithRules({ text: 'hello' })
assert('Degenerate short text does not crash and returns safe', rDegenerateShort.verdict === 'safe')

const rDegenerateLong = analyzeWithRules({ text: 'a'.repeat(10000) })
assert('Degenerate long text runs without crashing', rDegenerateLong.verdict === 'safe')

const rEmojiOnly = analyzeWithRules({ text: '😀🎉🚀🔥👍' })
assert('Emoji only text returns safe', rEmojiOnly.verdict === 'safe')

// -------------------------------------------------------------
// 4. LLM CONTRACT & JSON PARSER
// -------------------------------------------------------------
console.log('\n--- 4. LLM Contract & JSON Parser ---')

const validLlmOutput = JSON.stringify({
  confidence: 0.85,
  tactics: [
    { name: 'authority', evidence: ['State Bank of India'], note: 'Claims official bank identity.' },
    { name: 'urgency', evidence: ['within 24 hours'], note: 'Creates deadline pressure.' }
  ],
  explanation: 'This is an impersonation attempt.',
  nextMove: 'They want your bank credentials.'
})

const parseCtx = {
  input: { text: 'This is State Bank of India. Update KYC within 24 hours.' },
  senderSignal: classifySender(null),
  engineId: 'local',
  latencyMs: 1500
}

const parsedResult = resultFromLlm(validLlmOutput, parseCtx)
assert('resultFromLlm parses valid JSON correctly', parsedResult.verdict === 'danger' && parsedResult.tactics.length === 2)

// Fenced JSON
const fencedLlmOutput = '```json\n' + validLlmOutput + '\n```'
const parsedFenced = resultFromLlm(fencedLlmOutput, parseCtx)
assert('resultFromLlm parses fenced JSON', parsedFenced.verdict === 'danger')

// Prose wrapped JSON
const proseLlmOutput = 'Here is my analysis of the scam:\n' + validLlmOutput + '\nI hope this helps!'
const parsedProse = resultFromLlm(proseLlmOutput, parseCtx)
assert('resultFromLlm parses prose-wrapped JSON', parsedProse.verdict === 'danger')

// Invalid cases
let caughtContract = false
try {
  resultFromLlm('Sorry I cannot process this request', parseCtx)
} catch (e) {
  if (e instanceof LlmContractError) caughtContract = true
}
assert('resultFromLlm throws LlmContractError on non-JSON response', caughtContract)

caughtContract = false
try {
  resultFromLlm(JSON.stringify({ confidence: 85, tactics: [], explanation: 'test', nextMove: 'test' }), parseCtx)
} catch (e) {
  if (e instanceof LlmContractError) caughtContract = true
}
assert('resultFromLlm rejects confidence > 1 (e.g. 85)', caughtContract)

caughtContract = false
try {
  resultFromLlm(JSON.stringify({ confidence: -0.5, tactics: [], explanation: 'test', nextMove: 'test' }), parseCtx)
} catch (e) {
  if (e instanceof LlmContractError) caughtContract = true
}
assert('resultFromLlm rejects negative confidence', caughtContract)

// -------------------------------------------------------------
// 5. FUSION & INVARIANTS
// -------------------------------------------------------------
console.log('\n--- 5. Fusion & Invariants ---')

const deepInput = { text: 'Dear Customer, your SBI account will be blocked within 24 hours. Update KYC immediately.' }
const rulesRes = analyzeWithRules(deepInput)
const llmRes = resultFromLlm(JSON.stringify({
  confidence: 0.9,
  tactics: [{ name: 'extraction', evidence: ['Update KYC'], note: 'Asks to update KYC' }],
  explanation: 'Phishing scam detected',
  nextMove: 'They want your login details'
}), {
  input: { text: 'Dear Customer, your SBI account will be blocked within 24 hours. Update KYC immediately.' },
  senderSignal: classifySender(null),
  engineId: 'cloud',
  latencyMs: 800
})

const fused = fuse({ rules: rulesRes, llm: llmRes, input: deepInput })
assert('fuse creates valid DetectionResult', fused.verdict === 'danger')
assert('fuse merges tactics without duplicates', new Set(fused.tactics.map(t=>t.name)).size === fused.tactics.length)
assert('fuse confidence is >= rules confidence', fused.confidence >= rulesRes.confidence)

// -------------------------------------------------------------
// 6. ADAPTIVE FEEDBACK & CONSTRAINTS
// -------------------------------------------------------------
console.log('\n--- 6. Adaptive Feedback & Constraints ---')

resetFeedback()
assert('Fresh feedback is usingDefaults', usingDefaults())

// User rejects a danger verdict -> tactics that fired decrease in sensitivity
const mockDangerResult = {
  verdict: 'danger',
  confidence: 0.8,
  tactics: [{ name: 'urgency', label: 'Rushing you', evidence: [{ phrase: 'urgent', start: 0, end: 6 }], note: '' }],
  senderSignal: classifySender(null),
  explanation: 'test',
  nextMove: 'test',
  engineUsed: 'rules',
  latencyMs: 10
}

recordFeedback(mockDangerResult, false)
assert('Rejecting danger verdict reduces urgency weight', tacticAdjustment('urgency') < 1.0)
assert('Other tactics untouched', tacticAdjustment('isolation') === 1.0)

// 50 corrections cannot exceed clamp bounds [0.75, 1.25]
for (let i = 0; i < 50; i++) {
  recordFeedback(mockDangerResult, false)
}
assert('Feedback clamped at 0.75 lower bound', tacticAdjustment('urgency') >= 0.75)

resetFeedback()
assert('resetFeedback restores 1.0 multiplier', tacticAdjustment('urgency') === 1.0)

// -------------------------------------------------------------
// 7. MODEL TIERS & DEVICE LIMITS
// -------------------------------------------------------------
console.log('\n--- 7. Model Tiers & Device Limits ---')

const tierAndroidCeiling = pickTier({ maxStorageBufferBindingSize: 128 * 1024 * 1024, deviceMemoryGB: 8 })
assert('pickTier on Android 128MB ceiling selects "standard"', tierAndroidCeiling === 'standard')

const tierLowMemory = pickTier({ maxStorageBufferBindingSize: 256 * 1024 * 1024, deviceMemoryGB: 3 })
assert('pickTier on low memory device (<4GB) selects "low"', tierLowMemory === 'low')

// D20: capability is not consent. A roomy buffer cap no longer promotes a
// device to the stage tier on its own — `max` is reachable only through the
// Settings override (`setPreferredTier`). See scripts/test-cancel.mjs.
const tierDesktopGpu = pickTier({ maxStorageBufferBindingSize: 2048 * 1024 * 1024, deviceMemoryGB: 16 })
assert('pickTier on high-end desktop WebGPU stays on "standard" (D20)', tierDesktopGpu === 'standard')

// -------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------
console.log('\n=========================================')
console.log(`TOTAL FAILURES: ${failures.length}`)
if (failures.length > 0) {
  console.error('Failure details:')
  for (const f of failures) {
    console.error(`- ${f.name}: ${f.details}`)
  }
}
console.log('=========================================')
