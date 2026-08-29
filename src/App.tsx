import { useCallback, useEffect, useRef, useState } from 'react'
import { useRoute } from './router'
import { Home } from './screens/Home'
import { Check } from './screens/Check'
import { Verdict } from './screens/Verdict'
import { Listen } from './screens/Listen'
import { Probe } from './dev/Probe'
import { Engines } from './dev/Engines'
import { Llm } from './dev/Llm'
import { analyzeProgressive } from './detector/orchestrator'
import { analyzeWithRules } from './detector/rules'
import { localSupported, preloadModel } from './detector/local'
import type { DetectionInput, DetectionResult } from './detector/types.ts'

const DEFAULT_SAMPLE_TEXT =
  'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. Update your KYC immediately at http://sbi-kyc-verify.in/update to avoid suspension.'
const DEFAULT_SAMPLE_SENDER = '+91 98765 43210'

/**
 * Screens compose, components render, the detector decides (§10.3).
 *
 * The analysis lives here rather than in `Check` because it outlives that
 * screen: the deterministic verdict navigates to the result immediately, and
 * the on-device model upgrades it tens of seconds later (D13). Running it
 * inside `Check` would mean setting state on a component that has unmounted.
 *
 * Routing is path-based so Android's back button leaves a screen rather than
 * closing the installed PWA.
 */
export default function App() {
  const [path, navigate] = useRoute()
  const [result, setResult] = useState<DetectionResult | null>(null)
  const [analysed, setAnalysed] = useState('')
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
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
      setAnalysed(input.text)

      let navigated = false
      try {
        await analyzeProgressive(input, (stage) => {
          // A newer check started; drop this one's updates.
          if (id !== runId.current) return

          setResult(stage.result)
          setPending(stage.pending)

          if (!navigated) {
            navigated = true
            setBusy(false)
            navigate('/result')
          }
        })
      } finally {
        if (id === runId.current) {
          setBusy(false)
          setPending(false)
        }
      }
    },
    [navigate],
  )

  if (path === '/dev/probe') return <Probe />
  if (path === '/dev/engines') return <Engines />
  if (path === '/dev/llm') return <Llm />

  if (path === '/listen') return <Listen onBack={() => navigate('/')} />

  if (path === '/result') {
    // Deep-linking straight to /result (or a reload) has nothing to show, so
    // fall back to the sample rather than a blank screen.
    const activeResult =
      result ??
      analyzeWithRules({ text: DEFAULT_SAMPLE_TEXT, sender: DEFAULT_SAMPLE_SENDER })

    return (
      <Verdict
        result={activeResult}
        text={analysed || DEFAULT_SAMPLE_TEXT}
        pending={pending}
        onBack={() => {
          runId.current++
          setResult(null)
          setPending(false)
          navigate('/')
        }}
        onAgain={() => {
          runId.current++
          setResult(null)
          setPending(false)
          navigate('/check')
        }}
      />
    )
  }

  if (path === '/check') {
    return <Check onBack={() => navigate('/')} onSubmit={runCheck} busy={busy} />
  }

  return <Home onCheck={() => navigate('/check')} onListen={() => navigate('/listen')} />
}
