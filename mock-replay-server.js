/**
 * mock-replay-server.js
 * ─────────────────────────────────────────────────────────────────
 * Имитирует Stake Engine RGS endpoint для тестирования Bet Replay:
 *   GET /bet/replay/{game}/{version}/{mode}/{event}
 *
 * Запуск:  node mock-replay-server.js
 * Порт:    3001 (CORS разрешён для localhost:5173)
 * ─────────────────────────────────────────────────────────────────
 */

const http = require('http')

const PORT = 3002

// ─── Тестовые сценарии ────────────────────────────────────────────
// event ID → { payoutMultiplier, costMultiplier, state[] }

const SCENARIOS = {

  // ── Сценарий 1: Обычная победа (×3.5) ─────────────────────────
  'win-normal': {
    payoutMultiplier: 3.5,
    costMultiplier: 1.0,
    state: [
      { type: 'COIN',    depth: 5,   distance: 5,   effect: { op: 'add', value: 1 } },
      { type: 'COIN',    depth: 12,  distance: 12,  effect: { op: 'add', value: 2 } },
      { type: 'DIAMOND', depth: 18,  distance: 18,  effect: { op: 'mul', value: 2 } },
      { type: 'COIN',    depth: 24,  distance: 24,  effect: { op: 'add', value: 1 } },
      { type: 'GOLD',    depth: 32,  distance: 32,  effect: { op: 'add', value: 1 }, durationMs: 500 },
      { type: 'HOME',    depth: 40,  distance: 40 },
    ],
  },

  // ── Сценарий 2: Большая победа (×12.0) ────────────────────────
  'win-big': {
    payoutMultiplier: 12.0,
    costMultiplier: 1.0,
    state: [
      { type: 'COIN',    depth: 4,   distance: 4,   effect: { op: 'add', value: 2 } },
      { type: 'DIAMOND', depth: 10,  distance: 10,  effect: { op: 'mul', value: 3 } },
      { type: 'COIN',    depth: 16,  distance: 16,  effect: { op: 'add', value: 1 } },
      { type: 'GOLD',    depth: 22,  distance: 22,  effect: { op: 'add', value: 2 }, durationMs: 1000 },
      { type: 'DIAMOND', depth: 30,  distance: 30,  effect: { op: 'mul', value: 2 } },
      { type: 'COIN',    depth: 38,  distance: 38,  effect: { op: 'add', value: 1 } },
      { type: 'HOME',    depth: 48,  distance: 48 },
    ],
  },

  // ── Сценарий 3: Проигрыш (LAVA) ────────────────────────────────
  'loss': {
    payoutMultiplier: 0,
    costMultiplier: 1.0,
    state: [
      { type: 'COIN',  depth: 5,  distance: 5,  effect: { op: 'add', value: 1 } },
      { type: 'STONE', depth: 12, distance: 12, effect: { op: 'sub', value: 2 }, durationMs: 1000 },
      { type: 'BOMB',  depth: 20, distance: 20, effect: { op: 'div', value: 2 } },
      { type: 'STONE', depth: 28, distance: 28, effect: { op: 'sub', value: 1 }, durationMs: 500 },
      { type: 'LAVA',  depth: 36, distance: 36 },
    ],
  },

  // ── Сценарий 4: Максимальный выигрыш ───────────────────────────
  'win-max': {
    payoutMultiplier: 50.0,
    costMultiplier: 1.0,
    state: [
      { type: 'COIN',    depth: 3,   distance: 3,   effect: { op: 'add', value: 5 } },
      { type: 'DIAMOND', depth: 8,   distance: 8,   effect: { op: 'mul', value: 5 } },
      { type: 'GOLD',    depth: 14,  distance: 14,  effect: { op: 'add', value: 4 }, durationMs: 2000 },
      { type: 'DIAMOND', depth: 20,  distance: 20,  effect: { op: 'mul', value: 4 } },
      { type: 'COIN',    depth: 26,  distance: 26,  effect: { op: 'add', value: 3 } },
      { type: 'DIAMOND', depth: 32,  distance: 32,  effect: { op: 'mul', value: 2 } },
      { type: 'HOME',    depth: 40,  distance: 40 },
    ],
  },
}

// Дефолтный сценарий — если event ID не найден в SCENARIOS
const DEFAULT_SCENARIO = SCENARIOS['win-normal']

// ─── HTTP сервер ──────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // CORS для local dev (Vite на :5173)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url || ''

  // GET /bet/replay/{game}/{version}/{mode}/{event}
  const match = url.match(/^\/bet\/replay\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)/)
  if (req.method === 'GET' && match) {
    const [, game, version, mode, event] = match
    console.log(`[MOCK] Replay request: game=${game} version=${version} mode=${mode} event=${event}`)

    const scenario = SCENARIOS[event] || DEFAULT_SCENARIO
    if (!SCENARIOS[event]) {
      console.log(`[MOCK] Unknown event "${event}", using default (win-normal)`)
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(scenario))
    return
  }

  // 404 для всего остального
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found', url }))
})

server.listen(PORT, () => {
  console.log(`\n✅ Mock Replay Server запущен на http://localhost:${PORT}`)
  console.log('─'.repeat(60))
  console.log('Доступные event ID:')
  Object.keys(SCENARIOS).forEach(id => {
    const s = SCENARIOS[id]
    console.log(`  ${id.padEnd(16)} → ×${s.payoutMultiplier} (${s.state[s.state.length-1].type})`)
  })
  console.log('─'.repeat(60))
  console.log('\nURL для тестирования (вставь в браузер):\n')

  const gameId  = 'deep-rush-test'
  const ver     = '1'
  const mode    = 'BASE'
  const rgsUrl  = `http://localhost:${PORT}`
  const bet     = 1000000   // $1.00

  Object.keys(SCENARIOS).forEach(eventId => {
    const s = SCENARIOS[eventId]
    const url = `http://localhost:5173/?replay=true&game=${gameId}&version=${ver}&mode=${mode}&event=${eventId}&rgs_url=${rgsUrl}&currency=USD&amount=${bet}&lang=en&device=desktop`
    console.log(`[${eventId}]`)
    console.log(url)
    console.log()
  })
})
