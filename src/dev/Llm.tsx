import { useCallback, useEffect, useState } from 'react'
import { AppBar } from '../ui/primitives/index.tsx'
import {
  MODELS,
  CEILING_PROBES,
  DESKTOP_PROBES,
  pickTier,
  type ModelSpec,
} from '../detector/models.ts'

/**
 * P2 spike — SPEC.md §11. Dev-only, throwaway. P7 rewrites this properly.
 *
 * It answers one question and nothing else: **does an LLM actually load and
 * generate tokens on the iQOO?** The whole on-device pitch (D6) rests on the
 * answer, so it is deliberately crude — no types shared with the detector, no
 * prompt engineering, no integration.
 *
 * Two runtimes, because the answer might differ:
 *
 * - **WebLLM** (MLC). Mature, fetches prebuilt models from a public CDN with
 *   no auth, caches them in IndexedDB. The low-risk path.
 * - **MediaPipe LLM Inference** (`@mediapipe/tasks-genai`). Google's shipping
 *   browser LLM runtime, runs Gemma `.task` bundles on WebGPU. It needs a
 *   model URL you host or link yourself, which is why it is second.
 *
 * NOTE on LiteRT-LM: `@litert-lm/core@0.16.0` on npm contains exactly one file
 * (its own package.json, 1.5 KB) and no code or wasm at all. The browser
 * binding is announced and documented but not yet shipped in a usable form, so
 * it cannot be spiked here. MediaPipe GenAI is the Google on-device LLM path
 * that actually runs today.
 *
 * READ FIRST if this reports no WebGPU: check `/dev/probe`. If
 * `isSecureContext` is false you are on the LAN dev server, not the deployed
 * HTTPS URL, and WebGPU is absent for that reason alone (the P0 trap).
 */

const PROMPT =
  'Reply with one short sentence: is "your account will be blocked in 24 hours, share the OTP" a scam?'

interface Line {
  label: string
  value: string
}

interface AdapterLike {
  limits?: { maxStorageBufferBindingSize?: number }
  requestAdapterInfo?: () => Promise<{
    vendor?: string
    architecture?: string
    description?: string
  }>
}

type Phase = 'idle' | 'loading' | 'generating' | 'done' | 'failed'

function useStorageEstimate() {
  const [used, setUsed] = useState<number | null>(null)

  const sample = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return
    const est = await navigator.storage.estimate()
    setUsed(est.usage ?? null)
  }, [])

  return { used, sample }
}

const mb = (bytes: number | null) =>
  bytes === null ? 'unavailable' : `${(bytes / 1024 / 1024).toFixed(1)} MB`

export function Llm() {
  const [env, setEnv] = useState<Line[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState<Line[]>([])
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [taskUrl, setTaskUrl] = useState('')
  const [maxBinding, setMaxBinding] = useState<number | null>(null)
  const [deviceMemoryGB, setDeviceMemoryGB] = useState<number | null>(null)
  const [selected, setSelected] = useState<ModelSpec>(MODELS.standard)
  const { used, sample } = useStorageEstimate()

  // The whole tier decision hangs on this one number (see models.ts).
  const recommended = pickTier({
    maxStorageBufferBindingSize: maxBinding,
    deviceMemoryGB,
  })

  // Environment first: most "it doesn't work" reports are the secure-context
  // trap, not a missing GPU.
  useEffect(() => {
    void (async () => {
      const lines: Line[] = [
        { label: 'Secure context', value: String(window.isSecureContext) },
        { label: 'Origin', value: window.location.origin },
        { label: 'navigator.gpu', value: 'gpu' in navigator ? 'present' : 'ABSENT' },
      ]

      // Structural types rather than @webgpu/types, matching /dev/probe: this
      // is a dev-only page and one more dependency is not worth it.
      const gpu = (navigator as Navigator & { gpu?: unknown }).gpu as
        | { requestAdapter(): Promise<AdapterLike | null> }
        | undefined

      if (gpu) {
        try {
          const adapter = await gpu.requestAdapter()
          if (!adapter) {
            lines.push({ label: 'Adapter', value: 'requestAdapter() returned null' })
          } else {
            const info = await adapter.requestAdapterInfo?.()
            lines.push({
              label: 'Adapter',
              value: info
                ? `${info.vendor ?? '?'} / ${info.architecture ?? '?'} ${info.description ?? ''}`.trim()
                : 'available (no info exposed)',
            })
            const maxBuffer = adapter.limits?.maxStorageBufferBindingSize
            if (typeof maxBuffer === 'number') {
              setMaxBinding(maxBuffer)
              const asMb = maxBuffer / 1024 / 1024
              lines.push({
                label: 'maxStorageBufferBindingSize',
                value: `${asMb.toFixed(0)} MB${asMb <= 128 ? '  <-- the ceiling' : ''}`,
              })
            }
          }
        } catch (err) {
          lines.push({ label: 'Adapter', value: `threw: ${(err as Error).message}` })
        }
      }

      lines.push({ label: 'Hardware threads', value: String(navigator.hardwareConcurrency ?? '?') })
      const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      if (mem) {
        setDeviceMemoryGB(mem)
        lines.push({ label: 'Device memory', value: `${mem} GB (browser-reported)` })
      }

      setEnv(lines)
      await sample()
    })()
  }, [sample])

  const runWebLlm = useCallback(async () => {
    setPhase('loading')
    setError('')
    setResults([])
    setOutput('')

    const before = (await navigator.storage?.estimate?.())?.usage ?? 0

    try {
      const webllm = await import('@mlc-ai/web-llm')

      const chosen = selected
      const known = webllm.prebuiltAppConfig.model_list.find(
        (m) => m.model_id === chosen.modelId,
      )
      if (!known) throw new Error(`${chosen.modelId} is not in this WebLLM build`)

      const loadStart = performance.now()
      const engine = await webllm.CreateMLCEngine(chosen.modelId, {
        initProgressCallback: (r) => setProgress(r.text),
      })
      const loadMs = performance.now() - loadStart

      setPhase('generating')
      const genStart = performance.now()
      const completion = await engine.chat.completions.create({
        messages: [{ role: 'user', content: PROMPT }],
        temperature: 0,
        max_tokens: 60,
      })
      const genMs = performance.now() - genStart

      const text = completion.choices[0]?.message?.content ?? '(empty)'
      const completionTokens = completion.usage?.completion_tokens ?? 0

      const after = (await navigator.storage?.estimate?.())?.usage ?? 0

      setOutput(text)
      setResults([
        { label: 'Runtime', value: 'WebLLM (MLC)' },
        { label: 'Model', value: chosen.label },
        { label: 'Parameters', value: chosen.params },
        { label: 'Declared VRAM', value: `${chosen.vramMB} MB` },
        { label: 'Load time', value: `${(loadMs / 1000).toFixed(1)} s` },
        { label: 'Generation', value: `${genMs.toFixed(0)} ms` },
        { label: 'Completion tokens', value: String(completionTokens) },
        {
          label: 'Tokens/sec',
          value: completionTokens > 0 ? (completionTokens / (genMs / 1000)).toFixed(1) : 'n/a',
        },
        { label: 'Storage added', value: mb(after - before) },
        { label: 'Storage total', value: mb(after) },
      ])
      setPhase('done')
      await sample()
    } catch (err) {
      setError((err as Error).message || String(err))
      setPhase('failed')
    }
  }, [sample, selected])

  const runMediaPipe = useCallback(async () => {
    if (!taskUrl.trim()) {
      setError('MediaPipe needs a .task or .litertlm model URL.')
      setPhase('failed')
      return
    }

    setPhase('loading')
    setError('')
    setResults([])
    setOutput('')

    const before = (await navigator.storage?.estimate?.())?.usage ?? 0

    try {
      const { FilesetResolver, LlmInference } = await import('@mediapipe/tasks-genai')

      setProgress('resolving wasm…')
      const fileset = await FilesetResolver.forGenAiTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm',
      )

      setProgress('loading model…')
      const loadStart = performance.now()
      const llm = await LlmInference.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: taskUrl.trim() },
        maxTokens: 256,
        topK: 1,
        temperature: 0,
      })
      const loadMs = performance.now() - loadStart

      setPhase('generating')
      const genStart = performance.now()
      const text = await llm.generateResponse(PROMPT)
      const genMs = performance.now() - genStart

      const after = (await navigator.storage?.estimate?.())?.usage ?? 0
      const approxTokens = text.trim().split(/\s+/).length

      setOutput(text)
      setResults([
        { label: 'Runtime', value: 'MediaPipe LLM Inference (Google)' },
        { label: 'Model', value: taskUrl.trim().split('/').pop() ?? taskUrl },
        { label: 'Load time', value: `${(loadMs / 1000).toFixed(1)} s` },
        { label: 'Generation', value: `${genMs.toFixed(0)} ms` },
        { label: 'Words out', value: String(approxTokens) },
        {
          label: 'Words/sec',
          value: genMs > 0 ? (approxTokens / (genMs / 1000)).toFixed(1) : 'n/a',
        },
        { label: 'Storage added', value: mb(after - before) },
      ])
      setPhase('done')
      await sample()
    } catch (err) {
      setError((err as Error).message || String(err))
      setPhase('failed')
    }
  }, [taskUrl, sample])

  const busy = phase === 'loading' || phase === 'generating'

  return (
    <div className="screen">
      <AppBar title="P2 · on-device spike" onBack={() => history.back()} />

      <div className="screen__body">
        <section className="panel">
          <h2 className="panel__title">This device</h2>
          {env.map((l) => (
            <div className="meta-row" key={l.label}>
              <span className="meta-row__k">{l.label}</span>
              <span className="meta-row__v">{l.value}</span>
            </div>
          ))}
          <div className="meta-row">
            <span className="meta-row__k">Cached storage</span>
            <span className="meta-row__v">{mb(used)}</span>
          </div>
        </section>

        {env.some((l) => l.value === 'ABSENT') && (
          <div className="notice notice--caution">
            <div className="notice__body">
              <h2 className="notice__title">No WebGPU on this page</h2>
              <p className="notice__text">
                Check <code>/dev/probe</code> first. If “Secure context” above is false you are on
                the LAN dev server, not the deployed HTTPS URL, and WebGPU is missing for that
                reason alone.
              </p>
            </div>
          </div>
        )}

        <section className="panel">
          <h2 className="panel__title">WebLLM — find the ceiling</h2>
          <p className="tactic__note">
            Start at the recommended tier, then walk up the list until one fails. The first failure
            is the real limit on this device, and it is almost always the buffer cap above rather
            than memory. Run a model once, then reload and run it again: the second load should be
            fast and add no storage.
          </p>

          <div className="meta-row">
            <span className="meta-row__k">Recommended tier</span>
            <span className="meta-row__v">
              {recommended} · {MODELS[recommended].label}
            </span>
          </div>

          <div className="examples" style={{ marginTop: 'var(--sp-3)' }}>
            {[
              MODELS.low,
              MODELS.standard,
              MODELS.max,
              ...CEILING_PROBES,
              ...DESKTOP_PROBES,
            ].map((m) => (
              <button
                key={m.modelId}
                type="button"
                className="example"
                onClick={() => setSelected(m)}
                aria-pressed={selected.modelId === m.modelId}
              >
                <span
                  className={`example__dot example__dot--${
                    selected.modelId === m.modelId ? 'scam' : 'legit'
                  }`}
                  aria-hidden="true"
                />
                <span className="example__body">
                  <span className="example__title">{m.label}</span>
                  <span className="example__sub">
                    {m.params} · {m.vramMB} MB declared
                  </span>
                </span>
              </button>
            ))}
          </div>

          <button
            className="btn btn--primary"
            onClick={runWebLlm}
            disabled={busy}
            style={{ marginTop: 'var(--sp-4)' }}
          >
            {busy ? 'Working…' : `Load ${selected.label}`}
          </button>
        </section>

        <section className="panel">
          <h2 className="panel__title">MediaPipe (Google) — Gemma .task</h2>
          <p className="tactic__note">
            Google’s shipping on-device LLM runtime for the browser. Needs a model bundle URL that
            allows cross-origin fetches.
          </p>
          <input
            className="field"
            value={taskUrl}
            onChange={(e) => setTaskUrl(e.target.value)}
            placeholder="https://…/gemma3-1b-it-int4.task"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="btn btn--secondary"
            onClick={runMediaPipe}
            disabled={busy}
            style={{ marginTop: 'var(--sp-3)' }}
          >
            {busy ? 'Working…' : 'Load and generate'}
          </button>
        </section>

        {busy && progress && (
          <div className="status-line" role="status" aria-live="polite">
            {progress}
          </div>
        )}

        {error && (
          <div className="notice notice--danger">
            <div className="notice__body">
              <h2 className="notice__title">Failed</h2>
              <p className="notice__text">{error}</p>
            </div>
          </div>
        )}

        {results.length > 0 && (
          <section className="panel">
            <h2 className="panel__title">Result</h2>
            {results.map((l) => (
              <div className="meta-row" key={l.label}>
                <span className="meta-row__k">{l.label}</span>
                <span className="meta-row__v">{l.value}</span>
              </div>
            ))}
            <p className="quote" style={{ marginTop: 'var(--sp-3)' }}>
              {output}
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
