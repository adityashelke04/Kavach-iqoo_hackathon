import type { DetectionInput, DetectionResult, Detector } from './types.ts'
import { classifySender } from './sender.ts'
import { resultFromLlm, senderFact } from './llm.ts'
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.ts'
import { MODELS, pickTier, type Tier } from './models.ts'

/**
 * LocalDetector — SPEC.md §8.1, the headline phase.
 *
 * WebLLM over WebGPU. The model downloads once and lives in the browser cache,
 * so from the second run onward the whole thing works with the network off,
 * which is the demo beat the pitch is built around (D6, §13).
 *
 * Two things worth knowing before changing anything here:
 *
 * 1. **The engine is a singleton.** Creating a second MLCEngine while one is
 *    loaded will try to allocate the weights twice and take the tab down on a
 *    phone. `getEngine` is the only construction path.
 * 2. **It is slow, and that is designed for.** A 3B model on a phone produces
 *    a couple of hundred JSON tokens in tens of seconds. Nothing waits on it:
 *    the orchestrator shows the rules verdict immediately and upgrades in
 *    place when this returns (D13). If that ever changes, this engine becomes
 *    a 30-second spinner in front of a frightened person.
 */

/** Progress while the model downloads and initialises. */
export interface ModelProgress {
  /** 0-1 where the runtime reports it, else null. */
  fraction: number | null
  /** The runtime's own human-readable line. */
  text: string
  done: boolean
}

type ProgressListener = (p: ModelProgress) => void

interface MlcEngine {
  chat: {
    completions: {
      create(req: {
        messages: { role: string; content: string }[]
        temperature?: number
        max_tokens?: number
        response_format?: { type: string }
      }): Promise<{ choices: { message?: { content?: string } }[] }>
    }
  }
  interruptGenerate?: () => void
  unload?: () => Promise<void>
}

let enginePromise: Promise<MlcEngine> | null = null
let loadedModelId: string | null = null
const listeners = new Set<ProgressListener>()

export function onModelProgress(fn: ProgressListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(p: ModelProgress) {
  for (const fn of listeners) fn(p)
}

/** Cheap, synchronous-ish capability probe. Never downloads anything (§6). */
export async function localSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  // WebGPU is only exposed in a secure context. On the LAN dev server this is
  // false and the absence has nothing to do with the GPU — the P0 trap.
  if (!window.isSecureContext) return false

  const gpu = (navigator as Navigator & { gpu?: unknown }).gpu as
    | { requestAdapter(): Promise<unknown | null> }
    | undefined
  if (!gpu) return false

  try {
    return (await gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

interface AdapterLimits {
  limits?: { maxStorageBufferBindingSize?: number }
}

/**
 * Which tier this device can carry.
 *
 * Decided by Chrome's WebGPU buffer cap, not by the phone's spec sheet — see
 * the header of `models.ts` for why that distinction matters.
 */
export async function resolveTier(): Promise<Tier> {
  let maxStorageBufferBindingSize: number | null = null

  const gpu = (navigator as Navigator & { gpu?: unknown }).gpu as
    | { requestAdapter(): Promise<AdapterLimits | null> }
    | undefined

  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter()
      const limit = adapter?.limits?.maxStorageBufferBindingSize
      if (typeof limit === 'number') maxStorageBufferBindingSize = limit
    } catch {
      /* leave null and let pickTier be conservative */
    }
  }

  const deviceMemoryGB =
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null

  return pickTier({ maxStorageBufferBindingSize, deviceMemoryGB })
}

/**
 * Load the model, or return the already-loaded one.
 *
 * Safe to call repeatedly — the promise is cached, so a second caller during
 * the download attaches to the same load rather than starting another.
 */
export async function getEngine(tier?: Tier): Promise<MlcEngine> {
  const chosen = MODELS[tier ?? (await resolveTier())]

  if (enginePromise && loadedModelId === chosen.modelId) return enginePromise

  if (enginePromise && loadedModelId !== chosen.modelId) {
    // Switching tiers: release the old weights before allocating new ones.
    try {
      const old = await enginePromise
      await old.unload?.()
    } catch {
      /* unloading is best-effort */
    }
  }

  loadedModelId = chosen.modelId
  enginePromise = (async () => {
    const webllm = await import('@mlc-ai/web-llm')
    emit({ fraction: 0, text: `Preparing ${chosen.label}…`, done: false })

    const engine = await webllm.CreateMLCEngine(chosen.modelId, {
      initProgressCallback: (r) => {
        emit({
          fraction: typeof r.progress === 'number' ? r.progress : null,
          text: r.text,
          done: false,
        })
      },
    })

    emit({ fraction: 1, text: `${chosen.label} ready`, done: true })
    return engine as unknown as MlcEngine
  })()

  try {
    return await enginePromise
  } catch (err) {
    // A failed load must not poison every later attempt.
    enginePromise = null
    loadedModelId = null
    throw err
  }
}

/** Start the download early so the first analysis is not also the first load. */
export function preloadModel(tier?: Tier): void {
  void getEngine(tier).catch(() => {
    /* reported through onModelProgress; never throws into the app */
  })
}

export const localDetector: Detector = {
  id: 'local',

  async isAvailable(): Promise<boolean> {
    return localSupported()
  },

  async detect(input: DetectionInput, signal: AbortSignal): Promise<DetectionResult> {
    const startedAt = Date.now()
    const engine = await getEngine()

    // Deterministic and pure, so this is the same SenderSignal the
    // orchestrator computed (D9, §7).
    const senderSignal = classifySender(input.sender)
    const fact = senderFact(senderSignal)

    const onAbort = () => engine.interruptGenerate?.()
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      const completion = await engine.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildUserPrompt({
              text: input.text,
              channel: input.channel ?? 'text',
              senderFact: fact,
            }),
          },
        ],
        temperature: 0,
        max_tokens: 700,
        response_format: { type: 'json_object' },
      })

      if (signal.aborted) throw new Error('aborted')

      const content = completion.choices[0]?.message?.content
      if (typeof content !== 'string' || content.trim() === '') {
        throw new Error('on-device model returned nothing')
      }

      return resultFromLlm(content, {
        input,
        senderSignal,
        engineId: 'local',
        latencyMs: Date.now() - startedAt,
      })
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  },
}
