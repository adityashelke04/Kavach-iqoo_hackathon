import { useEffect, useState } from 'react'

/**
 * Whether the phone currently has a network — SPEC.md §11 P8, §9b.
 *
 * This exists for one sentence on Home. The signature demo beat is airplane
 * mode (§13 beat 4), and during it the app's central claim stops being a claim
 * and becomes a fact the phone itself can confirm. Saying so on screen at that
 * moment is worth more than any amount of copy saying it in advance.
 *
 * `navigator.onLine` is famously weak — it reports the link, not reachability,
 * so it can say `true` on a captive portal. It is exactly right here anyway:
 * airplane mode is precisely the case it reports correctly, and nothing in the
 * app *behaves* differently based on it. This drives one line of text.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => {
    try {
      return navigator.onLine
    } catch {
      return true // unknown means say nothing special
    }
  })

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}
