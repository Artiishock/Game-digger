/**
 * Demo / FUN mode — использует РЕАЛЬНУЮ математику Deep Rush.
 * Активен когда ?rgs_url отсутствует (local dev / preview).
 *
 * Флоу одного раунда:
 *  1. Сэмплируем base_coeff из COEFF_PROBABILITY
 *  2a. WIN (base_coeff > 0): грузим road из road_by_coeff_merged_nonzero
 *  2b. LOSS (base_coeff == 0): сэмплируем loss_coeff, грузим road из road_by_coeff_from_losses_merged
 *  3. Конвертируем токены road → RoundEvent[]
 *  4. Терминальный ивент: HOME (win) | LAVA (loss)
 */

import type {
  AuthResponse, PlayResponse, EndRoundResponse,
  RgsConfig, RgsRound, RoundEvent, EventEffect,
} from './client'
import { MONEY_SCALE } from './client'
import { GameConfig } from '../game/GameConfig'
import type { WinCelebrateKind } from '../ui/winCelebration'

// ─── State ────────────────────────────────────────────────────────────────────

const INITIAL_BALANCE = 1_000 * MONEY_SCALE   // $1 000 FUN
let _balance  = INITIAL_BALANCE
let _roundSeq = 0
let _pendingBaseCoeff = 0   // реальный base_coeff для точной выплаты

/** DEV: очередь на следующий FUN-раунд (только import.meta.env.DEV, см. demoMathConsole.ts) */
let _devQueuedCelebrate: WinCelebrateKind | null = null
let _devQueuedCoeff: number | null = null

export function resetDemoBalance() { _balance = INITIAL_BALANCE }
export function getDemoBalance()   { return _balance }

/** Снимок множителя математики перед demoEndRound (для отображения WIN = выплате demo). */
export function peekPendingBaseCoeff(): number {
  return _pendingBaseCoeff
}

function uniqCoeffsFromWinTable(table: CumTable): number[] {
  return [...new Set(table.map(([v]) => v))]
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b)
}

function nearestCoefficient(target: number, list: number[]): number {
  if (list.length === 0) return target
  let best = list[0]!
  let bd = Infinity
  for (const x of list) {
    const d = Math.abs(x - target)
    if (d < bd) {
      bd = d
      best = x
    }
  }
  return best
}

function pickCelebrateCoeffFromMath(kind: WinCelebrateKind, winCoeffs: number[]): number {
  const r = GameConfig.round
  const mega = r.megaWinMinMultiplier ?? 50
  const epic = r.epicWinMinMultiplier ?? 10
  const bigEx = r.bigWinExclusiveAboveMultiplier ?? 3
  const pos = winCoeffs.filter(c => c > 0)

  const pickMega = (): number =>
    pos.filter(c => c >= mega)[0] ?? pos[pos.length - 1]!
  const pickEpic = (): number => {
    const inTier = pos.filter(c => c >= epic && c < mega)
    if (inTier.length) return inTier[0]!
    const ge = pos.filter(c => c >= epic)
    return ge[0] ?? pickMega()
  }
  const pickBig = (): number => {
    const inTier = pos.filter(c => c > bigEx && c < epic)
    if (inTier.length) return inTier[inTier.length - 1]!
    const gt = pos.filter(c => c > bigEx)
    return gt[0] ?? pos[Math.min(1, pos.length - 1)]!
  }

  switch (kind) {
    case 'megawin': return pickMega()
    case 'epicwin': return pickEpic()
    case 'bigwin': return pickBig()
  }
}

/** Следующий demoPlay возьмёт указанный base_coeff из таблицы (ближайший допустимый). */
export function devQueueForcedCoeff(desiredCoeff: number): void {
  if (!import.meta.env.DEV) return
  _devQueuedCoeff = desiredCoeff
  _devQueuedCelebrate = null
  console.info('[demo dev] next round forced coeff (approx):', desiredCoeff)
}

/** Следующий demoPlay подберёт base_coeff так, чтобы оверлей bigwin/epicwin/megawin совпал с порогами. */
export function devQueueCelebrateAnimation(kind: WinCelebrateKind): void {
  if (!import.meta.env.DEV) return
  _devQueuedCelebrate = kind
  _devQueuedCoeff = null
  console.info('[demo dev] next round queued animation:', kind)
}

export function devClearForcedCoefficientQueue(): void {
  _devQueuedCoeff = null
  _devQueuedCelebrate = null
  if (import.meta.env.DEV) console.info('[demo dev] queues cleared')
}

export function devGetForcedCoefficientQueueHint(): {
  coeff: number | null
  celebrate: WinCelebrateKind | null
} {
  return { coeff: _devQueuedCoeff, celebrate: _devQueuedCelebrate }
}

function takeDevCoefficientForNextRound(winTable: CumTable): number | undefined {
  if (!import.meta.env.DEV) return undefined
  const coeffs = uniqCoeffsFromWinTable(winTable)
  const positives = coeffs.filter(c => c > 0)

  if (_devQueuedCoeff !== null) {
    const snapped = nearestCoefficient(_devQueuedCoeff, positives.length ? positives : coeffs)
    console.info(`[demo dev] apply forced coeff ${snapped} (requested ${_devQueuedCoeff})`)
    _devQueuedCoeff = null
    _devQueuedCelebrate = null
    return snapped
  }

  if (_devQueuedCelebrate !== null) {
    const k = _devQueuedCelebrate
    const c = pickCelebrateCoeffFromMath(k, positives.length ? positives : coeffs)
    console.info(`[demo dev] apply celebrate ${k} → coeff ${c}`)
    _devQueuedCelebrate = null
    return c
  }

  return undefined
}

// ─── Probability tables ───────────────────────────────────────────────────────

/** Накопительная таблица: [значение, накопленный вес] */
type CumTable = Array<[number, number]>

let _winTable:  CumTable | null = null
let _lossTable: CumTable | null = null
let _tablesLoading: Promise<void> | null = null

async function ensureProbTables(): Promise<void> {
  if (_winTable && _lossTable) return
  if (_tablesLoading) return _tablesLoading

  _tablesLoading = (async () => {
    const [win, loss] = await Promise.all([
      fetch('/math/coeff_probabilities.json').then(r => r.json() as Promise<Record<string, number>>),
      fetch('/math/coeff_probabilities_loss.json').then(r => r.json() as Promise<Record<string, number>>),
    ])
    _winTable  = buildCumTable(win)
    _lossTable = buildCumTable(loss)
  })()

  return _tablesLoading
}

function buildCumTable(prob: Record<string, number>): CumTable {
  // Сортируем ключи численно — Object.entries() не гарантирует порядок
  // для дробных ключей типа "0.12", "0.5" и т.д.
  const entries = Object.entries(prob)
    .map(([k, v]) => [parseFloat(k), Number(v)] as [number, number])
    .sort((a, b) => a[0] - b[0])

  const table: CumTable = []
  let cum = 0
  for (const [val, p] of entries) {
    cum += p
    table.push([val, cum])
  }

  // Гарантируем что последний cumW = 1.0 (защита от floating point погрешности)
  if (table.length > 0) {
    table[table.length - 1][1] = 1.0
  }

  return table
}

function sampleTable(table: CumTable): number {
  const r = Math.random()
  for (const [val, cumW] of table) {
    if (r <= cumW) return val
  }
  return table[table.length - 1][0]
}

// ─── Road loading ─────────────────────────────────────────────────────────────

function coeffToFilename(coeff: number): string {
  // 0.94 → coeff_0_94.jsonl
  return 'coeff_' + coeff.toFixed(2).replace('.', '_') + '.jsonl'
}

async function loadRoad(coeff: number, isLoss: boolean): Promise<string[]> {
  const dir  = isLoss
    ? 'road_by_coeff_from_losses_merged'
    : 'road_by_coeff_merged_nonzero'
  const file = coeffToFilename(coeff)
  const url  = `/math/${dir}/${file}`

  try {
    const text = await fetch(url).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
      return r.text()
    })
    const lines = text.trim().split('\n').filter(l => l.trim())
    if (!lines.length) throw new Error('empty road file')
    const idx  = Math.floor(Math.random() * lines.length)
    const road = JSON.parse(lines[idx]) as string[]

    console.log(
      `[road] 📂 ${dir}/${file}\n` +
      `       всего дорожек: ${lines.length}, выбрана #${idx + 1}\n` +
      `       маршрут: ${JSON.stringify(road)}`
    )

    return road
  } catch (err) {
    console.warn('[demo] road load failed:', err, '— using fallback')
    return isLoss ? ['1', '/2'] : ['1']
  }
}

// ─── Token → EventType ────────────────────────────────────────────────────────

type PickupType = 'COIN' | 'DIAMOND' | 'BOMB' | 'GOLD' | 'STONE'

function tokenToType(token: string): PickupType {
  if (/^\d+$/.test(token))                    return 'COIN'
  if (token.startsWith('*'))                  return 'DIAMOND'
  if (token.startsWith('/'))                  return 'BOMB'
  if (token.toLowerCase().startsWith('g'))    return 'GOLD'
  if (token.toLowerCase().startsWith('s'))    return 'STONE'
  return 'COIN'
}

/** Парсит токен дорожки в явный эффект на множитель. */
function parseToken(token: string): {
  type:       PickupType
  effect:     EventEffect
  durationMs?: number
} {
  const type = tokenToType(token)
  if (type === 'COIN') {
    const n = parseInt(token, 10)
    return { type, effect: { op: 'add', value: n } }
  }
  if (type === 'DIAMOND') {
    const k = parseInt(token.slice(1), 10)
    return { type, effect: { op: 'mul', value: k } }
  }
  if (type === 'BOMB') {
    const d = parseInt(token.slice(1), 10)
    return { type, effect: { op: 'div', value: d } }
  }
  if (type === 'GOLD') {
    // gN: +N за N×0.5 с паузы
    const t = Math.max(1, parseInt(token.slice(1), 10) || 1)
    return { type, effect: { op: 'add', value: t }, durationMs: t * 500 }
  }
  // STONE: sN: −N за N×0.5 с паузы
  const t = Math.max(1, parseInt(token.toLowerCase().slice(1), 10) || 1)
  return { type, effect: { op: 'sub', value: t }, durationMs: t * 500 }
}


// ─── Road → RoundEvent[] ─────────────────────────────────────────────────────

/**
 * Конвертирует массив токенов road в список ивентов для рендерера.
 * Каждое событие несёт явный `effect` — клиент применяет его детерминированно
 * при сборе; порядок сбора не влияет на смысл эффекта (но влияет на итог
 * из-за неассоциативности add/mul — payout определяется серверным base_coeff).
 */
function roadToEvents(
  road: string[],
  isLoss: boolean,
  rng: () => number,
): RoundEvent[] {
  const events: RoundEvent[] = []
  let depth    = 0
  let distance = 0

  for (const token of road) {
    const parsed = parseToken(token)

    depth    += 1.2 + rng() * 1.8   // 1.2–3.0 м на предмет
    distance += 1.8 + rng() * 2.8   // 1.8–4.6 м пути

    const ev: RoundEvent = {
      type:     parsed.type,
      depth:    Math.round(depth * 10) / 10,
      distance: Math.round(distance * 10) / 10,
      effect:   parsed.effect,
    }
    if (parsed.durationMs) ev.durationMs = parsed.durationMs
    events.push(ev)
  }

  depth    += 2 + rng() * 2.4
  distance += 2.6 + rng() * 3.4
  events.push({
    type:     isLoss ? 'LAVA' : 'HOME',
    depth:    Math.round(depth * 10) / 10,
    distance: Math.round(distance * 10) / 10,
  })

  return events
}

// ─── PRNG ─────────────────────────────────────────────────────────────────────

function makePrng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

const DEMO_CONFIG: RgsConfig = {
  minBet:          100_000,
  maxBet:   1_000_000_000,
  stepBet:         100_000,
  defaultBetLevel: 1_000_000,
  betLevels: [
    100_000, 200_000, 500_000,
    1_000_000, 2_000_000, 5_000_000,
    10_000_000, 25_000_000, 50_000_000, 100_000_000,
  ],
  jurisdiction: { socialCasino: false, disabledFullscreen: false, disabledTurbo: false },
}

// ─── API surface ──────────────────────────────────────────────────────────────

export async function demoAuthenticate(): Promise<AuthResponse> {
  return {
    balance: { amount: _balance, currency: 'FUN' },
    config:  DEMO_CONFIG,
  }
}

export async function demoPlay(betDisplay: number): Promise<PlayResponse> {
  const betApi = Math.round(betDisplay * MONEY_SCALE)
  _balance = Math.max(0, _balance - betApi)

  // Загружаем таблицы вероятностей если нужно
  await ensureProbTables()

  const devCoeff = takeDevCoefficientForNextRound(_winTable!)
  const baseCoeff = devCoeff !== undefined ? devCoeff : sampleTable(_winTable!)
  _pendingBaseCoeff = baseCoeff
  const isLoss = (baseCoeff === 0)

  const rng = makePrng((Date.now() ^ ((++_roundSeq) * 0x9e3779b9)) >>> 0)

  let road: string[]
  let lossCoeff = 0
  if (!isLoss) {
    // WIN: road из папки nonzero
    road = await loadRoad(baseCoeff, false)
  } else {
    // LOSS: сэмплируем loss_coeff, road из папки losses
    lossCoeff = sampleTable(_lossTable!)
    road = await loadRoad(lossCoeff, true)
  }

  const events  = roadToEvents(road, isLoss, rng)
  const roundID = `demo-${Date.now()}-${_roundSeq}`

  // ── Лог раунда ──────────────────────────────────────────────────────────────
  const tokenSymbols = road.map(t => {
    if (/^\d+$/.test(t))               return `💰${t}`
    if (t.startsWith('*'))             return `💎${t}`
    if (t.startsWith('/'))             return `💣${t}`
    if (t.toLowerCase().startsWith('g')) return `✨${t}`
    if (t.toLowerCase().startsWith('s')) return `🪨${t}`
    return t
  }).join(' → ')

  console.log(
    `\n${'═'.repeat(56)}\n` +
    `[раунд #${_roundSeq}]  исход: ${isLoss ? '🔥 ЛАВА' : '🏠 ДОМ'}` +
    (isLoss
      ? `  (base=0, loss_coeff=${lossCoeff})`
      : `  (base_coeff=${baseCoeff})`) +
    `\n  ставка: $${betDisplay.toFixed(2)}` +
    (isLoss ? '' : `  выплата: $${(betDisplay * baseCoeff).toFixed(2)}`) +
    `\n  предметы: ${tokenSymbols}` +
    `\n${'─'.repeat(56)}`
  )

  const round: RgsRound = {
    roundID,
    payoutMultiplier: baseCoeff,
    isActive:         !isLoss && baseCoeff > 0,
    events,
  }

  return {
    balance: { amount: _balance, currency: 'FUN' },
    round,
  }
}

/**
 * Завершение раунда в demo-режиме.
 * Используем _pendingBaseCoeff вместо renderer-множителя —
 * это гарантирует точную выплату независимо от визуальных накоплений.
 */
export async function demoEndRound(
  betDisplay: number,
  _rendererMult: number,
): Promise<EndRoundResponse> {
  const coeff     = _pendingBaseCoeff
  const payoutApi = Math.round(betDisplay * coeff * MONEY_SCALE)
  _balance += payoutApi
  _pendingBaseCoeff = 0

  console.log(
    `[end-round] 💵 выплата: $${(betDisplay * coeff).toFixed(2)}` +
    `  (ставка $${betDisplay.toFixed(2)} × coeff ${coeff})` +
    `  баланс: $${(_balance / MONEY_SCALE).toFixed(2)}`
  )

  return { balance: { amount: _balance, currency: 'FUN' } }
}