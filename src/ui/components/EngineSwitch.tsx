import { useCallback, useEffect, useState } from 'react'
import type { EnginePreference } from '../../detector/orchestrator.ts'
import { copy } from '../copy.ts'
import { IconLock, IconCloud, IconAlertTriangle } from '../icons.tsx'

export interface EngineSwitchProps {
  value: EnginePreference
  onChange: (pref: EnginePreference) => void
  disabled?: boolean
  className?: string
}

/**
 * EngineSwitch — SPEC.md §10.6, §16 D2.
 *
 * Impeccable, tactile two-way toggle between On-device AI (100% private, runs on phone)
 * and Cloud AI (faster on older devices).
 *
 * Features:
 * - Dual-layer tactile physics with spring transitions.
 * - Haptic pulse feedback on mobile touch.
 * - Dynamic offline connection sensing.
 * - Full WCAG AA keyboard accessibility (Arrow keys, Space/Enter).
 */
export function EngineSwitch({
  value,
  onChange,
  disabled = false,
  className = '',
}: EngineSwitchProps) {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const select = useCallback(
    (next: EnginePreference) => {
      if (disabled || next === value) return
      // Gentle tactile vibration on supported mobile devices
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(8)
        } catch {}
      }
      onChange(next)
    },
    [disabled, value, onChange],
  )

  const isLocal = value === 'local'
  const isCloud = value === 'cloud'
  const showOfflineWarning = isCloud && !isOnline

  return (
    <div className={`engine-switch ${className}`} role="region" aria-label={copy.engine_title}>
      <div className="engine-switch__header">
        <span className="section-head" style={{ margin: 0 }}>
          {copy.engine_title}
        </span>
        <span className={`engine-switch__status-pill ${isLocal ? 'engine-switch__status-pill--safe' : ''}`}>
          {isLocal ? copy.engine_local_badge : copy.engine_cloud_badge}
        </span>
      </div>

      <div
        className="engine-switch__track"
        role="radiogroup"
        aria-label={copy.engine_title}
      >
        {/* Floating sliding thumb */}
        <div
          className={`engine-switch__thumb ${
            isCloud ? 'engine-switch__thumb--right' : 'engine-switch__thumb--left'
          }`}
          aria-hidden="true"
        />

        <button
          type="button"
          role="radio"
          aria-checked={isLocal}
          disabled={disabled}
          className={`engine-switch__option ${isLocal ? 'engine-switch__option--active' : ''}`}
          onClick={() => select('local')}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') select('cloud')
          }}
        >
          <span className="engine-switch__icon" aria-hidden="true">
            <IconLock size={16} strokeWidth={2.2} />
          </span>
          <span className="engine-switch__label">{copy.engine_local}</span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={isCloud}
          disabled={disabled}
          className={`engine-switch__option ${isCloud ? 'engine-switch__option--active' : ''}`}
          onClick={() => select('cloud')}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') select('local')
          }}
        >
          <span className="engine-switch__icon" aria-hidden="true">
            <IconCloud size={16} strokeWidth={2.2} />
          </span>
          <span className="engine-switch__label">{copy.engine_cloud}</span>
        </button>
      </div>

      <div className="engine-switch__caption-wrap">
        {showOfflineWarning ? (
          <p className="engine-switch__caption engine-switch__caption--warning" role="status">
            <IconAlertTriangle size={14} className="engine-switch__caption-icon" aria-hidden="true" />
            <span>{copy.cloud_unavailable}</span>
          </p>
        ) : (
          <p className="engine-switch__caption" role="status">
            {isLocal ? copy.engine_local_note : copy.engine_cloud_note}
          </p>
        )}
      </div>
    </div>
  )
}
