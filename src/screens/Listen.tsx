import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyze } from '../detector/orchestrator.ts'
import { analyzeWithRules } from '../detector/rules.ts'
import type { DetectionResult, Tactic } from '../detector/types.ts'
import { buildSegments, resolveAllEvidence } from '../detector/evidence.ts'
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
 * Ambient in-call scam detection:
 * 1. Semantic, interactive record button with tactile feedback and full accessibility.
 * 2. Real-time microphone audio metering via Web Audio API (AudioContext + AnalyserNode)
 *    driving a 60fps 12-bar equalizer.
 * 3. Dual-track streaming speech recognition (en-IN / hi-IN / Hinglish) with fast-track
 *    conclusive pattern scanning (<350ms) to trigger instant danger interrupts.
 * 4. Coordinate-accurate evidence highlighting and full transcript preservation.
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

const FAST_EVAL_MS = 350
const DEBOUNCE_MS = 1400
const WINDOW_CHARS = 600

type Phase = 'priming' | 'listening' | 'denied' | 'unsupported' | 'stopped'

interface CallPreset {
  id: string
  title: string
  sub: string
  kind: 'scam' | 'legit'
  text: string
}

/** Recorded calls in English, Hindi Devanagari, and Hinglish for instant testing. */
const PRESETS: CallPreset[] = [
  {
    id: 'digital-arrest-en',
    title: 'A fake police call',
    sub: 'Says there is a case against your Aadhaar',
    kind: 'scam',
    text: 'madam this is sub inspector from cyber crime branch your aadhaar number has been used in a money laundering case this is a confidential investigation do not tell anyone in your family we are recording this call stay on the line',
  },
  {
    id: 'sbi-otp-scam-en',
    title: 'A fake bank call',
    sub: 'Asks you to read out a code',
    kind: 'scam',
    text: 'hello sir i am calling from the state bank of india head office your account has been temporarily suspended please listen to me carefully do not disconnect the call i will send you a code on your phone just read out the o t p to me for verification',
  },
  {
    id: 'digital-arrest-hi',
    title: 'डिजिटल अरेस्ट कॉल (Hindi)',
    sub: 'साइबर क्राइम सेल और गिरफ्तारी की धमकी',
    kind: 'scam',
    text: 'मैं साइबर क्राइम सेल दिल्ली पुलिस से सब इंस्पेक्टर बोल रहा हूँ आपके आधार कार्ड से मनी लॉन्ड्रिंग का केस दर्ज हुआ है यह एक गोपनीय जांच है किसी से बात मत करिए कमरे का दरवाजा बंद रखिए और वीडियो कॉल पर आइए',
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
   Microphone state & Audio Visualizer
   ========================================================================== */

function MicState({
  phase,
  hearing,
  danger,
  onToggle,
  barsRef,
}: {
  phase: Phase
  hearing: boolean
  danger: boolean
  onToggle?: () => void
  barsRef?: React.MutableRefObject<(HTMLSpanElement | null)[]>
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

  const isClickable = phase !== 'unsupported'
  const ariaLabel =
    phase === 'listening'
      ? copy.listen_stop
      : phase === 'stopped'
        ? copy.listen_start_again
        : copy.listen_start

  return (
    <div className={`mic ${mod}`}>
      <button
        type="button"
        className="mic__core"
        onClick={onToggle}
        disabled={!isClickable}
        aria-label={ariaLabel}
        title={phase === 'listening' ? 'Tap to stop recording' : 'Tap to start recording'}
      >
        <span className="mic__ring" aria-hidden="true" />
        <span className="mic__ring" aria-hidden="true" />
        {danger ? <IconShieldX size={36} /> : <IconMic size={36} />}
      </button>

      <div className={`level ${phase === 'listening' ? 'level--active' : ''}`} aria-hidden="true">
        {Array.from({ length: 12 }).map((_, i) => (
          <span
            key={i}
            ref={(el) => {
              if (barsRef) barsRef.current[i] = el
            }}
            className="level__bar"
          />
        ))}
      </div>

      <p className="mic__caption">{caption}</p>
    </div>
  )
}

/* ==========================================================================
   Live transcript with Evidence Highlighting
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
    const spans = resolveAllEvidence(finalText, tactics)
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
                <mark key={i} className="evidence-mark" title={`Detected tactic: ${s.tactics.join(', ')}`}>
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
  const lastFastRunAt = useRef(0)
  const lastSlowRunAt = useRef(0)
  const lastRunLen = useRef(0)
  const transcriptRef = useRef('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const simTimerRef = useRef<number | null>(null)
  const restartTimerRef = useRef<number | null>(null)
  const simWaveTimerRef = useRef<number | null>(null)

  // Web Audio & Metering refs
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const barsRef = useRef<(HTMLSpanElement | null)[]>([])

  const stopAudioMeter = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    if (simWaveTimerRef.current !== null) {
      window.clearInterval(simWaveTimerRef.current)
      simWaveTimerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (audioCtxRef.current) {
      try {
        void audioCtxRef.current.close()
      } catch {}
      audioCtxRef.current = null
    }
    analyserRef.current = null
    // Reset equalizer bars smoothly
    barsRef.current.forEach((bar) => {
      if (bar) bar.style.transform = 'scaleY(0.18)'
    })
  }, [])

  const startAudioMeter = useCallback(async () => {
    stopAudioMeter()
    try {
      if (!navigator.mediaDevices?.getUserMedia) return true

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream

      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return true

      const ctx = new AudioContextClass()
      audioCtxRef.current = ctx
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }

      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.75
      source.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateLoop = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(dataArray)

        // Map vocal spectrum across 12 bars
        for (let i = 0; i < 12; i++) {
          const bar = barsRef.current[i]
          if (!bar) continue
          const binIndex = i < 6 ? i + 1 : 12 - i
          const rawVal = dataArray[binIndex] || 0
          const scaled = Math.max(0.18, Math.min(1.0, (rawVal / 255) * 1.5))
          bar.style.transform = `scaleY(${scaled.toFixed(2)})`
        }
        rafIdRef.current = requestAnimationFrame(updateLoop)
      }
      updateLoop()
      return true
    } catch (err) {
      console.warn('[kavach] microphone metering notice:', err)
      return true // Continue to Web Speech API even if Web Audio stream failed
    }
  }, [stopAudioMeter])

  /** Simulated audio visualizer wave for preset demonstration */
  const startSimulatedWave = useCallback(() => {
    stopAudioMeter()
    let step = 0
    simWaveTimerRef.current = window.setInterval(() => {
      step += 0.25
      for (let i = 0; i < 12; i++) {
        const bar = barsRef.current[i]
        if (!bar) continue
        const energy = Math.sin(step + i * 0.45) * 0.4 + Math.cos(step * 0.7 + i * 0.3) * 0.3 + 0.5
        const scaled = Math.max(0.18, Math.min(1.0, energy))
        bar.style.transform = `scaleY(${scaled.toFixed(2)})`
      }
    }, 70)
  }, [stopAudioMeter])

  /**
   * Fast, deterministic analysis for live stream & full stack on stop.
   */
  const runDetection = useCallback(
    async (buffer: string, deep = false) => {
      if (!buffer.trim()) return
      setAnalyzing(true)
      try {
        if (deep) {
          const res = await analyze({ text: buffer, channel: 'voice' }, 'local')
          setResult(res)
          if (res.verdict === 'danger') setInterrupted(true)
        } else {
          const res = analyzeWithRules({ text: buffer, channel: 'voice' })
          setResult((prev) => {
            // Latch danger/caution so transient silence does not downgrade a flagged warning
            if (prev?.verdict === 'danger' && res.verdict !== 'danger') return prev
            return res
          })
          if (res.verdict === 'danger') setInterrupted(true)
        }
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
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
    try {
      recRef.current?.stop()
    } catch {
      /* already stopped */
    }
    recRef.current = null
    stopAudioMeter()
    setPhase('stopped')

    // Run complete deep analysis over the entire accumulated transcript
    const fullTranscript = transcriptRef.current.trim()
    if (fullTranscript) void runDetection(fullTranscript, true)
  }, [runDetection, stopAudioMeter])

  const start = useCallback(async () => {
    if (simTimerRef.current !== null) {
      window.clearInterval(simTimerRef.current)
      simTimerRef.current = null
    }
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }

    const Ctor = getSpeechCtor()
    if (!Ctor) {
      setPhase('unsupported')
      return
    }

    // 1. Prime microphone hardware & equalizer
    await startAudioMeter()

    // 2. Setup speech recognition lifecycle
    const setupRecognition = () => {
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
        }

        // Active buffer combines finalized transcript and streaming interim text
        const activeText = `${transcriptRef.current} ${pending}`.trim()
        const buffer = activeText.slice(-WINDOW_CHARS)
        const now = Date.now()

        // Fast-path: Rapid conclusive rule check (<350ms)
        if (now - lastFastRunAt.current > FAST_EVAL_MS && buffer.length > 10) {
          lastFastRunAt.current = now
          void runDetection(buffer, false)
        }

        // Standard-path: Periodic evaluation on buffer growth
        const grewEnough = buffer.length - lastRunLen.current > 15
        if (addition && now - lastSlowRunAt.current > DEBOUNCE_MS && grewEnough) {
          lastSlowRunAt.current = now
          lastRunLen.current = buffer.length
          void runDetection(buffer, false)
        }
      }

      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          wantRunning.current = false
          stopAudioMeter()
          setPhase('denied')
        }
      }

      rec.onend = () => {
        if (!wantRunning.current) return
        // Throttled restart prevents runaway CPU loops on Android Chrome silence dropouts
        restartTimerRef.current = window.setTimeout(() => {
          if (wantRunning.current) {
            try {
              setupRecognition()
            } catch {}
          }
        }, 150)
      }

      recRef.current = rec
      try {
        rec.start()
        setPhase('listening')
      } catch {
        setPhase('denied')
      }
    }

    wantRunning.current = true
    setupRecognition()
  }, [lang, runDetection, startAudioMeter, stopAudioMeter])

  const reset = useCallback(() => {
    stop()
    setResult(null)
    transcriptRef.current = ''
    setFinalText('')
    setInterim('')
    lastRunLen.current = 0
    lastFastRunAt.current = 0
    lastSlowRunAt.current = 0
    setPhase('priming')
  }, [stop])

  const toggleMic = useCallback(() => {
    if (phase === 'listening') {
      stop()
    } else if (phase === 'stopped') {
      reset()
    } else {
      void start()
    }
  }, [phase, start, stop, reset])

  /** Streams a recorded call into the transcript with dynamic equalizer simulation. */
  const playPreset = useCallback(
    (preset: CallPreset) => {
      stop()
      setResult(null)
      transcriptRef.current = ''
      setFinalText('')
      setInterim('')
      lastRunLen.current = 0
      lastFastRunAt.current = 0
      lastSlowRunAt.current = 0
      setPhase('listening')
      startSimulatedWave()

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
          const grewEnough = buffer.length - lastRunLen.current > 15
          if ((now - lastFastRunAt.current > 400 && grewEnough) || index === words.length) {
            lastFastRunAt.current = now
            lastRunLen.current = buffer.length
            void runDetection(buffer, false)
          }
        } else {
          if (simTimerRef.current !== null) {
            window.clearInterval(simTimerRef.current)
            simTimerRef.current = null
          }
          if (simWaveTimerRef.current !== null) {
            window.clearInterval(simWaveTimerRef.current)
            simWaveTimerRef.current = null
          }
          setInterim('')
        }
      }, 90)
    },
    [stop, runDetection, startSimulatedWave],
  )

  useEffect(() => {
    return () => {
      wantRunning.current = false
      if (simTimerRef.current !== null) {
        window.clearInterval(simTimerRef.current)
        simTimerRef.current = null
      }
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current)
        restartTimerRef.current = null
      }
      stopAudioMeter()
      try {
        recRef.current?.stop()
      } catch {
        /* cleanup */
      }
    }
  }, [stopAudioMeter])

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
              <MicState
                phase={phase}
                hearing={false}
                danger={false}
                onToggle={toggleMic}
                barsRef={barsRef}
              />
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
            <MicState
              phase={phase}
              hearing={interim.length > 0}
              danger={danger}
              onToggle={toggleMic}
              barsRef={barsRef}
            />

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
              <Findings result={result} text={finalText} />
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
