/**
 * Deep Rush — Stake Engine Book Generator
 *
 * Reads all road JSONL files and generates:
 *   math/books_base.jsonl       — simulations (one JSON per line, then compress)
 *   math/lookUpTable_base_0.csv — per-simulation: simNum, prob_uint64, payoutMultiplier
 *   math/index.json             — Stake Engine modes manifest
 *
 * Run:  node math-stake/generate-book.js
 * Then: zstd math/books_base.jsonl -o math/books_base.jsonl.zst -19
 *
 * Stake Engine JSONL format (required fields):
 *   { "id": <int>, "payoutMultiplier": <int×100>, "events": [RoundEvent, ...] }
 *
 * Stake Engine CSV format (no header, uint64 values):
 *   simulation_number, round_probability, payout_multiplier
 *
 * Stake Engine index.json format:
 *   { "modes": [{ "name", "cost", "events", "weights" }] }
 */

'use strict'

const fs   = require('fs')
const path = require('path')

const ROOT     = path.resolve(__dirname, '..')
const MATH_DIR = path.join(ROOT, 'public', 'math')
const OUT_DIR  = path.join(ROOT, 'math')

// Probability scale for uint64 representation (10^12 fits safely in float64 and uint64)
const PROB_SCALE = 1_000_000_000_000

// ─── LCG PRNG (same as demo.ts) ──────────────────────────────────────────────

function makePrng(seed) {
  let s = (seed >>> 0)
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

// ─── Token → RoundEvent ───────────────────────────────────────────────────────

function parseToken(token) {
  if (/^\d+$/.test(token))
    return { type: 'COIN',    effect: { op: 'add', value: parseInt(token, 10) } }
  if (token.startsWith('*'))
    return { type: 'DIAMOND', effect: { op: 'mul', value: parseInt(token.slice(1), 10) } }
  if (token.startsWith('/'))
    return { type: 'BOMB',    effect: { op: 'div', value: parseInt(token.slice(1), 10) } }
  if (token.toLowerCase().startsWith('g')) {
    const t = Math.max(1, parseInt(token.slice(1), 10) || 1)
    return { type: 'GOLD',  effect: { op: 'add', value: t }, durationMs: t * 500 }
  }
  const t = Math.max(1, parseInt(token.toLowerCase().slice(1), 10) || 1)
  return { type: 'STONE', effect: { op: 'sub', value: t }, durationMs: t * 500 }
}

function roadToEvents(road, isLoss, rng) {
  const events = []
  let depth = 0, distance = 0
  for (const token of road) {
    const parsed = parseToken(token)
    depth    += 1.2 + rng() * 0.2
    distance += 1.8 + rng() * 1.3
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function filenameToCoeff(fname) {
  const m = fname.match(/^coeff_(-?\d+)_(\d+)\.jsonl$/)
  return m ? parseFloat(`${m[1]}.${m[2]}`) : null
}

function buildCumTable(probObj) {
  let cum = 0
  return Object.entries(probObj)
    .map(([k, v]) => [parseFloat(k), Number(v)])
    .sort((a, b) => a[0] - b[0])
    .map(([val, p]) => { cum += p; return [val, cum] })
    .map((e, i, arr) => { if (i === arr.length - 1) e[1] = 1.0; return e })
}

function probMapFromCum(cumTable) {
  const map = {}
  let prev = 0
  for (const [c, cumW] of cumTable) { map[c] = cumW - prev; prev = cumW }
  return map
}

function loadRoadsDir(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(fname => {
      const coeff = filenameToCoeff(fname)
      if (coeff === null) return null
      const text  = fs.readFileSync(path.join(dir, fname), 'utf8')
      const roads = text.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
      return { coeff, roads }
    })
    .filter(Boolean)
}

function streamFinished(stream) {
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve)
    stream.on('error', reject)
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const winProb  = JSON.parse(fs.readFileSync(path.join(MATH_DIR, 'coeff_probabilities.json'),      'utf8'))
  const lossProb = JSON.parse(fs.readFileSync(path.join(MATH_DIR, 'coeff_probabilities_loss.json'), 'utf8'))

  const winCum      = buildCumTable(winProb)
  const winProbMap  = probMapFromCum(winCum)
  const lossProbMap = probMapFromCum(buildCumTable(lossProb))

  const winGroups  = loadRoadsDir(path.join(MATH_DIR, 'road_by_coeff_merged_nonzero'))
  const lossGroups = loadRoadsDir(path.join(MATH_DIR, 'road_by_coeff_from_losses_merged'))
  console.log(`Loaded WIN groups: ${winGroups.length}, LOSS groups: ${lossGroups.length}`)

  // ── Write books_base.jsonl ─────────────────────────────────────────────────

  const bookPath = path.join(OUT_DIR, 'books_base.jsonl')
  const bookOut  = fs.createWriteStream(bookPath, { encoding: 'utf8' })

  // CSV rows: one per simulation (no header per Stake Engine spec)
  const csvRows = []

  let simNum     = 1   // 1-indexed simulation ID
  let totalLines = 0
  let lossCount  = 0

  // Loss probability from win table (coeff=0 entry)
  const lossTotalProb = winProbMap[0] ?? 0

  // 1. WIN rounds (sorted by coeff ascending)
  const sortedWin = winGroups
    .filter(g => g.coeff > 0 && winProbMap[g.coeff] > 0)
    .sort((a, b) => a.coeff - b.coeff)

  for (const { coeff, roads } of sortedWin) {
    const payoutMultiplier = Math.round(coeff * 100)
    const probPerRoad = Math.round(winProbMap[coeff] * PROB_SCALE / roads.length)

    roads.forEach((road, idx) => {
      const rng    = makePrng(((coeff * 10000) ^ (idx * 0x9e3779b9)) >>> 0)
      const entry  = {
        id:               simNum,
        payoutMultiplier: payoutMultiplier,
        events:           roadToEvents(road, false, rng),
      }
      bookOut.write(JSON.stringify(entry) + '\n')
      csvRows.push(`${simNum},${probPerRoad},${payoutMultiplier}`)
      simNum++
      totalLines++
    })
  }

  // 2. LOSS rounds (payoutMultiplier = 0, prob weighted by coeff_probabilities_loss.json)
  const sortedLoss = lossGroups.filter(g => lossProbMap[g.coeff] > 0)
    .sort((a, b) => a.coeff - b.coeff)

  for (const { coeff: lossCoeff, roads } of sortedLoss) {
    const lossProbPerRoad = Math.round(lossTotalProb * lossProbMap[lossCoeff] * PROB_SCALE / roads.length)
    roads.forEach((road, idx) => {
      const rng   = makePrng(((lossCoeff * 10000 + 999999) ^ (idx * 0x9e3779b9)) >>> 0)
      const entry = {
        id:               simNum,
        payoutMultiplier: 0,
        events:           roadToEvents(road, true, rng),
      }
      bookOut.write(JSON.stringify(entry) + '\n')
      csvRows.push(`${simNum},${lossProbPerRoad},0`)
      simNum++
      totalLines++
      lossCount++
    })
  }

  bookOut.end()
  await streamFinished(bookOut)
  const winCount = totalLines - lossCount
  console.log(`Book written: ${totalLines} lines  (${winCount} win + ${lossCount} loss)`)

  // ── lookUpTable_base_0.csv ─────────────────────────────────────────────────
  // Format (no header): simulation_number, round_probability_uint64, payout_multiplier

  fs.writeFileSync(path.join(OUT_DIR, 'lookUpTable_base_0.csv'), csvRows.join('\n') + '\n', 'utf8')
  console.log(`LookUpTable written: ${csvRows.length} rows (one per simulation)`)

  // ── index.json ────────────────────────────────────────────────────────────
  // Stake Engine required format: { modes: [{ name, cost, events, weights }] }

  const meta = {
    modes: [
      {
        name:    'base',
        cost:    1.0,
        events:  'books_base.jsonl.zst',
        weights: 'lookUpTable_base_0.csv',
      }
    ]
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(meta, null, 2), 'utf8')

  // ── RTP summary ───────────────────────────────────────────────────────────

  let rtp = 0, prevCum = 0
  for (const [coeff, cumW] of winCum) { rtp += coeff * (cumW - prevCum); prevCum = cumW }

  const bookMB = (fs.statSync(bookPath).size / 1024 / 1024).toFixed(2)
  console.log('\n=== Generated in math/ ===')
  console.log(`  books_base.jsonl       ${bookMB} MB  (${totalLines} simulations)`)
  console.log(`  lookUpTable_base_0.csv ${csvRows.length} rows`)
  console.log(`  index.json             modes manifest`)
  console.log(`  Theoretical RTP:       ${(rtp * 100).toFixed(4)}%`)
  console.log('\nCompress with:  zstd math/books_base.jsonl -o math/books_base.jsonl.zst -19')
}

main().catch(err => { console.error(err); process.exit(1) })
