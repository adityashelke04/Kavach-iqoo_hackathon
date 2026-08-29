/**
 * On-device model tiers — SPEC.md §8.1, decision D7.
 *
 * THE CONSTRAINT IS NOT THE PHONE.
 *
 * The iQOO 15 has a Snapdragon 8 Elite Gen 5, an Adreno 840 and 12–16 GB of
 * RAM. None of that is the ceiling. Chrome on Android caps the WebGPU limit
 * `maxStorageBufferBindingSize`, commonly at 128 MiB, no matter how much
 * memory the device has — and a model whose largest single weight binding
 * exceeds that cap simply fails to load. This is the known cause of WebLLM
 * failing on Android where the same model runs on a laptop.
 *
 * So the tier a device can run is decided by a number we have to *measure*,
 * not by the spec sheet. `/dev/llm` prints it. Everything here is chosen
 * against that reading, and `pickTier` is deliberately conservative: a demo
 * that loads a smaller model is a demo; a demo that OOMs on stage is not.
 *
 * All entries are `q4f16_1` (4-bit weights, fp16 activations), which is the
 * quantisation WebLLM ships for mobile. `vramMB` is MLC's own declared
 * requirement from `prebuiltAppConfig`, not an estimate of ours. Real download
 * size is measured on device via `navigator.storage.estimate()` rather than
 * guessed here.
 */

export type Tier = 'low' | 'standard' | 'max'

export interface ModelSpec {
  tier: Tier
  /** WebLLM prebuilt model id. Must exist in `prebuiltAppConfig.model_list`. */
  modelId: string
  label: string
  /** Approximate parameter count, for the device panel (§9). */
  params: string
  /** MLC's declared VRAM requirement, in MB. */
  vramMB: number
  /** Why this one, in one line. */
  why: string
  /**
   * Fixes applied to WebLLM's own prebuilt record for this model.
   *
   * Not tuning — repairs. A shipped `prebuiltAppConfig` entry can be internally
   * inconsistent, in which case the model does not load at all and the error
   * arrives from deep inside the runtime. See the Gemma 3 note below.
   */
  overrides?: Record<string, number>
}

/**
 * Instruction-following matters more than parameter count here. The engine has
 * to return strict JSON with phrases copied verbatim; a larger model that
 * rambles is worse than a smaller one that obeys the schema.
 */
export const MODELS: Record<Tier, ModelSpec> = {
  low: {
    tier: 'low',
    modelId: 'gemma3-1b-it-q4f16_1-MLC',
    label: 'Gemma 3 1B',
    params: '1B',
    vramMB: 711,
    why: 'Smallest model that still follows a JSON schema reliably. Emergency tier for a device with a tight buffer cap.',
    /**
     * WITHOUT THIS THE LOW TIER DOES NOT LOAD AT ALL.
     *
     * WebLLM's prebuilt record for Gemma 3 1B ships `context_window_size: 4096`
     * *and* `sliding_window_size: 512`, and the runtime rejects having both
     * positive: "Only one of context_window_size and sliding_window_size can be
     * positive." Found by `npm run test:local` — every fixture failed before
     * generation, on every tier-`low` device.
     *
     * We keep the 4096 window and disable the sliding one, rather than the
     * reverse: the shared system prompt (§8.4) is most of a thousand tokens on
     * its own, so a 512-token window could not hold the instructions, let alone
     * the message being analysed.
     *
     * This is the tier a cheap Android falls back to — "we're building it for
     * everyone else" (§1) — so it is not a tier that can be left broken because
     * the demo phone never selects it.
     */
    overrides: { sliding_window_size: -1 },
  },
  standard: {
    tier: 'standard',
    modelId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B Instruct',
    params: '1B',
    vramMB: 879,
    why: 'The default. Strong instruction-following for its size and fast enough that a verdict does not feel stalled.',
  },
  max: {
    tier: 'max',
    modelId: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 3B Instruct',
    params: '3B',
    vramMB: 2505,
    why: 'Best structured-output quality that has a realistic chance of loading inside Chrome on Android. This is the tier the pitch exercises.',
  },
}

/**
 * Larger candidates, in ascending order, for the `/dev/llm` ceiling probe.
 *
 * The point of this list is to find empirically where Chrome stops us on the
 * actual device. Do not promote one of these to a tier without loading it on
 * the iQOO twice — once cold, once from cache — and watching it generate.
 */
export const CEILING_PROBES: ModelSpec[] = [
  {
    tier: 'max',
    modelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 3B Instruct',
    params: '3B',
    vramMB: 2264,
    why: 'Lighter 3B than Qwen2.5-3B; try first if the 3B tier fails.',
  },
  {
    tier: 'max',
    modelId: 'Qwen3-4B-q4f16_1-MLC',
    label: 'Qwen3 4B',
    params: '4B',
    vramMB: 3432,
    why: 'Next step up. Expect this to be near or past the Android ceiling.',
  },
  {
    tier: 'max',
    modelId: 'Phi-4-mini-instruct-q4f16_1-MLC',
    label: 'Phi-4 mini',
    params: '3.8B',
    vramMB: 3438,
    why: 'Strong at structured output; heavier than Qwen3-4B in practice.',
  },
  {
    tier: 'max',
    modelId: 'Qwen3.5-4B-q4f16_1-MLC',
    label: 'Qwen3.5 4B',
    params: '4B',
    vramMB: 3868,
    why: 'Stretch goal. Only reachable if the buffer cap is unusually generous.',
  },
]

/**
 * Desktop-class candidates.
 *
 * A gaming laptop reports a `maxStorageBufferBindingSize` in the gigabytes
 * rather than 128 MiB, so these load there and are worth measuring. They are
 * kept separate from `CEILING_PROBES` because the pitch runs on the iQOO (§13),
 * and a tier that only works on the laptop cannot be the tier we demo.
 *
 * Promoting one of these to the Max tier means the demo device changes, which
 * is a §16 decision, not a config edit.
 */
export const DESKTOP_PROBES: ModelSpec[] = [
  {
    tier: 'max',
    modelId: 'Llama-3.1-8B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.1 8B Instruct',
    params: '8B',
    vramMB: 5001,
    why: 'Desktop-class. Excellent instruction-following; needs roughly 5 GB of GPU budget.',
  },
  {
    tier: 'max',
    modelId: 'Qwen2.5-7B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 7B Instruct',
    params: '7B',
    vramMB: 5107,
    why: 'Desktop-class. The strongest structured-JSON behaviour of the 7B class in practice.',
  },
  {
    tier: 'max',
    modelId: 'Qwen3-8B-q4f16_1-MLC',
    label: 'Qwen3 8B',
    params: '8B',
    vramMB: 5696,
    why: 'Desktop-class stretch. Slowest of the three to first token.',
  },
]

export interface DeviceLimits {
  /** WebGPU `maxStorageBufferBindingSize`, in bytes. Null when unknown. */
  maxStorageBufferBindingSize: number | null
  /** `navigator.deviceMemory`, in GB. Null when the browser withholds it. */
  deviceMemoryGB: number | null
}

/**
 * Choose the heaviest tier this device can plausibly carry.
 *
 * Conservative on purpose. §9 rewards genuine device work and the Max tier
 * exists to be exercised, but the honest way to earn that is to *measure* the
 * ceiling once on the real phone and pin the tier, not to gamble on stage.
 * A user can always override in Settings (D7).
 */
export function pickTier(limits: DeviceLimits): Tier {
  const bindingMB =
    limits.maxStorageBufferBindingSize === null
      ? null
      : limits.maxStorageBufferBindingSize / (1024 * 1024)

  // The documented Android ceiling. At or below it, a 3B model's largest
  // binding will not fit, so do not attempt one.
  if (bindingMB !== null && bindingMB <= 128) return 'standard'

  if (limits.deviceMemoryGB !== null && limits.deviceMemoryGB < 4) return 'low'

  if (bindingMB !== null && bindingMB >= 1024) return 'max'

  return 'standard'
}
