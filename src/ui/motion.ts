/**
 * Motion — the one animation library for Kavach (SPEC.md §10.4 guardrail 2:
 * "pick one motion library at P4 and use only that"). React Bits set-pieces
 * are rebuilt on top of this rather than vendored with their own animation
 * runtime, so the app ships one motion engine, not two.
 *
 * https://motion.dev — MIT licensed, ~18kb, used here via the `motion/react`
 * import path.
 *
 * Every export below is a token-derived constant, not a magic number, so a
 * future redesign (§10.3) can retune motion by editing `tokens.css` and this
 * one file, the same way it retunes colour by editing `tokens.css` alone.
 */
import { useReducedMotion as useMotionReducedMotion } from 'motion/react'

/** Re-exported so screens/components never import `motion/react` directly. */
export const useReducedMotion = useMotionReducedMotion

/**
 * Springs tuned to feel like the token-based CSS easing already in the app
 * (`--ease-emphasis`, `--dur-fast/base/slow`), not like a different product's
 * motion signature. Decelerate hard, never overshoot into a bounce — a bounce
 * on a security verdict reads as playful, which fights §10.1 principle 4.
 */
export const spring = {
  /** Micro-interactions: press, hover-in. ~120ms of felt motion. */
  fast: { type: 'spring', stiffness: 500, damping: 32, mass: 0.7 } as const,
  /** Card/element entrances. ~220ms of felt motion. */
  base: { type: 'spring', stiffness: 320, damping: 28, mass: 0.8 } as const,
  /** The one-time brand moment on Home. ~420-600ms. */
  slow: { type: 'spring', stiffness: 180, damping: 22, mass: 1 } as const,
}

/** Plain easing for things a spring shouldn't drive (opacity fades, stagger delays). */
export const ease = {
  out: [0.2, 0.8, 0.2, 1],
  emphasis: [0.16, 1, 0.3, 1],
} as const

/**
 * A staggered-list entrance (§10.4: "staggered list entrance, TacticCard
 * list — cheap, reads as considered"). `transform`/`opacity` only — safe to
 * run during inference per the compositor-only rule, but callers of anything
 * *looping* (not this — entrances run once) must still gate on a busy prop
 * passed down from the owning screen (§10.3: screens own async state).
 */
export function staggerChild(index: number) {
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { ...spring.base, delay: index * 0.05 },
  }
}
