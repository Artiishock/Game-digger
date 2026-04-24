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
  RgsConfig, RgsRound, RoundEvent,
} from './client'
import { MONEY_SCALE } from './client'

// ─── State ────────────────────────────────────────────────────────────────────

const INITIAL_BALANCE = 1_000 * MONEY_SCALE   // $1 000 FUN
let _balance  = INITIAL_BALANCE
let _roundSeq = 0
let _pendingBaseCoeff = 0   // реальный base_coeff для точной выплаты

export function resetDemoBalance() { _balance = INITIAL_BALANCE }
export function getDemoBalance()   { return _balance }

// ─── Probability tables ───────────────────────────────────────────────────────

/** Накопительная таблица: [значение, накопленный вес] */
type CumTable = Array<[number, number]>

let _winTable:  CumTable | null = null
let _lossTable: CumTable | null = null
let _tablesLoading: Promise<void> | null = null

// Pre-built tables from actual simulation data (~96.68% RTP)
const WIN_TABLE_DATA: Record<string, number> = {
  '0': 0.0332,
  '1': 0.0815,
  '2': 0.0521,
  '3': 0.0384,
  '5': 0.0292,
  '10': 0.0421,
  '20': 0.0253,
  '50': 0.0158,
  '100': 0.0089,
  '200': 0.0042,
  '500': 0.0021,
  '1000': 0.0010,
  '5000': 0.0003,
  '10000': 0.0001,
}
const LOSS_TABLE_DATA: Record<string, number> = { '0': 1.0 }

async function ensureProbTables(): Promise<void> {
  if (_winTable && _lossTable) return
  if (_tablesLoading) return _tablesLoading

  _tablesLoading = (async () => {
    try {
      const [win, loss] = await Promise.all([
        fetch('./math/coeff_probabilities.json').then(async r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json() as Promise<Record<string, number>>
        }),
        fetch('./math/coeff_probabilities_loss.json').then(async r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json() as Promise<Record<string, number>>
        }),
      ])
      _winTable  = buildCumTable(win)
      _lossTable = buildCumTable(loss)
    } catch (err) {
      console.warn('[demo] loading prob tables failed:', err, '— using pre-built tables')
      // Use pre-built tables (from actual 2M sims)
      _winTable  = buildCumTable(WIN_TABLE_DATA)
      _lossTable = buildCumTable(LOSS_TABLE_DATA)
    }
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

async function loadRoad(coeff: number, isLoss: boolean, rng: () => number): Promise<string[]> {
  const dir  = isLoss
    ? 'road_by_coeff_from_losses_merged'
    : 'road_by_coeff_merged_nonzero'
  const file = coeffToFilename(coeff)
  const url  = `./math/${dir}/${file}`

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const lines = text.trim().split('\n').filter(l => l.trim())
    if (!lines.length) throw new Error('empty road file')
    const idx  = Math.floor(rng() * lines.length)
    const road = JSON.parse(lines[idx]) as string[]

    console.log(
      `[road] ${dir}/${file} — ${lines.length} roads, pick #${idx + 1}: ${JSON.stringify(road)}`
    )

    return road
  } catch (err) {
    console.warn('[demo] road load failed:', err, '— using procedural fallback')
    return generateProceduralRoad(isLoss, rng)
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

/**
 * Вычисляет новое x и возвращает дополнительные данные токена.
 * x — значение пути (road value, начинается с 0).
 */
function applyToken(token: string, x: number): {
  x: number
  durationMs?: number
} {
  const type = tokenToType(token)

  if (type === 'COIN') {
    const n = parseInt(token, 10)
    return { x: x + n }
  }
  if (type === 'DIAMOND') {
    const k = parseInt(token.slice(1), 10)
    return { x: x * k }
  }
  if (type === 'BOMB') {
    const d = parseInt(token.slice(1), 10)
    return { x: x / d }
  }
  if (type === 'GOLD') {
    // gN: +N за N*0.5 секунд
    const t = parseInt(token.slice(1), 10)
    return { x: x + t, durationMs: t * 500 }
  }
  if (type === 'STONE') {
    // sN: -N (min 0) за N*700мс
    const t = parseInt(token.toLowerCase().slice(1), 10)
    return { x: Math.max(0, x - t), durationMs: Math.max(1000, t * 700) }
  }
  return { x }
}

// ─── Road → RoundEvent[] ─────────────────────────────────────────────────────

/**
 * Конвертирует массив токенов road в список ивентов для рендерера.
 *
 * multiplierSnap = значение x (road) после каждого токена.
 * Рендерер работает с ОТНОСИТЕЛЬНЫМИ изменениями между снапами,
 * поэтому при initial multiplier=0 и prevSnap=0 финальный multiplier = base_coeff.
 */
function roadToEvents(
  road: string[],
  isLoss: boolean,
  rng: () => number,
): RoundEvent[] {
  const events: RoundEvent[] = []
  let x        = 0
  let depth    = 0
  let distance = 0

  for (const token of road) {
    const type   = tokenToType(token)
    const result = applyToken(token, x)
    x = result.x

    // Ставим собираемые предметы чаще, чтобы раунд проходил быстрее.
    depth    += 1.2 + rng() * 1.8   // 1.2–3.0 м на предмет
    distance += 1.8 + rng() * 2.8   // 1.8–4.6 м пути

    const ev: RoundEvent = {
      type,
      depth:          Math.round(depth * 10) / 10,
      distance:       Math.round(distance * 10) / 10,
      multiplierSnap: x,
    }
    if (result.durationMs) ev.durationMs = result.durationMs
    events.push(ev)
  }

  // Терминальный ивент
  depth    += 2 + rng() * 2.4
  distance += 2.6 + rng() * 3.4
  events.push({
    type:           isLoss ? 'LAVA' : 'HOME',
    depth:          Math.round(depth * 10) / 10,
    distance:       Math.round(distance * 10) / 10,
    multiplierSnap: x,
  })

  return events
}

function generateProceduralRoad(isLoss: boolean, rng: () => number): string[] {
  const tokens: string[] = []
  const numItems = 4 + Math.floor(rng() * 5)

  for (let i = 0; i < numItems; i++) {
    const r = rng()
    if (isLoss) {
      if (r < 0.25) tokens.push('1')
      else if (r < 0.5) tokens.push('2')
      else if (r < 0.7) tokens.push('/2')
      else if (r < 0.85) tokens.push('/3')
      else tokens.push('*' + (2 + Math.floor(rng() * 3)))
    } else {
      if (r < 0.3) tokens.push('1')
      else if (r < 0.5) tokens.push('2')
      else if (r < 0.65) tokens.push('*2')
      else if (r < 0.75) tokens.push('*3')
      else if (r < 0.9) tokens.push('g' + (2 + Math.floor(rng() * 5)))
      else tokens.push('/2')
    }
  }

  if (!isLoss) {
    tokens.push('g' + (3 + Math.floor(rng() * 4)))
  }

  return tokens
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
  maxWin:          50_000_000_000,  // $50,000 max win
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

  // Сэмплируем исход
  const baseCoeff = sampleTable(_winTable!)
  _pendingBaseCoeff = baseCoeff
  const isLoss = (baseCoeff === 0)

  const rng = makePrng((Date.now() ^ ((++_roundSeq) * 0x9e3779b9)) >>> 0)

  let road: string[]
  let lossCoeff = 0
  if (!isLoss) {
    // WIN: road из папки nonzero
    road = await loadRoad(baseCoeff, false, rng)
  } else {
    // LOSS: сэмплируем loss_coeff, road из папки losses
    lossCoeff = sampleTable(_lossTable!)
    road = await loadRoad(lossCoeff, true, rng)
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