import type { ReactNode } from 'react'

/**
 * Primitives — SPEC.md §10.3. Token-driven, no hard-coded values.
 * Android-first: 48dp+ tap targets, pure vector SVG glyphs, zero emojis.
 */

export function AppBar({
  title,
  onBack,
  action,
}: {
  title: string
  onBack?: () => void
  action?: ReactNode
}) {
  return (
    <header className="appbar">
      {onBack && (
        <button className="appbar__back" onClick={onBack} aria-label="Go back">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      <h2 className="appbar__title">{title}</h2>
      {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
    </header>
  )
}

export * from '../icons.tsx'
