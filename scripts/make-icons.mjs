/**
 * Render the Kavach shield to the PNG icon set the manifest needs (P8, §11).
 *
 * WHY THIS SCRIPT EXISTS: the manifest shipped `icons: []`, and Chrome on
 * Android will not offer to install a PWA without a 192px and a 512px icon.
 * P8's exit criterion is "installed to the iQOO home screen", so the icons are
 * not decoration — they are the blocker.
 *
 * The mark is defined once, here, from the same paths and the same Heat
 * gradient as `ShieldLogo` in `src/ui/icons.tsx`. If that mark is redrawn, redraw
 * it here too and re-run: `npm run icons`.
 *
 * Committed output lives in `public/icons/`, so a normal build and a normal
 * deploy never need Chrome. Re-run this only when the mark or the ground
 * colour changes.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'icons')

const green = (s) => `\x1b[32m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

/** `--bg` in tokens.css, and the manifest's background_color. Keep in step. */
const GROUND = '#0B0B0C'

/**
 * The mark, at viewBox 48. A verbatim SVG transcription of `ShieldLogo` —
 * JSX camelCase attributes spelled the way SVG actually wants them.
 */
const SHIELD = `
<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FA5D19"/>
      <stop offset="0.5" stop-color="#FF7A3D"/>
      <stop offset="1" stop-color="#FFB020"/>
    </linearGradient>
    <linearGradient id="core" x1="14" y1="8" x2="34" y2="42" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FA5D19" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#D8490B" stop-opacity="0.08"/>
    </linearGradient>
    <linearGradient id="spec" x1="24" y1="4" x2="24" y2="46" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.6"/>
      <stop offset="0.35" stop-color="#FA5D19" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#1C1C1F" stop-opacity="0.2"/>
    </linearGradient>
    <filter id="glow" x="-0.2" y="-0.2" width="1.4" height="1.4">
      <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#FA5D19" flood-opacity="0.4"/>
    </filter>
  </defs>
  <path d="M24 4L7 11V22C7 33.1 14.3 43.4 24 46C33.7 43.4 41 33.1 41 22V11L24 4Z"
        fill="url(#core)" stroke="url(#g)" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
  <path d="M24 10L12 15.5V23.5C12 31.8 17.1 39.2 24 41.5C30.9 39.2 36 31.8 36 23.5V15.5L24 10Z"
        stroke="url(#spec)" stroke-width="1.25" stroke-opacity="0.75" stroke-dasharray="2 2"/>
  <path d="M24 18L18 23.5V28.5L24 32.5L30 28.5V23.5L24 18Z"
        fill="#FA5D19" fill-opacity="0.28" stroke="#FA5D19" stroke-width="1.5" stroke-linejoin="round"/>
  <circle cx="24" cy="25.5" r="2.2" fill="#F9F9F9"/>
</svg>`.trim()

/**
 * `fill` is the mark's share of the canvas edge.
 *
 * A `maskable` icon is cropped by the platform to whatever shape it likes —
 * a circle on most Android launchers — and only the middle 80% is guaranteed
 * to survive. 0.52 keeps the whole shield inside that safe circle with room to
 * spare. The `any` icons are shown as authored, so they can breathe wider.
 */
const MONO_SHIELD = `
<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M24 4L7 11V22C7 33.1 14.3 43.4 24 46C33.7 43.4 41 33.1 41 22V11L24 4Z"
        stroke="#FFFFFF" stroke-width="2.5" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M24 10L12 15.5V23.5C12 31.8 17.1 39.2 24 41.5C30.9 39.2 36 31.8 36 23.5V15.5L24 10Z"
        stroke="#FFFFFF" stroke-width="1.25" stroke-opacity="0.75" stroke-dasharray="2 2"/>
  <path d="M24 18L18 23.5V28.5L24 32.5L30 28.5V23.5L24 18Z"
        fill="#FFFFFF" fill-opacity="0.5" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/>
  <circle cx="24" cy="25.5" r="2.2" fill="#FFFFFF"/>
</svg>`.trim()

/**
 * `fill` is the mark's share of the canvas edge.
 *
 * A `maskable` icon is cropped by the platform to whatever shape it likes —
 * a circle on most Android launchers — and only the middle 80% is guaranteed
 * to survive. 0.52 keeps the whole shield inside that safe circle with room to
 * spare. The `any` icons are shown as authored, so they can breathe wider.
 */
const ICONS = [
  { file: 'icon-96.png', size: 96, fill: 0.74, mono: false },
  { file: 'icon-192.png', size: 192, fill: 0.74, mono: false },
  { file: 'icon-512.png', size: 512, fill: 0.74, mono: false },
  { file: 'icon-maskable-192.png', size: 192, fill: 0.52, mono: false },
  { file: 'icon-maskable-512.png', size: 512, fill: 0.52, mono: false },
  { file: 'icon-monochrome-96.png', size: 96, fill: 0.74, mono: true },
  { file: 'icon-monochrome-512.png', size: 512, fill: 0.74, mono: true },
  { file: 'apple-touch-icon.png', size: 180, fill: 0.7, mono: false },
]

const page = (size, fill, mono = false) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:${mono ? 'transparent' : GROUND};
            display:flex;align-items:center;justify-content:center;overflow:hidden}
  svg{width:${Math.round(size * fill)}px;height:${Math.round(size * fill)}px;display:block}
</style>${mono ? MONO_SHIELD : SHIELD}`

mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const { file, size, fill, mono } of ICONS) {
    const ctx = await browser.newContext({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    })
    const p = await ctx.newPage()
    await p.setContent(page(size, fill, mono), { waitUntil: 'load' })
    const buf = await p.screenshot({ type: 'png', omitBackground: mono })
    writeFileSync(join(outDir, file), buf)
    await ctx.close()
    console.log(`${green('✓')} ${file} ${dim(`${size}×${size}${mono ? ' (mono)' : ''}`)}`)
  }

  // A vector favicon for the browser tab. Not part of the manifest — desktop
  // Chrome and the Android tab strip take this, and it costs 1 KB.
  writeFileSync(
    join(outDir, 'favicon.svg'),
    SHIELD.replace('<svg ', `<svg style="background:${GROUND}" `),
  )
  console.log(`${green('✓')} favicon.svg ${dim('vector')}`)
} finally {
  await browser.close()
}

console.log(`\n${green('icons written')} ${dim(outDir)}`)
