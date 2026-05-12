/**
 * PerfProfiler — лёгкий профайлер для игрового цикла.
 *
 * Когда disabled (по умолчанию) — нулевые накладные расходы:
 * begin() возвращает 0, end() с t0=0 — immediate return.
 *
 * Использование в браузере:
 *   __DR_PERF__.enable()        — начать сбор (автоматически при старте если URL содержит ?perf)
 *   __DR_PERF__.report()        — console.table со статистикой всех подсистем
 *   __DR_PERF__.top(5)          — топ-N самых дорогих подсистем
 *   __DR_PERF__.auto(3000)      — авто-вывод отчёта каждые N мс
 *   __DR_PERF__.stopAuto()      — остановить авто-вывод
 *   __DR_PERF__.reset()         — очистить накопленные данные
 *   __DR_PERF__.disable()       — выключить
 *   __DR_PERF__.scene()         — только снимок сцены (чанки, лава, спавнер, частицы)
 *
 * Подсистемы:
 *   tileWorld   — TileWorld.update: построение/удаление чанков, перестройка overrides
 *   spawner     — ObjectSpawner.update + checkCollisions
 *   miner       — MinerController.update (анимация персонажа)
 *   pUpdate     — _pUpdate: Spine + частицы + лава (culling + физика + рендер)
 *   spine       — SpineAnimator.tick (скелетные анимации)
 *   lava        — tileWorld.updateLavas (физика + маска текстуры по ячейкам)
 *   lava.flow   — LavaSimulation._flow (клеточный автомат)
 *   lava.render — LavaSimulation._render (маска drawRect по ячейкам для TilingSprite)
 */

/** Размер скользящего окна: 2 секунды при 60fps */
const SAMPLES = 120

interface Stats {
  buf:    Float32Array
  idx:    number
  count:  number
  warnMs: number
}

const _stats = new Map<string, Stats>()
let _enabled = false
let _autoTimer: ReturnType<typeof setInterval> | null = null
/** Последний снимок с GameRenderer (чанки, очереди, лава…) — только при enabled. */
let _lastScene: Record<string, string | number | boolean> = {}

function _getOrCreate(name: string, warnMs: number): Stats {
  let s = _stats.get(name)
  if (!s) {
    s = { buf: new Float32Array(SAMPLES), idx: 0, count: 0, warnMs }
    _stats.set(name, s)
  }
  return s
}

function _avg(s: Stats): number {
  if (s.count === 0) return 0
  let sum = 0
  for (let i = 0; i < s.count; i++) sum += s.buf[i]!
  return sum / s.count
}

function _max(s: Stats): number {
  let m = 0
  for (let i = 0; i < s.count; i++) { const v = s.buf[i]!; if (v > m) m = v }
  return m
}

function _last(s: Stats): number {
  if (s.count === 0) return 0
  return s.buf[(s.idx - 1 + SAMPLES) % SAMPLES]!
}

function _p95(s: Stats): number {
  if (s.count < 2) return _last(s)
  const sorted = Array.from(s.buf.subarray(0, s.count)).sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length * 0.95)]!
}

export const perf = {

  get enabled() { return _enabled },

  /**
   * Начало замера. Возвращает performance.now() если профайлер включён, иначе 0.
   * @param name    — название подсистемы
   * @param warnMs  — порог предупреждения (avg > warnMs → 🔴)
   */
  begin(name: string, warnMs = 2): number {
    if (!_enabled) return 0
    _getOrCreate(name, warnMs)
    return performance.now()
  },

  /**
   * Конец замера. t0=0 означает, что профайлер был выключен — immediate no-op.
   */
  end(name: string, t0: number): void {
    if (t0 === 0) return
    const elapsed = performance.now() - t0
    const s = _stats.get(name)
    if (!s) return
    s.buf[s.idx] = elapsed
    s.idx = (s.idx + 1) % SAMPLES
    if (s.count < SAMPLES) s.count++
  },

  /** Полная таблица статистики по всем подсистемам, отсортированная по avg desc. */
  report(): void {
    if (_stats.size === 0) {
      console.log('%c[DR perf] нет данных — вызовите enable() и поиграйте несколько секунд', 'color:#888')
      return
    }
    const rows: Record<string, Record<string, string>> = {}
    for (const [name, s] of _stats) {
      if (s.count === 0) continue
      const avg  = _avg(s)
      const max  = _max(s)
      const p95  = _p95(s)
      const last = _last(s)
      const icon = avg > s.warnMs ? '🔴' : avg > s.warnMs * 0.6 ? '🟡' : '🟢'
      rows[name] = {
        'avg ms':  avg.toFixed(2),
        'p95 ms':  p95.toFixed(2),
        'max ms':  max.toFixed(2),
        'last ms': last.toFixed(2),
        'warn':    `>${s.warnMs}ms`,
        ' ':       icon,
      }
    }
    const sorted = Object.entries(rows).sort(
      ([, a], [, b]) => parseFloat(b['avg ms']!) - parseFloat(a['avg ms']!),
    )
    console.log('%c[DR perf] === Статистика кадра (последние 120 фреймов) ===', 'color:#00d4ff;font-weight:bold')
    console.table(Object.fromEntries(sorted))
    if (Object.keys(_lastScene).length > 0) {
      console.log('%c[DR perf] --- Сцена (последний кадр с профайлером) ---', 'color:#88c4ff;font-weight:bold')
      console.table(_lastScene)
    }
  },

  /** Топ-N самых дорогих подсистем по среднему времени. */
  top(n = 5): void {
    const entries: Array<[string, number, number]> = []
    for (const [name, s] of _stats) {
      if (s.count > 0) entries.push([name, _avg(s), s.warnMs])
    }
    entries.sort((a, b) => b[1]! - a[1]!)
    console.log('%c[DR perf] Топ по avg ms:', 'color:#ff9500;font-weight:bold')
    for (const [name, avg, warnMs] of entries.slice(0, n)) {
      const filled = Math.min(30, Math.round(avg / Math.max(warnMs, 0.1) * 10))
      const bar    = '█'.repeat(filled) + '░'.repeat(Math.max(0, 30 - filled))
      const icon   = avg > warnMs ? '🔴' : avg > warnMs * 0.6 ? '🟡' : '🟢'
      console.log(`  ${icon} ${name.padEnd(18)} ${avg.toFixed(2).padStart(6)}ms  ${bar}`)
    }
  },

  /** Снимок сцены из последнего игрового кадра (чанки, лава, спавнер…). */
  setSceneSnapshot(data: Record<string, string | number | boolean>): void {
    if (!_enabled) return
    _lastScene = { ...data }
  },

  /** Вывести только снимок сцены (без таблицы ms). */
  scene(): void {
    if (Object.keys(_lastScene).length === 0) {
      console.log(
        '%c[DR perf] снимок пуст — включите enable() или ?perf и дождитесь кадра с TileWorld',
        'color:#888',
      )
      return
    }
    console.log('%c[DR perf] сцена (последний кадр):', 'color:#88c4ff;font-weight:bold')
    console.table(_lastScene)
  },

  /** Включить сбор данных. */
  enable(): void {
    _enabled = true
    console.log(
      '%c[DR perf] профайлер ВКЛ.\n  report() — время + сцена\n  scene()  — только сцена\n  top()    — топ-5 по ms\n  auto(n)  — авто отчёт каждые n мс\n  reset()  — сброс',
      'color:#00d4ff',
    )
  },

  /** Выключить профайлер и остановить авто-вывод. */
  disable(): void {
    _enabled = false
    if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null }
    console.log('[DR perf] профайлер ВЫКЛ')
  },

  /** Сбросить накопленные данные. */
  reset(): void {
    _stats.clear()
    _lastScene = {}
    console.log('[DR perf] данные сброшены')
  },

  /** Авто-вывод отчёта каждые intervalMs мс (по умолчанию 5000). */
  auto(intervalMs = 5000): void {
    if (_autoTimer) clearInterval(_autoTimer)
    if (!_enabled) this.enable()
    _autoTimer = setInterval(() => this.report(), intervalMs)
    console.log(`%c[DR perf] авто-отчёт каждые ${intervalMs / 1000}с`, 'color:#00d4ff')
  },

  /** Остановить авто-вывод. */
  stopAuto(): void {
    if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null }
    console.log('[DR perf] авто-вывод остановлен')
  },
}

/**
 * Устанавливает профайлер на window.__DR_PERF__.
 * В DEV-режиме включается автоматически и печатает отчёт каждые 5 секунд.
 * ?perf=N в URL — задаёт интервал в секундах (напр. ?perf=10).
 */
export function installPerfProfiler(): void {
  ;(window as any).__DR_PERF__ = perf

  let intervalMs = 5000
  if (typeof location !== 'undefined') {
    const param = new URLSearchParams(location.search).get('perf')
    if (param !== null) {
      intervalMs = param ? Math.max(1, parseFloat(param)) * 1000 : 5000
    }
  }

  perf.auto(intervalMs)
}
