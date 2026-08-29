import { useRef } from 'react'
import type { EnginePreference } from '../detector/orchestrator.ts'
import { copy } from '../ui/copy.ts'
import {
  ShieldLogo,
  IconMessageSquare,
  IconMic,
  IconChevronRight,
  IconLock,
} from '../ui/icons.tsx'
import { DeviceTelemetryPanel, EngineSwitch } from '../ui/components/index.tsx'

/**
 * Home — SPEC.md §10.6, §9b, §16 D2.
 *
 * Two primary actions, tactile Engine & Privacy switch (On-device ⇄ Cloud),
 * the privacy claim, and the collapsible "Running on this device" telemetry panel.
 */
export function Home({
  onCheck,
  onListen,
  enginePreference = 'local',
  onEnginePreferenceChange,
  onFailsafe,
}: {
  onCheck: () => void
  onListen: () => void
  enginePreference?: EnginePreference
  onEnginePreferenceChange?: (pref: EnginePreference) => void
  onFailsafe?: () => void
}) {
  const tapCount = useRef(0)
  const lastTap = useRef(0)

  // Triple-tap failsafe on brand header (SPEC.md §11 P10, §13)
  const handleBrandTap = () => {
    const now = Date.now()
    if (now - lastTap.current < 450) {
      tapCount.current++
      if (tapCount.current >= 3) {
        tapCount.current = 0
        onFailsafe?.()
      }
    } else {
      tapCount.current = 1
    }
    lastTap.current = now
  }

  return (
    <main className="screen screen--bare">
      <div className="screen__body">
        <header
          className="brand"
          onClick={handleBrandTap}
          style={{ cursor: 'pointer', userSelect: 'none' }}
          title="Kavach Shield"
        >
          <ShieldLogo size={48} />
          <h1 className="brand__name">{copy.app_name}</h1>
          <p className="brand__tagline">{copy.app_tagline}</p>
        </header>

        <nav className="home-actions" aria-label="What would you like to do?">
          <button type="button" className="choice" onClick={onCheck}>
            <span className="choice__icon" aria-hidden="true">
              <IconMessageSquare size={24} strokeWidth={2} />
            </span>
            <span className="choice__body">
              <span className="choice__title">{copy.home_check_title}</span>
              <span className="choice__sub">{copy.home_check_sub}</span>
            </span>
            <IconChevronRight size={20} className="choice__go" aria-hidden="true" />
          </button>

          <button type="button" className="choice" onClick={onListen}>
            <span className="choice__icon choice__icon--safe" aria-hidden="true">
              <IconMic size={24} strokeWidth={2} />
            </span>
            <span className="choice__body">
              <span className="choice__title">{copy.home_listen_title}</span>
              <span className="choice__sub">{copy.home_listen_sub}</span>
            </span>
            <IconChevronRight size={20} className="choice__go" aria-hidden="true" />
          </button>
        </nav>

        {onEnginePreferenceChange && (
          <div style={{ marginTop: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
            <EngineSwitch value={enginePreference} onChange={onEnginePreferenceChange} />
          </div>
        )}

        <div className="privacy-line">
          <span className="privacy-line__icon" aria-hidden="true">
            <IconLock size={18} />
          </span>
          <p className="privacy-line__text">{copy.home_privacy}</p>
        </div>

        <div style={{ marginTop: 'var(--sp-4)' }}>
          <DeviceTelemetryPanel />
        </div>
      </div>
    </main>
  )
}
