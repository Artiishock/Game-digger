import { useGameStore } from '../store/gameStore'
import type { GamePhase } from '../store/gameStore'

type Outcome = 'HOME' | 'LAVA' | 'UNKNOWN'

export interface RoundDebugCounters {
  terminalTimerActive?: boolean
  lavaResultTimerActive?: boolean
  tickerStarted?: boolean
  tickerCount?: number
  objectsLayerChildren?: number
  spawnerObjects?: number
  spawnerRoadItems?: number
  lavaStaticPools?: number
  tilePendingCaves?: number
  activePixiChildren?: number
}

export interface RoundDebugFramePayload {
  heroX: number
  heroY: number
  heroDepth: number
  heroArc: number
  pathTotalLength: number
  pathProgress: number
  lavaX: number | null
  lavaY: number | null
  lavaDepth: number | null
  distanceHeroToLava: number | null
  phase?: GamePhase
  running: boolean
  lossTerminalDescent: boolean
  turbo: boolean
  counters: RoundDebugCounters
}

interface LegacyRoundStartPayload {
  roundID: string
  outcome: Outcome
  speed: number
  autoplay: boolean
  turbo: boolean
  startHeroX: number
  startHeroY: number
  startCamX?: number
  startCamY?: number
  pathTotalLength: number
  expectedTerminalY: number | null
  expectedTerminalDepth?: number | null
  expectedLavaX: number | null
  expectedLavaY: number | null
  terminalCaveExists: boolean
  homeExists: boolean
  counters: RoundDebugCounters
}

interface LegacyTerminalHitPayload extends RoundDebugFramePayload {
  visualOutcome: Outcome
  source: 'object' | 'simulation' | 'instant'
}

export interface RoundDebugStartPayload {
  roundID: string
  outcomeFromRgs: Outcome
  speed: number
  turbo: boolean
  autoplay: boolean
  startHeroX: number
  startHeroY: number
  terminalCaveExists: boolean
  homeExists: boolean
  pathTotalLength: number
  terminalX: number | null
  terminalY: number | null
  lavaPools: number
  activeRendererTimers: number
  activeAutoplayTimers: number
  previousCleanupCompleted: boolean
}

export interface RoundDebugSamplePayload {
  heroX: number
  heroY: number
  heroDepth: number
  heroArc: number
  pathTotalLength: number
  pathProgress: number
  lavaX: number | null
  lavaY: number | null
  lavaDepth: number | null
  distanceHeroToLava: number | null
  lossTerminalDescent: boolean
  running: boolean
  ended: boolean
  speed: number
  turbo: boolean
  autoplay: boolean
  activeRendererTimers: number
  activeAutoplayTimers: number
  objects: number
  lavaPools: number
}

export interface RoundDebugEndPayload extends RoundDebugSamplePayload {
  visualOutcome: Outcome
  collisionSource: 'object' | 'simulation' | 'instant' | 'unknown'
}

export interface RoundDebugPhasePayload {
  from: GamePhase
  to: GamePhase
  activeAutoplayTimers: number
}

interface RoundSummary extends RoundDebugStartPayload {
  seq: number
  startedAtMs: number
  runningStartedAtMs: number | null
  endedAtMs: number | null
  durationMs: number | null
  runningDurationMs: number | null
  visualOutcome: Outcome
  collisionSource: RoundDebugEndPayload['collisionSource'] | null
  endHeroX: number | null
  endHeroY: number | null
  heroDepth: number | null
  heroArc: number | null
  pathProgress: number | null
  lavaX: number | null
  lavaY: number | null
  lavaDepth: number | null
  distanceHeroToLava: number | null
  minDistanceHeroToLava: number | null
  maxDistanceHeroToLava: number | null
  activeRendererTimersEnd: number
  activeAutoplayTimersEnd: number
  maxObjects: number
  maxLavaPools: number
  phaseTransitions: string[]
  anomalies: string[]
  countersStart?: {
    objectsLayerChildren?: number
    activePixiChildren?: number
    lavaStaticPools?: number
    tilePendingCaves?: number
  }
  countersEnd?: {
    objectsLayerChildren?: number
    activePixiChildren?: number
    lavaStaticPools?: number
    tilePendingCaves?: number
  }
}

interface RoundDebugReport {
  enabled: boolean
  stress: StressState
  rounds: number
  lavaRounds: number
  lavaDurationMs: { min: number | null; avg: number | null; max: number | null }
  heroDepthAtLava: { min: number | null; avg: number | null; max: number | null }
  distanceHeroToLava: { min: number | null; avg: number | null; max: number | null }
  anomalyCount: number
  anomalies: Array<{ round: number; reasons: string[] }>
  anomalyRounds: Array<{ round: number; reasons: string[] }>
  last10: Array<{
    round: number
    roundID: string
    outcome: Outcome
    rgs: Outcome
    visualOutcome: Outcome
    visual: Outcome
    durationMs: number | null
    heroDepth: number | null
    depth: number | null
    pathProgress: number | null
    lavaY: number | null
    distanceHeroToLava: number | null
    distanceToLava: number | null
    rendererTimers: number
    autoplayTimers: number
    maxObjects: number
    maxLavaPools: number
    anomalies: string[]
  }>
}

interface StressState {
  active: boolean
  requested: number
  completed: number
  stopOnAnomaly: boolean
}

let _enabled = false
let _seq = 0
let _current: RoundSummary | null = null
const _rounds: RoundSummary[] = []
const _phaseTransitions: string[] = []
const _stress: StressState = { active: false, requested: 0, completed: 0, stopOnAnomaly: true }

function isDev(): boolean {
  return import.meta.env.DEV
}

function now(): number {
  return performance.now()
}

function round1(v: number | null): number | null {
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10
}

function round3(v: number | null): number | null {
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function minAvgMax(values: number[]): { min: number | null; avg: number | null; max: number | null } {
  if (values.length === 0) return { min: null, avg: null, max: null }
  return {
    min: Math.min(...values),
    avg: avg(values),
    max: Math.max(...values),
  }
}

function pushAnomaly(summary: RoundSummary, reason: string): void {
  if (!summary.anomalies.includes(reason)) summary.anomalies.push(reason)
}

function evaluateSample(summary: RoundSummary, sample: RoundDebugSamplePayload, elapsedMs: number): void {
  if (summary.outcomeFromRgs !== 'LAVA' || summary.visualOutcome !== 'UNKNOWN') return

  const terminalY = summary.terminalY
  if (terminalY != null && sample.heroY > terminalY + 120 * 3) {
    pushAnomaly(summary, 'hero_deeper_than_terminal')
  }
  if (sample.pathProgress > 1.02) {
    pushAnomaly(summary, 'path_progress_above_100')
  }
  if (elapsedMs > 45000) {
    pushAnomaly(summary, 'running_too_long')
  }
  if (sample.distanceHeroToLava != null) {
    if (summary.minDistanceHeroToLava == null || sample.distanceHeroToLava < summary.minDistanceHeroToLava) {
      summary.minDistanceHeroToLava = sample.distanceHeroToLava
    }
    if (summary.maxDistanceHeroToLava == null || sample.distanceHeroToLava > summary.maxDistanceHeroToLava) {
      summary.maxDistanceHeroToLava = sample.distanceHeroToLava
    }
  }
}

function activeRendererTimersFromCounters(counters: RoundDebugCounters): number {
  return (counters.terminalTimerActive ? 1 : 0) + (counters.lavaResultTimerActive ? 1 : 0)
}

function sampleFromLegacy(payload: RoundDebugFramePayload): RoundDebugSamplePayload {
  return {
    heroX: payload.heroX,
    heroY: payload.heroY,
    heroDepth: payload.heroDepth,
    heroArc: payload.heroArc,
    pathTotalLength: payload.pathTotalLength,
    pathProgress: payload.pathProgress,
    lavaX: payload.lavaX,
    lavaY: payload.lavaY,
    lavaDepth: payload.lavaDepth,
    distanceHeroToLava: payload.distanceHeroToLava,
    lossTerminalDescent: payload.lossTerminalDescent,
    running: payload.running,
    ended: false,
    speed: useGameStore.getState().speed,
    turbo: payload.turbo,
    autoplay: useGameStore.getState().autoplay.active,
    activeRendererTimers: activeRendererTimersFromCounters(payload.counters),
    activeAutoplayTimers: 0,
    objects: payload.counters.spawnerObjects ?? payload.counters.objectsLayerChildren ?? 0,
    lavaPools: payload.counters.lavaStaticPools ?? 0,
  }
}

function printAnomaly(summary: RoundSummary): void {
  if (!isDev() || summary.anomalies.length === 0) return
  console.warn(
    `[DR round anomaly] round=${summary.seq} outcome=${summary.outcomeFromRgs} ` +
      `duration=${round1(summary.runningDurationMs)}ms ` +
      `heroDepth=${round3(summary.heroDepth)} lavaY=${round1(summary.lavaY)} ` +
      `distanceToLava=${round1(summary.distanceHeroToLava)} ` +
      `reason=${summary.anomalies.join(',')}`,
  )
}

function finishCurrent(end: RoundDebugEndPayload): void {
  if (!_current) return
  const t = now()
  const s = _current
  s.endedAtMs = t
  s.durationMs = t - s.startedAtMs
  s.runningDurationMs = s.runningStartedAtMs == null ? null : t - s.runningStartedAtMs
  s.visualOutcome = end.visualOutcome
  s.collisionSource = end.collisionSource
  s.endHeroX = end.heroX
  s.endHeroY = end.heroY
  s.heroDepth = end.heroDepth
  s.heroArc = end.heroArc
  s.pathProgress = end.pathProgress
  s.lavaX = end.lavaX
  s.lavaY = end.lavaY
  s.lavaDepth = end.lavaDepth
  s.distanceHeroToLava = end.distanceHeroToLava
  s.activeRendererTimersEnd = end.activeRendererTimers
  s.activeAutoplayTimersEnd = end.activeAutoplayTimers
  s.maxObjects = Math.max(s.maxObjects, end.objects)
  s.maxLavaPools = Math.max(s.maxLavaPools, end.lavaPools)

  if (s.outcomeFromRgs !== 'UNKNOWN' && s.visualOutcome !== 'UNKNOWN' && s.outcomeFromRgs !== s.visualOutcome) {
    pushAnomaly(s, 'visual_outcome_mismatch')
  }
  if (s.outcomeFromRgs === 'LAVA' && s.runningDurationMs != null && s.runningDurationMs > 45000) {
    pushAnomaly(s, 'lava_duration_high')
  }
  if (s.activeRendererTimersEnd > 0) pushAnomaly(s, 'renderer_timer_left_after_end')
  if (s.activeAutoplayTimersEnd > 1) pushAnomaly(s, 'duplicated_autoplay_timer')

  _rounds.push(s)
  if (_rounds.length > 1000) _rounds.shift()
  _current = null
  _stress.completed += _stress.active ? 1 : 0
  printAnomaly(s)
}

export function isRoundDebugActive(): boolean {
  return isDev() && _enabled
}

export function roundDebugBeginRound(payload: RoundDebugStartPayload): void {
  if (!isDev()) return
  if (_current && _current.visualOutcome === 'UNKNOWN') {
    pushAnomaly(_current, 'new_round_started_before_previous_end')
    finishCurrent({
      heroX: _current.startHeroX,
      heroY: _current.startHeroY,
      heroDepth: 0,
      heroArc: 0,
      pathTotalLength: _current.pathTotalLength,
      pathProgress: 0,
      lavaX: _current.terminalX,
      lavaY: _current.terminalY,
      lavaDepth: null,
      distanceHeroToLava: null,
      lossTerminalDescent: false,
      running: false,
      ended: true,
      speed: payload.speed,
      turbo: payload.turbo,
      autoplay: payload.autoplay,
      activeRendererTimers: payload.activeRendererTimers,
      activeAutoplayTimers: payload.activeAutoplayTimers,
      objects: 0,
      lavaPools: payload.lavaPools,
      visualOutcome: 'UNKNOWN',
      collisionSource: 'unknown',
    })
  }

  const inheritedTransitions = _phaseTransitions.splice(0, _phaseTransitions.length)
  _current = {
    ...payload,
    seq: ++_seq,
    startedAtMs: now(),
    runningStartedAtMs: null,
    endedAtMs: null,
    durationMs: null,
    runningDurationMs: null,
    visualOutcome: 'UNKNOWN',
    collisionSource: null,
    endHeroX: null,
    endHeroY: null,
    heroDepth: null,
    heroArc: null,
    pathProgress: null,
    lavaX: payload.terminalX,
    lavaY: payload.terminalY,
    lavaDepth: null,
    distanceHeroToLava: null,
    minDistanceHeroToLava: null,
    maxDistanceHeroToLava: null,
    activeRendererTimersEnd: payload.activeRendererTimers,
    activeAutoplayTimersEnd: payload.activeAutoplayTimers,
    maxObjects: 0,
    maxLavaPools: payload.lavaPools,
    phaseTransitions: inheritedTransitions,
    anomalies: [],
  }
}

export function roundDebugMarkRunningStart(): void {
  if (!isDev() || !_current) return
  if (_current.runningStartedAtMs == null) _current.runningStartedAtMs = now()
}

export function roundDebugSample(sample: RoundDebugSamplePayload): void {
  if (!isDev() || !_current) return
  const s = _current
  s.heroDepth = sample.heroDepth
  s.heroArc = sample.heroArc
  s.pathProgress = sample.pathProgress
  s.endHeroX = sample.heroX
  s.endHeroY = sample.heroY
  s.lavaX = sample.lavaX
  s.lavaY = sample.lavaY
  s.lavaDepth = sample.lavaDepth
  s.distanceHeroToLava = sample.distanceHeroToLava
  s.activeRendererTimersEnd = sample.activeRendererTimers
  s.activeAutoplayTimersEnd = sample.activeAutoplayTimers
  s.maxObjects = Math.max(s.maxObjects, sample.objects)
  s.maxLavaPools = Math.max(s.maxLavaPools, sample.lavaPools)
  const elapsed = s.runningStartedAtMs == null ? now() - s.startedAtMs : now() - s.runningStartedAtMs
  evaluateSample(s, sample, elapsed)
}

export function roundDebugEndRound(end: RoundDebugEndPayload): void {
  if (!isDev()) return
  if (!_current) return
  roundDebugSample(end)
  finishCurrent(end)
}

export function roundDebugPhaseChange(payload: RoundDebugPhasePayload): void {
  if (!isDev()) return
  const line = `${payload.from}->${payload.to}@${Math.round(now())}ms timers=${payload.activeAutoplayTimers}`
  if (_current) _current.phaseTransitions.push(line)
  else _phaseTransitions.push(line)
}

export function roundDebugReport(): RoundDebugReport {
  const lavaRounds = _rounds.filter(r => r.outcomeFromRgs === 'LAVA' && r.runningDurationMs != null)
  const durations = lavaRounds.map(r => r.runningDurationMs!).filter(Number.isFinite)
  const depths = lavaRounds.map(r => r.heroDepth).filter((v): v is number => v != null && Number.isFinite(v))
  const distances = lavaRounds.map(r => r.distanceHeroToLava).filter((v): v is number => v != null && Number.isFinite(v))
  const anomalies = _rounds.filter(r => r.anomalies.length > 0)
  const anomalyRows = anomalies.map(r => ({ round: r.seq, reasons: r.anomalies }))
  const report: RoundDebugReport = {
    enabled: _enabled,
    stress: { ..._stress },
    rounds: _rounds.length,
    lavaRounds: lavaRounds.length,
    lavaDurationMs: minAvgMax(durations),
    heroDepthAtLava: minAvgMax(depths),
    distanceHeroToLava: minAvgMax(distances),
    anomalyCount: anomalies.length,
    anomalies: anomalyRows,
    anomalyRounds: anomalyRows,
    last10: _rounds.slice(-10).map(r => ({
      round: r.seq,
      roundID: r.roundID,
      outcome: r.outcomeFromRgs,
      rgs: r.outcomeFromRgs,
      visualOutcome: r.visualOutcome,
      visual: r.visualOutcome,
      durationMs: round1(r.runningDurationMs),
      heroDepth: round3(r.heroDepth),
      depth: round3(r.heroDepth),
      pathProgress: round3(r.pathProgress),
      lavaY: round1(r.lavaY),
      distanceHeroToLava: round1(r.distanceHeroToLava),
      distanceToLava: round1(r.distanceHeroToLava),
      rendererTimers: r.activeRendererTimersEnd,
      autoplayTimers: r.activeAutoplayTimersEnd,
      maxObjects: r.maxObjects,
      maxLavaPools: r.maxLavaPools,
      anomalies: r.anomalies,
    })),
  }
  if (isDev()) {
    console.log('%c[DR round debug] report', 'color:#9ad0ff;font-weight:bold')
    console.table((report.last10 as unknown[]))
    console.log(report)
  }
  return report
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

async function waitForBoot(): Promise<void> {
  const started = now()
  while (useGameStore.getState().phase === 'BOOT') {
    if (now() - started > 30000) throw new Error('Timed out waiting for boot')
    await sleep(100)
  }
}

async function waitForRoundFinish(roundID: string, timeoutMs: number): Promise<void> {
  const started = now()
  while (true) {
    const s = useGameStore.getState()
    const doneByPhase = s.roundID === roundID && (s.phase === 'WIN' || s.phase === 'LOSE' || s.phase === 'IDLE')
    const nextRoundStarted = s.roundID !== roundID && s.phase !== 'BETTING'
    if (doneByPhase || nextRoundStarted) return
    if (now() - started > timeoutMs) throw new Error(`Timed out waiting for round ${roundID || '(empty)'}`)
    await sleep(100)
  }
}

async function runStressSpins(count = 250, opts?: { stopOnAnomaly?: boolean; timeoutMs?: number }): Promise<RoundDebugReport> {
  if (!isDev()) throw new Error('__DR_STRESS_SPINS__ is available only in DEV')
  const { gameEngine } = await import('../game/GameEngine')
  _enabled = true
  _stress.active = true
  _stress.requested = count
  _stress.completed = 0
  _stress.stopOnAnomaly = opts?.stopOnAnomaly ?? true

  const store = useGameStore.getState()
  store.setAutoplay({ active: false, remainingRounds: 0, infinite: false })
  store.setAutoplayOpen(false)
  store.setMenuOpen(false)

  await waitForBoot()
  for (let i = 0; i < count; i++) {
    const beforeAnomalies = _rounds.filter(r => r.anomalies.length > 0).length
    await gameEngine.startRound()
    const roundID = useGameStore.getState().roundID
    await waitForRoundFinish(roundID, opts?.timeoutMs ?? 90000)
    const afterAnomalies = _rounds.filter(r => r.anomalies.length > 0).length
    if (_stress.stopOnAnomaly && afterAnomalies > beforeAnomalies) break
    await sleep(50)
  }
  _stress.active = false
  return roundDebugReport()
}

const DR_ROUND_DEBUG = {
  enable(): void {
    _enabled = true
    console.log('%c[DR round debug] вкл. __DR_ROUND_DEBUG__.report()', 'color:#9ad0ff')
  },
  disable(): void {
    _enabled = false
    console.log('[DR round debug] выкл')
  },
  report: roundDebugReport,
  clear(): void {
    _rounds.length = 0
    _phaseTransitions.length = 0
    _current = null
    _seq = 0
    console.log('[DR round debug] cleared')
  },
}

export const roundDebug = {
  enable: DR_ROUND_DEBUG.enable,
  disable: DR_ROUND_DEBUG.disable,
  reset: DR_ROUND_DEBUG.clear,
  clear: DR_ROUND_DEBUG.clear,
  report: roundDebugReport,
  phaseChange(from: GamePhase, to: GamePhase): void {
    roundDebugPhaseChange({ from, to, activeAutoplayTimers: 0 })
  },
  roundStart(payload: LegacyRoundStartPayload): void {
    roundDebugBeginRound({
      roundID: payload.roundID,
      outcomeFromRgs: payload.outcome,
      speed: payload.speed,
      turbo: payload.turbo,
      autoplay: payload.autoplay,
      startHeroX: payload.startHeroX,
      startHeroY: payload.startHeroY,
      terminalCaveExists: payload.terminalCaveExists,
      homeExists: payload.homeExists,
      pathTotalLength: payload.pathTotalLength,
      terminalX: payload.expectedLavaX,
      terminalY: payload.expectedLavaY ?? payload.expectedTerminalY,
      lavaPools: payload.counters.lavaStaticPools ?? 0,
      activeRendererTimers: activeRendererTimersFromCounters(payload.counters),
      activeAutoplayTimers: 0,
      previousCleanupCompleted: activeRendererTimersFromCounters(payload.counters) === 0,
    })
    if (_current) {
      _current.countersStart = {
        objectsLayerChildren: payload.counters.objectsLayerChildren,
        activePixiChildren: payload.counters.activePixiChildren,
        lavaStaticPools: payload.counters.lavaStaticPools,
        tilePendingCaves: payload.counters.tilePendingCaves,
      }
    }
  },
  frame(payload: RoundDebugFramePayload): void {
    if (payload.running) roundDebugMarkRunningStart()
    roundDebugSample(sampleFromLegacy(payload))
  },
  terminalHit(payload: LegacyTerminalHitPayload): void {
    const sample = sampleFromLegacy(payload)
    roundDebugEndRound({
      ...sample,
      ended: true,
      visualOutcome: payload.visualOutcome,
      collisionSource: payload.source,
    })
  },
  cleanup(payload: { completed: boolean; counters: RoundDebugCounters }): void {
    if (_rounds.length === 0) return
    const last = _rounds[_rounds.length - 1]!
    last.countersEnd = {
      objectsLayerChildren: payload.counters.objectsLayerChildren,
      activePixiChildren: payload.counters.activePixiChildren,
      lavaStaticPools: payload.counters.lavaStaticPools,
      tilePendingCaves: payload.counters.tilePendingCaves,
    }
    if (!payload.completed) pushAnomaly(last, 'cleanup_incomplete')
  },
  get summaries(): RoundSummary[] {
    return _rounds
  },
}

const DR_STRESS_SPINS = {
  run: runStressSpins,
  stop(): void {
    _stress.active = false
  },
  report: roundDebugReport,
}

export function installRoundDebugFromUrl(): void {
  if (!isDev() || typeof window === 'undefined') return
  ;(window as any).__DR_ROUND_DEBUG__ = DR_ROUND_DEBUG

  if (typeof location === 'undefined') return
  const sp = new URLSearchParams(location.search)
  if (sp.get('roundDebug') !== null) DR_ROUND_DEBUG.enable()
}
