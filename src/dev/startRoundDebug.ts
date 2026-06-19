export interface StartRoundDebugPayload {
  totalMs: number
  tileWorldResetMs: number
  pathAndGeomMs: number
  setPathWaypointsAndCaveMs: number
  spawnerMs: number
  chunksMs: number
  restMs: number
  worldMap?: Record<string, string | number | boolean>
  chunks?: Record<string, string | number | boolean>
  counts?: Record<string, string | number | boolean>
}

let _active = false

function printPayload(payload: StartRoundDebugPayload): void {
  console.log(
    `[DR startRound] total=${payload.totalMs.toFixed(1)}ms ` +
      `path=${payload.pathAndGeomMs.toFixed(1)}ms ` +
      `obstacles=${String(payload.worldMap?.placeObstaclesMs ?? '—')}ms ` +
      `chunks=${payload.chunksMs.toFixed(1)}ms ` +
      `chunksBuilt=${String(payload.chunks?.chunksBuilt ?? '—')} ` +
      `renderTextures=${String(payload.chunks?.renderTexturesCreated ?? '—')} ` +
      `renderCalls=${String(payload.chunks?.renderCalls ?? '—')}`,
  )

  console.table({
    'tileWorld reset + lava': { ms: payload.tileWorldResetMs.toFixed(1) },
    'buildRoundPath + geom': { ms: payload.pathAndGeomMs.toFixed(1) },
    'setPathWaypoints + cave': { ms: payload.setPathWaypointsAndCaveMs.toFixed(1) },
    'spawner.setRgsEvents': { ms: payload.spawnerMs.toFixed(1) },
    'tileWorld.update chunks': { ms: payload.chunksMs.toFixed(1) },
    'rest miner/sync': { ms: payload.restMs.toFixed(1) },
    'TOTAL': { ms: payload.totalMs.toFixed(1) },
  })

  if (payload.worldMap) {
    console.log('%c[DR startRound] WorldMap', 'color:#9ad0ff;font-weight:bold')
    console.table(payload.worldMap)
  }
  if (payload.chunks) {
    console.log('%c[DR startRound] TileWorld chunks', 'color:#9ad0ff;font-weight:bold')
    console.table(payload.chunks)
  }
  if (payload.counts) {
    console.log('%c[DR startRound] Counts', 'color:#9ad0ff;font-weight:bold')
    console.table(payload.counts)
  }
}

export function isStartRoundLogActive(): boolean {
  return import.meta.env.DEV && _active
}

export function reportStartRoundDebug(payload: StartRoundDebugPayload): void {
  if (!isStartRoundLogActive()) return
  printPayload(payload)
}

const DR_START_LOG = {
  enable(): void {
    _active = true
    console.log('%c[DR startRound] вкл. Выключить: __DR_START_LOG__.disable()', 'color:#9ad0ff')
  },

  disable(): void {
    _active = false
    console.log('[DR startRound] выкл')
  },

  status(): void {
    console.log('[DR startRound]', { active: _active })
  },

  help(): void {
    console.log(
      '[DR startRound] Диагностика старта раунда\n' +
        '  URL: ?start\n' +
        '  __DR_START_LOG__.enable()\n' +
        '  __DR_START_LOG__.disable()\n' +
        '  __DR_START_LOG__.status()',
    )
  },
}

export function installStartRoundDebugFromUrl(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  ;(window as any).__DR_START_LOG__ = DR_START_LOG

  if (typeof location === 'undefined') return
  const sp = new URLSearchParams(location.search)
  if (sp.get('start') !== null) DR_START_LOG.enable()
}
