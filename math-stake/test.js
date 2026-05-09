/**
 * Quick sanity-check for the Stake math book.
 * Run: node math-stake/test.js
 */

'use strict'

const { play, getConfig, getRtp, MONEY_SCALE } = require('./index.js')

// ─── Config ───────────────────────────────────────────────────────────────────

const cfg = getConfig()
console.log('\n=== Config ===')
console.log('  minBet:     $' + (cfg.minBet / MONEY_SCALE).toFixed(2))
console.log('  maxBet:     $' + (cfg.maxBet / MONEY_SCALE).toFixed(2))
console.log('  defaultBet: $' + (cfg.defaultBetLevel / MONEY_SCALE).toFixed(2))

// ─── RTP ─────────────────────────────────────────────────────────────────────

const rtp = getRtp()
console.log('\n=== RTP ===')
console.log('  theoretical RTP: ' + (rtp * 100).toFixed(2) + '%')

// ─── Single round ─────────────────────────────────────────────────────────────

const BET = 1_000_000  // $1.00

console.log('\n=== Single round (bet=$1.00) ===')
const r = play(BET)
console.log('  betID:            ', r.betID)
console.log('  payoutMultiplier: ', r.payoutMultiplier, '(int×100 =', (r.payoutMultiplier / 100).toFixed(2) + 'x)')
console.log('  active:           ', r.active)
console.log('  events:           ', r.state.length)
console.log('  terminal:         ', r.state[r.state.length - 1].type)
console.log('  _meta.baseCoeff:  ', r._meta.baseCoeff)
console.log('  _meta.isLoss:     ', r._meta.isLoss)
console.log('  road:             ', r._meta.roadTokens.join(' → '))
console.log('  state[0]:         ', JSON.stringify(r.state[0]))

// ─── Sanity: run N rounds, check stats ───────────────────────────────────────

const N = 1000
let wins = 0, losses = 0, totalPayout = 0, totalBet = 0
const eventTypeCounts = {}

for (let i = 0; i < N; i++) {
  const round = play(BET)
  totalBet += BET
  if (round.active) {
    wins++
    totalPayout += Math.round(BET * round.payoutMultiplier / 100)
  } else {
    losses++
  }
  for (const ev of round.state) {
    eventTypeCounts[ev.type] = (eventTypeCounts[ev.type] || 0) + 1
  }
}

const empiricalRtp = totalPayout / totalBet

console.log('\n=== Stats over', N, 'rounds ===')
console.log('  wins:        ', wins, `(${(wins/N*100).toFixed(1)}%)`)
console.log('  losses:      ', losses, `(${(losses/N*100).toFixed(1)}%)`)
console.log('  empirical RTP:', (empiricalRtp * 100).toFixed(2) + '%')
console.log('  theoret. RTP: ', (rtp * 100).toFixed(2) + '%')
console.log('  event types: ', JSON.stringify(eventTypeCounts))

// ─── Validate every round ─────────────────────────────────────────────────────

let errors = 0
for (let i = 0; i < N; i++) {
  const round = play(BET)

  if (!round.betID)              { console.error('  ERR: no betID');          errors++ }
  if (typeof round.payoutMultiplier !== 'number') { console.error('  ERR: payoutMultiplier type'); errors++ }
  if (typeof round.active !== 'boolean')          { console.error('  ERR: active type');           errors++ }
  if (!Array.isArray(round.state))                { console.error('  ERR: state not array');       errors++ }
  if (!round.state.length)                        { console.error('  ERR: empty state');           errors++ }

  const last = round.state[round.state.length - 1]
  if (last.type !== 'HOME' && last.type !== 'LAVA') {
    console.error('  ERR: terminal event is not HOME/LAVA, got:', last.type)
    errors++
  }
  if (round.active && last.type !== 'HOME') {
    console.error('  ERR: active=true but terminal is', last.type)
    errors++
  }
  if (!round.active && last.type === 'HOME') {
    // HOME rounds with baseCoeff<=0 shouldn't exist, but check anyway
    if (round.payoutMultiplier > 0) {
      console.error('  ERR: active=false but HOME with positive payout')
      errors++
    }
  }

  for (const ev of round.state.slice(0, -1)) {
    const validTypes = ['COIN', 'GOLD', 'DIAMOND', 'BOMB', 'STONE']
    if (!validTypes.includes(ev.type)) {
      console.error('  ERR: invalid mid-event type:', ev.type)
      errors++
    }
    if (typeof ev.depth !== 'number' || typeof ev.distance !== 'number') {
      console.error('  ERR: missing depth/distance on', ev.type)
      errors++
    }
    if (!ev.effect || typeof ev.effect.op !== 'string' || typeof ev.effect.value !== 'number') {
      console.error('  ERR: invalid/missing effect on', ev.type)
      errors++
    }
  }
}

if (errors === 0) {
  console.log('\n✓ All', N, 'validation rounds passed')
} else {
  console.error('\n✗', errors, 'validation errors found')
  process.exit(1)
}
