/**
 * GameLogger — комплексный логгер сессии для отладки.
 *
 * Собирает историю каждого раунда: ожидаемые события, сбор предметов,
 * соответствие rgsQueue, изменения множителя, переходы фаз.
 *
 * В браузере доступен как window.__DEEP_RUSH_LOG:
 *   __DEEP_RUSH_LOG.report()   — итоговая таблица раундов
 *   __DEEP_RUSH_LOG.rounds()   — массив данных всех раундов
 *   __DEEP_RUSH_LOG.current()  — текущий незавершённый раунд
 *   __DEEP_RUSH_LOG.help()     — список команд
 */

import type { RoundEvent, EventType } from '../rgs/client'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CollectRecord {
  seq:        number
  type:       EventType
  multBefore: number
  multAfter:  number
  rgsMatched: boolean
  rgsEffect:  string | null  // напр. "add 2", "mul 3", "sub 1", "div 2"
  depth:      number
}

export interface RoundRecord {
  roundSeq:        number
  roundID:         string
  bet:             number
  isLoss:          boolean
  expectedEvents:  RoundEvent[]
  collects:        CollectRecord[]
  finalMultiplier: number | null
  settledMultiplier: number | null
  rgsRemainder:    RoundEvent[]   // события, оставшиеся в очереди после конца раунда
  startedAt:       number         // performance.now()
  endedAt:         number | null
}

// ─── State ─────────────────────────────────────────────────────────────────────

const MAX_ROUNDS = 30
const _rounds: RoundRecord[] = []
let _current: RoundRecord | null = null
let _collectSeq = 0
let _roundSeq   = 0

function _ensureCurrent(): RoundRecord {
  if (_current) return _current
  // защита: не должно случаться, но лучше не бросать исключение
  _current = {
    roundSeq: 0, roundID: '?', bet: 0, isLoss: false,
    expectedEvents: [], collects: [], finalMultiplier: null, settledMultiplier: null,
    rgsRemainder: [], startedAt: performance.now(), endedAt: null,
  }
  return _current
}

// ─── Public API ────────────────────────────────────────────────────────────────

export const GameLogger = {

  // ── Начало раунда ────────────────────────────────────────────────────────────

  roundStart(params: {
    roundID: string
    bet:     number
    events:  RoundEvent[]
  }): void {
    _roundSeq++
    _collectSeq = 0
    _current = {
      roundSeq:        _roundSeq,
      roundID:         params.roundID,
      bet:             params.bet,
      isLoss:          params.events.some(e => e.type === 'LAVA'),
      expectedEvents:  [...params.events],
      collects:        [],
      finalMultiplier: null,
      settledMultiplier: null,
      rgsRemainder:    [],
      startedAt:       performance.now(),
      endedAt:         null,
    }

    const isLoss = _current.isLoss
    const label  = isLoss ? '🔥 ЛАВА' : '🏠 ДОМ'
    const css    = isLoss ? 'color:#ff6b6b;font-weight:bold' : 'color:#51cf66;font-weight:bold'

    console.groupCollapsed(
      `%c[РАУНД #${_roundSeq} START]  ${label}  ставка: $${params.bet.toFixed(2)}  (${params.events.length} событий)`,
      css,
    )

    const rows = params.events.map((e, i) => ({
      '#':         i + 1,
      'тип':       e.type,
      'глубина м': e.depth,
      'дист м':    e.distance,
      'эффект':    e.effect ? `${e.effect.op} ${e.effect.value}` : '—',
      'пауза мс':  e.durationMs ?? '—',
    }))
    console.table(rows)
    console.groupEnd()
  },

  // ── Сбор предмета ────────────────────────────────────────────────────────────

  itemCollect(params: {
    type:       EventType
    multBefore: number
    multAfter:  number
    rgsMatched: boolean
    rgsEffect:  { op: string; value: number } | null
    depth?:     number
  }): void {
    const round = _ensureCurrent()
    const seq   = ++_collectSeq
    round.collects.push({
      seq,
      type:       params.type,
      multBefore: params.multBefore,
      multAfter:  params.multAfter,
      rgsMatched: params.rgsMatched,
      rgsEffect:  params.rgsEffect ? `${params.rgsEffect.op} ${params.rgsEffect.value}` : null,
      depth:      params.depth ?? 0,
    })

    if (!params.rgsMatched) {
      console.warn(
        `⚠️  [COLLECT #${seq}] ${params.type} — RGS-ивент НЕ найден в очереди!` +
        ` Применён СЛУЧАЙНЫЙ эффект.` +
        `  ×${params.multBefore.toFixed(2)} → ×${params.multAfter.toFixed(2)}`,
      )
    }
  },

  // ── Конец раунда ─────────────────────────────────────────────────────────────

  roundEnd(params: {
    result:          'HOME' | 'LAVA'
    source:          'object' | 'simulation'
    finalMultiplier: number
    settledMultiplier?: number
    rgsRemainder:    RoundEvent[]
  }): void {
    const round  = _ensureCurrent()
    round.finalMultiplier = params.finalMultiplier
    round.settledMultiplier = params.settledMultiplier ?? params.finalMultiplier
    round.rgsRemainder    = [...params.rgsRemainder]
    round.endedAt         = performance.now()
    _current = null

    _rounds.push(round)
    if (_rounds.length > MAX_ROUNDS) _rounds.shift()

    const won    = params.result === 'HOME'
    const css    = won ? 'color:#51cf66;font-weight:bold' : 'color:#ff6b6b;font-weight:bold'
    const dur    = ((round.endedAt - round.startedAt) / 1000).toFixed(1)
    const misses = round.collects.filter(c => !c.rgsMatched).length
    const missStr = misses > 0 ? `  ⚠️ RGS miss: ${misses}` : ''
    const settledMult = round.settledMultiplier ?? params.finalMultiplier
    const visualMult  = params.finalMultiplier
    const hasMultDrift = Math.abs(settledMult - visualMult) >= 0.01

    console.group(
      `%c[РАУНД #${round.roundSeq} END]  ${won ? '🏠 ПОБЕДА' : '🔥 ПОТЕРЯ'}` +
      `  ×${settledMult.toFixed(2)}  ${dur}с${missStr}`,
      css,
    )
    if (hasMultDrift) {
      console.debug(
        `[ROUND MULT] visual ×${visualMult.toFixed(2)} vs payout ×${settledMult.toFixed(2)}`,
      )
    }

    if (round.collects.length > 0) {
      for (const c of round.collects) {
        const effect = (c.type === 'HOME' || c.type === 'LAVA') ? '—' : c.rgsEffect ?? '(random)'
        console.log(
          `#${c.seq} ${c.type}  ${`×${c.multBefore.toFixed(2)}`} → ${`×${c.multAfter.toFixed(2)}`}  ` +
          `${c.rgsMatched ? '✅' : '❌ random'}  ${effect}`
        )
      }
    } else {
      console.log('(нет собранных предметов)')
    }

    if (params.rgsRemainder.length > 0) {
      console.warn(
        `Остаток rgsQueue (${params.rgsRemainder.length}): ` +
        params.rgsRemainder.map(e => `${e.type}@${e.depth}м`).join('  '),
      )
    }

    if (misses > 0) {
      console.error(
        `❌ ${misses} предмет(ов) не нашли соответствие в rgsQueue — использован random.` +
        ' Возможно рассинхрон типов событий или порядка.',
      )
    }

    console.groupEnd()
  },

  // ── Переход фазы ─────────────────────────────────────────────────────────────

  phaseChange(from: string, to: string): void {
    console.log(`%c[ФАЗА] ${from} → ${to}`, 'color:#74c0fc')
  },

  // ── Плановый маршрут ─────────────────────────────────────────────────────────

  /**
   * Вызывается после setRgsEvents: показывает карту раунда —
   * где каждый предмет расположен в мире vs что ожидал RGS.
   */
  pathPlan(items: Array<{
    seq:          number
    type:         EventType
    worldX:       number
    worldY:       number
    actualDepthM: number   // (worldY - surfY) / ppm
    rgsDepthM:    number   // из rgsEvent.depth
    rgsDistM:     number   // из rgsEvent.distance
    terminal:     boolean
  }>): void {
    if (items.length === 0) return

    console.groupCollapsed(
      `%c[PATH PLAN] маршрут раунда: ${items.length} точек`,
      'color:#ffd43b;font-weight:bold',
    )
    console.table(items.map(it => ({
      '#':           it.seq,
      'тип':         it.type,
      'мир X':       it.worldX.toFixed(0),
      'мир Y':       it.worldY.toFixed(0),
      'факт глуб м': it.actualDepthM.toFixed(1),
      'rgs глуб м':  it.rgsDepthM.toFixed(1),
      'Δ глуб м':    (it.actualDepthM - it.rgsDepthM).toFixed(1),
      'rgs дист м':  it.rgsDistM.toFixed(1),
      'терминал':    it.terminal ? '🏁' : '',
    })))
    console.groupEnd()
  },

  // ── Движение персонажа ───────────────────────────────────────────────────────

  /**
   * Вызывается после сбора предмета — показывает откуда шёл персонаж
   * и куда теперь направляется.
   */
  charToTarget(params: {
    charX:        number
    charY:        number
    charDepthM:   number
    charArcS:     number
    collected: {
      type:    EventType
      worldX:  number
      worldY:  number
      distPx:  number   // расстояние между персонажем и предметом в момент коллекта
    }
    nextTarget: {
      type:    EventType
      worldX:  number
      worldY:  number
      depthM:  number
    } | null
  }): void {
    const c    = params.collected
    const next = params.nextTarget
    const distStr = c.distPx.toFixed(0)
    const hitOk   = c.distPx < 200

    console.log(
      `%c[MOVE] собрал ${c.type} @ (${c.worldX.toFixed(0)}, ${c.worldY.toFixed(0)})` +
      `  — персонаж был в (${params.charX.toFixed(0)}, ${params.charY.toFixed(0)})` +
      `  глубина: ${params.charDepthM.toFixed(1)}м` +
      `  arc: ${params.charArcS.toFixed(0)}px` +
      `  дистанция до предмета: ${distStr}px ${hitOk ? '✅' : '⚠️ далеко!'}` +
      (next
        ? `\n       → следующая цель: ${next.type} @ (${next.worldX.toFixed(0)}, ${next.worldY.toFixed(0)})  глубина: ${next.depthM.toFixed(1)}м`
        : '\n       → следующей цели нет (терминал или конец маршрута)'),
      hitOk ? 'color:#adb5bd' : 'color:#ff6b6b',
    )
  },

  // ── Session report ───────────────────────────────────────────────────────────

  report(): void {
    if (_rounds.length === 0) {
      console.log('[GameLogger] Нет завершённых раундов.')
      return
    }
    console.group('%c[SESSION REPORT] — последние раунды', 'font-weight:bold;font-size:14px')
    console.table(_rounds.map(r => ({
      '#':           r.roundSeq,
      'исход':       r.isLoss ? '🔥 ЛАВА' : '🏠 ДОМ',
      'ставка':      `$${r.bet.toFixed(2)}`,
      '×':           r.finalMultiplier != null ? `×${r.finalMultiplier.toFixed(2)}` : '?',
      '× payout':    r.settledMultiplier != null ? `×${r.settledMultiplier.toFixed(2)}` : '?',
      'предметов':   r.collects.length,
      'RGS miss':    r.collects.filter(c => !c.rgsMatched).length,
      'rgs остаток': r.rgsRemainder.length,
      'длит с':      r.endedAt ? ((r.endedAt - r.startedAt) / 1000).toFixed(1) : '?',
    })))
    console.groupEnd()
  },

  // ── Accessors ────────────────────────────────────────────────────────────────

  get rounds(): readonly RoundRecord[] { return _rounds },
  get current(): RoundRecord | null    { return _current },
}

// ─── Browser globals ───────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  ;(window as any).__DEEP_RUSH_LOG = {
    report:  () => GameLogger.report(),
    rounds:  () => GameLogger.rounds,
    current: () => GameLogger.current,
    help() {
      console.log(
        'window.__DEEP_RUSH_LOG\n' +
        '  .report()   — итоговая таблица всех раундов\n' +
        '  .rounds()   — массив объектов по каждому раунду\n' +
        '  .current()  — текущий незавершённый раунд\n' +
        '  .help()     — эта подсказка\n' +
        'Плавность кадра: __DR_FPS_LOG__.help() (в DEV лог кадров включается сам раз в 8 с; ?nofps — выкл)',
      )
    },
  }
  console.info('[GameLogger] window.__DEEP_RUSH_LOG доступен (введите __DEEP_RUSH_LOG.help())')
}
