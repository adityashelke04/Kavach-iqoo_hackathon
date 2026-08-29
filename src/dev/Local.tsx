import { useCallback, useEffect, useRef, useState } from 'react'
import { AppBar } from '../ui/primitives/index.tsx'
import {
  localDetector,
  onModelProgress,
  resolveTier,
  setPreferredTier,
  unloadEngine,
} from '../detector/local.ts'
import { analyzeWithRules } from '../detector/rules.ts'
import { MODELS, type Tier } from '../detector/models.ts'
import type { DetectionResult, Verdict } from '../detector/types.ts'

/**
 * /dev/local — does the on-device model actually hold the contract?
 *
 * `/dev/llm` (the P2 spike) proves WebGPU can load a model and emit tokens. It
 * does NOT touch `localDetector`, so it cannot tell you whether the thing the
 * product actually ships — prompt, JSON contract, evidence resolution, verdict
 * mapping — survives a 1B model on a phone. This page runs that path.
 *
 * It answers the three questions P7's exit criterion implies but does not spell
 * out:
 *
 * 1. **Does it keep the JSON contract?** Every failure here is an engine
 *    failure (§6) that silently falls back to rules in production, so a high
 *    rate would mean the on-device claim is decoration.
 * 2. **Does it stay off the legitimate messages?** The false-positive gate
 *    (§12) has only ever been measured against the rules engine. A model that
 *    flags a real bank alert is worse than no model.
 * 3. **How long does it take per message, on this device?**
 *
 * Results are also written to `window.__kavachLocal` so `npm run test:local`
 * can read them. On the phone, just read the table.
 */

interface Fixture {
  id: string
  text: string
  sender?: string
  channel?: 'text' | 'voice'
  expect: Verdict
  /** Why this one is in a set this small. */
  why: string
}

/**
 * Deliberately small. Each on-device run costs tens of seconds, so 70 corpus
 * messages would be half an hour on a phone and nobody would run it twice.
 * These are the cases that actually discriminate.
 */
const FIXTURES: Fixture[] = [
  {
    id: 'legit-debit-alert',
    sender: 'VM-SBIINB',
    text: 'Dear Customer, Rs.2,500.00 has been debited from A/c XX8842 on 28-Aug-26 to UPI/adityaenterprises. Avl Bal Rs.18,340.20. Not you? Call 18001111109. Do not share OTP/CVV/PIN with anyone. -SBI',
    expect: 'safe',
    why: 'THE hard case: a real bank SMS that says OTP, CVV and PIN. Flagging this is the worst thing the model can do.',
  },
  {
    id: 'legit-delivery-otp',
    sender: 'VM-SWGGY',
    text: 'Your Swiggy order is arriving. Share OTP 4471 with your delivery partner to complete the handover.',
    expect: 'safe',
    why: 'A legitimate request for an OTP. The distinction is who is asking and why.',
  },
  {
    id: 'legit-appointment',
    sender: 'AD-APOLLO',
    text: 'Reminder: your appointment with Dr. Menon is tomorrow at 11:30 AM at Apollo Jayanagar. Reply CANCEL to reschedule.',
    expect: 'safe',
    why: 'Ordinary transactional message with a deadline in it. Urgency alone must not convict.',
  },
  {
    id: 'scam-kyc-otp',
    sender: '+91 98765 43210',
    text: 'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. Share the OTP sent to your number immediately to avoid suspension.',
    expect: 'danger',
    why: 'The canonical case: authority + urgency + extraction, from a personal number.',
  },
  {
    id: 'scam-digital-arrest',
    sender: '+91 91234 56789',
    text: 'This is Inspector Sharma from Mumbai Cyber Crime Branch. An FIR has been registered against your Aadhaar for money laundering. This is a confidential investigation. Do not discuss this with anyone including family. Stay on the line.',
    expect: 'danger',
    why: 'Authority + isolation with no extraction in the text. Tests that isolation is scored.',
  },
  {
    id: 'scam-remote-access',
    sender: '+91 90000 11111',
    text: 'Sir your refund is stuck. Please install AnyDesk from Play Store and share the 9 digit code so I can process it from my side.',
    expect: 'danger',
    why: 'Remote-access app — a conclusive signal in the rules engine (§8.3). Does the model see it too?',
  },
  {
    id: 'scam-voice-transcript',
    channel: 'voice',
    text: 'sir before we proceed are you alone at home please go to a quiet room this is a confidential matter from the enforcement directorate we will need to verify your bank account details',
    expect: 'danger',
    why: 'Voice channel, no sender, no punctuation. The language has to carry the whole judgment (§5.6).',
  },
  {
    id: 'legit-voice-delivery',
    channel: 'voice',
    text: 'hello sir i am calling from swiggy i am at your gate with your order can you please tell me the o t p shown in your app',
    expect: 'safe',
    why: 'The voice false-positive trap: a real delivery driver asking for an OTP.',
  },
]

type Row = {
  id: string
  expect: Verdict
  got: Verdict | null
  rules: Verdict
  ms: number
  tactics: string
  confidence: number | null
  error: string | null
  explanation: string
  unresolved: number
}

const verdictColour = (v: Verdict | null) =>
  v === 'danger'
    ? 'var(--danger-accent)'
    : v === 'caution'
      ? 'var(--caution-accent)'
      : v === 'safe'
        ? 'var(--safe-accent)'
        : 'var(--text-faint)'

export function Local() {
  const [tier, setTier] = useState<Tier | null>(null)
  const [forced, setForced] = useState<Tier | ''>('')
  const [rows, setRows] = useState<Row[]>([])
  const [progress, setProgress] = useState('')
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState('')
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    void resolveTier().then(setTier)
    return onModelProgress((p) => setProgress(p.text))
  }, [])

  const run = useCallback(async () => {
    setRunning(true)
    setRows([])
    setNote('')
    // Pin the tier before the first detect(), so the run measures the tier that
    // was asked for rather than whatever this device would pick for itself.
    setPreferredTier(forced === '' ? null : forced)
    abort.current = new AbortController()
    const collected: Row[] = []

    for (const f of FIXTURES) {
      const input = {
        text: f.text,
        ...(f.sender ? { sender: f.sender } : {}),
        ...(f.channel ? { channel: f.channel } : {}),
      }
      const rules = analyzeWithRules(input)
      const started = performance.now()

      let row: Row
      try {
        setProgress(`Running ${f.id}…`)
        const r: DetectionResult = await localDetector.detect(input, abort.current.signal)
        row = {
          id: f.id,
          expect: f.expect,
          got: r.verdict,
          rules: rules.verdict,
          ms: Math.round(performance.now() - started),
          tactics: r.tactics.map((t) => t.name).join(',') || '—',
          confidence: r.confidence,
          error: null,
          explanation: r.explanation,
          unresolved: r.tactics.reduce(
            (n, t) => n + t.evidence.filter((e) => e.start === -1).length,
            0,
          ),
        }
      } catch (err) {
        row = {
          id: f.id,
          expect: f.expect,
          got: null,
          rules: rules.verdict,
          ms: Math.round(performance.now() - started),
          tactics: '—',
          confidence: null,
          error: (err as Error).message,
          explanation: '',
          unresolved: 0,
        }
      }

      collected.push(row)
      setRows([...collected])
      ;(window as unknown as { __kavachLocal?: unknown }).__kavachLocal = {
        done: false,
        tier: forced || tier,
        rows: collected,
      }
    }

    ;(window as unknown as { __kavachLocal?: unknown }).__kavachLocal = {
      done: true,
      tier: forced || tier,
      rows: collected,
    }
    setProgress('')
    setRunning(false)

    const contractFails = collected.filter((r) => r.error !== null).length
    const falsePositives = collected.filter(
      (r) => r.expect === 'safe' && r.got === 'danger',
    ).length
    const missed = collected.filter((r) => r.expect === 'danger' && r.got === 'safe').length
    setNote(
      `${collected.length} run · ${contractFails} contract failure(s) · ` +
        `${falsePositives} false positive(s) · ${missed} missed scam(s)`,
    )
  }, [forced, tier])

  return (
    <div className="screen">
      <AppBar title="On-device engine" />
      <div className="screen__body">
        <section className="panel">
          <h2 className="panel__title">Device</h2>
          <p className="panel__lead">
            Tier chosen for this device: <strong>{tier ?? 'measuring…'}</strong>
            {tier ? ` — ${MODELS[tier].label}` : ''}
          </p>
          <div className="action-row" style={{ flexWrap: 'wrap' }}>
            {(['', 'low', 'standard', 'max'] as const).map((t) => (
              <button
                key={t || 'auto'}
                type="button"
                className="chip"
                onClick={() => setForced(t)}
                style={forced === t ? { borderColor: 'var(--heat)' } : undefined}
              >
                {t === '' ? 'auto' : t}
              </button>
            ))}
          </div>
        </section>

        <div className="action-row">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void run()}
            disabled={running}
          >
            {running ? 'Running…' : `Run ${FIXTURES.length} messages on-device`}
          </button>
        </div>
        <div className="action-row">
          <button
            type="button"
            className="chip chip--grow"
            onClick={() => {
              abort.current?.abort()
              void unloadEngine()
              setRunning(false)
            }}
          >
            Stop and unload
          </button>
        </div>

        {progress && <p className="hint">{progress}</p>}
        {note && (
          <p className="panel__lead" style={{ fontWeight: 700 }}>
            {note}
          </p>
        )}

        <div className="stack">
          {rows.map((r) => {
            const wrong = r.error !== null || r.got !== r.expect
            return (
              <section className="panel" key={r.id}>
                <h2 className="panel__title" style={{ color: verdictColour(r.got) }}>
                  {wrong ? '✗ ' : '✓ '}
                  {r.id}
                </h2>
                <p className="hint">
                  want <strong>{r.expect}</strong> · model{' '}
                  <strong style={{ color: verdictColour(r.got) }}>{r.got ?? 'FAILED'}</strong> ·
                  rules <strong>{r.rules}</strong> · {r.ms} ms
                </p>
                {r.error ? (
                  <p className="panel__lead" style={{ color: 'var(--danger-accent)' }}>
                    {r.error}
                  </p>
                ) : (
                  <>
                    <p className="hint">
                      tactics: {r.tactics}
                      {r.unresolved > 0
                        ? ` · ${r.unresolved} evidence phrase(s) not found in the message`
                        : ''}
                    </p>
                    <p className="panel__lead">{r.explanation}</p>
                  </>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
