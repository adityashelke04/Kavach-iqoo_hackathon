import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

/**
 * Follow the phone's own light/dark setting.
 *
 * tokens.css defines a full light palette under [data-theme='light']; without
 * this it was unreachable, so every light value in the token file was dead
 * code and any component that hard-coded a dark colour went unnoticed.
 * The address-bar colour is kept in step with the ground the page paints.
 */
function applyTheme(light: boolean) {
  const el = document.documentElement
  if (light) el.dataset['theme'] = 'light'
  else delete el.dataset['theme']

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', light ? '#F9F9F9' : '#0B0B0C')
}

const prefersLight = window.matchMedia('(prefers-color-scheme: light)')
applyTheme(prefersLight.matches)
prefersLight.addEventListener('change', (e) => applyTheme(e.matches))

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
