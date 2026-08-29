import { useRoute } from './router'
import { Probe } from './dev/Probe'
import { Engines } from './dev/Engines'

/**
 * P0 shell. Home is a placeholder until P6 (SPEC.md §11).
 *
 * Dev routes are listed here rather than hidden, because the whole point of
 * them is that they are reachable from the phone during the build.
 */
export default function App() {
  const [path, navigate] = useRoute()

  if (path === '/dev/probe') return <Probe />
  if (path === '/dev/engines') return <Engines />

  return (
    <main
      style={{
        maxWidth: 'var(--content-max)',
        margin: '0 auto',
        padding: 'var(--sp-6) var(--sp-4)',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--fs-2xl)',
          lineHeight: 'var(--lh-tight)',
          margin: 0,
          letterSpacing: '-0.02em',
        }}
      >
        Kavach
      </h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 'var(--sp-2)' }}>
        Check a message before you trust it.
      </p>

      <p
        style={{
          marginTop: 'var(--sp-8)',
          padding: 'var(--sp-3)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          color: 'var(--text-muted)',
          fontSize: 'var(--fs-sm)',
        }}
      >
        Scaffold only — phase P0. The paste flow lands at P6. See{' '}
        <code>SPEC.md</code> §11.
      </p>

      <nav style={{ marginTop: 'var(--sp-6)' }}>
        <h2
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          Dev routes
        </h2>
        <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
          {[
            ['/dev/engines', 'Engine workbench — paste a message, see the verdict'],
            ['/dev/probe', 'Device capability report'],
          ].map(([href, label]) => (
            <button
              key={href}
              onClick={() => navigate(href!)}
              style={{
                minHeight: 'var(--tap-min)',
                width: '100%',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                fontSize: 'var(--fs-md)',
                cursor: 'pointer',
                textAlign: 'left',
                padding: 'var(--sp-3)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
    </main>
  )
}
