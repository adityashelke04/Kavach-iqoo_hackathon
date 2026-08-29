import { useCallback, useEffect, useRef, useState } from 'react'
import { analyze } from '../detector/orchestrator.ts'
import type { DetectionResult } from '../detector/types.ts'
import { Findings } from '../ui/components/index.tsx'
import { copy } from '../ui/copy.ts'
import { AppBar } from '../ui/primitives/index.tsx'

/**
 * Listen mode — SPEC.md §10.6, §5.6.
 *
 * Transcribes a speakerphone call with the Web Speech API and feeds the
 * rolling transcript through the SAME orchestrator as the paste flow. Listen
 * mode contains no detection logic of its own — that is the whole point of the
 * Detector interface (§6).
 *
 * HONESTY: Android Chrome sends audio to Google for recognition, so Listen
 * mode is NOT offline and NOT private the way paste mode is. The screen says
 * so. Do not let the offline claim bleed across from paste mode.
 */

// The Web Speech API is not in TS's DOM lib. Minimal shape, only what we use.
interface SpeechResultAlt {
  transcript: string
}
interface SpeechResult {
  0: SpeechResultAlt
  isFinal: boolean
  length: number
}
interface SpeechEvent {
  resultIndex: number
  results: { length: number; [i: number]: SpeechResult }
}
interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((e: SpeechEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
type SpeechCtor = new () => SpeechRecognitionLike

function getSpeechCtor(): SpeechCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  return (w['SpeechRecognition'] ?? w['webkitSpeechRecognition'] ?? null) as SpeechCtor | null
}

/** Analyse at most this often, and only when the buffer actually grew. */
const DEBOUNCE_MS = 3000
/** How much of the conversation to keep in the rolling window. */
const WINDOW_CHARS = 600

type Phase = 'priming' | 'listening' | 'denied' | 'unsupported' | 'stopped'

export function Listen({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>(() =>
    getSpeechCtor() ? 'priming' : 'unsupported',
  )
  const [finalText, setFinalText] = useState('')
  const [interim, setInterim] = useState('')
  const [result, setResult] = useState<DetectionResult | null>(null)
  const [interrupted, setInterrupted] = useState(false)

  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const wantRunning = useRef(false)
  const lastRunAt = useRef(0)
  const lastRunLen = useRef(0)
  const transcriptRef = useRef('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const runDetection = useCallback(async (buffer: string) => {
    const res = await analyze({ text: buffer, channel: 'voice' })
    setResult(res)
    if (res.verdict === 'danger') setInterrupted(true)
  }, [])

  const stop = useCallback(() => {
    wantRunning.current = false
    try {
      recRef.current?.stop()
    } catch {
      /* already stopped */
    }
    setPhase('stopped')
  }, [])

  const start = useCallback(() => {
    const Ctor = getSpeechCtor()
    if (!Ctor) {
      setPhase('unsupported')
      return
    }

    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-IN'

    rec.onresult = (e) => {
      let addition = ''
      let pending = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (!r) continue
        const chunk = r[0].transcript
        if (r.isFinal) addition += chunk
        else pending += chunk
      }
      setInterim(pending)

      if (addition) {
        transcriptRef.current = `${transcriptRef.current} ${addition}`.trim()
        setFinalText(transcriptRef.current)

        const buffer = transcriptRef.current.slice(-WINDOW_CHARS)
        const now = Date.now()
        const grewEnough = buffer.length - lastRunLen.current > 25
        if (now - lastRunAt.current > DEBOUNCE_MS && grewEnough) {
          lastRunAt.current = now
          lastRunLen.current = buffer.length
          void runDetection(buffer)
        }
      }
    }

    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantRunning.current = false
        setPhase('denied')
      }
      // 'no-speech' and 'network' are transient; onend restarts us.
    }

    // Android Chrome stops recognition on silence. Restart while the user
    // still wants to be listening — without this, Listen mode dies the first
    // time nobody speaks for a few seconds.
    rec.onend = () => {
      if (!wantRunning.current) return
      try {
        rec.start()
      } catch {
        /* a restart raced the stop; ignore */
      }
    }

    recRef.current = rec
    wantRunning.current = true
    try {
      rec.start()
      setPhase('listening')
    } catch {
      setPhase('denied')
    }
  }, [runDetection])

  useEffect(() => {
    return () => {
      wantRunning.current = false
      try {
        recRef.current?.stop()
      } catch {
        /* ignore */
      }
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [finalText, interim])

  // --- full-screen interrupt --------------------------------------------
  if (interrupted && result) {
    return (
      <div className="interrupt">
        <div>
          <div style={{ fontSize: 48, lineHeight: 1 }} aria-hidden="true">
            ⛔
          </div>
          <h1 className="verdict__head" style={{ marginTop: 'var(--sp-3)' }}>
            {copy.listen_interrupt}
          </h1>
          <p className="verdict__sub">{result.explanation}</p>
        </div>
        <div className="stack">
          {result.tactics.map((t) => (
            <div key={t.name} className="card card--danger">
              <h3 className="card__title">{t.label}</h3>
              <p className="card__note">{t.note}</p>
            </div>
          ))}
        </div>
        <button
          className="btn btn--secondary"
          onClick={() => {
            setInterrupted(false)
          }}
        >
          Keep listening
        </button>
        <button
          className="btn btn--primary"
          onClick={() => {
            stop()
            onBack()
          }}
        >
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="screen">
      <AppBar title={copy.listen_title} onBack={onBack} />

      <div className="screen__body">
        {phase === 'unsupported' && (
          <div className="card card--caution">
            <h3 className="card__title">Not available on this browser</h3>
            <p className="card__note">
              Listen mode needs speech recognition, which this browser does not provide. Checking
              a pasted message still works.
            </p>
          </div>
        )}

        {phase === 'denied' && (
          <div className="card card--caution">
            <h3 className="card__title">{copy.listen_denied}</h3>
            <p className="card__note">
              Allow microphone access in your browser settings, then try again.
            </p>
          </div>
        )}

        {phase === 'priming' && (
          <>
            <div className="card">
              <h3 className="card__title">Before you start</h3>
              <p className="card__note">{copy.listen_prime}</p>
            </div>
            <div className="card card--caution">
              <p className="card__note" style={{ margin: 0 }}>
                {copy.listen_privacy_note}
              </p>
            </div>
          </>
        )}

        {(phase === 'listening' || phase === 'stopped') && (
          <>
            <div className="listen-status">
              {phase === 'listening' && <span className="dot" aria-hidden="true" />}
              <span>{phase === 'listening' ? copy.listen_active : 'Stopped'}</span>
            </div>

            <div className="transcript" ref={scrollRef} aria-live="polite">
              {finalText || interim ? (
                <>
                  {finalText}{' '}
                  <span className="transcript__interim">{interim}</span>
                </>
              ) : (
                <span className="muted">Waiting for speech…</span>
              )}
            </div>

            {result && result.verdict !== 'safe' && (
              <div className={`card card--${result.verdict}`}>
                <h3 className="card__title">
                  {result.verdict === 'danger' ? 'This sounds like a scam' : 'Something is off'}
                </h3>
                <p className="card__note">{result.explanation}</p>
              </div>
            )}

            {phase === 'stopped' && result && (
              <Findings result={result} text={finalText.slice(-WINDOW_CHARS)} />
            )}
          </>
        )}
      </div>

      <div className="screen__footer">
        {phase === 'priming' && (
          <button className="btn btn--primary" onClick={start}>
            Start listening
          </button>
        )}
        {phase === 'listening' && (
          <button className="btn btn--danger" onClick={stop}>
            {copy.listen_stop}
          </button>
        )}
        {(phase === 'stopped' || phase === 'denied') && (
          <button
            className="btn btn--primary"
            onClick={() => {
              setResult(null)
              transcriptRef.current = ''
              setFinalText('')
              setInterim('')
              lastRunLen.current = 0
              lastRunAt.current = 0
              setPhase('priming')
            }}
          >
            Start again
          </button>
        )}
      </div>
    </div>
  )
}
