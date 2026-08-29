import { useEffect, useState } from 'react'

/**
 * /dev/probe — P0 capability report (SPEC.md §11 P0).
 *
 * This exists to answer, on the actual iQOO and over real HTTPS, the questions
 * the whole plan depends on: is there a WebGPU adapter, does IndexedDB work,
 * did a service worker register, and how much storage are we allowed.
 *
 * P2's spike then only has to answer "does a model actually load", rather than
 * also discovering that the device story was wrong.
 */

type Row = { label: string; value: string; ok: boolean | null }

/** Every probe is individually guarded: one failure must not blank the page. */
async function collect(): Promise<Row[]> {
  const rows: Row[] = []

  rows.push({
    label: 'Secure context (HTTPS)',
    value: window.isSecureContext ? 'yes' : 'NO — WebGPU and SW will not work',
    ok: window.isSecureContext,
  })

  // --- WebGPU: the one that decides the pitch -----------------------------
  try {
    const gpu = (navigator as Navigator & { gpu?: unknown }).gpu
    if (!gpu) {
      rows.push({ label: 'WebGPU', value: 'navigator.gpu absent', ok: false })
    } else {
      const adapter = await (
        gpu as { requestAdapter(): Promise<unknown | null> }
      ).requestAdapter()
      if (!adapter) {
        rows.push({
          label: 'WebGPU',
          value: 'navigator.gpu present, but no adapter',
          ok: false,
        })
      } else {
        const a = adapter as {
          info?: { vendor?: string; architecture?: string; device?: string }
          limits?: { maxBufferSize?: number; maxStorageBufferBindingSize?: number }
        }
        const info = a.info
        rows.push({
          label: 'WebGPU adapter',
          value: info
            ? [info.vendor, info.architecture, info.device]
                .filter(Boolean)
                .join(' · ') || 'present (no info exposed)'
            : 'present (no info exposed)',
          ok: true,
        })
        const maxBuf = a.limits?.maxBufferSize
        if (typeof maxBuf === 'number') {
          rows.push({
            label: 'Max buffer size',
            value: `${(maxBuf / 1024 / 1024).toFixed(0)} MB`,
            ok: null,
          })
        }
        const maxBind = a.limits?.maxStorageBufferBindingSize
        if (typeof maxBind === 'number') {
          rows.push({
            label: 'Max storage binding',
            value: `${(maxBind / 1024 / 1024).toFixed(0)} MB`,
            ok: null,
          })
        }
      }
    }
  } catch (err) {
    rows.push({ label: 'WebGPU', value: `threw: ${String(err)}`, ok: false })
  }

  // --- Storage: where the model will live ---------------------------------
  rows.push({
    label: 'IndexedDB',
    value: 'indexedDB' in window ? 'available' : 'MISSING',
    ok: 'indexedDB' in window,
  })

  try {
    const est = await navigator.storage?.estimate?.()
    if (est) {
      const quota = est.quota ? (est.quota / 1024 ** 3).toFixed(2) : '?'
      const usage = est.usage ? (est.usage / 1024 ** 2).toFixed(1) : '0'
      rows.push({
        label: 'Storage quota',
        value: `${usage} MB used of ~${quota} GB`,
        ok: null,
      })
    }
  } catch {
    /* not fatal — §9b says hide, never show a zero */
  }

  try {
    const persisted = await navigator.storage?.persisted?.()
    rows.push({
      label: 'Storage persisted',
      value: persisted ? 'yes' : 'no (model cache may be evicted)',
      ok: null,
    })
  } catch {
    /* ignore */
  }

  // --- Service worker: the offline half of the demo ------------------------
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      rows.push({
        label: 'Service worker',
        value: reg ? `registered (${reg.active ? 'active' : 'installing'})` : 'not registered yet',
        ok: Boolean(reg),
      })
    } else {
      rows.push({ label: 'Service worker', value: 'unsupported', ok: false })
    }
  } catch (err) {
    rows.push({ label: 'Service worker', value: `threw: ${String(err)}`, ok: false })
  }

  rows.push({
    label: 'Installed (standalone)',
    value: window.matchMedia('(display-mode: standalone)').matches
      ? 'yes — running from home screen'
      : 'no — running in browser',
    ok: null,
  })

  // --- Listen mode prerequisite (P11) --------------------------------------
  const w = window as unknown as Record<string, unknown>
  rows.push({
    label: 'SpeechRecognition',
    value:
      'SpeechRecognition' in w || 'webkitSpeechRecognition' in w
        ? 'available'
        : 'unsupported (Listen mode unavailable)',
    ok: 'SpeechRecognition' in w || 'webkitSpeechRecognition' in w,
  })

  rows.push({ label: 'Cores', value: String(navigator.hardwareConcurrency ?? '?'), ok: null })

  const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (typeof dm === 'number') {
    rows.push({ label: 'Device memory', value: `~${dm} GB`, ok: null })
  }

  rows.push({ label: 'User agent', value: navigator.userAgent, ok: null })

  return rows
}

export function Probe() {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let alive = true
    collect().then((r) => {
      if (alive) setRows(r)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <main
      style={{
        maxWidth: 'var(--content-max)',
        margin: '0 auto',
        padding: 'var(--sp-4)',
      }}
    >
      <h1 style={{ fontSize: 'var(--fs-xl)', lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Device probe
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
        P0 capability report. Run this on the iQOO, not the laptop.
      </p>

      {rows === null ? (
        <p style={{ color: 'var(--text-muted)' }}>Probing…</p>
      ) : (
        <dl style={{ display: 'grid', gap: 'var(--sp-2)', margin: 0 }}>
          {rows.map((r) => (
            <div
              key={r.label}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderLeft: `3px solid ${
                  r.ok === null
                    ? 'var(--border)'
                    : r.ok
                      ? 'var(--safe-accent)'
                      : 'var(--danger-accent)'
                }`,
                borderRadius: 'var(--r-md)',
                padding: 'var(--sp-3)',
              }}
            >
              <dt
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {r.label}
              </dt>
              <dd style={{ margin: 0, wordBreak: 'break-word' }}>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </main>
  )
}
