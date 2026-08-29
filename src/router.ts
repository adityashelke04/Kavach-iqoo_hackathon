import { useCallback, useEffect, useState } from 'react'

/**
 * A ~40-line history router. Deliberately not react-router.
 *
 * Kavach has four screens that are really app states, plus a handful of dev
 * routes. What we actually need from routing is one thing: Android's back
 * button must leave the Verdict screen rather than closing the installed PWA
 * (§10.6). The History API gives us that directly.
 */
export function useRoute(): [string, (path: string) => void] {
  const [path, setPath] = useState(() => window.location.pathname)

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((next: string) => {
    if (next === window.location.pathname) return
    window.history.pushState({}, '', next)
    setPath(next)
  }, [])

  return [path, navigate]
}
