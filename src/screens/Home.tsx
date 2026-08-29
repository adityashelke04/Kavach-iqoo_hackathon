import { copy } from '../ui/copy.ts'

/**
 * Home — SPEC.md §10.6.
 *
 * Two large, obvious choices and nothing else. The audience runs from kids to
 * grandparents, so there is nothing to discover and nothing to learn: the
 * whole screen is the two things the app does.
 */
export function Home({ onCheck, onListen }: { onCheck: () => void; onListen: () => void }) {
  return (
    <div className="screen">
      <div className="screen__body" style={{ justifyContent: 'center' }}>
        <div className="center" style={{ marginBottom: 'var(--sp-6)' }}>
          <h1
            style={{
              fontSize: 'var(--fs-xl)',
              margin: 0,
              letterSpacing: '0.14em',
              fontWeight: 'var(--fw-bold)',
            }}
          >
            {copy.app_name.toUpperCase()}
          </h1>
          <p className="muted" style={{ margin: 'var(--sp-2) 0 0' }}>
            {copy.app_tagline}
          </p>
        </div>

        <div className="stack stagger">
          <button className="choice" onClick={onCheck}>
            <span className="choice__icon" aria-hidden="true">
              ✉️
            </span>
            <span>
              <span className="choice__title">Check a message</span>
              <span className="choice__sub">SMS, WhatsApp, email — anything you can copy</span>
            </span>
          </button>

          <button className="choice" onClick={onListen}>
            <span className="choice__icon" aria-hidden="true">
              🎙️
            </span>
            <span>
              <span className="choice__title">Listen to a call</span>
              <span className="choice__sub">Put the call on speaker and Kavach will listen</span>
            </span>
          </button>
        </div>

        <p className="hint center" style={{ marginTop: 'var(--sp-6)' }}>
          {copy.about_disclaimer}
        </p>
      </div>
    </div>
  )
}
