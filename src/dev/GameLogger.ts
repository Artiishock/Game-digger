import type { RoundEvent, EventType } from '../rgs/client'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface FpsSnapshot {
  at:        number
  windowSec: number
  frames:    number
  avgMs:     number
  minMs:     number
  maxMs:     number
  avgFps:    number
}

export interface CollectRecord {
  seq:        number
  type:       EventType
  multBefore: number
  multAfter:  number
  rgsMatched: boolean
  rgsEffect:  string | null
  depth:      number
}

export interface RoundRecord {
  roundSeq:          number
  roundID:           string
  bet:               number
  isLoss:            boolean
  expectedEvents:    RoundEvent[]
  collects:          CollectRecord[]
  finalMultiplier:   number | null
  settledMultiplier: number | null
  rgsRemainder:      RoundEvent[]
  startedAt:         number
  endedAt:           number | null
}

// ─── State ─────────────────────────────────────────────────────────────────────

const MAX_ROUNDS = 30
const _rounds: RoundRecord[] = []
let _current: RoundRecord | null = null
const _fpsSnapshots: FpsSnapshot[] = []
let _collectSeq = 0
let _roundSeq   = 0

function _ensureCurrent(): RoundRecord {
  if (_current) return _current
  _current = {
    roundSeq: 0, roundID: '?', bet: 0, isLoss: false,
    expectedEvents: [], collects: [], finalMultiplier: null, settledMultiplier: null,
    rgsRemainder: [], startedAt: performance.now(), endedAt: null,
  }
  return _current
}

// ─── Public API ────────────────────────────────────────────────────────────────

const _gameLoggerReal = {

  roundStart(params: {
    roundID: string
    bet:     number
    events:  RoundEvent[]
  }): void {
    _roundSeq++
    _collectSeq = 0
    _current = {
      roundSeq:          _roundSeq,
      roundID:           params.roundID,
      bet:               params.bet,
      isLoss:            params.events.some(e => e.type === 'LAVA'),
      expectedEvents:    [...params.events],
      collects:          [],
      finalMultiplier:   null,
      settledMultiplier: null,
      rgsRemainder:      [],
      startedAt:         performance.now(),
      endedAt:           null,
    }
  },

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
  },

  roundEnd(params: {
    result:            'HOME' | 'LAVA'
    source:            'object' | 'simulation'
    finalMultiplier:   number
    settledMultiplier?: number
    rgsRemainder:      RoundEvent[]
  }): void {
    const round = _ensureCurrent()
    round.finalMultiplier   = params.finalMultiplier
    round.settledMultiplier = params.settledMultiplier ?? params.finalMultiplier
    round.rgsRemainder      = [...params.rgsRemainder]
    round.endedAt           = performance.now()
    _current = null

    _rounds.push(round)
    if (_rounds.length > MAX_ROUNDS) _rounds.shift()
  },

  phaseChange(_from: string, _to: string): void {},

  pathPlan(_items: Array<{
    seq:          number
    type:         EventType
    worldX:       number
    worldY:       number
    actualDepthM: number
    rgsDepthM:    number
    rgsDistM:     number
    terminal:     boolean
  }>): void {},

  treeLayout(_params: {
    tag: string
    running: boolean
    idleActive: boolean
    autoplay: boolean
    charX: number
    camX: number
    viewW: number
    treeRunDx: readonly [number, number, number]
    trees: Array<{
      name: string
      worldX: number | null
      screenX: number | null
      expectedWorldX: number
      onScreenApprox: boolean
    }>
  }): void {},

  charToTarget(_params: {
    charX:      number
    charY:      number
    charDepthM: number
    charArcS:   number
    collected: {
      type:    EventType
      worldX:  number
      worldY:  number
      distPx:  number
    }
    nextTarget: {
      type:    EventType
      worldX:  number
      worldY:  number
      depthM:  number
    } | null
  }): void {},

  report(): void {},

  recordFpsSnapshot(snap: FpsSnapshot): void {
    _fpsSnapshots.push(snap)
  },

  get rounds():  readonly RoundRecord[] { return _rounds },
  get current(): RoundRecord | null     { return _current },
  get fpsLog():  readonly FpsSnapshot[] { return _fpsSnapshots },
}

type GameLoggerApi = typeof _gameLoggerReal

/** No-op заглушка для production: тот же API, ничего не пишет, tree-shake-able. */
const _gameLoggerNoop: GameLoggerApi = {
  roundStart: () => {},
  itemCollect: () => {},
  roundEnd: () => {},
  phaseChange: () => {},
  pathPlan: () => {},
  treeLayout: () => {},
  charToTarget: () => {},
  report: () => {},
  recordFpsSnapshot: () => {},
  rounds: [],
  current: null,
  fpsLog: [],
}

/**
 * В production экспортируется пустышка, а реальный логгер (с буферами раундов)
 * вырезается из бандла. В dev — полноценный `_gameLoggerReal`.
 */
export const GameLogger: GameLoggerApi = import.meta.env.DEV ? _gameLoggerReal : _gameLoggerNoop

// ─── Dev inspector (browser console: __DEEP_RUSH_LOG.rounds()) ─────────────────

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  ;(window as any).__DEEP_RUSH_LOG = {
    rounds:  () => GameLogger.rounds,
    current: () => GameLogger.current,
    fps:     () => GameLogger.fpsLog,
  }
}
