import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { splitSender, classifySender } from '../detector/sender.ts'
import type { DetectionInput } from '../detector/types.ts'
import type { AnalysisPhase } from '../detector/orchestrator.ts'
import { getDeviceTelemetry } from '../device/telemetry.ts'
import { onModelProgress } from '../detector/local.ts'
import { createHiddenTimeTracker } from '../pwa/wakelock.ts'
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
  onCancel,
  busy,
  phase,
}: {
  /** The orchestrator runs in App and resolves once, with the final result (D15). */
  onSubmit: (input: DetectionInput) => void
  onBack: () => void
  /**
   * Abandons the analysis in flight and returns to the composer (D20, P10).
   *
   * §10.6 described the wait as the proof of work, and §6 called Cancel
   * "always available" — but there was no way to stop one, on this screen or
   * anywhere else. A wait a person cannot end is not a demonstration of
   * anything; it is a hang with a good explanation.
   */
  onCancel: () => void
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

  /**
   * Whether the model is still arriving, and how far along.
   *
   * Without this the screen claimed "Reading your message on this phone…" for
   * the entire first download — minutes, on a phone that has never loaded a
   * model — while the phone was doing nothing of the kind. Observed on the
   * deployed build: forty seconds of that line before a single token existed.
   */
  const [loading, setLoading] = useState<{ fraction: number | null } | null>(null)

  useEffect(() => {
    if (!busy) {
      startedAt.current = null
      setElapsedMs(0)
      return
    }

    startedAt.current = Date.now()
    // `getDeviceTelemetry` reads the *active* tier since D20, so this line now
    // names the model that is generating rather than the one this device would
    // have picked from scratch.
    void getDeviceTelemetry().then((t) => setModelLabel(`${t.model.label} (${t.tier})`))

    /**
     * Time the phone actually spent working, not time it spent on a table (D22).
     *
     * This counter was plain wall-clock, and Android freezes a screen-off tab —
     * so a locked phone produced "325.5s" of "Reading your message…" while
     * nothing was computing. §9c holds the app to an honest account of its own
     * effort, and a figure inflated by a screen lock is not one. The wake lock
     * in `App` should stop this arising at all; this makes the number truthful
     * when it does.
     */
    const hidden = createHiddenTimeTracker()

    const id = setInterval(() => {
      if (startedAt.current) {
        setElapsedMs(Math.max(0, Date.now() - startedAt.current - hidden.hiddenMs()))
      }
    }, 250)

    return () => {
      clearInterval(id)
      hidden.stop()
    }
  }, [busy])

  // Subscribed for the life of the screen, not just while busy: the preload
  // starts on app open (D6), so the model may already be arriving before the
  // user has finished pasting.
  useEffect(
    () => onModelProgress((p) => setLoading(p.done ? null : { fraction: p.fraction })),
    [],
  )

  const elapsedLabel = `${(elapsedMs / 1000).toFixed(1)}s`
  const statusLine = loading
    ? copy.analyzing_downloading
    : phase === 'reconsidering'
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
            {/* Keyed by its own text so the rare "double-checking one detail"
                switch (D15 step 6) crossfades in rather than snapping. */}
            <p className="working__text" key={statusLine}>
              {statusLine}
            </p>
            <p className="working__meta">
              {elapsedLabel}
              {modelLabel ? ` · ${modelLabel}` : ''}
            </p>

            {/* A bar, never a percentage: §4 permits numbers about the phone,
                but the mobile gate forbids any "%" in the DOM outright, and a
                bar reads faster than a figure anyway. */}
            {loading && (
              <>
                <div
                  className="working__bar"
                  role="progressbar"
                  aria-label={copy.analyzing_downloading}
                  {...(loading.fraction !== null
                    ? {
                        'aria-valuemin': 0,
                        'aria-valuemax': 1,
                        'aria-valuenow': loading.fraction,
                      }
                    : {})}
                >
                  <div
                    className={`working__bar-fill${
                      loading.fraction === null ? ' working__bar-fill--indeterminate' : ''
                    }`}
                    style={
                      loading.fraction !== null
                        ? { transform: `scaleX(${Math.max(0.02, Math.min(1, loading.fraction))})` }
                        : undefined
                    }
                  />
                </div>
                <p className="working__note">{copy.analyzing_downloading_note}</p>
              </>
            )}

            <button type="button" className="btn btn--ghost working__cancel" onClick={onCancel}>
              {copy.cta_cancel}
            </button>
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
