/**
 * Deep Rush — Stake Engine Math Book
 *
 * Server-side math module. Mirrors demo.ts logic exactly, adapted for Node.js.
 * No browser APIs: fs.readFileSync instead of fetch, crypto for seeding.
 *
 * Response format matches what client/normalisePlayResponse expects:
 *   { betID, payoutMultiplier (int×100), active, state: RoundEvent[] }
 *
 * Directory layout expected (relative to this file):
 *   ../public/math/coeff_probabilities.json
 *   ../public/math/coeff_probabilities_loss.json
 *   ../public/math/road_by_coeff_merged_nonzero/coeff_X_XX.jsonl
 *   ../public/math/road_by_coeff_from_losses_merged/coeff_X_XX.jsonl
 */

'use strict'

const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')

const MATH_DIR = path.resolve(__dirname, '../public/math')
const MONEY_SCALE = 1_000_000

// ─── PRNG (LCG, same as demo.ts) ─────────────────────────────────────────────

function makePrng(seed) {
  let s = (seed >>> 0)
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function randomSeed() {
  return crypto.randomBytes(4).readUInt32BE(0)
}

// ─── Probability tables ───────────────────────────────────────────────────────

function buildCumTable(probObj) {
  const entries = Object.entries(probObj)
    .map(([k, v]) => [parseFloat(k), Number(v)])
    .sort((a, b) => a[0] - b[0])

  const table = []
  let cum = 0
  for (const [val, p] of entries) {
    cum += p
    table.push([val, cum])
  }
  if (table.length > 0) table[table.length - 1][1] = 1.0
  return table
}

function sampleTable(table, rng) {
  const r = rng()
  for (const [val, cumW] of table) {
    if (r <= cumW) return val
  }
  return table[table.length - 1][0]
}

// ─── Road loading (synchronous, server-side) ──────────────────────────────────

function coeffToFilename(coeff) {
  return 'coeff_' + coeff.toFixed(2).replace('.', '_') + '.jsonl'
}

function loadRoad(coeff, isLoss, rng) {
  const dir  = isLoss
    ? 'road_by_coeff_from_losses_merged'
    : 'road_by_coeff_merged_nonzero'
  const file = coeffToFilename(coeff)
  const fp   = path.join(MATH_DIR, dir, file)

  let lines
  try {
    const text = fs.readFileSync(fp, 'utf8')
    lines = text.trim().split('\n').filter(l => l.trim())
    if (!lines.length) throw new Error('empty road file')
  } catch (err) {
    console.error('[math] road load failed:', fp, err.message, '— using fallback')
    return isLoss ? ['1', '/2'] : ['1']
  }

  const idx = Math.floor(rng() * lines.length)
  return JSON.parse(lines[idx])
}

// ─── Token → RoundEvent ───────────────────────────────────────────────────────

function parseToken(token) {
  if (/^\d+$/.test(token)) {
    return { type: 'COIN', effect: { op: 'add', value: parseInt(token, 10) } }
  }
  if (token.startsWith('*')) {
    return { type: 'DIAMOND', effect: { op: 'mul', value: parseInt(token.slice(1), 10) } }
  }
  if (token.startsWith('/')) {
    return { type: 'BOMB', effect: { op: 'div', value: parseInt(token.slice(1), 10) } }
  }
  if (token.toLowerCase().startsWith('g')) {
    const t = Math.max(1, parseInt(token.slice(1), 10) || 1)
    return { type: 'GOLD', effect: { op: 'add', value: t }, durationMs: t * 500 }
  }
  // STONE: sN
  const t = Math.max(1, parseInt(token.toLowerCase().slice(1), 10) || 1)
  return { type: 'STONE', effect: { op: 'sub', value: t }, durationMs: t * 500 }
}

function roadToEvents(road, isLoss, rng) {
  const events = []
  let depth    = 0
  let distance = 0

  for (const token of road) {
    const parsed = parseToken(token)

    depth    += 1.2 + rng() * 0.2   // 1.2–1.4 м
    distance += 1.8 + rng() * 1.3   // 1.8–3.1 м

    const ev = {
      type:     parsed.type,
      depth:    Math.round(depth    * 10) / 10,
      distance: Math.round(distance * 10) / 10,
      effect:   parsed.effect,
    }
    if (parsed.durationMs != null) ev.durationMs = parsed.durationMs
    events.push(ev)
  }

  depth    += 2   + rng() * 2.4
  distance += 2.6 + rng() * 3.4
  events.push({
    type:     isLoss ? 'LAVA' : 'HOME',
    depth:    Math.round(depth    * 10) / 10,
    distance: Math.round(distance * 10) / 10,
  })

  return events
}

// ─── Init: load tables once at startup ───────────────────────────────────────

let WIN_TABLE, LOSS_TABLE

try {
  const winRaw  = JSON.parse(fs.readFileSync(path.join(MATH_DIR, 'coeff_probabilities.json'),      'utf8'))
  const lossRaw = JSON.parse(fs.readFileSync(path.join(MATH_DIR, 'coeff_probabilities_loss.json'), 'utf8'))
  WIN_TABLE  = buildCumTable(winRaw)
  LOSS_TABLE = buildCumTable(lossRaw)
  console.log('[math] tables loaded — win entries:', WIN_TABLE.length, 'loss entries:', LOSS_TABLE.length)
} catch (err) {
  throw new Error('[math] FATAL: failed to load probability tables: ' + err.message)
}

let _roundSeq = 0

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate one round.
 *
 * @param {number} betAmount  Bet in API units (integer, ÷1_000_000 = display dollars).
 * @param {string} [sessionId] Optional session ID for logging.
 * @returns {{
 *   betID:             string,
 *   payoutMultiplier:  number,   // int×100 — e.g. 150 = 1.5×
 *   active:            boolean,
 *   state:             Array,    // RoundEvent[]
 *   _meta: { baseCoeff, isLoss, lossCoeff, seed, roadIdx }
 * }}
 */
function play(betAmount, sessionId) {
  const seed = randomSeed()
  const rng  = makePrng(seed)
  _roundSeq++

  const baseCoeff = sampleTable(WIN_TABLE, rng)
  const isLoss    = baseCoeff === 0

  let road      = []
  let lossCoeff = 0

  if (!isLoss) {
    road = loadRoad(baseCoeff, false, rng)
  } else {
    lossCoeff = sampleTable(LOSS_TABLE, rng)
    road      = loadRoad(lossCoeff, true, rng)
  }

  const state = roadToEvents(road, isLoss, rng)
  const betID = `dr-${Date.now()}-${_roundSeq}`

  // payoutMultiplier as int×100 (Stake Engine book format)
  const payoutMultiplier = Math.round(baseCoeff * 100)

  return {
    betID,
    payoutMultiplier,
    active: !isLoss && baseCoeff > 0,
    state,
    // _meta is for server logging / audit — strip before sending to client
    _meta: { baseCoeff, isLoss, lossCoeff, seed, roadTokens: road },
  }
}

/**
 * Return theoretical config passed to the game client on authenticate.
 * Values must match what client expects in RgsConfig.
 */
function getConfig() {
  return {
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
}

/**
 * Theoretical RTP: Σ (coeff × probability) over all entries.
 * Loss entry (coeff=0) contributes 0 to the sum automatically.
 * Returns a fraction, e.g. 0.9619 = 96.19%.
 */
function getRtp() {
  let ev   = 0
  let prev = 0
  for (const [coeff, cumW] of WIN_TABLE) {
    const p = cumW - prev
    ev += coeff * p
    prev = cumW
  }
  return ev
}

module.exports = { play, getConfig, getRtp, MONEY_SCALE }
