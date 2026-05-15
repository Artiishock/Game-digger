import { GameLogger } from './GameLogger'

/**
 * Редкий лог плавности: средний / min / max `ticker.deltaMS` (Pixi) за окно.
 *
 * Включение:
 *   ?fps       — окно 3 с (по умолчанию)
 *   ?fps=5     — каждые 5 с одна строка в консоль
 *   (в DEV: если нет ?fps и нет ?nofps — авто раз в 8 с)
 *
 * Без перезагрузки:
 *   __DR_FPS_LOG__.enable(3)
 *   __DR_FPS_LOG__.disable()
 */

let _active = false
let _intervalSec = 3
let _accumMs = 0
let _frames = 0
let _minMs = Infinity
let _maxMs = 0
let _lastLogAt = 0

function _resetAccum(): void {
  _accumMs = 0
  _frames = 0
  _minMs = Infinity
  _maxMs = 0
}

function _emitLine(): void {
  const n = Math.max(1, _frames)
  const avg = _accumMs / n
  const minStr = _minMs === Infinity ? '—' : _minMs.toFixed(2)
  const fps = avg > 0 ? 1000 / avg : 0
  console.log(
    `[DR fps] ${_intervalSec}s: frames=${_frames} avg=${avg.toFixed(2)}ms min=${minStr} max=${_maxMs.toFixed(2)}ms ≈${fps.toFixed(1)} fps`,
  )
  GameLogger.recordFpsSnapshot({
    at:        performance.now(),
    windowSec: _intervalSec,
    frames:    _frames,
    avgMs:     avg,
    minMs:     _minMs === Infinity ? avg : _minMs,
    maxMs:     _maxMs,
    avgFps:    fps,
  })
  _resetAccum()
  _lastLogAt = performance.now()
}

export function tickTickerFpsLog(deltaMS: number): void {
  if (!_active) return
  const ms = Number.isFinite(deltaMS) ? Math.max(0, deltaMS) : 0
  _accumMs += ms
  _frames++
  if (ms < _minMs) _minMs = ms
  if (ms > _maxMs) _maxMs = ms

  const now = performance.now()
  if (now - _lastLogAt < _intervalSec * 1000) return
  if (_frames === 0) {
    _lastLogAt = now
    return
  }
  _emitLine()
}

const __DR_FPS_LOG__ = {
  enable(intervalSec = 3): void {
    _active = true
    _intervalSec = Math.max(0.5, intervalSec)
    _lastLogAt = performance.now()
    _resetAccum()
    console.log(
      `%c[DR fps] вкл: строка раз в ${_intervalSec}s (Pixi ticker.deltaMS). Выключить: __DR_FPS_LOG__.disable()`,
      'color:#7cfc00',
    )
  },

  disable(): void {
    _active = false
    console.log('[DR fps] выкл')
  },

  help(): void {
    console.log(
      '[DR fps] Диагностика рывков (редкий лог, почти без нагрузки)\n' +
        '  URL: ?fps или ?fps=5\n' +
        '  DEV: без ?fps включается авто раз в 8 с; отключить авто: ?nofps в URL\n' +
        '  __DR_FPS_LOG__.enable(3)  __DR_FPS_LOG__.disable()  __DR_FPS_LOG__.help()',
    )
  },
}

/** Вызывать один раз при старте (ставит window.__DR_FPS_LOG__, читает ?fps / DEV-авто). */
export function installTickerFpsLogFromUrl(): void {
  if (typeof window !== 'undefined') {
    ;(window as any).__DR_FPS_LOG__ = __DR_FPS_LOG__
  }
  if (typeof location === 'undefined') return
  const sp = new URLSearchParams(location.search)
  const raw = sp.get('fps')
  if (raw !== null) {
    const sec = raw === '' ? 3 : Math.max(0.5, parseFloat(raw) || 3)
    __DR_FPS_LOG__.enable(sec)
    return
  }
  if (import.meta.env.DEV && sp.get('nofps') === null) {
    __DR_FPS_LOG__.enable(8)
  }
}
