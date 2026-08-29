import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// PWA config is deliberately minimal until P8 (SPEC.md §11). What matters
// before then is that a service worker registers at all, so P8 is tuning
// rather than first-time setup.
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
        // Matches --bg in tokens.css and the meta tag in index.html.
        theme_color: '#0B0B0C',
        background_color: '#0B0B0C',
        display: 'standalone',
        start_url: '/',
        icons: [],
      },
      workbox: {
        // Model weights live in IndexedDB, not the SW cache. Never let Workbox
        // try to precache model shards (§8.1).
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],

        // The inference runtimes are a ~6 MB chunk reached only from the
        // dev-only /dev/llm spike, so precaching them would add 6 MB to every
        // install for a route no user visits.
        //
        // P7 REVISITS THIS. Once LocalDetector is real, the runtime is on the
        // critical path for the offline demo (D6, P8) and must be cached — by
        // raising the size cap, or by runtime-caching it on first use so the
        // install stays small. Deleting these lines without making that
        // decision will silently break the airplane-mode beat.
        globIgnores: ['**/llm-runtime-*.js'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Named so the service worker can reason about them; see globIgnores.
        manualChunks(id) {
          if (id.includes('@mlc-ai/web-llm') || id.includes('@mediapipe/tasks-genai')) {
            return 'llm-runtime'
          }
          return undefined
        },
      },
    },
  },
  server: {
    // Needed to open the dev server from the phone on the same network.
    host: true,
  },
})
