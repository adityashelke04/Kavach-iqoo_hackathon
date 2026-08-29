import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// PWA config is deliberately minimal at P0 — full manifest, icons and offline
// hardening land at P8 (SPEC.md §11). What matters here is that a service
// worker registers at all, so P8 is tuning rather than first-time setup.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      manifest: {
        name: 'Kavach — scam message checker',
        short_name: 'Kavach',
        description:
          'Check whether a message is a scam. Runs on your phone, works offline.',
        theme_color: '#0B0D10',
        background_color: '#0B0D10',
        display: 'standalone',
        start_url: '/',
        icons: [],
      },
      workbox: {
        // The WebLLM model lives in IndexedDB, not the SW cache. Never let
        // Workbox try to precache model shards (§8.1).
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: {
    // Needed to open the dev server from the phone on the same network.
    host: true,
  },
})
