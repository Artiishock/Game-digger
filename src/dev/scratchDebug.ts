export interface ScratchFrameSample {
  calls: number
  stamps: number
  renderPasses: number
  affectedChunks: number
  multiChunkCalls: number
  timeMs: number
  mode: 'normal' | 'turbo' | 'idle'
}

interface ScratchAccum {
  frames: number
  calls: number
  stamps: number
  renderPasses: number
  affectedChunks: number
  multiChunkCalls: number
  timeMs: number
  maxMs: number
}

const emptyAccum = (): ScratchAccum => ({
  frames: 0,
  calls: 0,
  stamps: 0,
  renderPasses: 0,
  affectedChunks: 0,
  multiChunkCalls: 0,
  timeMs: 0,
  maxMs: 0,
})

let _active = false
let _intervalSec = 8
let _lastLogAt = 0
let _all = emptyAccum()
let _normal = emptyAccum()
let _turbo = emptyAccum()

function resetAccum(): void {
  _all = emptyAccum()
  _normal = emptyAccum()
  _turbo = emptyAccum()
}

function addSample(acc: ScratchAccum, sample: ScratchFrameSample): void {
  acc.frames++
  acc.calls += sample.calls
  acc.stamps += sample.stamps
  acc.renderPasses += sample.renderPasses
  acc.affectedChunks += sample.affectedChunks
  acc.multiChunkCalls += sample.multiChunkCalls
  acc.timeMs += sample.timeMs
  if (sample.timeMs > acc.maxMs) acc.maxMs = sample.timeMs
}

function fmt(acc: ScratchAccum): string {
  const avgPerCall = acc.calls > 0 ? acc.timeMs / acc.calls : 0
  const avgPerFrame = acc.frames > 0 ? acc.timeMs / acc.frames : 0
  return (
    `frames=${acc.frames} calls=${acc.calls} stamps=${acc.stamps} ` +
    `renderPasses=${acc.renderPasses} affectedChunks=${acc.affectedChunks} ` +
    `multiChunk=${acc.multiChunkCalls} avgCall=${avgPerCall.toFixed(3)}ms ` +
    `avgFrame=${avgPerFrame.toFixed(3)}ms maxFrame=${acc.maxMs.toFixed(3)}ms`
  )
}

function emitReport(reset = true): void {
  console.log(`[DR scratch] ${_intervalSec}s: ${fmt(_all)}`)
  if (_normal.calls > 0) console.log(`[DR scratch] normal: ${fmt(_normal)}`)
  if (_turbo.calls > 0) console.log(`[DR scratch] turbo: ${fmt(_turbo)}`)
  if (reset) {
    resetAccum()
    _lastLogAt = performance.now()
  }
}

export function tickScratchLog(sample: ScratchFrameSample): void {
  if (!_active) return
  addSample(_all, sample)
  if (sample.mode === 'turbo') addSample(_turbo, sample)
  else if (sample.mode === 'normal') addSample(_normal, sample)

  const now = performance.now()
  if (now - _lastLogAt >= _intervalSec * 1000) emitReport(true)
}

export function isScratchLogActive(): boolean {
  return import.meta.env.DEV && _active
}

const DR_SCRATCH_LOG = {
  enable(intervalSec = 8): void {
    _active = true
    _intervalSec = Math.max(1, intervalSec)
    _lastLogAt = performance.now()
    resetAccum()
    console.log(
      `%c[DR scratch] вкл: строка раз в ${_intervalSec}s. Выключить: __DR_SCRATCH_LOG__.disable()`,
      'color:#f7c948',
    )
  },

  disable(): void {
    _active = false
    console.log('[DR scratch] выкл')
  },

  report(): void {
    emitReport(false)
  },

  help(): void {
    console.log(
      '[DR scratch] Диагностика scratch земли\n' +
        '  URL: ?scratch или ?scratch=8\n' +
        '  __DR_SCRATCH_LOG__.enable(8)\n' +
        '  __DR_SCRATCH_LOG__.report()\n' +
        '  __DR_SCRATCH_LOG__.disable()\n' +
        '  DR_SCRATCH_DEBUG.disableScratch() / enableScratch() / status()',
    )
  },
}

const DR_SCRATCH_DEBUG = {
  disableScratch(): void {
    ;(window as any).__DR_DISABLE_SCRATCH__ = true
    console.log('[DR scratch] scratch disabled for diagnostics')
  },

  enableScratch(): void {
    ;(window as any).__DR_DISABLE_SCRATCH__ = false
    console.log('[DR scratch] scratch enabled')
  },

  status(): void {
    console.log('[DR scratch]', {
      disabled: !!(window as any).__DR_DISABLE_SCRATCH__,
      logActive: _active,
      intervalSec: _intervalSec,
    })
  },
}

export function isScratchDisabledForDiagnostics(): boolean {
  return import.meta.env.DEV && typeof window !== 'undefined' && !!(window as any).__DR_DISABLE_SCRATCH__
}

export function installScratchDebugFromUrl(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  ;(window as any).__DR_SCRATCH_LOG__ = DR_SCRATCH_LOG
  ;(window as any).DR_SCRATCH_DEBUG = DR_SCRATCH_DEBUG

  if (typeof location === 'undefined') return
  const sp = new URLSearchParams(location.search)

  if (sp.get('noScratch') === '1') DR_SCRATCH_DEBUG.disableScratch()

  const raw = sp.get('scratch')
  if (raw !== null) {
    const sec = raw === '' ? 8 : Math.max(1, parseFloat(raw) || 8)
    DR_SCRATCH_LOG.enable(sec)
  }
}
