import { useEffect, useRef } from 'react'

/**
 * Hold the screen awake while the device is doing our work — D22.
 *
 * **This is not a nicety. It is the difference between a verdict and a hang.**
 *
 * On-device inference runs in the page. Android freezes a backgrounded or
 * screen-off tab, and WebGPU work stops with it — but `Date.now()` does not, so
 * the Check screen's elapsed counter keeps climbing while nothing is being
 * computed. That is exactly what a tester saw on the iQOO: "325.5s" on screen,
 * the status line still reading "Reading your message on this phone…", the
 * weights fully resident (679 MB in storage, no download in flight), and no
 * verdict. The analysis had not failed. It had been paused by the screen going
 * off, and the timer had carried on without it.
 *
 * On an exhibition floor a person puts the phone down for a moment and the demo
 * dies silently. So: while an analysis is in flight, ask the platform to keep
 * the screen on.
 *
 * Everything here is best-effort and silent. `navigator.wakeLock` is absent on
 * plenty of browsers, the request is rejected outright when the document is not
 * visible, and the sentinel is released by the platform whenever the page is
 * hidden — so it is re-acquired on `visibilitychange`. Nothing here may throw
 * into the app, and nothing here is ever shown to the user: it is a fact about
 * the device, not something to explain (§8.3's spirit — the machinery stays
 * invisible).
 */

interface WakeLockSentinelLike {
  released: boolean
  release(): Promise<void>
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null
  const wl = (navigator as Navigator & { wakeLock?: unknown }).wakeLock
  return (wl as WakeLockLike | undefined) ?? null
}

/** True when the platform can keep the screen awake for us. */
export function wakeLockSupported(): boolean {
  return wakeLockApi() !== null
}

/**
 * Keep the screen awake for as long as `active` is true.
 *
 * Safe to call unconditionally; does nothing when unsupported.
 */
export function useWakeLock(active: boolean): void {
  const sentinel = useRef<WakeLockSentinelLike | null>(null)

  useEffect(() => {
    const api = wakeLockApi()
    if (!api || !active) return

    let cancelled = false

    const acquire = async () => {
      // The request is rejected when the document is hidden, which is fine —
      // `visibilitychange` below tries again the moment it comes back.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (sentinel.current && !sentinel.current.released) return
      try {
        sentinel.current = await api.request('screen')
      } catch {
        /* refused, unsupported, or the page lost focus mid-request */
      }
    }

    const onVisibility = () => {
      if (!cancelled && document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      const held = sentinel.current
      sentinel.current = null
      if (held && !held.released) {
        void held.release().catch(() => {
          /* already gone */
        })
      }
    }
  }, [active])
}

/**
 * How long the page spent hidden, so a duration can be reported honestly.
 *
 * The elapsed figure on the Check screen is wall-clock. When the screen sleeps
 * mid-analysis that figure stops describing the device's work and starts
 * describing how long the phone sat on a table. §9c is explicit that the app's
 * account of its own effort has to be honest, and a number inflated by a screen
 * lock is not.
 *
 * Returns a live getter rather than state: it is read inside an interval that
 * is already running, and re-rendering on every visibility flip would be noise.
 */
export function createHiddenTimeTracker(): { hiddenMs: () => number; stop: () => void } {
  if (typeof document === 'undefined') {
    return { hiddenMs: () => 0, stop: () => {} }
  }

  let total = 0
  let hiddenSince: number | null = document.visibilityState === 'hidden' ? Date.now() : null

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenSince ??= Date.now()
    } else if (hiddenSince !== null) {
      total += Date.now() - hiddenSince
      hiddenSince = null
    }
  }

  document.addEventListener('visibilitychange', onVisibility)

  return {
    hiddenMs: () => total + (hiddenSince === null ? 0 : Date.now() - hiddenSince),
    stop: () => document.removeEventListener('visibilitychange', onVisibility),
  }
}
