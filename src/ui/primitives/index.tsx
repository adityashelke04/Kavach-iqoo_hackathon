/**
 * Primitives — SPEC.md §10.3. Token-driven, no hard-coded values.
 * Swapping this file is the "re-skin" step of the redesign runbook (§15).
 */

/**
 * Android-first top bar. The back affordance is present but small — the
 * system back button/gesture is the primary way back, which the router
 * supports via the History API.
 */
export function AppBar({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="appbar">
      {onBack && (
        <button className="appbar__back" onClick={onBack} aria-label="Go back">
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      <h2 className="appbar__title">{title}</h2>
    </header>
  )
}
