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
 * 2. **It is slow, and since D15 the user waits for it.** A 3B model on a
 *    phone produces a couple of hundred JSON tokens in tens of seconds, and
 *    D15 removed the early rules-only paint that used to fill that time — so
 *    this engine IS the wait the Check screen shows. That is deliberate (the
 *    wait is the proof of work, §10.6), but it means every extra second here
 *    is a second a frightened person spends looking at a spinner. An earlier
 *    version of this comment described D13's progressive upgrade, which no
 *    longer exists; do not design against it.
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

/**
 * §8.1: "enough for the JSON, tight enough to stay fast."
 *
 * Exported so a gate can assert it, because it had drifted to 700 and nothing
 * noticed. The largest real answer in the corpus — four tactics, each with
 * evidence phrases and a note — lands around 350 tokens; the rest was buying a
 * longer worst case, and on a phone the worst case is the one a visitor stands
 * through.
 */
export const MAX_TOKENS = 500

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
/** True only once the weights are resident and generation can start. */
let engineReady = false
const listeners = new Set<ProgressListener>()

/**
 * A tier chosen deliberately, overriding what this device would pick for itself.
 *
 * D7 promises the user can override the tier. Without this, `detect()` — which
 * has no tier to pass — would call `resolveTier()` every time, disagree with
 * whatever was deliberately loaded, and unload it to fetch the automatic choice
 * instead. On a phone that is a second several-hundred-megabyte download in the
 * middle of a session, triggered by the user having expressed a preference.
 *
 * Set by `getEngine(tier)` and `setPreferredTier`. Deliberately survives
 * `unloadEngine`: unloading frees GPU memory, it does not un-choose a tier.
 */
let preferredTier: Tier | null = null

/**
 * Models that have already failed to load, by id.
 *
 * A load failure is nearly always permanent for this device — a bad config, a
 * buffer cap the weights do not fit under, no WebGPU. Retrying it on every
 * message costs a full re-download each time.
 */
const failedModels = new Map<string, Error>()

/** Pin the tier for every later load. `null` returns to measuring the device. */
export function setPreferredTier(tier: Tier | null): void {
  preferredTier = tier
}

export function getPreferredTier(): Tier | null {
  return preferredTier
}

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
  // An explicit tier is a decision, so it sticks: the next `detect()` — which
  // has no tier to pass — must agree with it rather than re-measuring the
  // device and unloading the model that was just deliberately loaded.
  if (tier) preferredTier = tier

  const chosen = MODELS[tier ?? preferredTier ?? (await resolveTier())]

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

  // A model that has already failed to load on this device will fail again for
  // the same reason. Without this, every `detect()` retries the whole load —
  // which on a phone means re-downloading hundreds of megabytes per message,
  // and a run of eight messages exhausting the storage quota. That is exactly
  // what `test:local` produced before this check existed: the real error was a
  // bad model config, and every message after the first reported "Quota
  // exceeded" instead, hiding it.
  const priorFailure = failedModels.get(chosen.modelId)
  if (priorFailure) throw priorFailure

  loadedModelId = chosen.modelId
  engineReady = false
  enginePromise = (async () => {
    // Ask for persistent storage BEFORE downloading several hundred megabytes.
    //
    // Two reasons, and the second is the demo. Best-effort storage is subject
    // to eviction under pressure, so the offline beat (§13 beat 4) would depend
    // on the browser not having quietly reclaimed the weights overnight. And
    // Chrome grants a materially larger quota to a persistent origin — a
    // partial download that dies at "Quota exceeded" is what this looks like
    // otherwise, which is how `test:local` first presented a completely
    // unrelated config bug.
    //
    // Chrome decides by engagement heuristic and may simply say no. That is
    // survivable, so this never blocks or throws.
    try {
      await navigator.storage?.persist?.()
    } catch {
      /* not supported, or refused — carry on with best-effort storage */
    }

    const webllm = await import('@mlc-ai/web-llm')
    emit({ fraction: 0, text: `Preparing ${chosen.label}…`, done: false })

    // Fail loudly and early on a model id this build of WebLLM does not carry,
    // rather than with whatever the runtime says several layers down.
    const known = webllm.prebuiltAppConfig.model_list.some(
      (m) => m.model_id === chosen.modelId,
    )
    if (!known) {
      throw new Error(`${chosen.modelId} is not in this WebLLM build`)
    }

    // Apply our repairs to WebLLM's own record for this model (see
    // `ModelSpec.overrides`). Everything else in the prebuilt config is left
    // exactly as shipped.
    const appConfig = chosen.overrides
      ? {
          ...webllm.prebuiltAppConfig,
          model_list: webllm.prebuiltAppConfig.model_list.map((m) =>
            m.model_id === chosen.modelId
              ? { ...m, overrides: { ...m.overrides, ...chosen.overrides } }
              : m,
          ),
        }
      : webllm.prebuiltAppConfig

    const engine = await webllm.CreateMLCEngine(chosen.modelId, {
      appConfig,
      initProgressCallback: (r) => {
        emit({
          fraction: typeof r.progress === 'number' ? r.progress : null,
          text: r.text,
          done: false,
        })
      },
    })

    engineReady = true
    emit({ fraction: 1, text: `${chosen.label} ready`, done: true })
    return engine as unknown as MlcEngine
  })()

  try {
    return await enginePromise
  } catch (err) {
    enginePromise = null
    loadedModelId = null
    engineReady = false
    // Remembered so the next caller fails in milliseconds instead of
    // re-downloading. `unloadEngine()` clears it, which is how a user-triggered
    // retry gets a genuinely fresh attempt.
    failedModels.set(chosen.modelId, err as Error)
    emit({ fraction: null, text: `${chosen.label} could not load`, done: true })
    throw err
  }
}

/**
 * Whether the weights are already resident, so a `detect()` would go straight
 * to generating.
 *
 * The orchestrator budgets a cold call differently from a warm one (§6): a
 * first run legitimately spends minutes downloading before it can generate a
 * token, and timing that out would throw away a nearly-complete download along
 * with the on-device claim it exists to support.
 */
/**
 * The tier that is actually in play: what is loaded, else what has been pinned,
 * else what this device would choose for itself.
 *
 * `resolveTier()` answers a different question — "what would this device pick
 * from scratch" — and callers wanting a *label* kept reaching for it and
 * getting an answer that disagreed with the model in memory. The Check screen
 * named one model while another generated, which is a bad thing for a screen
 * whose entire job is an honest account of what the phone is doing (§9).
 */
export async function activeTier(): Promise<Tier> {
  if (loadedModelId) {
    const found = (Object.keys(MODELS) as Tier[]).find(
      (t) => MODELS[t].modelId === loadedModelId,
    )
    if (found) return found
  }
  return preferredTier ?? (await resolveTier())
}

export function isModelLoaded(): boolean {
  // Deliberately not `enginePromise !== null`: that is also true for the whole
  // duration of a download, which is precisely the case this has to separate.
  return engineReady
}

/** Cleanly unload the active engine and release WebGPU memory. */
export async function unloadEngine(): Promise<void> {
  if (enginePromise) {
    try {
      const old = await enginePromise
      await old.unload?.()
    } catch {
      /* ignore */
    }
  }
  enginePromise = null
  loadedModelId = null
  engineReady = false
  // An explicit unload is the user asking for a clean slate, so a model that
  // failed before is allowed one more genuine attempt.
  failedModels.clear()
  emit({ fraction: null, text: 'Engine unloaded', done: true })
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

    // The load is the long part of a cold call — minutes, not seconds — so it
    // is also the part a user is most likely to walk away from. `getEngine`
    // deliberately takes no signal (the download is shared, and one caller
    // leaving must not cancel it for everyone else, or throw away weights the
    // device has nearly finished paying for). What must not happen is what
    // happened before D20: the caller leaves, the download finishes some
    // minutes later, and this function calmly starts generating for a screen
    // nobody is looking at — on the same GPU the next check needs.
    if (signal.aborted) throw new Error('aborted')
    const engine = await getEngine()
    if (signal.aborted) throw new Error('aborted')

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
              ...(input.briefing ? { briefing: input.briefing } : {}),
              ...(input.reconsider ? { reconsider: input.reconsider } : {}),
            }),
          },
        ],
        temperature: 0,
        max_tokens: MAX_TOKENS,
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
