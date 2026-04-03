/**
 * Demo / FUN mode — simulates Stake Engine RGS responses client-side.
 * Active when ?rgs_url is absent (local dev, preview, or demo embed).
 *
 * Mirrors the exact same response shapes as the real RGS API so the
 * game code never needs to know which mode it's in.
 *
 * ── Логика начисления ──────────────────────────────────────────────────────
 * `multiplier` — накопленный коэффициент к базовой ставке.
 * Итоговый выигрыш = bet * multiplier.
 *
 * COIN:    накопленное += addMin..addMax  (фиксированная добавка в единицах ставки)
 * DIAMOND: накопленное *= factor          (умножение имеющейся суммы)
 * GOLD:    накопленное += ratePerSec * durationSec  (рост суммы пока идёт уничтожение)
 * STONE:   накопленное *= (1 - penaltyPerSec * durationSec)  (сгорание % суммы в сек)
 * BOMB:    накопленное /= divisor         (делит сумму пополам)
 * LAVA:    накопленное = 0               (всё сгорает, поражение)
 * HOME:    раунд завершён, выплачивается накопленное
 */

import type {
  AuthResponse, PlayResponse, EndRoundResponse,
  RgsConfig, RgsRound, RoundEvent, MoneyAmount,
} from './client'
import { MONEY_SCALE } from './client'
import bonusesRaw from './bonuses.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cfg: any = bonusesRaw

// ─── State ────────────────────────────────────────────────────────────────────

const INITIAL_BALANCE = 1_000 * MONEY_SCALE   // $1 000 FUN

let _balance = INITIAL_BALANCE
let _roundSeq = 0

export function resetDemoBalance() { _balance = INITIAL_BALANCE }
export function getDemoBalance()   { return _balance }

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
  jurisdiction: {
    socialCasino:       false,
    disabledFullscreen: false,
    disabledTurbo:      false,
  },
}

// ─── PRNG ─────────────────────────────────────────────────────────────────────

function makePrng(seed: number) {
  let s = seed >>> 0
  return (): number => {
    s = Math.imul(1664525, s) + 1013904223 >>> 0
    return s / 0x100000000
  }
}

// ─── Round generation ─────────────────────────────────────────────────────────

export function generateDemoRound(_betDisplay: number): RoundEvent[] {
  const rand = makePrng((Date.now() ^ (++_roundSeq * 0x9e3779b9)) >>> 0)

  const willWin = rand() < cfg.round.winChance

  const events: RoundEvent[] = []

  // multiplier = накопленный коэффициент к ставке (начинаем с 1x)
  let multiplier = 1.0

  const count = Math.floor(rand() * (cfg.round.eventsMax - cfg.round.eventsMin + 1)) + cfg.round.eventsMin

  let depth    = 0
  let distance = 0

  for (let i = 0; i < count; i++) {
    depth    += Math.floor(rand() * 18) + 6
    distance += Math.floor(rand() * 28) + 12

    const r = rand()
    let type: RoundEvent['type'] = 'COIN'
    let durationMs: number | undefined

    // ── Weighted pick ──────────────────────────────────────────────────────
    const w = cfg.weights
    const wCoin = w.COIN
    const wDiam = wCoin + w.DIAMOND
    const wGold = wDiam + w.GOLD
    const wBomb = wGold + w.BOMB
    if      (r < wCoin) { type = 'COIN'    }
    else if (r < wDiam) { type = 'DIAMOND' }
    else if (r < wGold) { type = 'GOLD'    }
    else if (r < wBomb) { type = 'BOMB'    }
    else                { type = 'STONE'   }

    // ── Применяем эффект к накопленному множителю ──────────────────────────

    if (type === 'COIN') {
      // Монета: +N к сумме (в единицах ставки)
      // Пример: ставка $1, add=0.8 → накопленное +$0.80
      const add = cfg.COIN.addMin + rand() * (cfg.COIN.addMax - cfg.COIN.addMin)
      multiplier += add
    }
    else if (type === 'DIAMOND') {
      // Бриллиант: накопленное * X
      // Пример: накоплено $3, factor=3 → $9
      const factors: number[] = cfg.DIAMOND.factors
      const factor = factors[Math.floor(rand() * factors.length)]
      multiplier *= factor
    }
    else if (type === 'GOLD') {
      // Золото: персонаж стоит durationMs мс
      // Накопленное растёт: += ratePerSec * секунды
      // Пример: ставка $1, rate=3, time=3s → +$9 (итого multiplier += 9)
      const durMin = cfg.GOLD.durationMsMin
      const durMax = cfg.GOLD.durationMsMax
      durationMs = Math.floor(rand() * (durMax - durMin)) + durMin
      const secs = durationMs / 1000
      multiplier += cfg.GOLD.ratePerSec * secs
    }
    else if (type === 'BOMB') {
      // Бомба: накопленное делится на divisor (пополам)
      // Пример: $10 → $5
      multiplier = Math.max(cfg.BOMB.multiplierFloor, multiplier / cfg.BOMB.divisor)
    }
    else if (type === 'STONE') {
      // Камень: персонаж стоит durationMs мс
      // Накопленное сгорает: *= (1 - penaltyPerSec * секунды)
      // Пример: $100, penalty=0.05, time=5s → $100 * (1 - 0.25) = $75
      const durMin = cfg.STONE.durationMsMin
      const durMax = cfg.STONE.durationMsMax
      durationMs = Math.floor(rand() * (durMax - durMin)) + durMin
      const secs = durationMs / 1000
      // penaltyPerSec * secs не должен превысить 1 (нельзя уйти в минус)
      const totalPenalty = Math.min(cfg.STONE.penaltyPerSec * secs, 0.99)
      multiplier = Math.max(cfg.BOMB.multiplierFloor, multiplier * (1 - totalPenalty))
    }

    // Округляем до 2 знаков, не выходим за cap
    multiplier = Math.min(cfg.round.multiplierCap, Math.round(multiplier * 100) / 100)

    events.push({ type, depth, distance, multiplierSnap: multiplier, durationMs } as any)
  }

  // ── Финальное событие ──────────────────────────────────────────────────────
  depth    += Math.floor(rand() * 20) + 10
  distance += Math.floor(rand() * 30) + 15

  const terminal: RoundEvent['type'] = willWin ? 'HOME' : 'LAVA'
  events.push({ type: terminal, depth, distance, multiplierSnap: multiplier } as any)

  return events
}

function roundFromEvents(events: RoundEvent[], roundID: string): RgsRound {
  const terminal  = events[events.length - 1]
  const won       = terminal.type === 'HOME'
  const finalMult = won ? terminal.multiplierSnap : 0
  return { roundID, payoutMultiplier: finalMult, isActive: false, events }
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
  _balance     = Math.max(0, _balance - betApi)

  const events  = generateDemoRound(betDisplay)
  const roundID = `demo-${Date.now()}-${_roundSeq}`
  const round   = roundFromEvents(events, roundID)
  round.isActive = round.payoutMultiplier > 0

  return {
    balance: { amount: _balance, currency: 'FUN' },
    round,
  }
}

export async function demoEndRound(betDisplay: number, multiplier: number): Promise<EndRoundResponse> {
  const payoutApi = Math.round(betDisplay * multiplier * MONEY_SCALE)
  _balance       += payoutApi
  return {
    balance: { amount: _balance, currency: 'FUN' },
  }
}