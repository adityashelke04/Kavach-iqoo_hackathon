import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyze } from '../detector/orchestrator.ts'
import type { DetectionResult, Tactic } from '../detector/types.ts'
import { buildSegments } from '../detector/evidence.ts'
import { Findings } from '../ui/components/index.tsx'
import { copy } from '../ui/copy.ts'
import { AppBar } from '../ui/primitives/index.tsx'
import {
  IconMic,
  IconShieldX,
  IconAlertTriangle,
  IconPhoneOff,
  IconInfo,
  IconPlay,
} from '../ui/icons.tsx'

/**
 * Listen — SPEC.md §10.6, §5.6.
 *
 * Web Speech drives a rolling window of the transcript through the same
 * orchestrator the paste flow uses, with `channel: 'voice'` so the engine also
 * matches the spoken forms of acronyms ("o t p"). A danger verdict takes over
 * the whole screen, because someone mid-call is not reading a card.
 */

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
  abort?: () => void
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

const DEBOUNCE_MS = 2400
const WINDOW_CHARS = 600

type Phase = 'priming' | 'listening' | 'denied' | 'unsupported' | 'stopped'

interface CallPreset {
  id: string
  title: string
  sub: string
  kind: 'scam' | 'legit'
  text: string
}

/** Recorded calls, so Listen mode can be shown without a live caller. */
const PRESETS: CallPreset[] = [
  {
    id: 'digital-arrest',
    title: 'A fake police call',
    sub: 'Says there is a case against your Aadhaar',
    kind: 'scam',
    text: 'madam this is sub inspector from cyber crime branch your aadhaar number has been used in a money laundering case this is a confidential investigation do not tell anyone in your family we are recording this call stay on the line',
  },
  {
    id: 'sbi-otp-scam',
    title: 'A fake bank call',
    sub: 'Asks you to read out a code',
    kind: 'scam',
    text: 'hello sir i am calling from the state bank of india head office your account has been temporarily suspended please listen to me carefully do not disconnect the call i will send you a code on your phone just read out the o t p to me for verification',
  },
  {
    id: 'safe-delivery',
    title: 'A real delivery call',
    sub: 'A courier at your building',
    kind: 'legit',
    text: 'hello sir i am outside your building with your amazon parcel can you please give me the four digit delivery code sent by sms so i can hand over the package',
  },
]

/* ==========================================================================
   Microphone state
   ========================================================================== */

function MicState({
  phase,
  hearing,
  danger,
}: {
  phase: Phase
  hearing: boolean
  danger: boolean
}) {
  const mod = danger ? 'mic--danger' : phase === 'listening' ? 'mic--listening' : ''

  const caption =
    phase === 'listening'
      ? hearing
        ? copy.listen_active_speech
        : copy.listen_active
      : phase === 'stopped'
        ? copy.listen_stopped
        : copy.listen_idle

  return (
    <div className={`mic ${mod}`}>
      <span className="mic__core">
        <span className="mic__ring" aria-hidden="true" />
        <span className="mic__ring" aria-hidden="true" />
        {danger ? <IconShieldX size={36} /> : <IconMic size={36} />}
      </span>

      <div className={`level ${hearing ? 'level--active' : ''}`} aria-hidden="true">
        {Array.from({ length: 12 }).map((_, i) => (
          <span key={i} className="level__bar" />
        ))}
      </div>

      <p className="mic__caption">{caption}</p>
    </div>
  )
}

/* ==========================================================================
   Live transcript
   ========================================================================== */

function Transcript({
  finalText,
  interim,
  tactics,
  scrollRef,
}: {
  finalText: string
  interim: string
  tactics: readonly Tactic[]
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  const segments = useMemo(() => {
    if (!finalText) return []
    const spans = tactics
      .flatMap((t) =>
        t.evidence.map((e) => ({ start: e.start, end: e.end, tactic: t.name })),
      )
      .filter((e) => e.start !== -1)
    return buildSegments(finalText, spans)
  }, [finalText, tactics])

  return (
    <section className="transcript">
      <h2 className="transcript__head">{copy.listen_transcript}</h2>
      <div className="transcript__body" ref={scrollRef} aria-live="polite">
        {finalText || interim ? (
          <>
            {segments.map((s, i) =>
              s.tactics.length === 0 ? (
                <span key={i}>{s.text}</span>
              ) : (
                <mark key={i} className="evidence-mark">
                  {s.text}
                </mark>
              ),
            )}
            {interim && (
              <span className="transcript__interim">
                {' '}
                {interim}
                <span className="transcript__cursor" aria-hidden="true" />
              </span>
            )}
          </>
        ) : (
          <div className="transcript__empty">
            <IconMic size={22} />
            <span>{copy.listen_waiting}</span>
          </div>
        )}
      </div>
    </section>
  )
}

/* ==========================================================================
   Full-screen interrupt
   ========================================================================== */

function Interrupt({
  result,
  onDismiss,
  onExit,
}: {
  result: DetectionResult
  onDismiss: () => void
  onExit: () => void
}) {
  return (
    <div className="interrupt" role="alertdialog" aria-modal="true">
      <div className="interrupt__body">
        <div className="interrupt__head">
          <span className="interrupt__mark" aria-hidden="true">
            <IconShieldX size={36} strokeWidth={2.2} />
          </span>
          <h1 className="interrupt__title">{copy.listen_interrupt}</h1>
          <p className="interrupt__sub">{result.explanation}</p>
        </div>

        <section className="panel">
          <h2 className="panel__title">{copy.next_move_title}</h2>
          <p className="panel__lead">{result.nextMove}</p>
        </section>
      </div>

      <div className="screen__footer">
        <button className="btn btn--primary" onClick={onExit}>
          <IconPhoneOff size={20} />
          <span>{copy.listen_hangup}</span>
        </button>
        <button className="btn btn--ghost" onClick={onDismiss}>
          {copy.listen_keep}
        </button>
      </div>
    </div>
  )
}

/* ==========================================================================
   Screen
   ========================================================================== */

export function Listen({ onBack }: { onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>(() =>
    getSpeechCtor() ? 'priming' : 'unsupported',
  )
  const [finalText, setFinalText] = useState('')
  const [interim, setInterim] = useState('')
  const [result, setResult] = useState<DetectionResult | null>(null)
  const [interrupted, setInterrupted] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [lang, setLang] = useState<'en-IN' | 'hi-IN'>('en-IN')

  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const wantRunning = useRef(false)
  const restartTimerRef = useRef<number | null>(null)
  const lastRunAt = useRef(0)
  const lastRunLen = useRef(0)
  const transcriptRef = useRef('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const simTimerRef = useRef<number | null>(null)

  const cleanupRec = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
    const r = recRef.current
    if (r) {
      r.onresult = null
      r.onerror = null
      r.onend = null
      try {
        if (typeof r.abort === 'function') {
          r.abort()
        } else {
          r.stop()
        }
      } catch {
        /* already closed */
      }
      recRef.current = null
    }
  }, [])

  /**
   * The live loop is deterministic-only.
   *
   * A rolling transcript is re-analysed every couple of seconds; starting a
   * tens-of-seconds on-device generation on each pass would queue jobs faster
   * than they finish and the warning would arrive after the call ended. The
   * full stack runs once, on the final transcript, when the user stops.
   */
  const runDetection = useCallback(
    async (buffer: string, deep = false) => {
      if (!buffer.trim()) return
      setAnalyzing(true)
      try {
        const res = await analyze({ text: buffer, channel: 'voice' }, deep ? 'local' : 'none')
        setResult(res)
        if (res.verdict === 'danger') setInterrupted(true)
      } finally {
        setAnalyzing(false)
      }
    },
    [],
  )

  const stop = useCallback(() => {
    wantRunning.current = false
    if (simTimerRef.current !== null) {
      window.clearInterval(simTimerRef.current)
      simTimerRef.current = null
    }
    cleanupRec()
    setPhase('stopped')

    // Now that nothing is streaming, spend the time on a full check of what
    // was actually said.
    const buffer = transcriptRef.current.slice(-WINDOW_CHARS)
    if (buffer.trim()) void runDetection(buffer, true)
  }, [cleanupRec, runDetection])

  const startSession = useCallback(() => {
    cleanupRec()

    const Ctor = getSpeechCtor()
    if (!Ctor) {
      setPhase('unsupported')
      return
    }

    try {
      const rec = new Ctor()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = lang

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
          const grewEnough = buffer.length - lastRunLen.current > 15
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
          cleanupRec()
          setPhase('denied')
        }
        // Non-fatal errors like 'no-speech' or 'audio-capture': onend will fire and restart with cooldown
      }

      // Android Chrome ends recognition the moment nobody is speaking.
      // Re-instantiate with a cooldown delay so Chrome releases the mic handle first.
      rec.onend = () => {
        if (!wantRunning.current) return
        cleanupRec()
        restartTimerRef.current = window.setTimeout(() => {
          if (wantRunning.current) {
            startSession()
          }
        }, 300)
      }

      recRef.current = rec
      rec.start()
      setPhase('listening')
    } catch {
      if (wantRunning.current) {
        restartTimerRef.current = window.setTimeout(() => {
          if (wantRunning.current) {
            startSession()
          }
        }, 500)
      }
    }
  }, [cleanupRec, lang, runDetection])

  const start = useCallback(() => {
    if (simTimerRef.current !== null) {
      window.clearInterval(simTimerRef.current)
      simTimerRef.current = null
    }
    wantRunning.current = true
    startSession()
  }, [startSession])

  const reset = useCallback(() => {
    stop()
    setResult(null)
    transcriptRef.current = ''
    setFinalText('')
    setInterim('')
    lastRunLen.current = 0
    lastRunAt.current = 0
    setPhase('priming')
  }, [stop])

  /** Streams a recorded call into the transcript, word by word. */
  const playPreset = useCallback(
    (preset: CallPreset) => {
      stop()
      setResult(null)
      transcriptRef.current = ''
      setFinalText('')
      setInterim('')
      lastRunLen.current = 0
      lastRunAt.current = 0
      setPhase('listening')

      const words = preset.text.split(' ')
      let index = 0

      simTimerRef.current = window.setInterval(() => {
        if (index < words.length) {
          const chunk = words[index]
          index++
          transcriptRef.current = `${transcriptRef.current} ${chunk}`.trim()
          setFinalText(transcriptRef.current)
          setInterim(
            index < words.length
              ? words.slice(index, Math.min(index + 2, words.length)).join(' ')
              : '',
          )

          const buffer = transcriptRef.current.slice(-WINDOW_CHARS)
          const now = Date.now()
          const grewEnough = buffer.length - lastRunLen.current > 20
          if ((now - lastRunAt.current > 1800 && grewEnough) || index === words.length) {
            lastRunAt.current = now
            lastRunLen.current = buffer.length
            void runDetection(buffer)
          }
        } else {
          if (simTimerRef.current !== null) {
            window.clearInterval(simTimerRef.current)
            simTimerRef.current = null
          }
          setInterim('')
        }
      }, 95)
    },
    [stop, runDetection],
  )

  useEffect(() => {
    return () => {
      wantRunning.current = false
      if (simTimerRef.current !== null) {
        window.clearInterval(simTimerRef.current)
        simTimerRef.current = null
      }
      cleanupRec()
    }
  }, [cleanupRec])

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [finalText, interim])

  if (interrupted && result) {
    return (
      <Interrupt
        result={result}
        onDismiss={() => setInterrupted(false)}
        onExit={() => {
          stop()
          onBack()
        }}
      />
    )
  }

  const danger = result?.verdict === 'danger'
  const statusTone = analyzing
    ? ''
    : result?.verdict === 'danger'
      ? 'status-line--danger'
      : result?.verdict === 'caution'
        ? 'status-line--caution'
        : ''

  const statusText = analyzing
    ? copy.listen_checking
    : result && result.verdict !== 'safe'
      ? result.explanation
      : copy.listen_clear

  const idle = phase === 'priming' || phase === 'denied' || phase === 'unsupported'

  return (
    <div className="screen">
      <AppBar
        title={copy.listen_title}
        onBack={onBack}
        action={
          phase === 'listening' ? (
            <span className="live-pill">
              <span className="live-dot" aria-hidden="true" />
              <span>LIVE</span>
            </span>
          ) : undefined
        }
      />

      <div className="screen__body">
        {phase === 'unsupported' && (
          <div className="notice notice--caution">
            <span className="notice__icon" aria-hidden="true">
              <IconAlertTriangle size={20} />
            </span>
            <div className="notice__body">
              <h2 className="notice__title">{copy.listen_unsupported}</h2>
              <p className="notice__text">{copy.listen_unsupported_note}</p>
            </div>
          </div>
        )}

        {phase === 'denied' && (
          <div className="notice notice--caution">
            <span className="notice__icon" aria-hidden="true">
              <IconAlertTriangle size={20} />
            </span>
            <div className="notice__body">
              <h2 className="notice__title">{copy.listen_denied}</h2>
              <p className="notice__text">{copy.listen_denied_note}</p>
            </div>
          </div>
        )}

        {idle && (
          <>
            {phase === 'priming' && (
              <MicState phase={phase} hearing={false} danger={false} />
            )}

            <div className="action-row" role="group" aria-label="Language">
              <button
                type="button"
                className={`chip chip--grow ${lang === 'en-IN' ? 'chip--active' : ''}`}
                onClick={() => setLang('en-IN')}
                aria-pressed={lang === 'en-IN'}
              >
                {copy.listen_lang_en}
              </button>
              <button
                type="button"
                className={`chip chip--grow ${lang === 'hi-IN' ? 'chip--active' : ''}`}
                onClick={() => setLang('hi-IN')}
                aria-pressed={lang === 'hi-IN'}
              >
                {copy.listen_lang_hi}
              </button>
            </div>

            <div className="steps">
              <div className="step">
                <span className="step__num" aria-hidden="true">
                  1
                </span>
                <div>
                  <h3 className="step__title">Put the call on speaker</h3>
                  <p className="step__desc">
                    Hold the phone close enough that Kavach can hear the other person.
                  </p>
                </div>
              </div>
              <div className="step">
                <span className="step__num" aria-hidden="true">
                  2
                </span>
                <div>
                  <h3 className="step__title">Keep the phone here</h3>
                  <p className="step__desc">
                    Kavach follows the conversation and stops you if it hears a scam.
                  </p>
                </div>
              </div>
            </div>

            <section>
              <h2 className="section-head">{copy.listen_examples_title}</h2>
              <div className="examples">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="example"
                    onClick={() => playPreset(p)}
                  >
                    <span
                      className={`example__dot example__dot--${p.kind}`}
                      aria-hidden="true"
                    />
                    <span className="example__body">
                      <span className="example__title">{p.title}</span>
                      <span className="example__sub">{p.sub}</span>
                    </span>
                    <IconPlay size={18} className="choice__go" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>

            <div className="notice">
              <span className="notice__icon" aria-hidden="true">
                <IconInfo size={18} />
              </span>
              <div className="notice__body">
                <p className="notice__text">{copy.listen_privacy_note}</p>
              </div>
            </div>
          </>
        )}

        {(phase === 'listening' || phase === 'stopped') && (
          <>
            <MicState phase={phase} hearing={interim.length > 0} danger={danger} />

            <div className={`status-line ${statusTone}`} role="status" aria-live="polite">
              {statusText}
            </div>

            <Transcript
              finalText={finalText}
              interim={interim}
              tactics={result?.tactics ?? []}
              scrollRef={scrollRef}
            />

            {phase === 'stopped' && result && (
              <Findings result={result} text={finalText.slice(-WINDOW_CHARS)} />
            )}
          </>
        )}
      </div>

      <div className="screen__footer">
        {phase === 'priming' && (
          <button className="btn btn--primary" onClick={start}>
            <IconMic size={20} />
            <span>{copy.listen_start}</span>
          </button>
        )}

        {phase === 'listening' && (
          <button className="btn btn--secondary" onClick={stop}>
            <IconPhoneOff size={20} />
            <span>{copy.listen_stop}</span>
          </button>
        )}

        {(phase === 'stopped' || phase === 'denied' || phase === 'unsupported') && (
          <>
            <button className="btn btn--primary" onClick={reset}>
              <IconMic size={20} />
              <span>{copy.listen_start_again}</span>
            </button>
            {phase === 'stopped' && (
              <button className="btn btn--ghost" onClick={onBack}>
                {copy.cta_done}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
