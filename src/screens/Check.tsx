import { useState } from 'react'
import { splitSender } from '../detector/sender.ts'
import { analyze } from '../detector/orchestrator.ts'
import type { DetectionResult } from '../detector/types.ts'
import { copy } from '../ui/copy.ts'
import { AppBar } from '../ui/primitives/index.tsx'

const MIN_CHARS = 10

const EXAMPLES = [
  {
    label: copy.example_scam,
    sender: '+91 98765 43210',
    text: 'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. Update your KYC immediately at http://sbi-kyc-verify.in/update to avoid suspension.',
  },
  {
    label: copy.example_legit,
    sender: 'VM-SBIINB',
    text: 'Dear Customer, Rs.2,500.00 has been debited from A/c XX8842 on 28-Aug-26 to UPI/adityaenterprises. Avl Bal Rs.18,340.20. Not you? Call 18001111109. Do not share OTP/CVV/PIN with anyone. -SBI',
  },
]

/**
 * Check — paste a message, get a verdict. SPEC.md §10.6.
 *
 * The sender is auto-detected out of what they paste and shown for
 * confirmation, so nobody has to type it. It stays optional: if we cannot find
 * one, detection is exactly as good as before (§5.5).
 */
export function Check({
  onResult,
  onBack,
}: {
  onResult: (result: DetectionResult, text: string) => void
  onBack: () => void
}) {
  const [text, setText] = useState('')
  const [sender, setSender] = useState('')
  const [detected, setDetected] = useState(false)
  const [editingSender, setEditingSender] = useState(false)
  const [busy, setBusy] = useState(false)

  const tooShort = text.trim().length < MIN_CHARS

  /** Lift a sender out of pasted text so it is not double-counted in the body. */
  function ingest(raw: string) {
    const split = splitSender(raw)
    if (split.sender) {
      setSender(split.sender)
      setDetected(true)
      setText(split.body)
    } else {
      setText(raw)
    }
  }

  async function run() {
    if (tooShort || busy) return
    setBusy(true)
    const body = text.trim()
    try {
      const result = await analyze({
        text: body,
        channel: 'text',
        ...(sender.trim() ? { sender: sender.trim() } : {}),
      })
      onResult(result, body)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <AppBar title="Check a message" onBack={onBack} />

      <div className="screen__body">
        <div>
          <label className="label" htmlFor="msg">
            Paste the message
          </label>
          <textarea
            id="msg"
            className="field field--message"
            value={text}
            autoFocus
            placeholder={copy.paste_placeholder}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text')
              if (pasted && text.trim() === '') {
                e.preventDefault()
                ingest(pasted)
              }
            }}
          />
          {tooShort && text.length > 0 && <p className="hint">{copy.too_short}</p>}
        </div>

        {sender && !editingSender ? (
          <div>
            <div className="detected">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="detected__label">From</div>
                <div className="detected__value">{sender}</div>
              </div>
              <button
                className="chip"
                onClick={() => setEditingSender(true)}
                aria-label="Edit sender"
              >
                Edit
              </button>
            </div>
            {detected && <p className="hint">We spotted this in what you pasted.</p>}
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="sender">
              {copy.sender_label}
            </label>
            <input
              id="sender"
              className="field field--sender"
              value={sender}
              placeholder={copy.sender_placeholder}
              onChange={(e) => {
                setSender(e.target.value)
                setDetected(false)
              }}
              onBlur={() => setEditingSender(false)}
            />
            <p className="hint">
              A real bank uses a name like VM-SBIINB. A scam usually comes from a normal
              number.
            </p>
          </div>
        )}

        <div>
          <p className="section-label" style={{ marginBottom: 'var(--sp-2)' }}>
            {copy.try_example}
          </p>
          <div className="chips">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                className="chip"
                onClick={() => {
                  setText(ex.text)
                  setSender(ex.sender)
                  setDetected(false)
                  setEditingSender(false)
                }}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="screen__footer">
        {busy ? (
          <div className="thinking">
            <span className="spinner" aria-hidden="true" />
            Checking…
          </div>
        ) : (
          <button className="btn btn--primary" disabled={tooShort} onClick={run}>
            {copy.cta_check}
          </button>
        )}
      </div>
    </div>
  )
}
