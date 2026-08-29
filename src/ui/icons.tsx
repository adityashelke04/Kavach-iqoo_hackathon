import type { SVGProps } from 'react'

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number | string
  strokeWidth?: number
  className?: string
}

const defaultProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

// 1. Kavach Shield Emblem (Master Logo with Official Heat Gradient & Specular Bezel)
export function ShieldLogo({ size = 36, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <defs>
        {/* Heat Electric Vermilion Primary Gradient */}
        <linearGradient id="kavachShieldGrad" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FA5D19" />
          <stop offset="0.5" stopColor="#FF7A3D" />
          <stop offset="1" stopColor="#FFB020" />
        </linearGradient>

        {/* Deep Radiant Heat Core Plasma */}
        <linearGradient id="kavachShieldCore" x1="14" y1="8" x2="34" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FA5D19" stopOpacity="0.32" />
          <stop offset="1" stopColor="#D8490B" stopOpacity="0.08" />
        </linearGradient>

        {/* Specular Edge Highlighting */}
        <linearGradient id="kavachShieldSpecular" x1="24" y1="4" x2="24" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.6" />
          <stop offset="0.35" stopColor="#FA5D19" stopOpacity="0.4" />
          <stop offset="1" stopColor="#1C1C1F" stopOpacity="0.2" />
        </linearGradient>

        {/* Heat Glow Filter */}
        <filter id="kavachHeatGlow" x="-0.2" y="-0.2" width="1.4" height="1.4">
          <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#FA5D19" floodOpacity="0.4" />
        </filter>
      </defs>

      {/* Armored Outer Shell */}
      <path
        d="M24 4L7 11V22C7 33.1 14.3 43.4 24 46C33.7 43.4 41 33.1 41 22V11L24 4Z"
        fill="url(#kavachShieldCore)"
        stroke="url(#kavachShieldGrad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#kavachHeatGlow)"
      />

      {/* Prismatic Specular Bezel Inner Inset */}
      <path
        d="M24 10L12 15.5V23.5C12 31.8 17.1 39.2 24 41.5C30.9 39.2 36 31.8 36 23.5V15.5L24 10Z"
        stroke="url(#kavachShieldSpecular)"
        strokeWidth="1.25"
        strokeOpacity="0.75"
        strokeDasharray="2 2"
      />

      {/* Central Diamond Sentinel Node */}
      <path
        d="M24 18L18 23.5V28.5L24 32.5L30 28.5V23.5L24 18Z"
        fill="#FA5D19"
        fillOpacity="0.28"
        stroke="#FA5D19"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Core Specular Apex Point */}
      <circle cx="24" cy="25.5" r="2.2" fill="#F9F9F9" />
    </svg>
  )
}

// 2. Shield (Generic)
export function IconShield({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

// 3. ShieldCheck (Safe State)
export function IconShieldCheck({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

// 4. ShieldAlert (Caution State)
export function IconShieldAlert({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

// 5. ShieldX / Danger State
export function IconShieldX({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  )
}

// 6. AlertTriangle
export function IconAlertTriangle({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

// 7. MessageSquare / Check Message
export function IconMessageSquare({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function MessageScanIcon({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h8" strokeOpacity="0.6" />
      <path d="M8 13h5" strokeOpacity="0.6" />
      <circle cx="17.5" cy="13" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

// 8. Microphone / Listen to Call
export function IconMic({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  )
}

export function MicrophoneSentinelIcon({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  )
}

// 9. Navigation & Directional Arrows
export function IconArrowLeft({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

export function IconArrowRight({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

export function ArrowRightIcon({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}

export function IconChevronRight({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

// 10. Tactical Category Icons
export function IconBadgeCheck({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

export function CheckBadgeIcon({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

export function IconClock({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

export function IconUserX({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="17" y1="8" x2="22" y2="13" />
      <line x1="22" y1="8" x2="17" y2="13" />
    </svg>
  )
}

export function IconCreditCard({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  )
}

export function IconKey({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  )
}

// 11. Hardware & System Status
export function IconCpu({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <rect width="16" height="16" x="4" y="4" rx="2" />
      <rect width="6" height="6" x="9" y="9" rx="1" />
      <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
    </svg>
  )
}

export function CpuChipIcon(props: IconProps) {
  return <IconCpu {...props} />
}

export function IconLock({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

export function LockShieldIcon({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <rect x="9" y="11" width="6" height="5" rx="1" />
      <path d="M10 11V9a2 2 0 0 1 4 0v2" />
    </svg>
  )
}

export function IconZap({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

export function LightningBoltIcon(props: IconProps) {
  return <IconZap {...props} />
}

export function IconSparkles({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4M19 17v4M3 5h4M17 19h4" />
    </svg>
  )
}

export function SparklesIcon(props: IconProps) {
  return <IconSparkles {...props} />
}

export function DialectIcon({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  )
}

// 12. Actions & Utilities
export function IconCopy({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}

export function IconCheck({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export function IconRefreshCw({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  )
}

export function IconShare({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}

export function IconPhoneCall({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}

export function IconPhoneOff({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  )
}

export function IconInfo({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

export function IconPlay({ size = 20, strokeWidth = 2, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} {...defaultProps} className={className} {...props}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

export function QuoteIcon({ size = 14, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" opacity={0.6} className={className} {...props} aria-hidden="true">
      <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
    </svg>
  )
}
