import { useState } from 'react'
import { useRoute } from './router'
import { Home } from './screens/Home'
import { Check } from './screens/Check'
import { Verdict } from './screens/Verdict'
import { Listen } from './screens/Listen'
import { Probe } from './dev/Probe'
import { Engines } from './dev/Engines'
import { Llm } from './dev/Llm'
import { analyzeWithRules } from './detector/rules'
import type { DetectionResult } from './detector/types.ts'

const DEFAULT_SAMPLE_TEXT =
  'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. Update your KYC immediately at http://sbi-kyc-verify.in/update to avoid suspension.'
const DEFAULT_SAMPLE_SENDER = '+91 98765 43210'

/**
 * Screens compose, components render, the detector decides (§10.3).
 *
 * Routing is path-based so Android's back button leaves a screen rather than
 * closing the installed PWA.
 */
export default function App() {
  const [path, navigate] = useRoute()
  const [result, setResult] = useState<DetectionResult | null>(null)
  const [analysed, setAnalysed] = useState('')

  if (path === '/dev/probe') return <Probe />
  if (path === '/dev/engines') return <Engines />
  if (path === '/dev/llm') return <Llm />

  if (path === '/listen') {
    return <Listen onBack={() => navigate('/')} />
  }

  if (path === '/result') {
    const activeResult =
      result ??
      analyzeWithRules({
        text: DEFAULT_SAMPLE_TEXT,
        sender: DEFAULT_SAMPLE_SENDER,
      })
    const activeText = analysed || DEFAULT_SAMPLE_TEXT

    return (
      <Verdict
        result={activeResult}
        text={activeText}
        onAgain={() => {
          setResult(null)
          navigate('/check')
        }}
      />
    )
  }

  if (path === '/check') {
    return (
      <Check
        onBack={() => navigate('/')}
        onResult={(r, text) => {
          setResult(r)
          setAnalysed(text)
          navigate('/result')
        }}
      />
    )
  }

  return <Home onCheck={() => navigate('/check')} onListen={() => navigate('/listen')} />
}
