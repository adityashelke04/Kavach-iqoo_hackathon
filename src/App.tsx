import { useState } from 'react'
import { useRoute } from './router'
import { Home } from './screens/Home'
import { Check } from './screens/Check'
import { Verdict } from './screens/Verdict'
import { Listen } from './screens/Listen'
import { Probe } from './dev/Probe'
import { Engines } from './dev/Engines'
import type { DetectionResult } from './detector/types.ts'

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

  if (path === '/listen') {
    return <Listen onBack={() => navigate('/')} />
  }

  if (path === '/result' && result) {
    return (
      <Verdict
        result={result}
        text={analysed}
        onAgain={() => {
          setResult(null)
          navigate('/check')
        }}
      />
    )
  }

  // A refresh on /result loses the in-memory result — nothing is stored, by
  // design (§2). Fall back to the check screen rather than showing an error.
  if (path === '/check' || path === '/result') {
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
