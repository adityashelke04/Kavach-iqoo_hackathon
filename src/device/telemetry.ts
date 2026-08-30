import { MODELS, type Tier, type ModelSpec } from '../detector/models.ts'
import { onModelProgress, activeTier, type ModelProgress } from '../detector/local.ts'

export interface DeviceTelemetry {
  isSecureContext: boolean
  webgpuSupported: boolean
  adapterName: string | null
  maxStorageBufferBindingMB: number | null
  tier: Tier
  model: ModelSpec
  storageUsageMB: number | null
  storageQuotaMB: number | null
  progress: ModelProgress | null
  offlineCapable: boolean
}

let cachedTelemetry: DeviceTelemetry | null = null
let currentProgress: ModelProgress | null = null

// Subscribe to local model loading progress
if (typeof window !== 'undefined') {
  onModelProgress((p) => {
    currentProgress = p
  })
}

export async function getDeviceTelemetry(): Promise<DeviceTelemetry> {
  const isSecure = typeof window !== 'undefined' ? window.isSecureContext : false
  let webgpuSupported = false
  let adapterName: string | null = null
  let maxStorageBufferBindingMB: number | null = null

  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const gpu = (navigator as unknown as { gpu: { requestAdapter: () => Promise<{ limits?: { maxStorageBufferBindingSize?: number }; requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string; description?: string }> } | null> } }).gpu
      const adapter = await gpu.requestAdapter()
      if (adapter) {
        webgpuSupported = true
        if (adapter.limits?.maxStorageBufferBindingSize) {
          maxStorageBufferBindingMB = Math.round(adapter.limits.maxStorageBufferBindingSize / (1024 * 1024))
        }
        if (adapter.requestAdapterInfo) {
          const info = await adapter.requestAdapterInfo()
          adapterName = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'WebGPU Hardware Adapter'
        } else {
          adapterName = 'WebGPU Hardware Accelerator'
        }
      }
    } catch {
      webgpuSupported = false
    }
  }

  let storageUsageMB: number | null = null
  let storageQuotaMB: number | null = null

  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate()
      if (typeof est.usage === 'number') storageUsageMB = Math.round((est.usage / (1024 * 1024)) * 10) / 10
      if (typeof est.quota === 'number') storageQuotaMB = Math.round((est.quota / (1024 * 1024)) * 10) / 10
    } catch {
      // ignore
    }
  }

  // `activeTier`, not `resolveTier`: this panel reports what the phone is
  // doing, and a pinned or already-loaded tier is what it is doing (D20).
  const tier = await activeTier()
  const model = MODELS[tier]

  const offlineCapable = typeof navigator !== 'undefined' && 'serviceWorker' in navigator

  cachedTelemetry = {
    isSecureContext: isSecure,
    webgpuSupported,
    adapterName,
    maxStorageBufferBindingMB,
    tier,
    model,
    storageUsageMB,
    storageQuotaMB,
    progress: currentProgress,
    offlineCapable,
  }

  return cachedTelemetry
}
