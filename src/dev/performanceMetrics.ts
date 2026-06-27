import { useGameStore } from '../store/gameStore'

type MemoryInfo = {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

type PerformanceWithMemory = Performance & {
  memory?: MemoryInfo
}

type AssetMetrics = {
  textureCount?: number
  spineResourceCount?: number
  domAssetCount?: number
}

type RoundSample = {
  preparationMs: number
  startRoundMs: number
  totalMs: number
}

const REPORT_INTERVAL_MS = 10_000
const MEMORY_INTERVAL_MS = 30_000
const LONG_FRAME_MS = 50
const ROUND_SUMMARY_SIZE = 10

let installed = false
let enabled = false
let rafId = 0
let lastFrameTs = 0
let reportTimer: ReturnType<typeof setInterval> | null = null
let memoryTimer: ReturnType<typeof setInterval> | null = null
let longTaskObserver: PerformanceObserver | null = null
let memoryUnavailableLogged = false

const frameTimes: number[] = []
const fpsSamples: number[] = []

const lifecycle = {
  rendererCreates: 0,
  rendererDestroys: 0,
  rendererResizes: 0,
}

const assets = {
  loading: false,
  startTs: 0,
  durationMs: 0,
  textureCount: 0,
  spineResourceCount: 0,
  domAssetCount: 0,
}

let latestHeapUsedMb: number | null = null
let latestHeapTotalMb: number | null = null
let latestHeapLimitMb: number | null = null

let roundSeq = 0
let activeRound: {
  id: number
  startTs: number
  preparationMs: number
  startRoundMs: number
  rendererStartTs: number
} | null = null
const roundSamples: RoundSample[] = []

function mb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10
}

function avg(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function max(values: readonly number[]): number {
  return values.length ? Math.max(...values) : 0
}

function min(values: readonly number[]): number {
  return values.length ? Math.min(...values) : 0
}

function p95(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
}

function phase(): string {
  try {
    return useGameStore.getState().phase
  } catch {
    return 'UNKNOWN'
  }
}

function logLifecycle(message: string): void {
  if (import.meta.env.DEV) console.log(message)
}

function readMemory(logAvailable = false): void {
  const memory = (performance as PerformanceWithMemory).memory
  if (!memory) {
    if (!memoryUnavailableLogged) {
      memoryUnavailableLogged = true
      console.log('[DR metrics] performance.memory is not available')
    }
    return
  }

  latestHeapUsedMb = mb(memory.usedJSHeapSize)
  latestHeapTotalMb = mb(memory.totalJSHeapSize)
  latestHeapLimitMb = mb(memory.jsHeapSizeLimit)

  if (logAvailable) {
    console.table({
      'used JS Heap': `${latestHeapUsedMb} MB`,
      'total JS Heap': `${latestHeapTotalMb} MB`,
      'heap limit': `${latestHeapLimitMb} MB`,
    })
  }
}

function tickFrame(now: number): void {
  if (!enabled) return
  if (lastFrameTs > 0) {
    const dt = now - lastFrameTs
    frameTimes.push(dt)
    if (dt > 0) fpsSamples.push(1000 / dt)
  }
  lastFrameTs = now
  rafId = requestAnimationFrame(tickFrame)
}

function resetWindowSamples(): void {
  frameTimes.length = 0
  fpsSamples.length = 0
}

function roundSummary(): Record<string, string | number> {
  const samples = roundSamples.slice(-ROUND_SUMMARY_SIZE)
  const prep = samples.map((s) => s.preparationMs)
  const start = samples.map((s) => s.startRoundMs)
  const total = samples.map((s) => s.totalMs)
  return {
    count: samples.length,
    'prep avg ms': avg(prep).toFixed(1),
    'prep p95 ms': p95(prep).toFixed(1),
    'prep max ms': max(prep).toFixed(1),
    'startRound avg ms': avg(start).toFixed(1),
    'startRound p95 ms': p95(start).toFixed(1),
    'startRound max ms': max(start).toFixed(1),
    'total avg ms': avg(total).toFixed(1),
    'total p95 ms': p95(total).toFixed(1),
    'total max ms': max(total).toFixed(1),
  }
}

function report(): void {
  readMemory()
  const longFrames = frameTimes.filter((value) => value > LONG_FRAME_MS).length
  const roundAvg = avg(roundSamples.map((s) => s.totalMs))

  console.log('========== DeepRush Performance ==========')
  console.table({
    'Frames': frameTimes.length,
    'FPS avg': avg(fpsSamples).toFixed(1),
    'FPS min': min(fpsSamples).toFixed(1),
    'FPS max': max(fpsSamples).toFixed(1),
    'Frame avg': `${avg(frameTimes).toFixed(1)}ms`,
    'Frame p95': `${p95(frameTimes).toFixed(1)}ms`,
    'Frame max': `${max(frameTimes).toFixed(1)}ms`,
    'Long frames >50ms': longFrames,
    'Renderer creates': lifecycle.rendererCreates,
    'Renderer destroys': lifecycle.rendererDestroys,
    'Renderer resizes': lifecycle.rendererResizes,
    'Rounds played': roundSamples.length,
    'Round avg': `${roundAvg.toFixed(1)}ms`,
    'Asset load': assets.durationMs > 0 ? `${assets.durationMs.toFixed(1)}ms` : 'pending',
    'Textures': assets.textureCount,
    'Spine resources': assets.spineResourceCount,
    'Heap used': latestHeapUsedMb === null ? 'n/a' : `${latestHeapUsedMb}MB`,
  })
  console.log('==========================================')
  resetWindowSamples()
}

function installLongTaskObserver(): void {
  if (!('PerformanceObserver' in window)) return
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration <= LONG_FRAME_MS) continue
        console.log('[DR metrics] Long task', {
          duration: Number(entry.duration.toFixed(1)),
          phase: phase(),
          timestamp: Number(entry.startTime.toFixed(1)),
        })
      }
    })
    longTaskObserver.observe({ entryTypes: ['longtask'] })
  } catch {
    longTaskObserver = null
  }
}

export function installDeepRushPerformanceMetrics(): void {
  if (!import.meta.env.DEV || installed) return
  installed = true
  enabled = true
  lastFrameTs = 0
  rafId = requestAnimationFrame(tickFrame)
  reportTimer = setInterval(report, REPORT_INTERVAL_MS)
  memoryTimer = setInterval(() => readMemory(true), MEMORY_INTERVAL_MS)
  readMemory()
  installLongTaskObserver()
  ;(window as unknown as Record<string, unknown>).__DR_METRICS__ = {
    report,
    reset: () => {
      resetWindowSamples()
      roundSamples.length = 0
      console.log('[DR metrics] reset')
    },
    stop: uninstallDeepRushPerformanceMetrics,
  }
  console.log('[DR metrics] enabled. Disable with __DR_METRICS__.stop() or remove installDeepRushPerformanceMetrics() from main.tsx.')
}

export function uninstallDeepRushPerformanceMetrics(): void {
  enabled = false
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  if (reportTimer) clearInterval(reportTimer)
  reportTimer = null
  if (memoryTimer) clearInterval(memoryTimer)
  memoryTimer = null
  longTaskObserver?.disconnect()
  longTaskObserver = null
  installed = false
  console.log('[DR metrics] disabled')
}

export function recordRendererCreate(): void {
  if (!import.meta.env.DEV) return
  lifecycle.rendererCreates += 1
  logLifecycle(`[GameCanvas] renderer create #${lifecycle.rendererCreates}`)
}

export function recordRendererDestroy(): void {
  if (!import.meta.env.DEV) return
  lifecycle.rendererDestroys += 1
  logLifecycle(`[GameCanvas] renderer destroy #${lifecycle.rendererDestroys}`)
}

export function recordRendererResize(width: number, height: number): void {
  if (!import.meta.env.DEV) return
  lifecycle.rendererResizes += 1
  logLifecycle(`[GameCanvas] renderer resize ${width}x${height}`)
}

export function recordAssetLoadStart(metrics: AssetMetrics = {}): void {
  if (!import.meta.env.DEV) return
  assets.loading = true
  assets.startTs = performance.now()
  assets.textureCount = metrics.textureCount ?? assets.textureCount
  assets.spineResourceCount = metrics.spineResourceCount ?? assets.spineResourceCount
  assets.domAssetCount = metrics.domAssetCount ?? assets.domAssetCount
}

export function recordAssetLoadEnd(metrics: AssetMetrics = {}): void {
  if (!import.meta.env.DEV) return
  if (assets.startTs > 0) assets.durationMs = performance.now() - assets.startTs
  assets.loading = false
  assets.textureCount = metrics.textureCount ?? assets.textureCount
  assets.spineResourceCount = metrics.spineResourceCount ?? assets.spineResourceCount
  assets.domAssetCount = metrics.domAssetCount ?? assets.domAssetCount
  console.table({
    'asset load ms': assets.durationMs.toFixed(1),
    textures: assets.textureCount,
    'spine resources': assets.spineResourceCount,
    'dom assets': assets.domAssetCount,
  })
}

export function recordRoundStart(): void {
  if (!import.meta.env.DEV) return
  activeRound = {
    id: ++roundSeq,
    startTs: performance.now(),
    preparationMs: 0,
    startRoundMs: 0,
    rendererStartTs: 0,
  }
}

export function recordRoundPreparationDone(): void {
  if (!import.meta.env.DEV || !activeRound) return
  activeRound.preparationMs = performance.now() - activeRound.startTs
}

export function recordRendererStartRoundStart(): void {
  if (!import.meta.env.DEV || !activeRound) return
  activeRound.rendererStartTs = performance.now()
}

export function recordRendererStartRoundEnd(): void {
  if (!import.meta.env.DEV || !activeRound || activeRound.rendererStartTs <= 0) return
  activeRound.startRoundMs = performance.now() - activeRound.rendererStartTs
}

export function recordRoundComplete(): void {
  if (!import.meta.env.DEV || !activeRound) return
  const sample: RoundSample = {
    preparationMs: activeRound.preparationMs,
    startRoundMs: activeRound.startRoundMs,
    totalMs: performance.now() - activeRound.startTs,
  }
  roundSamples.push(sample)
  if (roundSamples.length % ROUND_SUMMARY_SIZE === 0) {
    console.log(`[DR metrics] Last ${ROUND_SUMMARY_SIZE} rounds`)
    console.table(roundSummary())
  }
  activeRound = null
}

export function recordRoundCancel(): void {
  if (!import.meta.env.DEV) return
  activeRound = null
}
