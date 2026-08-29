import { useMemo, useState } from 'react'
import { analyzeWithRules } from '../detector/rules.ts'
import { buildSegments } from '../detector/evidence.ts'
import type { Channel, DetectionResult } from '../detector/types.ts'

/**
 * /dev/engines — a raw test surface for the detector.
 *
 * Deliberately unstyled-ish and information-dense: this is a workbench, not
 * the product. The real Verdict screen (§10.6) lands at P5 and looks nothing
 * like this. This exists so the engine can be exercised by hand on the actual
 * phone from P1 onward, instead of only through the corpus harness.
 *
 * It shows `confidence`, which the real UI must never do (§4). That is fine
 * here and only here — a dev route is not the product.
 */

const PRESETS: { label: string; sender: string; text: string; channel?: Channel }[] = [
  {
    label: 'Scam · KYC',
    sender: '+91 98765 43210',
    text: 'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. Update your KYC immediately at http://sbi-kyc-verify.in/update to avoid suspension.',
  },
  {
    label: 'Scam · digital arrest',
    sender: '+91 91234 56780',
    text: 'This is Inspector Rajesh Kumar from Mumbai Cyber Crime Branch. An FIR has been registered against your Aadhaar in a money laundering case. Do not discuss this case with anyone including family members. Stay on the line for verification.',
  },
  {
    label: 'Scam · remote access',
    sender: '+91 88990 11223',
    text: 'Sir I am calling from HDFC bank fraud prevention department. To secure your account please install AnyDesk from Play Store and share the 9 digit code with me. Do not disconnect the call.',
  },
  {
    label: 'Legit · bank debit',
    sender: 'VM-SBIINB',
    text: 'Dear Customer, Rs.2,500.00 has been debited from A/c XX8842 on 28-Aug-26 to UPI/adityaenterprises. Avl Bal Rs.18,340.20. Not you? Call 18001111109. Do not share OTP/CVV/PIN with anyone. -SBI',
  },
  {
    label: 'Legit · OTP',
    sender: 'AD-HDFCBK',
    text: 'OTP for your transaction of Rs.1,299.00 at AMAZON is 458213. Valid for 10 minutes. HDFC Bank never asks for your OTP. Do not share it with anyone.',
  },
  {
    label: 'Legit · friend',
    sender: '+91 98450 11223',
    text: 'Hey, are we still on for dinner on Saturday? Let me know by tomorrow so I can book a table.',
  },
  {
    label: 'Voice · scam call',
    sender: '',
    channel: 'voice',
    text: 'hello sir i am calling from the state bank of india head office your account has been temporarily suspended please listen to me carefully do not disconnect the call i will send you a code on your phone just read out the o t p to me for verification',
  },
  {
    label: 'Voice · delivery call',
    sender: '',
    channel: 'voice',
    text: 'hello sir i am calling from swiggy your delivery is at the gate can you please come down and share the delivery code with me',
  },
]

const VERDICT_ACCENT = {
  danger: 'var(--danger-accent)',
  caution: 'var(--caution-accent)',
  safe: 'var(--safe-accent)',
} as const

const box: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)',
  padding: 'var(--sp-3)',
}

export function Engines() {
  const [text, setText] = useState(PRESETS[0]!.text)
  const [sender, setSender] = useState(PRESETS[0]!.sender)
  const [channel, setChannel] = useState<Channel>('text')

  const result: DetectionResult | null = useMemo(() => {
    if (text.trim().length < 10) return null
    return analyzeWithRules({
      text,
      channel,
      ...(sender.trim() ? { sender } : {}),
    })
  }, [text, sender, channel])

  const segments = useMemo(() => {
    if (!result) return null
    const spans = result.tactics.flatMap((t) =>
      t.evidence.map((e) => ({ start: e.start, end: e.end, tactic: t.name })),
    )
    return buildSegments(text, spans)
  }, [result, text])

  return (
    <main
      style={{
        maxWidth: 'var(--content-max)',
        margin: '0 auto',
        padding: 'var(--sp-4)',
        display: 'grid',
        gap: 'var(--sp-4)',
      }}
    >
      <header>
        <h1 style={{ fontSize: 'var(--fs-xl)', margin: 0, lineHeight: 'var(--lh-tight)' }}>
          Engine workbench
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: 0 }}>
          Rules engine, live. Not the product UI — that lands at P5.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              setText(p.text)
              setSender(p.sender)
              setChannel(p.channel ?? 'text')
            }}
            style={{
              minHeight: 'var(--tap-min)',
              padding: '0 var(--sp-3)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-full)',
              fontSize: 'var(--fs-sm)',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label style={{ display: 'grid', gap: 'var(--sp-1)' }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Message</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          style={{
            ...box,
            color: 'var(--text)',
            fontSize: 'var(--fs-md)',
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
      </label>

      <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
        {(['text', 'voice'] as const).map((c) => (
          <button
            key={c}
            onClick={() => setChannel(c)}
            style={{
              flex: 1,
              minHeight: 'var(--tap-min)',
              background: channel === c ? 'var(--surface-2)' : 'transparent',
              color: channel === c ? 'var(--text)' : 'var(--text-muted)',
              border: `1px solid ${channel === c ? 'var(--text-faint)' : 'var(--border)'}`,
              borderRadius: 'var(--r-md)',
              fontSize: 'var(--fs-sm)',
            }}
          >
            {c === 'text' ? 'Text / SMS' : 'Voice transcript'}
          </button>
        ))}
      </div>

      <label style={{ display: 'grid', gap: 'var(--sp-1)' }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          Sender (optional)
        </span>
        <input
          value={sender}
          onChange={(e) => setSender(e.target.value)}
          placeholder="VM-SBIINB or +91 98765 43210"
          style={{
            ...box,
            minHeight: 'var(--tap-min)',
            color: 'var(--text)',
            fontSize: 'var(--fs-md)',
            fontFamily: 'inherit',
          }}
        />
      </label>

      {result === null ? (
        <p style={{ color: 'var(--text-faint)' }}>Type at least 10 characters…</p>
      ) : (
        <>
          <div
            style={{
              ...box,
              borderLeft: `4px solid ${VERDICT_ACCENT[result.verdict]}`,
            }}
          >
            <strong style={{ fontSize: 'var(--fs-lg)', color: VERDICT_ACCENT[result.verdict] }}>
              {result.verdict.toUpperCase()}
            </strong>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
              confidence {result.confidence.toFixed(3)} · {result.engineUsed} ·{' '}
              {result.latencyMs}ms
              <em style={{ display: 'block' }}>(dev only — never shown in the real UI, §4)</em>
            </div>
            <p style={{ marginBottom: 0 }}>{result.explanation}</p>
          </div>

          <div style={box}>
            <div
              style={{
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Message with evidence
            </div>
            <p style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
              {segments?.map((s, i) =>
                s.tactics.length === 0 ? (
                  <span key={i}>{s.text}</span>
                ) : (
                  <mark
                    key={i}
                    title={s.tactics.join(', ')}
                    style={{
                      background: 'color-mix(in srgb, var(--danger-accent) 24%, transparent)',
                      color: 'var(--text)',
                      borderBottom: `2px solid ${VERDICT_ACCENT[result.verdict]}`,
                      borderRadius: '2px',
                    }}
                  >
                    {s.text}
                  </mark>
                ),
              )}
            </p>
          </div>

          <div style={{ ...box, borderLeft: '4px solid var(--border)' }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              SENDER · {result.senderSignal.kind} · risk {result.senderSignal.risk}
            </div>
            <div>{result.senderSignal.note || <em>no sender given</em>}</div>
          </div>

          {result.tactics.map((t) => (
            <div key={t.name} style={box}>
              <strong>{t.label}</strong>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t.note}</div>
              <div style={{ marginTop: 'var(--sp-2)', display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
                {t.evidence.map((e, i) => (
                  <code
                    key={i}
                    style={{
                      background: 'var(--surface-2)',
                      borderRadius: 'var(--r-sm)',
                      padding: '2px 6px',
                      fontSize: 'var(--fs-xs)',
                    }}
                  >
                    {e.phrase}
                  </code>
                ))}
              </div>
            </div>
          ))}

          <div style={{ ...box, borderLeft: '4px solid var(--caution-accent)' }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              WHAT THEY WANT NEXT
            </div>
            <div>{result.nextMove}</div>
          </div>
        </>
      )}
    </main>
  )
}
