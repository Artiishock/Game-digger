/**
 * Demo / FUN mode — simulates Stake Engine RGS responses client-side.
 * Active when ?rgs_url is absent (local dev, preview, or demo embed).
 *
 * Mirrors the exact same response shapes as the real RGS API so the
 * game code never needs to know which mode it's in.
 */

import type {
  AuthResponse, PlayResponse, EndRoundResponse,
  RgsConfig, RgsRound, RoundEvent, MoneyAmount,
} from './client'
import { MONEY_SCALE } from './client'

// ─── State ────────────────────────────────────────────────────────────────────

const INITIAL_BALANCE = 1_000 * MONEY_SCALE   // $1 000 FUN

let _balance = INITIAL_BALANCE
let _roundSeq = 0

export function resetDemoBalance() { _balance = INITIAL_BALANCE }
export function getDemoBalance()   { return _balance }

// ─── Config (mirrors real RGS config shape) ───────────────────────────────────

const DEMO_CONFIG: RgsConfig = {
  minBet:          100_000,         // $0.10
  maxBet:   1_000_000_000,          // $1 000
  stepBet:         100_000,
  defaultBetLevel: 1_000_000,       // $1.00
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

// ─── Seeded PRNG (Lehmer) ─────────────────────────────────────────────────────

function makePrng(seed: number) {
  let s = seed >>> 0
  return (): number => {
    s = Math.imul(1664525, s) + 1013904223 >>> 0
    return s / 0x100000000
  }
}

// ─── Round generation ─────────────────────────────────────────────────────────

/**
 * Generate a complete game round client-side.
 * The outcome (WIN / LOSE) is decided first, then a plausible event
 * sequence is built that leads to that outcome.
 *
 * Overall house edge ≈ 35% on LAVA rounds.
 */
export function generateDemoRound(betDisplay: number): RoundEvent[] {
  const rand = makePrng((Date.now() ^ (++_roundSeq * 0x9e3779b9)) >>> 0)

  // Decide outcome: 65% WIN, 35% LOSE
  const willWin = rand() < 0.65

  const events: RoundEvent[] = []
  let   multiplier = 1.0

  // 4–10 events before terminal
  const count = Math.floor(rand() * 7) + 4

  let depth    = 0
  let distance = 0

  for (let i = 0; i < count; i++) {
    depth    += Math.floor(rand() * 18) + 6
    distance += Math.floor(rand() * 28) + 12

    const r = rand()
    let type: RoundEvent['type'] = 'COIN'
    let durationMs: number | undefined

    // ── Weighted pick ──────────────────────────────────────────
    if      (r < 0.28) { type = 'COIN'    }
    else if (r < 0.44) { type = 'DIAMOND' }
    else if (r < 0.58) { type = 'GOLD'    }
    else if (r < 0.70) { type = 'BOMB'    }
    else if (r < 0.82) { type = 'STONE'   }
    else               { type = 'COIN'    }   // extra coins at tail

    // ── Apply effect to running multiplier ─────────────────────
    if (type === 'COIN') {
      const add = 0.1 + rand() * 0.5
      multiplier += add
    }
    else if (type === 'DIAMOND') {
      const factor = [1.5, 2, 2.5, 3, 4][Math.floor(rand() * 5)]
      multiplier *= factor
    }
    else if (type === 'GOLD') {
      durationMs = Math.floor(rand() * 4000) + 1000
      const secs = durationMs / 1000
      multiplier += 3 * secs      // ×3 per second
    }
    else if (type === 'BOMB') {
      multiplier = Math.max(0.1, multiplier / 2)
    }
    else if (type === 'STONE') {
      durationMs = Math.floor(rand() * 4000) + 1000
      const secs = durationMs / 1000
      multiplier = Math.max(0.1, multiplier * (1 - 0.05 * secs))
    }

    multiplier = Math.round(multiplier * 100) / 100

    events.push({ type, depth, distance, multiplierSnap: multiplier, durationMs })
  }

  // ── Terminal event ─────────────────────────────────────────────
  depth    += Math.floor(rand() * 20) + 10
  distance += Math.floor(rand() * 30) + 15

  const terminal: RoundEvent['type'] = willWin ? 'HOME' : 'LAVA'
  events.push({ type: terminal, depth, distance, multiplierSnap: multiplier })

  return events
}

function roundFromEvents(events: RoundEvent[], roundID: string): RgsRound {
  const terminal = events[events.length - 1]
  const won       = terminal.type === 'HOME'
  const finalMult = won ? terminal.multiplierSnap : 0
  return {
    roundID,
    payoutMultiplier: finalMult,
    isActive:         false,
    events,
  }
}

// ─── API surface (same shape as real RGS) ────────────────────────────────────

export async function demoAuthenticate(): Promise<AuthResponse> {
  return {
    balance: { amount: _balance, currency: 'FUN' },
    config:  DEMO_CONFIG,
  }
}

export async function demoPlay(betDisplay: number): Promise<PlayResponse> {
  const betApi  = Math.round(betDisplay * MONEY_SCALE)
  _balance     -= betApi                           // debit immediately
  _balance      = Math.max(0, _balance)

  const events  = generateDemoRound(betDisplay)
  const roundID = `demo-${Date.now()}-${_roundSeq}`
  const round   = roundFromEvents(events, roundID)

  // Mark active so frontend knows to call endRound on WIN
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
