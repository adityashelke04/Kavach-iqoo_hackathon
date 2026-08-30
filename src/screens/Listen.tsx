import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyze, type EnginePreference } from '../detector/orchestrator.ts'
import { analyzeWithRules } from '../detector/rules.ts'
import type { DetectionResult, Tactic } from '../detector/types.ts'
import { buildSegments, resolveAllEvidence } from '../detector/evidence.ts'
import { Findings } from '../ui/components/index.tsx'
import { NextLines } from '../ui/components/NextLines.tsx'
import { predictNextLines } from '../predict/match.ts'
import type { Prediction } from '../predict/types.ts'
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
 * 2. A 12-bar meter driven by what the recogniser hears. It used to read the
 *    waveform through a parallel `getUserMedia` capture, which is exactly what
 *    starved the Android recogniser of the microphone — see MIC_RELEASE_MS.
 *    Exactly one thing on this screen opens the microphone at a time.
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
  /** Present in Chrome; ends the session without waiting to flush a result. */
  abort?(): void
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

/**
 * How long Android needs to hand the microphone over.
 *
 * On Android, `webkitSpeechRecognition` is not in-process: Chrome brokers it to
 * Google Speech Services, a separate app that opens the microphone itself. The
 * handle is exclusive. If this page is still holding a `getUserMedia` capture
 * when the recognizer starts, that app loses the race and reports
 * "Chrome is currently recording audio" — so we release the stream, wait for
 * the platform to actually let go, and only then start recognition.
 */
const MIC_RELEASE_MS = 300

/** Restart backoff after a recognition end, and the ceiling on retrying. */
const RESTART_BASE_MS = 250
const RESTART_MAX_MS = 4000
const MAX_CONSECUTIVE_FAILURES = 4

type Phase = 'priming' | 'listening' | 'denied' | 'busy' | 'unsupported' | 'stopped'

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
  prediction,
  onDismiss,
  onExit,
}: {
  result: DetectionResult
  /**
   * The predicted script (D17), when one matched the transcript so far.
   *
   * This is the screen the whole prediction idea is for. The call is still
   * live: naming the next three lines *before* the caller says them turns a
   * warning into something the person can check for themselves, in real time.
   * When the caller then says one of them, the call is over.
   */
  prediction?: Prediction | null
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

        {prediction && <NextLines prediction={prediction} verdict={result.verdict} />}
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

export function Listen({
  onBack,
  enginePreference = 'local',
}: {
  onBack: () => void
  enginePreference?: EnginePreference
}) {
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

  // Metering refs
  const rafIdRef = useRef<number | null>(null)
  const barsRef = useRef<(HTMLSpanElement | null)[]>([])
  /** Timestamp of the last thing the recogniser actually heard. Drives the meter. */
  const lastVoiceAtRef = useRef(0)
  /** Consecutive failed starts, reset by the first result that arrives. */
  const failureCountRef = useRef(0)

  /**
   * Generation counter for detection runs.
   *
   * Stopping starts a deep analysis of the whole transcript, which can take
   * seconds on the on-device engine. Reset and the call presets both clear the
   * transcript immediately afterwards, so without this an in-flight analysis of
   * the *previous* call would land on the new one — up to and including raising
   * its danger interrupt over a legitimate message.
   */
  const runGenRef = useRef(0)

  const stopAudioMeter = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    if (simWaveTimerRef.current !== null) {
      window.clearInterval(simWaveTimerRef.current)
      simWaveTimerRef.current = null
    }
    lastVoiceAtRef.current = 0
    // Reset equalizer bars smoothly
    barsRef.current.forEach((bar) => {
      if (bar) bar.style.transform = 'scaleY(0.18)'
    })
  }, [])

  /**
   * Ask for the microphone, then give it straight back.
   *
   * This exists only to raise the permission prompt against this origin and to
   * keep the grant durable. It deliberately does *not* hold the stream: an open
   * capture is what starves Google Speech Services of the microphone on Android
   * (see MIC_RELEASE_MS). We stop every track immediately and wait for the
   * platform to release the handle before the recogniser asks for it.
   */
  const primeMicPermission = useCallback(async (): Promise<'granted' | 'denied' | 'unknown'> => {
    if (!navigator.mediaDevices?.getUserMedia) return 'unknown'
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      return 'granted'
    } catch (err) {
      const name = (err as { name?: string } | null)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
      // NotFoundError, NotReadableError, or anything else: let the recogniser
      // try anyway and report what it actually hits.
      console.warn('[kavach] microphone prime notice:', err)
      return 'unknown'
    } finally {
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  /**
   * The twelve bars, driven by what the recogniser hears rather than by a
   * second capture of the same microphone.
   *
   * We cannot read the waveform without holding the stream open, and holding it
   * open is the bug. So the meter follows recognition activity: it swells while
   * speech is arriving and settles to rest after roughly a second of quiet. It
   * is an honest "Kavach can hear this" indicator, not a claimed amplitude.
   */
  const startActivityMeter = useCallback(() => {
    stopAudioMeter()
    let step = 0
    const loop = () => {
      step += 0.22
      const sinceVoice = lastVoiceAtRef.current ? Date.now() - lastVoiceAtRef.current : Infinity
      // Full swing while speech is live, fading out over the second after it.
      const activity = sinceVoice > 1000 ? 0 : 1 - sinceVoice / 1000
      for (let i = 0; i < 12; i++) {
        const bar = barsRef.current[i]
        if (!bar) continue
        const wave = Math.sin(step + i * 0.45) * 0.4 + Math.cos(step * 0.7 + i * 0.3) * 0.3 + 0.5
        const scaled = Math.max(0.18, Math.min(1, 0.18 + wave * activity))
        bar.style.transform = `scaleY(${scaled.toFixed(2)})`
      }
      rafIdRef.current = requestAnimationFrame(loop)
    }
    loop()
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
      // Anything that clears the transcript bumps the generation; a run started
      // against an older one must not touch the screen when it finally resolves.
      const gen = runGenRef.current
      setAnalyzing(true)
      try {
        if (deep) {
          const res = await analyze({ text: buffer, channel: 'voice' }, enginePreference)
          if (gen !== runGenRef.current) return
          setResult(res)
          if (res.verdict === 'danger') setInterrupted(true)
        } else {
          const res = analyzeWithRules({ text: buffer, channel: 'voice' })
          if (gen !== runGenRef.current) return
          setResult((prev) => {
            // Latch danger/caution so transient silence does not downgrade a flagged warning
            if (prev?.verdict === 'danger' && res.verdict !== 'danger') return prev
            return res
          })
          if (res.verdict === 'danger') setInterrupted(true)
        }
      } finally {
        if (gen === runGenRef.current) setAnalyzing(false)
      }
    },
    [enginePreference],
  )

  /**
   * Hand the microphone back, all the way.
   *
   * Dropping the reference is not enough. An abandoned recogniser keeps its
   * handlers, keeps delivering buffered results into a transcript we have
   * already cleared, and — on Android — keeps Google Speech Services holding
   * the microphone. Detach every callback first so a late event cannot fire,
   * then `abort()` (which ends the session at once) in preference to `stop()`
   * (which waits to flush a final result, and so holds the handle longer).
   */
  const teardownRecognition = useCallback(() => {
    const rec = recRef.current
    recRef.current = null
    if (!rec) return
    rec.onresult = null
    rec.onerror = null
    rec.onend = null
    try {
      if (typeof rec.abort === 'function') rec.abort()
      else rec.stop()
    } catch {
      /* already ended */
    }
  }, [])

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
    teardownRecognition()
    stopAudioMeter()
    setPhase('stopped')

    // Run complete deep analysis over the entire accumulated transcript
    const fullTranscript = transcriptRef.current.trim()
    if (fullTranscript) void runDetection(fullTranscript, true)
  }, [runDetection, stopAudioMeter, teardownRecognition])

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

    // Never leave a previous session holding the microphone.
    teardownRecognition()

    // 1. Take the permission grant, then give the hardware straight back and
    //    let Android settle before the recogniser asks for it.
    const permission = await primeMicPermission()
    if (permission === 'denied') {
      wantRunning.current = false
      stopAudioMeter()
      setPhase('denied')
      return
    }
    await new Promise((r) => setTimeout(r, MIC_RELEASE_MS))

    // 2. Setup speech recognition lifecycle
    const setupRecognition = () => {
      const rec = new Ctor()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = lang

      rec.onresult = (e) => {
        // A result means the recogniser really did start and really is hearing
        // the call: the session is healthy, so forget any earlier failures.
        failureCountRef.current = 0
        lastVoiceAtRef.current = Date.now()

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
        // 'no-speech' is not a failure — it is a quiet moment on the call, and
        // the ordinary restart below picks the session straight back up.
        if (e.error === 'no-speech' || e.error === 'aborted') return

        failureCountRef.current += 1

        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          wantRunning.current = false
          stopAudioMeter()
          setPhase('denied')
          return
        }

        // 'audio-capture': something else on the phone holds the microphone —
        // another tab, the dialer, a recorder app. Retrying at speed is what
        // produced the repeating "Chrome is currently recording audio" toast,
        // so back off, and after a few attempts stop and say so plainly.
        if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
          wantRunning.current = false
          stopAudioMeter()
          setPhase(e.error === 'audio-capture' ? 'busy' : 'stopped')
        }
      }

      rec.onend = () => {
        if (recRef.current === rec) recRef.current = null
        if (!wantRunning.current) return

        // Let the platform release the microphone before asking for it again,
        // and lengthen the wait each time a restart fails in a row.
        const backoff = Math.min(
          RESTART_MAX_MS,
          RESTART_BASE_MS * 2 ** failureCountRef.current + MIC_RELEASE_MS,
        )
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null
          if (!wantRunning.current) return
          try {
            setupRecognition()
          } catch {
            failureCountRef.current += 1
          }
        }, backoff)
      }

      recRef.current = rec
      try {
        rec.start()
        setPhase('listening')
      } catch {
        // Chrome throws InvalidStateError if a session is somehow still live.
        failureCountRef.current += 1
        recRef.current = null
        if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
          wantRunning.current = false
          stopAudioMeter()
          setPhase('busy')
        }
      }
    }

    failureCountRef.current = 0
    wantRunning.current = true
    startActivityMeter()
    setupRecognition()
  }, [
    lang,
    runDetection,
    primeMicPermission,
    startActivityMeter,
    stopAudioMeter,
    teardownRecognition,
  ])

  /**
   * Wipe the session down to nothing.
   *
   * The generation bump matters as much as the clearing does: `stop()` has just
   * kicked off a deep analysis of the transcript we are about to discard, and
   * that analysis must not be allowed to land on whatever comes next.
   */
  const clearSession = useCallback(() => {
    runGenRef.current += 1
    setResult(null)
    setInterrupted(false)
    setAnalyzing(false)
    transcriptRef.current = ''
    setFinalText('')
    setInterim('')
    lastRunLen.current = 0
    lastFastRunAt.current = 0
    lastSlowRunAt.current = 0
    failureCountRef.current = 0
  }, [])

  const reset = useCallback(() => {
    stop()
    clearSession()
    setPhase('priming')
  }, [stop, clearSession])

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
      // A preset is a different mode: tear the live session down first, so no
      // recogniser is left holding the microphone behind the recorded call.
      stop()
      clearSession()
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
    [stop, clearSession, runDetection, startSimulatedWave],
  )

  useEffect(() => {
    return () => {
      wantRunning.current = false
      // Leaving the screen invalidates any analysis still in flight.
      runGenRef.current += 1
      if (simTimerRef.current !== null) {
        window.clearInterval(simTimerRef.current)
        simTimerRef.current = null
      }
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current)
        restartTimerRef.current = null
      }
      stopAudioMeter()
      teardownRecognition()
    }
  }, [stopAudioMeter, teardownRecognition])

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
        // channel 'voice': speech recognition spells acronyms out and drops
        // punctuation, and a couple of playbooks read differently on a call
        // than in an SMS (§5.6).
        prediction={predictNextLines({
          text: finalText,
          tactics: result.tactics,
          channel: 'voice',
        })}
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

  const idle =
    phase === 'priming' || phase === 'denied' || phase === 'busy' || phase === 'unsupported'

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

        {phase === 'busy' && (
          <div className="notice notice--caution">
            <span className="notice__icon" aria-hidden="true">
              <IconAlertTriangle size={20} />
            </span>
            <div className="notice__body">
              <h2 className="notice__title">{copy.listen_busy}</h2>
              <p className="notice__text">{copy.listen_busy_note}</p>
            </div>
          </div>
        )}

        {idle && (
          <>
            {(phase === 'priming' || phase === 'busy') && (
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
              <Findings
                result={result}
                text={finalText}
                prediction={predictNextLines({
                  text: finalText,
                  tactics: result.tactics,
                  channel: 'voice',
                })}
              />
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
