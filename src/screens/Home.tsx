import { useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
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
import { useReducedMotion } from '../ui/motion.ts'

/**
 * The two choices settle in a beat apart on first paint rather than appearing
 * as two static boxes already sitting there. Deliberately NOT synced to the
 * end of the shield-draw/tagline sequence (~900ms+): the two primary actions
 * on the whole app must never sit invisible for the better part of a second
 * waiting their turn — they get their own quick, independent settle instead.
 */
const CHOICE_ENTER_DELAY_MS: [number, number] = [70, 150]

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
  const reducedMotion = useReducedMotion()

  // The shield draw-in and tagline settle run once per session, never on a
  // return to Home within the same session (§10.6, D15's Home direction).
  const [entering] = useState(() => {
    try {
      const seen = sessionStorage.getItem('kavach-brand-seen')
      if (seen) return false
      sessionStorage.setItem('kavach-brand-seen', '1')
      return true
    } catch {
      return false // storage blocked (private mode) — skip the entrance, never crash for it
    }
  })

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
          className={`brand${entering ? ' brand--entering' : ''}`}
          onClick={handleBrandTap}
          style={{ cursor: 'pointer', userSelect: 'none' }}
          title="Kavach Shield"
        >
          <ShieldLogo size={48} />
          <h1 className="brand__name">{copy.app_name}</h1>
          <p className="brand__tagline">{copy.app_tagline}</p>
        </header>

        <nav className="home-actions" aria-label="What would you like to do?">
          <ChoiceCard
            onClick={onCheck}
            icon={<IconMessageSquare size={24} strokeWidth={2} />}
            title={copy.home_check_title}
            sub={copy.home_check_sub}
            animateIn={entering && !reducedMotion}
            delayMs={CHOICE_ENTER_DELAY_MS[0]}
          />
          <ChoiceCard
            onClick={onListen}
            icon={<IconMic size={24} strokeWidth={2} />}
            title={copy.home_listen_title}
            sub={copy.home_listen_sub}
            animateIn={entering && !reducedMotion}
            delayMs={CHOICE_ENTER_DELAY_MS[1]}
          />
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
          <p className="privacy-line__text">
            <span className="privacy-line__dot" aria-hidden="true" />
            {copy.home_privacy}
          </p>
        </div>

        <div style={{ marginTop: 'var(--sp-4)' }}>
          <DeviceTelemetryPanel />
        </div>
      </div>
    </main>
  )
}

/**
 * One of the two front-door actions. When `animateIn` is set (first paint of
 * the session, motion allowed) it rises in as the tail of the brand entrance;
 * every other render — including every later visit to Home this session — is
 * a plain, motion-free button, so navigating back here never re-plays anything.
 */
function ChoiceCard({
  onClick,
  icon,
  title,
  sub,
  animateIn,
  delayMs,
}: {
  onClick: () => void
  icon: ReactNode
  title: string
  sub: string
  animateIn: boolean
  delayMs: number
}) {
  const body = (
    <>
      <span className="choice__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="choice__body">
        <span className="choice__title">{title}</span>
        <span className="choice__sub">{sub}</span>
      </span>
      <IconChevronRight size={20} className="choice__go" aria-hidden="true" />
    </>
  )

  if (!animateIn) {
    return (
      <button type="button" className="choice" onClick={onClick}>
        {body}
      </button>
    )
  }

  return (
    <motion.button
      type="button"
      className="choice"
      onClick={onClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: 'spring',
        stiffness: 420,
        damping: 30,
        mass: 0.7,
        delay: delayMs / 1000,
      }}
    >
      {body}
    </motion.button>
  )
}
