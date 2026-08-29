import { useCallback, useEffect, useRef, useState } from 'react'
import { AppBar } from '../ui/primitives/index.tsx'
import {
  MODELS,
  CEILING_PROBES,
  DESKTOP_PROBES,
  pickTier,
  type ModelSpec,
} from '../detector/models.ts'
import { onModelProgress, unloadEngine } from '../detector/local.ts'

/**
 * /dev/llm — On-device WebGPU AI Laboratory.
 *
 * Provides real-time visibility into on-device model downloads, WebGPU shader
 * compilation, and token generation speed directly on the user's phone.
 */

const DEFAULT_PROMPT =
  'Dear Customer, your SBI account will be blocked within 24 hours due to incomplete KYC. Update your KYC immediately at http://sbi-kyc-verify.in/update to avoid suspension.'

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
  const [progressText, setProgressText] = useState('')
  const [progressFraction, setProgressFraction] = useState<number | null>(null)
  const [promptText, setPromptText] = useState(DEFAULT_PROMPT)
  const [results, setResults] = useState<Line[]>([])
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [taskUrl, setTaskUrl] = useState('')
  const [maxBinding, setMaxBinding] = useState<number | null>(null)
  const [deviceMemoryGB, setDeviceMemoryGB] = useState<number | null>(null)
  const [selected, setSelected] = useState<ModelSpec>(MODELS.standard)
  const abortRef = useRef(false)
  const { used, sample } = useStorageEstimate()

  const recommended = pickTier({
    maxStorageBufferBindingSize: maxBinding,
    deviceMemoryGB,
  })

  // Listen to global model progress
  useEffect(() => {
    return onModelProgress((p) => {
      setProgressText(p.text)
      if (p.fraction !== null) setProgressFraction(p.fraction)
    })
  }, [])

  // Probe environment
  useEffect(() => {
    void (async () => {
      const lines: Line[] = [
        { label: 'Secure context', value: String(window.isSecureContext) },
        { label: 'Origin', value: window.location.origin },
        { label: 'navigator.gpu', value: 'gpu' in navigator ? 'present' : 'ABSENT' },
      ]

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
                value: `${asMb.toFixed(0)} MB${asMb <= 128 ? ' (mobile buffer ceiling)' : ''}`,
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

  const cancelOrReset = useCallback(async () => {
    abortRef.current = true
    setPhase('loading')
    setProgressText('Unloading model and releasing WebGPU memory…')
    try {
      await unloadEngine()
      setPhase('idle')
      setProgressText('Engine reset. Ready.')
      setProgressFraction(null)
      setError('')
      await sample()
    } catch (err) {
      setError(`Reset error: ${(err as Error).message}`)
      setPhase('failed')
    }
  }, [sample])

  const loadAndRunWebLlm = useCallback(async () => {
    abortRef.current = false
    setPhase('loading')
    setError('')
    setResults([])
    setOutput('')
    setProgressFraction(0)
    setProgressText(`Initializing ${selected.label}…`)

    const before = (await navigator.storage?.estimate?.())?.usage ?? 0

    try {
      // Unload previous engine before allocating new weights
      await unloadEngine()

      const webllm = await import('@mlc-ai/web-llm')
      const chosen = selected

      const known = webllm.prebuiltAppConfig.model_list.find(
        (m) => m.model_id === chosen.modelId,
      )
      if (!known) throw new Error(`${chosen.modelId} is not in this WebLLM build`)

      const loadStart = performance.now()
      const engine = await webllm.CreateMLCEngine(chosen.modelId, {
        initProgressCallback: (r) => {
          if (abortRef.current) return
          setProgressText(r.text)
          if (typeof r.progress === 'number') {
            setProgressFraction(r.progress)
          }
        },
      })

      if (abortRef.current) {
        await engine.unload?.()
        return
      }

      const loadMs = performance.now() - loadStart

      setPhase('generating')
      setProgressText(`Generating analysis with ${chosen.label}…`)
      setProgressFraction(null)

      const genStart = performance.now()
      const completion = await engine.chat.completions.create({
        messages: [
          {
            role: 'system',
            content:
              'You are Kavach, an on-device scam detector for India. Analyze the message and reply in 1-2 short sentences whether it is a scam and why.',
          },
          { role: 'user', content: promptText },
        ],
        temperature: 0,
        max_tokens: 150,
      })
      const genMs = performance.now() - genStart

      if (abortRef.current) return

      const text = completion.choices[0]?.message?.content ?? '(empty)'
      const completionTokens = completion.usage?.completion_tokens ?? 0
      const after = (await navigator.storage?.estimate?.())?.usage ?? 0

      setOutput(text)
      setResults([
        { label: 'Runtime', value: 'WebLLM on WebGPU' },
        { label: 'Model', value: chosen.label },
        { label: 'Parameters', value: chosen.params },
        { label: 'Declared VRAM', value: `${chosen.vramMB} MB` },
        { label: 'Load time', value: `${(loadMs / 1000).toFixed(1)} s` },
        { label: 'Generation time', value: `${genMs.toFixed(0)} ms` },
        { label: 'Tokens generated', value: String(completionTokens) },
        {
          label: 'Inference speed',
          value: completionTokens > 0 ? `${(completionTokens / (genMs / 1000)).toFixed(1)} tokens/sec` : 'n/a',
        },
        { label: 'Storage added', value: mb(after - before) },
        { label: 'Total cached', value: mb(after) },
      ])
      setPhase('done')
      setProgressText('Generation complete.')
      await sample()
    } catch (err) {
      if (!abortRef.current) {
        setError((err as Error).message || String(err))
        setPhase('failed')
      }
    }
  }, [sample, selected, promptText])

  const runMediaPipe = useCallback(async () => {
    if (!taskUrl.trim()) {
      setError('Please provide a direct URL to a cross-origin .task model bundle.')
      setPhase('failed')
      return
    }

    setPhase('loading')
    setError('')
    setResults([])
    setOutput('')
    setProgressText('Resolving MediaPipe WebAssembly…')

    const before = (await navigator.storage?.estimate?.())?.usage ?? 0

    try {
      const { FilesetResolver, LlmInference } = await import('@mediapipe/tasks-genai')
      const fileset = await FilesetResolver.forGenAiTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm',
      )

      setProgressText('Loading MediaPipe model into WebGPU…')
      const loadStart = performance.now()
      const llm = await LlmInference.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: taskUrl.trim() },
        maxTokens: 150,
        topK: 1,
        temperature: 0,
      })
      const loadMs = performance.now() - loadStart

      setPhase('generating')
      setProgressText('Generating response…')
      const genStart = performance.now()
      const text = await llm.generateResponse(promptText)
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
          label: 'Speed',
          value: genMs > 0 ? `${(approxTokens / (genMs / 1000)).toFixed(1)} words/sec` : 'n/a',
        },
        { label: 'Storage added', value: mb(after - before) },
      ])
      setPhase('done')
      setProgressText('MediaPipe generation complete.')
      await sample()
    } catch (err) {
      setError((err as Error).message || String(err))
      setPhase('failed')
    }
  }, [taskUrl, sample, promptText])

  const busy = phase === 'loading' || phase === 'generating'

  return (
    <div className="screen">
      <AppBar title="On-Device AI Laboratory" onBack={() => history.back()} />

      <div className="screen__body">
        <section className="panel">
          <h2 className="panel__title">Device & WebGPU Capabilities</h2>
          {env.map((l) => (
            <div className="meta-row" key={l.label}>
              <span className="meta-row__k">{l.label}</span>
              <span className="meta-row__v">{l.value}</span>
            </div>
          ))}
          <div className="meta-row">
            <span className="meta-row__k">Cached Storage</span>
            <span className="meta-row__v">{mb(used)}</span>
          </div>
        </section>

        {env.some((l) => l.value === 'ABSENT') && (
          <div className="notice notice--caution">
            <div className="notice__body">
              <h2 className="notice__title">WebGPU Unavailable in this context</h2>
              <p className="notice__text">
                WebGPU requires a secure HTTPS origin. Please ensure you are viewing this over HTTPS.
              </p>
            </div>
          </div>
        )}

        <section className="panel">
          <h2 className="panel__title">WebLLM — Select On-Device Model</h2>
          <p className="tactic__note">
            The model weights download once into browser storage (IndexedDB) and run 100% offline.
          </p>

          <div className="meta-row" style={{ marginBottom: 'var(--sp-3)' }}>
            <span className="meta-row__k">Recommended for this device</span>
            <span className="meta-row__v">
              {recommended} · {MODELS[recommended].label}
            </span>
          </div>

          <div className="examples">
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
                disabled={busy}
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
                    {m.params} · {m.vramMB} MB VRAM · {m.why}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 'var(--sp-4)' }}>
            <label style={{ display: 'grid', gap: 'var(--sp-1)', marginBottom: 'var(--sp-3)' }}>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                Test Prompt for Inference:
              </span>
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                rows={3}
                disabled={busy}
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  padding: 'var(--sp-2)',
                  color: 'var(--text)',
                  fontSize: 'var(--fs-sm)',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <button
              className="btn btn--primary"
              onClick={loadAndRunWebLlm}
              disabled={busy}
              style={{ flex: 1, minWidth: '160px' }}
            >
              {phase === 'loading'
                ? 'Downloading & Loading…'
                : phase === 'generating'
                  ? 'Generating Tokens…'
                  : `Load & Run ${selected.label}`}
            </button>

            <button
              type="button"
              className="btn btn--secondary"
              onClick={cancelOrReset}
              style={{ width: 'auto', padding: '0 var(--sp-4)' }}
            >
              Reset Engine
            </button>
          </div>
        </section>

        {busy && (
          <section className="panel" style={{ border: '1px solid var(--heat-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 'bold', color: 'var(--heat)' }}>
                {phase === 'loading' ? 'Loading Model into WebGPU' : 'Generating…'}
              </span>
              {progressFraction !== null && (
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                  {Math.round(progressFraction * 100)}%
                </span>
              )}
            </div>

            {progressFraction !== null && (
              <div
                style={{
                  height: '8px',
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--r-full)',
                  overflow: 'hidden',
                  marginBottom: 'var(--sp-2)',
                  border: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(2, progressFraction * 100))}%`,
                    background: 'var(--heat)',
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
            )}

            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              {progressText || 'Connecting to model repository…'}
            </div>
          </section>
        )}

        {error && (
          <div className="notice notice--danger">
            <div className="notice__body">
              <h2 className="notice__title">Failed</h2>
              <p className="notice__text">{error}</p>
              <button
                type="button"
                className="chip"
                onClick={cancelOrReset}
                style={{ marginTop: 'var(--sp-2)' }}
              >
                Clear and Try Recommended Tier
              </button>
            </div>
          </div>
        )}

        {results.length > 0 && (
          <section className="panel" style={{ borderLeft: '4px solid var(--safe-accent)' }}>
            <h2 className="panel__title">Inference Output & Performance</h2>
            <div className="meta-row">
              <span className="meta-row__k">Model Output</span>
            </div>
            <p className="quote" style={{ marginTop: 'var(--sp-1)', marginBottom: 'var(--sp-3)', whiteSpace: 'pre-wrap' }}>
              {output}
            </p>

            {results.map((l) => (
              <div className="meta-row" key={l.label}>
                <span className="meta-row__k">{l.label}</span>
                <span className="meta-row__v">{l.value}</span>
              </div>
            ))}
          </section>
        )}

        <details className="disclosure">
          <summary className="disclosure__summary">
            <span>Advanced: MediaPipe GenAI Runtime</span>
          </summary>
          <div className="disclosure__body">
            <p className="tactic__note">
              Google’s experimental browser runtime. Requires a link to a CORS-accessible .task Gemma bundle.
            </p>
            <input
              className="field"
              value={taskUrl}
              onChange={(e) => setTaskUrl(e.target.value)}
              placeholder="https://…/gemma3-1b-it-int4.task"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <button
              className="btn btn--secondary"
              onClick={runMediaPipe}
              disabled={busy}
              style={{ marginTop: 'var(--sp-3)' }}
            >
              Load MediaPipe
            </button>
          </div>
        </details>
      </div>
    </div>
  )
}
