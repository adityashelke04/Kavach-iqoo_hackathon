import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { splitSender, classifySender } from '../detector/sender.ts'
import type { DetectionInput } from '../detector/types.ts'
import type { AnalysisPhase } from '../detector/orchestrator.ts'
import { getDeviceTelemetry } from '../device/telemetry.ts'
import { copy } from '../ui/copy.ts'
import { AppBar } from '../ui/primitives/index.tsx'
import {
  IconCopy,
  IconBadgeCheck,
  IconAlertTriangle,
  IconUserX,
} from '../ui/icons.tsx'

const MIN_CHARS = 10
const MAX_CHARS = 4000

interface Example {
  kind: 'scam' | 'legit'
  title: string
  sub: string
  sender: string
  text: string
}

/**
 * Three examples, named the way a person would describe them. The old list of
 * six carried titles like "CBI Digital Arrest Coercion — Institutional
 * Authority + Isolation Mandate", which reads as a test harness rather than a
 * product, and buried the textarea under a screenful of chrome.
 */
const EXAMPLES: Example[] = [
  {
    kind: 'scam',
    title: 'A fake bank SMS',
    sub: 'Says your account will be blocked',
    sender: '+91 98765 43210',
    text: 'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. Update your KYC immediately at http://sbi-kyc-verify.in/update to avoid suspension.',
  },
  {
    kind: 'scam',
    title: 'A fake police message',
    sub: 'Claims there is a case against you',
    sender: '+91 88234 11098',
    text: 'This is Inspector Sharma from Mumbai Cyber Crime Branch. An arrest warrant has been issued against your Aadhaar for illegal money laundering. Stay on the call and do not contact anyone or visit the bank.',
  },
  {
    kind: 'legit',
    title: 'A real bank SMS',
    sub: 'An ordinary transaction alert',
    sender: 'VM-SBIINB',
    text: 'Dear Customer, Rs.2,500.00 has been debited from A/c XX8842 on 28-Aug-26 to UPI/adityaenterprises. Avl Bal Rs.18,340.20. Not you? Call 18001111109. Do not share OTP/CVV/PIN with anyone. -SBI',
  },
]

/**
 * Check — SPEC.md §10.6, §5.5.
 *
 * The sender is lifted out of whatever the user pasted rather than typed into a
 * second field, and removed from the body so the same phone number is not
 * counted twice by the detector.
 */
export function Check({
  onSubmit,
  onBack,
  busy,
  phase,
}: {
  /** The orchestrator runs in App and resolves once, with the final result (D15). */
  onSubmit: (input: DetectionInput) => void
  onBack: () => void
  busy: boolean
  /** null before a phase is known, or once analysis has finished (D15). */
  phase: AnalysisPhase | null
}) {
  const [text, setText] = useState('')
  const [sender, setSender] = useState('')
  const [editingSender, setEditingSender] = useState(false)

  const tooShort = text.trim().length < MIN_CHARS
  const truncated = text.length > MAX_CHARS
  const signal = useMemo(() => classifySender(sender), [sender])

  // A live view of the wait, since D15 no longer paints an early verdict to
  // fill this time — the wait itself is now the whole story (§9b, §10.6).
  const [elapsedMs, setElapsedMs] = useState(0)
  const [modelLabel, setModelLabel] = useState<string | null>(null)
  const startedAt = useRef<number | null>(null)

  useEffect(() => {
    if (!busy) {
      startedAt.current = null
      setElapsedMs(0)
      return
    }

    startedAt.current = Date.now()
    void getDeviceTelemetry().then((t) => setModelLabel(`${t.model.label} (${t.tier})`))

    const id = setInterval(() => {
      if (startedAt.current) setElapsedMs(Date.now() - startedAt.current)
    }, 250)

    return () => clearInterval(id)
  }, [busy])

  const elapsedLabel = `${(elapsedMs / 1000).toFixed(1)}s`
  const statusLine =
    phase === 'reconsidering'
      ? copy.analyzing_reconsidering
      : phase === 'thinking'
        ? copy.analyzing_thinking
        : copy.working

  /** Pull a sender out of the pasted blob if one is in there (§5.5). */
  const ingest = useCallback((raw: string) => {
    const split = splitSender(raw)
    if (split.sender) {
      setSender(split.sender)
      setText(split.body)
    } else {
      setText(raw)
    }
  }, [])

  const pasteFromClipboard = useCallback(async () => {
    try {
      const clip = await navigator.clipboard?.readText()
      if (clip) ingest(clip)
    } catch {
      /* clipboard blocked — the user can still paste with the keyboard */
    }
  }, [ingest])

  const useExample = useCallback((ex: Example) => {
    setText(ex.text)
    setSender(ex.sender)
    setEditingSender(false)
  }, [])

  /**
   * Hands off and returns. The deterministic verdict lands in milliseconds and
   * App navigates on it; the on-device model upgrades it later (D13).
   */
  const run = useCallback(() => {
    if (tooShort || busy) return
    onSubmit({
      text: text.trim().slice(0, MAX_CHARS),
      channel: 'text',
      ...(sender.trim() ? { sender: sender.trim() } : {}),
    })
  }, [tooShort, busy, text, sender, onSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!tooShort && !busy) {
          run()
        }
      }
    },
    [tooShort, busy, run],
  )

  const senderTone =
    signal.kind === 'dlt_header'
      ? 'registered'
      : signal.risk === 'high'
        ? 'personal'
        : 'neutral'

  return (
    <div className="screen">
      <AppBar title={copy.home_check_title} onBack={onBack} />

      <div className="screen__body">
        {busy ? (
          <div className="working" role="status" aria-live="polite">
            <div className="working__pulse" aria-hidden="true" />
            <p className="working__text">{statusLine}</p>
            <p className="working__meta">
              {elapsedLabel}
              {modelLabel ? ` · ${modelLabel}` : ''}
            </p>
          </div>
        ) : (
          <>
            <div className="composer">
              <textarea
                className="composer__area"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text')
                  if (pasted) {
                    e.preventDefault()
                    ingest(pasted)
                  }
                }}
                placeholder={copy.paste_placeholder}
                aria-label={copy.paste_placeholder}
              />
              <div className="composer__bar">
                <div className="composer__actions">
                  <button type="button" className="chip" onClick={pasteFromClipboard}>
                    <IconCopy size={16} />
                    <span>{copy.cta_paste}</span>
                  </button>
                  {text.length > 0 && (
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        setText('')
                        setSender('')
                      }}
                    >
                      {copy.cta_clear}
                    </button>
                  )}
                </div>
                {!tooShort && (
                  <button
                    type="button"
                    className="btn btn--primary composer__submit"
                    onClick={run}
                    disabled={busy}
                  >
                    <span>{copy.cta_check}</span>
                  </button>
                )}
              </div>
            </div>

            {truncated && <p className="hint">{copy.truncated}</p>}

            {/* Sender: shown once we have one, editable, never demanded. */}
            {sender && !editingSender && (
              <div className={`sender-strip sender-strip--${senderTone}`}>
                <span className="sender-strip__icon" aria-hidden="true">
                  {senderTone === 'registered' ? (
                    <IconBadgeCheck size={20} />
                  ) : senderTone === 'personal' ? (
                    <IconUserX size={20} />
                  ) : (
                    <IconAlertTriangle size={20} />
                  )}
                </span>
                <span className="sender-strip__body">
                  <span className="sender-strip__label">{copy.sender_detected}</span>
                  <span className="sender-strip__value">{sender}</span>
                </span>
                <button
                  type="button"
                  className="chip"
                  onClick={() => setEditingSender(true)}
                >
                  {copy.cta_edit}
                </button>
              </div>
            )}

            {(editingSender || (!sender && text.length > 0)) && (
              <div className="stack">
                <label className="section-head" htmlFor="sender-input">
                  {copy.sender_label_optional}
                </label>
                <input
                  id="sender-input"
                  className="field"
                  value={sender}
                  onChange={(e) => setSender(e.target.value)}
                  onBlur={() => setEditingSender(false)}
                  placeholder={copy.sender_placeholder}
                  autoComplete="off"
                />
                <p className="hint">{copy.sender_hint}</p>
              </div>
            )}

            {text.length === 0 && (
              <section>
                <h2 className="section-head">{copy.try_example}</h2>
                <div className="examples">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.title}
                      type="button"
                      className="example"
                      onClick={() => useExample(ex)}
                    >
                      <span
                        className={`example__dot example__dot--${ex.kind}`}
                        aria-hidden="true"
                      />
                      <span className="example__body">
                        <span className="example__title">{ex.title}</span>
                        <span className="example__sub">{ex.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <div className="screen__footer">
        <button
          className="btn btn--primary"
          onClick={run}
          disabled={tooShort || busy}
        >
          {copy.cta_check}
        </button>
        {tooShort && text.length > 0 && <p className="hint center">{copy.too_short}</p>}
      </div>
    </div>
  )
}
