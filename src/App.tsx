import { useCallback, useEffect, useRef, useState } from 'react'
import { useRoute } from './router'
import { Home } from './screens/Home'
import { Check } from './screens/Check'
import { Verdict } from './screens/Verdict'
import { Report } from './screens/Report'
import { Listen } from './screens/Listen'
import { Probe } from './dev/Probe'
import { Engines } from './dev/Engines'
import { Llm } from './dev/Llm'
import { Local } from './dev/Local'
import { analyze, type AnalysisPhase, type EnginePreference } from './detector/orchestrator'
import { analyzeWithRules } from './detector/rules'
import { localSupported, preloadModel } from './detector/local'
import type { DetectionInput, DetectionResult } from './detector/types.ts'

const DEFAULT_SAMPLE_TEXT =
  'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. Update your KYC immediately at http://sbi-kyc-verify.in/update to avoid suspension.'
const DEFAULT_SAMPLE_SENDER = '+91 98765 43210'

/**
 * Screens compose, components render, the detector decides (§10.3).
 *
 * The analysis still lives here rather than in `Check` so that navigating
 * away and back (or a cancelled and restarted check) is unambiguous via
 * `runId` — but under D15 it no longer needs to outlive the screen the way
 * D13's progressive upgrade did: `analyze()` resolves once, and `App`
 * navigates to `/result` exactly once, with the final result.
 *
 * Routing is path-based so Android's back button leaves a screen rather than
 * closing the installed PWA.
 */
export default function App() {
  const [path, navigate] = useRoute()
  const [result, setResult] = useState<DetectionResult | null>(null)
  const [analysed, setAnalysed] = useState('')
  const [phase, setPhase] = useState<AnalysisPhase | null>(null)
  const [busy, setBusy] = useState(false)
  const [enginePreference, setEnginePreference] = useState<EnginePreference>('local')
  const runId = useRef(0)

  /**
   * The live analysis, so that leaving actually leaves (D20).
   *
   * `analyze()` has always taken an `AbortSignal` and every engine has always
   * honoured it; until D20 this file simply passed `undefined`. The result was
   * a check that could not be stopped by anything a user can do. Tap Check,
   * then tap back: `busy` stayed true, so returning to the screen showed the
   * same spinner mid-flight; the on-device model kept generating on the GPU the
   * next check needed; and Listen mode, opened from Home, was queued behind a
   * generation for a screen that had been closed a minute earlier.
   *
   * `runId` was already here and was already correct — it stops a stale result
   * being *shown*. It has no way to stop the work, which is the part that costs
   * a phone its battery and the next screen its GPU. The two are needed
   * together.
   */
  const abort = useRef<AbortController | null>(null)

  // Start the model download on app open rather than on first analysis, so the
  // first check is not also the first load (D6, §9).
  useEffect(() => {
    void localSupported().then((ok) => {
      if (ok) preloadModel()
    })
  }, [])

  /**
   * Stop whatever is in flight, and stop showing that anything is.
   *
   * Safe to call when nothing is running — which is why the route effect below
   * can call it on every navigation without asking questions first.
   */
  const cancelRun = useCallback(() => {
    runId.current++
    abort.current?.abort()
    abort.current = null
    setBusy(false)
    setPhase(null)
  }, [])

  const runCheck = useCallback(
    async (input: DetectionInput) => {
      // A second check while one is in flight replaces it rather than joining a
      // queue behind it. WebLLM serialises generations on its single engine, so
      // without this the new message waits out the old one before it starts.
      abort.current?.abort()

      const id = ++runId.current
      const controller = new AbortController()
      abort.current = controller
      setBusy(true)
      setPhase(null)
      setAnalysed(input.text)

      try {
        const detected = await analyze(input, enginePreference, controller.signal, (p) => {
          if (id === runId.current) setPhase(p)
        })
        if (id !== runId.current) return
        setResult(detected)
        setBusy(false)
        setPhase(null)
        navigate('/result')
      } finally {
        if (id === runId.current) {
          abort.current = null
          setBusy(false)
          setPhase(null)
        }
      }
    },
    [navigate, enginePreference],
  )

  /**
   * Leaving the Check screen cancels the check. Every way of leaving it.
   *
   * This is an effect on `path` rather than a handler on the back button
   * because Android's back button does not go through `navigate()` — it fires
   * `popstate`, which the router turns straight into a new `path` (see
   * `router.ts`). A handler would have covered the on-screen arrow and missed
   * the one people actually press.
   *
   * `analyze()` resolves rather than rejects on an aborted engine — silent
   * fallback is §6's contract — so the guard is `runId`, already bumped by
   * `cancelRun` before the abort lands.
   */
  useEffect(() => {
    if (path === '/check') return
    if (!abort.current) return
    cancelRun()
  }, [path, cancelRun])

  const triggerFailsafe = useCallback(() => {
    runId.current++
    setAnalysed(DEFAULT_SAMPLE_TEXT)
    setResult(analyzeWithRules({ text: DEFAULT_SAMPLE_TEXT, sender: DEFAULT_SAMPLE_SENDER }))
    navigate('/result')
  }, [navigate])

  if (path === '/dev/probe') return <Probe />
  if (path === '/dev/engines') return <Engines />
  if (path === '/dev/llm') return <Llm />
  if (path === '/dev/local') return <Local />

  if (path === '/listen')
    return <Listen onBack={() => navigate('/')} enginePreference={enginePreference} />

  if (path === '/result' || path === '/report') {
    // Deep-linking straight to /result (or a reload) has nothing to show, so
    // fall back to the sample rather than a blank screen.
    const activeResult =
      result ??
      analyzeWithRules({ text: DEFAULT_SAMPLE_TEXT, sender: DEFAULT_SAMPLE_SENDER })
    const activeText = analysed || DEFAULT_SAMPLE_TEXT

    // The report is built from the same two values the Verdict screen already
    // holds, so nothing is stored and §2's no-archive stance is untouched (D16).
    // Back from here returns to the verdict rather than to Home, which is what
    // Android's back button should do from a screen you opened off it.
    if (path === '/report') {
      return (
        <Report result={activeResult} text={activeText} onBack={() => navigate('/result')} />
      )
    }

    return (
      <Verdict
        result={activeResult}
        text={activeText}
        onBack={() => {
          runId.current++
          navigate('/')
        }}
        onAgain={() => {
          runId.current++
          navigate('/check')
        }}
        onReport={() => navigate('/report')}
      />
    )
  }

  if (path === '/check') {
    return (
      <Check
        onBack={() => {
          cancelRun()
          navigate('/')
        }}
        onCancel={cancelRun}
        onSubmit={runCheck}
        busy={busy}
        phase={phase}
      />
    )
  }

  return (
    <Home
      onCheck={() => navigate('/check')}
      onListen={() => navigate('/listen')}
      enginePreference={enginePreference}
      onEnginePreferenceChange={setEnginePreference}
      onFailsafe={triggerFailsafe}
    />
  )
}
