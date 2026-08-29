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

  // Start the model download on app open rather than on first analysis, so the
  // first check is not also the first load (D6, §9).
  useEffect(() => {
    void localSupported().then((ok) => {
      if (ok) preloadModel()
    })
  }, [])

  const runCheck = useCallback(
    async (input: DetectionInput) => {
      const id = ++runId.current
      setBusy(true)
      setPhase(null)
      setAnalysed(input.text)

      try {
        const detected = await analyze(input, enginePreference, undefined, (p) => {
          if (id === runId.current) setPhase(p)
        })
        if (id !== runId.current) return
        setResult(detected)
        setBusy(false)
        setPhase(null)
        navigate('/result')
      } finally {
        if (id === runId.current) {
          setBusy(false)
          setPhase(null)
        }
      }
    },
    [navigate, enginePreference],
  )

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
    return <Check onBack={() => navigate('/')} onSubmit={runCheck} busy={busy} phase={phase} />
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
