import * as PIXI from 'pixi.js'
import { Assets } from 'pixi.js'
import { GameConfig } from './GameConfig'
import { LavaSimulation } from './LavaSimulation'
import { GameAssets } from './gameAssets'

export const TILE = 120
export const CHUNK_W = 6
export const CHUNK_H = 4

const CPW = CHUNK_W * TILE
const CPH = CHUNK_H * TILE
/** Visual-only overlap to hide subpixel seam artifacts on Retina/macOS with fractional zoom/DPR. */
const CHUNK_VISUAL_OVERLAP_PX = 3
const MASK_W = CPW + CHUNK_VISUAL_OVERLAP_PX * 2
const MASK_H = CPH + CHUNK_VISUAL_OVERLAP_PX * 2

/**
 * Маскинг чанков (см. PERF_FIX_chunk_masks.md). Подтверждено: fps 28→60.
 *  true  = flatten-режим (по умолчанию): content маскируется maskRT и ОДИН РАЗ
 *          (на изменение карва) рендерится в отдельный displayRT; на кадре —
 *          плоский displaySpr, без per-frame AlphaMaskPipe.
 *  false = legacy живая маска (per-frame AlphaMaskPipe) — оставлено для отката.
 * Нюансы v8: маска читает КРАСНЫЙ канал (mask.frag → masky.r), поэтому тоннель
 * рисуется opaque-чёрным; флэттен идёт через обёртку `_flattenWrapper`, т.к.
 * render-to-target делает контейнер корнем render-group и его .mask иначе не применяется.
 */
const USE_BAKED_TUNNEL_MASK = true

function chunkTopVisualOverlap(row: number): number {
  return row === 0 ? 0 : CHUNK_VISUAL_OVERLAP_PX
}

/** Буфер вокруг камеры при расчёте чанков (px) — меньше множитель → меньше активных чанков / нагрузка на Mac. */
export const TILEWORLD_CHUNK_VIEW_BUF_PX = CPW * 0.75

/** Запас чанков вокруг окна камеры — чанк удаляется только за пределами `colMin±cull` / `rowMin±cull`. */
export const TILEWORLD_CHUNK_CULL_MARGIN = 1

/** Текущий размер viewport для чанков из `GameConfig.viewportChunks`. */
export function tileWorldChunkViewportFromConfig(): { w: number; h: number } {
  return {
    w: GameConfig.viewportChunks.widthPx,
    h: GameConfig.viewportChunks.heightPx,
  }
}

/**
 * Оценка сетки чанков при `GameConfig.viewportChunks` и буфере `TILEWORLD_CHUNK_VIEW_BUF_PX`.
 * `inner*` — окно как в update (floor/ceil камеры); `colsWithCull` — с полем `TILEWORLD_CHUNK_CULL_MARGIN`,
 * иначе `chunksActive` кажется «выше лимита», хотя это нормально.
 */
export function tileWorldMaxChunkWindowFromConfig(): {
  innerCols: number
  innerRows: number
  innerChunksEst: number
  cullMarginChunks: number
  colsWithCull: number
  rowsWithCull: number
  chunksUpperBound: number
  tilesPerChunk: number
  earthTileSpritesUpperBound: number
} {
  const { widthPx: W, heightPx: H } = GameConfig.viewportChunks
  const buf = TILEWORLD_CHUNK_VIEW_BUF_PX
  const innerCols = Math.ceil((W + 2 * buf) / CPW) + 1
  const innerRows = Math.ceil((H + 2 * buf) / CPH) + 1
  const c = TILEWORLD_CHUNK_CULL_MARGIN
  const colsWithCull = innerCols + 2 * c
  const rowsWithCull = innerRows + 2 * c
  const tilesPerChunk = CHUNK_W * CHUNK_H
  return {
    innerCols,
    innerRows,
    innerChunksEst: innerCols * innerRows,
    cullMarginChunks: c,
    colsWithCull,
    rowsWithCull,
    chunksUpperBound: colsWithCull * rowsWithCull,
    tilesPerChunk,
    earthTileSpritesUpperBound: colsWithCull * rowsWithCull * tilesPerChunk,
  }
}

/**
 * Эллипс в локальных координатах чанка: `rx` поперёк движения, `ry` вдоль;
 * (ux, uy) — направление копания (необязательно единичное, нормализуем).
 */
function tunnelEllipsePolyRotatedLocal(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  ux: number,
  uy: number,
  steps: number,
): number[] {
  const len = Math.hypot(ux, uy)
  const tx = len > 1e-6 ? ux / len : 0
  const ty = len > 1e-6 ? uy / len : 1
  const px = -ty
  const py = tx
  const v: number[] = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const ca = Math.cos(a), sa = Math.sin(a)
    v.push(cx + rx * ca * px + ry * sa * tx, cy + rx * ca * py + ry * sa * ty)
  }
  return v
}

/** Верхняя полоса травы в локальных координатах чанка: меньше Y → выше на экране (смотри маску чанка при сильном отрицании). */
const GRASS_SPRITE_Y_OFFSET = -13
/** Запас сверху для grass-mask, чтобы верх травы не клипался при отрицательном Y. */
const GRASS_MASK_HEADROOM = 24

/**
 * Фиксированная лавовая пещера — строгий axis-aligned прямоугольник (маска + лава по `rect`).
 * Компактнее прежнего; seed не влияет.
 */
const LAVA_CAVE_HW = TILE * 2.15
const LAVA_CAVE_HH = TILE * 1.15
/** Радиус скругления углов пещеры (в мире, px). Маленький — чтобы угловые ячейки не были мёртвой зоной. */
const LAVA_CAVE_CORNER_R = TILE * 0.15

export const enum T {
  AIR = 0, GRASS, DIRT, DIRT2, DIRT3,
  STONE, DEEP, LAVA, GRAVEL, CLAY,
  GOLD_ORE, CRYSTAL, BRICK, WOOD, LEAF,
  MAGMA, COAL, IRON,
}

const COL: Record<number, [number, number]> = {
  [T.AIR]:      [0,          0         ],
  [T.GRASS]:    [0x7CB944,   0x5a8a30  ],
  [T.DIRT]:     [0x8B5E3C,   0x6B4226  ],
  [T.DIRT2]:    [0x7a3e1e,   0x5a2e10  ],
  [T.DIRT3]:    [0x5a2d14,   0x3d1a09  ],
  [T.STONE]:    [0x7a7a7a,   0x555555  ],
  [T.DEEP]:     [0x3d1a09,   0x2a1008  ],
  [T.LAVA]:     [0xFF4500,   0xFF8C00  ],
  [T.GRAVEL]:   [0x9E9E9E,   0x757575  ],
  [T.CLAY]:     [0xA0522D,   0x7B3F1A  ],
  [T.GOLD_ORE]: [0x5a2d14,   0x3d1a09  ],
  [T.CRYSTAL]:  [0x4ECDC4,   0x2aaaa0  ],
  [T.BRICK]:    [0xC0392B,   0x922B21  ],
  [T.WOOD]:     [0x6B4226,   0x4a2e18  ],
  [T.LEAF]:     [0x27AE60,   0x1e8449  ],
  [T.MAGMA]:    [0xFF0000,   0xFF4500  ],
  [T.COAL]:     [0x2C2C2C,   0x1a1a1a  ],
  [T.IRON]:     [0x7a7a7a,   0xaaaaaa  ],
}

function mulRgb(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * k))
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * k))
  const b = Math.min(255, Math.round((hex & 0xff) * k))
  return (r << 16) | (g << 8) | b
}

/** Фон под выкопом, если нет текстур земли (как fallback в чанке). */
const TUNNEL_BG_FALLBACK = mulRgb(COL[T.DIRT]![0], 0.58)

/** Мир: покрытие под туннелем (как прежний `drawRect`). */
const TUNNEL_BG_X = -500000
const TUNNEL_BG_W = 1_000_000
const TUNNEL_BG_H = 1_000_000
/** Полупрозрачный тон поверх текстуры дна туннеля — цвет и альфа задаются отдельно. */
const TUNNEL_FLOOR_TINT_COLOR = 0x000000
const TUNNEL_FLOOR_TINT_ALPHA = 0.42

function lcg(seed: number) {
  let s = seed >>> 0
  return () => { s = Math.imul(1664525, s) + 1013904223 >>> 0; return s / 0x100000000 }
}

function h2(a: number, b: number, worldSeed: number): number {
  const s = ((a * 73856093) ^ (b * 19349663) ^ worldSeed) >>> 0
  return lcg(s)()
}

interface Structure {
  tiles: { dx: number; dy: number; t: T }[]
  priority: number
}

function makeHouse(): Structure {
  const tiles: { dx: number; dy: number; t: T }[] = []
  tiles.push({dx:0,dy:-4,t:T.BRICK},{dx:1,dy:-4,t:T.BRICK},{dx:2,dy:-4,t:T.BRICK})
  tiles.push({dx:1,dy:-5,t:T.BRICK})
  for(let row=-3;row<=0;row++){
    tiles.push({dx:0,dy:row,t:T.BRICK})
    tiles.push({dx:2,dy:row,t:T.BRICK})
  }
  for(let row=-3;row<=-1;row++) tiles.push({dx:1,dy:row,t:T.AIR})
  tiles.push({dx:1,dy:0,t:T.AIR})
  tiles.push({dx:1,dy:-2,t:T.CRYSTAL})
  tiles.push({dx:2,dy:-5,t:T.BRICK},{dx:2,dy:-6,t:T.BRICK})
  return { tiles, priority: 10 }
}

function makeTree(): Structure {
  return {
    priority: 8,
    tiles: [
      {dx:0,dy:-1,t:T.WOOD},{dx:0,dy:-2,t:T.WOOD},{dx:0,dy:-3,t:T.WOOD},
      {dx:-1,dy:-3,t:T.LEAF},{dx:1,dy:-3,t:T.LEAF},
      {dx:-1,dy:-4,t:T.LEAF},{dx:0,dy:-4,t:T.LEAF},{dx:1,dy:-4,t:T.LEAF},
      {dx:0,dy:-5,t:T.LEAF},
    ],
  }
}

function makeRuin(): Structure {
  const tiles: { dx: number; dy: number; t: T }[] = []
  for(let dx=0;dx<4;dx++){
    tiles.push({dx,dy:0,t:T.BRICK})
    tiles.push({dx,dy:-3,t:T.BRICK})
  }
  for(let dy=-2;dy<=-1;dy++){
    tiles.push({dx:0,dy,t:T.BRICK})
    tiles.push({dx:3,dy,t:T.BRICK})
    tiles.push({dx:1,dy,t:T.AIR})
    tiles.push({dx:2,dy,t:T.AIR})
  }
  tiles.push({dx:2,dy:0,t:T.AIR})
  return { tiles, priority: 6 }
}

type TileOverride = Map<string, T>

function buildOverrides(
  colStart: number, rowStart: number,
  colEnd: number,   rowEnd: number,
  worldSeed: number,
  totalRows: number,
  pathWaypoints: number[]  = [],
  pathSurfY:     number    = TILE,
  pathProtectY:  number    = Infinity,
  skipAir = false,
): TileOverride {
  const out: TileOverride = new Map()
  const set = (tc: number, tr: number, type: T) => {
    if (tr < 0) return
    out.set(`${tc},${tr}`, type)
  }

  const STEP_Y_TW = TILE * 0.72
  const isInPathCorridor = (tc: number, tr: number): boolean => {
    if (pathWaypoints.length === 0) return false
    const wx = tc * TILE
    const wy = tr * TILE
    if (wy > pathProtectY) return false

    // Капсульная проверка: расстояние от тайла до отрезка пути
    const idxCenter = Math.round((wy - pathSurfY) / STEP_Y_TW)
    const lo = Math.max(0, idxCenter - 4)
    const hi = Math.min(pathWaypoints.length - 2, idxCenter + 4)

    for (let i = lo; i <= hi; i++) {
      const xA = pathWaypoints[i]
      const yA = pathSurfY + i * STEP_Y_TW
      const xB = pathWaypoints[i + 1] ?? xA
      const yB = pathSurfY + (i + 1) * STEP_Y_TW

      // distPointSegment
      const dx = xB - xA, dy = yB - yA
      const lenSq = dx * dx + dy * dy
      let dist: number
      if (lenSq === 0) {
        dist = Math.hypot(wx - xA, wy - yA)
      } else {
        const t = Math.max(0, Math.min(1, ((wx - xA) * dx + (wy - yA) * dy) / lenSq))
        dist = Math.hypot(wx - xA - t * dx, wy - yA - t * dy)
      }
      // Как WorldMap.LAVA_MARGIN: SAFE_R + TILE (не ставим лаву ближе к коридору)
      if (dist < TILE * 2.5 + TILE) return true
    }
    return false
  }

  const PAD = 8
  const tc0 = colStart * CHUNK_W - PAD
  const tc1 = colEnd   * CHUNK_W + CHUNK_W + PAD
  const tr0 = rowStart * CHUNK_H - PAD
  const tr1 = rowEnd   * CHUNK_H + CHUNK_H + PAD

  if (tr0 <= 2) {
    for (let tc = tc0; tc <= tc1; tc++) {
      const r = h2(tc, 9999, worldSeed)
      if (r < 0.10) {
        const house = makeHouse()
        for (const t of house.tiles) set(tc + t.dx, 0 + t.dy + 1, t.t)
      } else if (r < 0.22) {
        const tree = makeTree()
        for (const t of tree.tiles) set(tc + t.dx, 0 + t.dy + 1, t.t)
      } else if (r < 0.28) {
        set(tc, 1, T.STONE); set(tc+1, 1, T.STONE); set(tc, 0, T.STONE)
      }
    }
  }

  if (tr1 >= 8 && tr0 <= 20) {
    for (let tc = tc0; tc <= tc1; tc += 5) {
      for (let tr = Math.max(tr0, 8); tr <= Math.min(tr1, 20); tr += 6) {
        if (h2(tc, tr, worldSeed ^ 0xABCD) < 0.08) {
          const ruin = makeRuin()
          for (const t of ruin.tiles) set(tc + t.dx, tr + t.dy, t.t)
        }
      }
    }
  }

  if (!skipAir) {
    for (let tc = tc0; tc <= tc1; tc++)
      for (let tr = Math.max(tr0, 5); tr <= tr1; tr++)
        if (caveNoise(tc, tr, worldSeed) > 0.62) set(tc, tr, T.AIR)
  }

  for (let tc = tc0; tc <= tc1; tc++) {
    for (let tr = Math.max(tr0, 10); tr <= tr1; tr++) {
      const depth = tr % 200
      // Случайная лава — пропускаем если тайл в коридоре пути
      if (isInPathCorridor(tc, tr)) continue
      if (depth >= 40 && depth <= 80 && caveNoise(tc*1.3+50, tr*0.8, worldSeed^0xFF00) > 0.70) set(tc, tr, T.LAVA)
      if (depth >= 130 && depth <= 180 && caveNoise(tc*1.1+30, tr*0.9, worldSeed^0xFF11) > 0.65) set(tc, tr, T.MAGMA)
    }
  }

  for (let tr = Math.max(tr0, 15); tr <= tr1; tr++) {
    if (h2(tr, 7777, worldSeed) < 0.12) {
      const startCol = tc0 + Math.floor(h2(tr, 8888, worldSeed) * (tc1 - tc0))
      const len = 4 + Math.floor(h2(tr, 9999, worldSeed) * 9)
      for (let i = 0; i < len; i++) set(startCol + i, tr, T.GOLD_ORE)
    }
  }

  for (let tr = Math.max(tr0, 5); tr <= tr1; tr++) {
    if (h2(tr, 3333, worldSeed) < 0.18) {
      const startCol = tc0 + Math.floor(h2(tr, 4444, worldSeed) * (tc1 - tc0))
      const len = 3 + Math.floor(h2(tr, 5555, worldSeed) * 7)
      for (let i = 0; i < len; i++) set(startCol + i, tr, T.COAL)
    }
  }

  for (let tr = Math.max(tr0, 20); tr <= tr1; tr++) {
    if (h2(tr, 1111, worldSeed) < 0.10) {
      const startCol = tc0 + Math.floor(h2(tr, 2222, worldSeed) * (tc1 - tc0))
      const len = 3 + Math.floor(h2(tr, 3333, worldSeed^1) * 6)
      for (let i = 0; i < len; i++) set(startCol + i, tr, T.IRON)
    }
  }

  for (let tc = tc0; tc <= tc1; tc++)
    for (let tr = Math.max(tr0, 25); tr <= tr1; tr++)
      if (h2(tc^0x1234, tr, worldSeed^0x5678) < 0.025) set(tc, tr, T.CRYSTAL)

  for (let tc = tc0; tc <= tc1; tc++)
    for (let tr = Math.max(tr0, 75); tr <= tr1; tr++)
      if (tr % 200 >= 75 && h2(tc, tr, worldSeed^0x9ABC) < 0.35) set(tc, tr, T.MAGMA)

  return out
}

function caveNoise(x: number, y: number, seed: number): number {
  const sx = (seed & 0xFFFF) * 0.0001
  const sy = ((seed >> 16) & 0xFFFF) * 0.0001
  let v = 0
  v += 0.5  * Math.sin(x*0.42+sx) * Math.cos(y*0.38+sy)
  v += 0.25 * Math.sin(x*0.87+sx*2) * Math.cos(y*0.91+sy*2)
  v += 0.15 * Math.sin(x*1.7+sx*3) * Math.cos(y*1.55+sy*3)
  v += 0.10 * Math.sin(x*3.1+sx*5) * Math.cos(y*2.8+sy*5)
  return (v + 1) / 2
}

function baseTile(tileRow: number, _totalRows: number, rng: () => number): T {
  const r = rng()
  if (tileRow <= 0) return T.GRASS
  if (tileRow <= 1) return T.DIRT
  const depth = tileRow % 200
  if (depth < 3)   return r < 0.75 ? T.DIRT   : T.GRAVEL
  if (depth < 10)  return r < 0.65 ? T.DIRT   : (r < 0.85 ? T.DIRT2  : T.GRAVEL)
  if (depth < 22)  return r < 0.50 ? T.DIRT2  : (r < 0.78 ? T.DIRT3  : T.CLAY)
  if (depth < 40)  return r < 0.45 ? T.DIRT3  : (r < 0.80 ? T.STONE  : T.CLAY)
  if (depth < 70)  return r < 0.55 ? T.STONE  : (r < 0.85 ? T.DEEP   : T.CLAY)
  if (depth < 100) return r < 0.50 ? T.DEEP   : (r < 0.80 ? T.STONE  : T.CLAY)
  if (depth < 130) return r < 0.35 ? T.STONE  : (r < 0.70 ? T.DEEP   : (r<0.85?T.COAL:T.CLAY))
  if (depth < 160) return r < 0.30 ? T.LAVA   : (r < 0.65 ? T.DEEP   : T.STONE)
  if (depth < 180) return r < 0.40 ? T.MAGMA  : (r < 0.75 ? T.DEEP   : T.LAVA)
  return r < 0.50 ? T.MAGMA : (r < 0.80 ? T.LAVA : T.DEEP)
}

function drawTile(g: PIXI.Graphics, type: T, px: number, py: number, tileSeed: number) {
  if (type === T.AIR) return
  // LAVA и MAGMA тайлы рендерим как тёмный камень — реальная лава через LavaSimulation
  const wasLavaOrMagma = type === T.LAVA || type === T.MAGMA
  if (wasLavaOrMagma) type = T.DEEP
  const [fill, shadow] = COL[type] ?? [0x555555, 0x333333]
  const rng = lcg(tileSeed)
  g.beginFill(fill); g.drawRect(px, py, TILE, TILE); g.endFill()
  g.beginFill(shadow, 0.30); g.drawRect(px, py+TILE-5, TILE, 5); g.endFill()
  g.beginFill(0x000000, 0.10); g.drawRect(px+TILE-3, py, 3, TILE); g.endFill()
  if (!wasLavaOrMagma) {
    g.beginFill(0xffffff, 0.06); g.drawRect(px, py, TILE, 3); g.endFill()
  }
  if (type === T.GRASS) {
    g.beginFill(0x5a8a30, 0.35); g.drawRect(px, py+TILE-8, TILE, 8); g.endFill()
  }
  // LAVA/MAGMA эллипсы убраны — рендерятся через LavaSimulation
  if (type === T.GOLD_ORE) {
    for (let i=0;i<5;i++) {
      g.beginFill(0xFFD700,0.8); g.drawCircle(px+3+rng()*(TILE-6), py+3+rng()*(TILE-6), 2.5+rng()*2); g.endFill()
    }
    g.lineStyle(1.5,0xFFD700,0.5); g.moveTo(px+4,py+TILE*0.5); g.lineTo(px+TILE-4,py+TILE*0.4); g.lineStyle(0)
  }
  if (type === T.IRON) {
    for (let i=0;i<4;i++) { g.beginFill(0xE8E8D0,0.7); g.drawCircle(px+3+rng()*(TILE-6),py+3+rng()*(TILE-6),2+rng()*2); g.endFill() }
  }
  if (type === T.COAL) {
    for (let i=0;i<4;i++) { g.beginFill(0x111111,0.9); g.drawCircle(px+3+rng()*(TILE-6),py+3+rng()*(TILE-6),2+rng()*3); g.endFill() }
  }
  if (type === T.CRYSTAL) {
    const cx=px+TILE/2, cy=py+TILE/2
    g.beginFill(0x7FEFEF,0.9); g.drawPolygon([cx,py+4,cx+10,cy,cx,py+TILE-4,cx-10,cy]); g.endFill()
    g.beginFill(0xffffff,0.4); g.drawPolygon([cx,py+4,cx+5,cy-4,cx,cy-2,cx-5,cy-4]); g.endFill()
  }
  if (type === T.BRICK) {
    g.lineStyle(1,0x000000,0.2)
    g.moveTo(px,py+TILE/2); g.lineTo(px+TILE,py+TILE/2)
    const off = tileSeed%2===0?TILE/2:0
    g.moveTo(px+off,py); g.lineTo(px+off,py+TILE/2)
    g.moveTo(px+off+TILE/2,py); g.lineTo(px+off+TILE/2,py+TILE/2)
    g.moveTo(px+((off+TILE/4)%TILE),py+TILE/2); g.lineTo(px+((off+TILE/4)%TILE),py+TILE)
    g.lineStyle(0)
    if (rng()<0.3) { g.beginFill(0x27AE60,0.3); g.drawRect(px,py,TILE,4); g.endFill() }
  }
  if (type === T.WOOD) {
    g.lineStyle(1,0x000000,0.12); g.drawCircle(px+TILE/2,py+TILE/2,TILE*0.28); g.drawCircle(px+TILE/2,py+TILE/2,TILE*0.14); g.lineStyle(0)
    g.beginFill(0x000000,0.07); g.drawRect(px+TILE*0.45,py,TILE*0.1,TILE); g.endFill()
  }
  if (type === T.LEAF) {
    for (let i=0;i<6;i++) { g.beginFill(0x1e8449,0.4); g.drawCircle(px+3+rng()*(TILE-6),py+3+rng()*(TILE-6),2+rng()*3); g.endFill() }
  }
  if (type===T.DIRT||type===T.DIRT2||type===T.DIRT3||type===T.CLAY) {
    for (let i=0;i<3;i++) {
      g.beginFill(0x000000,0.08+rng()*0.1)
      g.drawEllipse(px+3+rng()*(TILE-6),py+3+rng()*(TILE-6),2+rng()*4,1.5+rng()*2.5); g.endFill()
    }
  }
  g.lineStyle(0.5,0x000000,0.07); g.drawRect(px,py,TILE,TILE); g.lineStyle(0)
}


// ── Рисует капсулу между двумя точками с разными радиусами ───────────────────
function drawCapsule(
  g: PIXI.Graphics,
  ax: number, ay: number, ra: number,
  bx: number, by: number, rb: number,
  color: number
) {
  const dx = bx - ax, dy = by - ay
  const len = Math.sqrt(dx*dx + dy*dy)
  if (len < 0.001) {
    g.beginFill(color).drawCircle(ax, ay, ra).endFill()
    return
  }
  const STEPS = 10
  const verts: number[] = []
  // Дуга вокруг A (180°)
  for (let i = 0; i <= STEPS; i++) {
    const angle = Math.atan2(dy, dx) + Math.PI / 2 + (Math.PI / STEPS) * i
    verts.push(ax + Math.cos(angle) * ra, ay + Math.sin(angle) * ra)
  }
  // Дуга вокруг B (180°)
  for (let i = 0; i <= STEPS; i++) {
    const angle = Math.atan2(dy, dx) - Math.PI / 2 + (Math.PI / STEPS) * i
    verts.push(bx + Math.cos(angle) * rb, by + Math.sin(angle) * rb)
  }
  g.beginFill(color).drawPolygon(verts).endFill()
}

// ─── TileWorld ────────────────────────────────────────────────────────────────

interface Chunk { gfx: PIXI.Container; col: number; row: number }

export interface CavePath {
  points: Array<{ x: number; y: number; r: number }>
  /** Прямоугольная выемка и зона лавы в мировых координатах (центр + полуразмеры). */
  rect: { cx: number; cy: number; hw: number; hh: number; cr: number }
}

interface ScratchFrameStats {
  active: boolean
  calls: number
  stamps: number
  renderOps: number
  chunksTouched: number
  multiChunkCalls: number
  timeMs: number
}

interface TileWorldBuildDiagnostics {
  active: boolean
  chunksBuilt: number
  chunkBuildTotalMs: number
  maxChunkBuildMs: number
  renderTexturesCreated: number
  renderCalls: number
  spritesCreated: number
  graphicsCreated: number
  maskPoolReused: number
  grassMaskPoolReused: number
  tunnelBgPanelsBuilt: number
}

export class TileWorld {
  /** Только чанки (трава/земля); фон bgLight живёт в `bgContainer`. */
  private chunkContainer: PIXI.Container
  private chunks:     Map<string, Chunk> = new Map()
  private overrides:  TileOverride = new Map()
  private seed:       number
  private totalRows:  number
  private overridesBuilt = false
  private _ovColMin = 0; private _ovColMax = 0
  private _ovRowMin = 0; private _ovRowMax = 0

  private brush: PIXI.Graphics = new PIXI.Graphics()
  private line:  PIXI.Graphics = new PIXI.Graphics()
  /** Переиспользование в scratchAt вместо new Graphics() каждый кадр */
  private _scratchDb = new PIXI.Graphics()
  private _scratchWb = new PIXI.Graphics()
  private _scratchGb = new PIXI.Graphics()
  private _scratchGl = new PIXI.Graphics()
  private lastPt: {x:number,y:number}|null = null
  private _scratchFrameStats: ScratchFrameStats = {
    active: false,
    calls: 0,
    stamps: 0,
    renderOps: 0,
    chunksTouched: 0,
    multiChunkCalls: 0,
    timeMs: 0,
  }
  private _scratchFrameChunks = new Set<string>()
  private _scratchCallChunks = new Set<string>()
  private _buildDiagnostics: TileWorldBuildDiagnostics = {
    active: false,
    chunksBuilt: 0,
    chunkBuildTotalMs: 0,
    maxChunkBuildMs: 0,
    renderTexturesCreated: 0,
    renderCalls: 0,
    spritesCreated: 0,
    graphicsCreated: 0,
    maskPoolReused: 0,
    grassMaskPoolReused: 0,
    tunnelBgPanelsBuilt: 0,
  }
  renderer: PIXI.Renderer|null = null

  /** Буферные чанки, ожидающие сборки (не попадают в viewport). Строятся по 3 в кадр. */
  private _buildQueue: Array<{col: number; row: number}> = []
  private _buildQueueKeys = new Set<string>()

  /** Пул RenderTexture для масок чанков — вместо destroy(true), чтобы не ломать BindGroup PixiJS v8. */
  private _maskRTPool: PIXI.RenderTexture[] = []
  private _grassMaskRTPool: PIXI.RenderTexture[] = []

  private _pendingCaves: CavePath[] = []
  private _lastCavePath: CavePath | null = null
  private _cavesByPosition: Map<string, CavePath> = new Map()
  /** Счётчик не-терминальных лавовых пещер (лимит GameConfig.lava.maxDecorCaves) */
  private _decorLavaCaveCount = 0
  private _caveGfx: PIXI.Graphics = new PIXI.Graphics()
  /** Переиспользуемая offscreen-обёртка для flatten: делает content НЕ корнем render-group,
   *  иначе v8 не применяет content.mask при render-to-target (см. PERF_FIX_chunk_masks.md). */
  private _flattenWrapper: PIXI.Container = new PIXI.Container()
  /** Чанки, чей maskRT изменился за текущий scratchAt → пересобрать displayRT (дедуп за кадр). */
  private _flattenDirtyKeys: Set<string> = new Set()
  /** Невидимые чанки после clearRuntimeDigging догоняем постепенно, чтобы не делать GPU-пик на смене раунда. */
  private _resetFlattenQueue: string[] = []
  private _resetFlattenQueueKeys = new Set<string>()
  private _hasLastVisibleWindow = false
  private _lastVisibleColMin = 0
  private _lastVisibleColMax = 0
  private _lastVisibleRowMin = 0
  private _lastVisibleRowMax = 0

  lavaSimulation: LavaSimulation | null = null
  private _lavaViewportW = -1
  private _lavaViewportH = -1

  // Путь персонажа — лава не генерируется в коридоре пути
  private _pathWaypoints:  number[] = []
  private _pathSurfY:      number   = TILE
  private _pathProtectY:   number   = Infinity

  /** Устанавливает путь. Лава не будет генерироваться в коридоре ±3 тайла от пути. */
  setPathWaypoints(waypoints: number[], surfY: number, protectUntilY: number = Infinity): void {
    this._pathWaypoints = waypoints
    this._pathSurfY     = surfY
    this._pathProtectY  = protectUntilY
    this.overridesBuilt = false
  }

  /** Подложка под выкопом: текстура земли (как верхний слой чанка) или запасной цвет. */
  private bgLight: PIXI.Container = new PIXI.Container()
  private _tunnelBgMode: 'earthTiles' | 'groundTiling' | 'colorFill' = 'colorFill'
  /** Земля / заливка под выкопом; оверлей затемнения — поверх этого контейнера. */
  private _tunnelBgContent = new PIXI.Container()
  private _tunnelBgDim = new PIXI.Graphics()
  private _tunnelBgPanels = new Map<string, { spr: PIXI.Sprite; rt: PIXI.RenderTexture }>()
  private _tunnelBgGroundTiling: PIXI.TilingSprite | null = null
  private _tunnelBgColorFill: PIXI.Graphics | null = null

  static grassTex:  PIXI.Texture | null = null
  static groundTex: PIXI.Texture | null = null
  static earthTex:  [PIXI.Texture | null, PIXI.Texture | null, PIXI.Texture | null] = [null, null, null]

  private _bakeToRenderTexture(displayObject: PIXI.Container, w: number, h: number): PIXI.RenderTexture | null {
    const r = this.renderer
    if (!r) return null
    const rt = PIXI.RenderTexture.create({ width: w, height: h })
    if (this._buildDiagnostics.active) this._buildDiagnostics.renderTexturesCreated++
    r.render({ container: displayObject, target: rt, clear: true })
    if (this._buildDiagnostics.active) this._buildDiagnostics.renderCalls++
    return rt
  }

  static loadGrassTex(): Promise<void> {
    const p1 = TileWorld.grassTex
      ? Promise.resolve()
      : Assets.load<PIXI.Texture>(GameAssets.grass).then((t: PIXI.Texture) => { TileWorld.grassTex = t }).catch(() => { TileWorld.grassTex = null })
    const pEarth = Promise.all([
      Assets.load<PIXI.Texture>(GameAssets.earth1).then((t: PIXI.Texture) => { TileWorld.earthTex[0] = t }).catch(() => { TileWorld.earthTex[0] = null }),
      Assets.load<PIXI.Texture>(GameAssets.earth2).then((t: PIXI.Texture) => { TileWorld.earthTex[1] = t }).catch(() => { TileWorld.earthTex[1] = null }),
      Assets.load<PIXI.Texture>(GameAssets.earth3).then((t: PIXI.Texture) => { TileWorld.earthTex[2] = t }).catch(() => { TileWorld.earthTex[2] = null }),
    ])
    return Promise.all([p1, pEarth]).then(() => {})
  }

  constructor(bgContainer: PIXI.Container, chunkContainer: PIXI.Container, seed: number, _totalDepthPx?: number) {
    this.chunkContainer = chunkContainer
    this.seed = seed
    this.totalRows = Number.MAX_SAFE_INTEGER

    this.bgLight.zIndex = -10
    this.chunkContainer.sortableChildren = true
    bgContainer.addChild(this.bgLight)
    this.bgLight.addChild(this._tunnelBgContent)
    this._redrawTunnelBgDimOverlay()
    this.bgLight.addChild(this._tunnelBgDim)
    this.rebuildTunnelBgFromTextures()
  }

  private _redrawTunnelBgDimOverlay(): void {
    this._tunnelBgDim.clear()
    if (TUNNEL_FLOOR_TINT_ALPHA <= 0) return
    this._tunnelBgDim.beginFill(TUNNEL_FLOOR_TINT_COLOR, TUNNEL_FLOOR_TINT_ALPHA)
      .drawRect(TUNNEL_BG_X, 0, TUNNEL_BG_W, TUNNEL_BG_H)
      .endFill()
  }

  /** Вариант earth1/2/3 для глобальной клетки: нет двух одинаковых у соседей слева/сверху */
  private _earthVariant = new Map<string, number>()

  private _earthKey(gCol: number, gRow: number): string {
    return `${gCol},${gRow}`
  }

  private _pickEarthVariant(gCol: number, gRow: number): number {
    const k = this._earthKey(gCol, gRow)
    let v = this._earthVariant.get(k)
    if (v !== undefined) return v

    const left = gCol > 0 ? this._earthVariant.get(this._earthKey(gCol - 1, gRow)) : undefined
    const top = this._earthVariant.get(this._earthKey(gCol, gRow - 1))

    const r = h2(gCol, gRow * 17 + 3, this.seed ^ 0xE471)
    const bad = new Set<number>()
    if (left !== undefined) bad.add(left)
    if (top !== undefined) bad.add(top)
    const opts = [0, 1, 2].filter(i => !bad.has(i))
    if (opts.length === 0) v = Math.floor(r * 3) % 3
    else v = opts[Math.floor(r * opts.length)]!
    this._earthVariant.set(k, v)
    return v
  }

  private _forgetEarthVariantsForChunk(chunkCol: number, chunkRow: number) {
    const gCol0 = chunkCol * CHUNK_W
    const gRow0 = chunkRow * CHUNK_H
    for (let ly = 0; ly < CHUNK_H; ly++) {
      for (let lx = 0; lx < CHUNK_W; lx++) {
        this._earthVariant.delete(this._earthKey(gCol0 + lx, gRow0 + ly))
      }
    }
  }

  initMasks() {
    // per-chunk darkMask инициализируется в _buildChunk
  }

  showBg() { this.bgLight.visible = true  }
  hideBg()  { this.bgLight.visible = false }

  /**
   * Подложка туннеля: те же `earth1/2/3` / `groundTex`, что и слой земли в чанке.
   * Вызвать после `TileWorld.loadGrassTex()`, если мир создали до резолва Promise.
   */
  rebuildTunnelBgFromTextures(): void {
    for (const p of this._tunnelBgPanels.values()) {
      this._tunnelBgContent.removeChild(p.spr)
      p.spr.destroy({ texture: false })
      p.rt.destroy(true)
    }
    this._tunnelBgPanels.clear()
    if (this._tunnelBgGroundTiling) {
      this._tunnelBgContent.removeChild(this._tunnelBgGroundTiling)
      this._tunnelBgGroundTiling.destroy()
      this._tunnelBgGroundTiling = null
    }
    if (this._tunnelBgColorFill) {
      this._tunnelBgContent.removeChild(this._tunnelBgColorFill)
      this._tunnelBgColorFill.destroy()
      this._tunnelBgColorFill = null
    }

    const hasEarth = TileWorld.earthTex.some(t => t != null)
    if (hasEarth) {
      this._tunnelBgMode = 'earthTiles'
      return
    }
    if (TileWorld.groundTex) {
      this._tunnelBgMode = 'groundTiling'
      const tex = TileWorld.groundTex
      const spr = new PIXI.TilingSprite(tex, TUNNEL_BG_W, TUNNEL_BG_H)
      spr.x = TUNNEL_BG_X
      spr.y = 0
      spr.tileScale.set(TILE / tex.width, TILE / tex.height)
      this._tunnelBgContent.addChild(spr)
      this._tunnelBgGroundTiling = spr
      return
    }
    this._tunnelBgMode = 'colorFill'
    const g = new PIXI.Graphics()
    g.beginFill(TUNNEL_BG_FALLBACK).drawRect(TUNNEL_BG_X, 0, TUNNEL_BG_W, TUNNEL_BG_H).endFill()
    this._tunnelBgContent.addChild(g)
    this._tunnelBgColorFill = g
  }

  private _syncTunnelBgEarthTiles(camX: number, camY: number, screenW: number, screenH: number): void {
    if (this._tunnelBgMode !== 'earthTiles') return
    if (!this.renderer) return
    const margin = TILE * 3
    const wx0 = camX - margin
    const wx1 = camX + screenW + margin
    const wy0 = Math.max(0, camY - margin)
    const wy1 = camY + screenH + margin

    // Perf: bake chunk-sized panels (CPW×CPH) instead of individual tile sprites.
    // ~140 Sprites → ~6 baked Sprites per viewport.
    const pc0 = Math.floor(wx0 / CPW)
    const pc1 = Math.floor(wx1 / CPW)
    const pr0 = Math.floor(wy0 / CPH)
    const pr1 = Math.floor(wy1 / CPH)

    const needed = new Set<string>()
    for (let pr = pr0; pr <= pr1; pr++) {
      if (pr < 0) continue
      for (let pc = pc0; pc <= pc1; pc++) needed.add(`${pc}_${pr}`)
    }

    for (const k of [...this._tunnelBgPanels.keys()]) {
      if (!needed.has(k)) {
        const p = this._tunnelBgPanels.get(k)!
        this._tunnelBgContent.removeChild(p.spr)
        p.spr.destroy({ texture: false })
        p.rt.destroy(true)
        this._tunnelBgPanels.delete(k)
      }
    }

    for (const k of needed) {
      if (this._tunnelBgPanels.has(k)) continue
      const [pcStr, prStr] = k.split('_')
      const pc = Number(pcStr), pr = Number(prStr)

      const tmpLayer = new PIXI.Container()
      for (let ly = 0; ly < CHUNK_H; ly++) {
        for (let lx = 0; lx < CHUNK_W; lx++) {
          const gCol = pc * CHUNK_W + lx
          const gRow = pr * CHUNK_H + ly
          const vi = this._pickEarthVariant(gCol, gRow)
          const tex = TileWorld.earthTex[vi]
          if (!tex) continue
          const cell = new PIXI.Sprite(tex)
          if (this._buildDiagnostics.active) this._buildDiagnostics.spritesCreated++
          cell.width = TILE; cell.height = TILE
          cell.x = lx * TILE; cell.y = ly * TILE
          tmpLayer.addChild(cell)
        }
      }
      const rt = PIXI.RenderTexture.create({ width: CPW, height: CPH })
      if (this._buildDiagnostics.active) this._buildDiagnostics.renderTexturesCreated++
      this.renderer.render({ container: tmpLayer, target: rt, clear: true })
      if (this._buildDiagnostics.active) this._buildDiagnostics.renderCalls++
      tmpLayer.destroy({ children: true })

      const spr = new PIXI.Sprite(rt)
      if (this._buildDiagnostics.active) {
        this._buildDiagnostics.spritesCreated++
        this._buildDiagnostics.tunnelBgPanelsBuilt++
      }
      spr.x = pc * CPW; spr.y = pr * CPH
      spr.roundPixels = true
      this._tunnelBgContent.addChild(spr)
      this._tunnelBgPanels.set(k, { spr, rt })
    }
  }

  // ── Scratch ────────────────────────────────────────────────────────────────

  /** Один овал + опциональная линия от предыдущей точки (мир, px) — для цепочки субсэмплов. */
  private _scratchWorldTunnelStamp(
    wx: number,
    wy: number,
    rx: number,
    ry: number,
    ux: number,
    uy: number,
    lineFrom: { x: number; y: number } | null,
    carveGrass: boolean,
  ) {
    if (!this.renderer) return
    const stats = this._scratchFrameStats.active ? this._scratchFrameStats : null
    if (stats) stats.stamps++
    const ts = GameConfig.tunnelScratch
    const steps = ts.ellipsePolySteps ?? 36
    // Толщина «нитки» между субточками ≈ ширина поперёк копания, не max(rx,ry) — иначе туннель раздувается.
    const lineW = 2 * rx + 2

    const pad = Math.hypot(rx, ry) + 4
    const colMin = Math.floor((wx - pad) / CPW), colMax = Math.floor((wx + pad) / CPW)
    const rowMin = Math.floor((wy - pad) / CPH), rowMax = Math.floor((wy + pad) / CPH)

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        if (row < 0) continue
        const chunkKey = `${col}_${row}`
        const chunk = this.chunks.get(chunkKey)
        if (!chunk) continue
        if (stats && !this._scratchFrameChunks.has(chunkKey)) {
          this._scratchFrameChunks.add(chunkKey)
          stats.chunksTouched = this._scratchFrameChunks.size
        }
        if (stats) this._scratchCallChunks.add(chunkKey)
        const lx = wx - col * CPW + CHUNK_VISUAL_OVERLAP_PX
        const ly = wy - row * CPH + CHUNK_VISUAL_OVERLAP_PX
        const poly = tunnelEllipsePolyRotatedLocal(lx, ly, rx, ry, ux, uy, steps)
        this.brush.clear()
        this.brush.beginFill(0x000000).drawPolygon(poly).endFill()
        this.renderer.render({ container: this.brush, target: (chunk as any).maskRT, clear: false })
        if (stats) stats.renderOps++
        if (USE_BAKED_TUNNEL_MASK) this._flattenDirtyKeys.add(chunkKey)

        // Per-chunk lava mask is disabled (lava is rendered via LavaSimulation).
        const grassMaskRT = (chunk as any).grassMaskRT as PIXI.RenderTexture | undefined
        if (grassMaskRT && carveGrass) {
          this._scratchGb.clear()
          // Тот же овал, что и выкоп грунта — иначе трава «шире» туннеля (раньше был круг по hitbox).
          const polyG: number[] = []
          for (let i = 0; i < poly.length; i += 2) {
            polyG.push(poly[i]!, poly[i + 1]! + GRASS_MASK_HEADROOM)
          }
          this._scratchGb.beginFill(0x000000).drawPolygon(polyG).endFill()
          this.renderer.render({ container: this._scratchGb, target: grassMaskRT, clear: false })
          if (stats) stats.renderOps++
        }

        if (lineFrom) {
          const plx = lineFrom.x - col * CPW + CHUNK_VISUAL_OVERLAP_PX
          const ply = lineFrom.y - row * CPH + CHUNK_VISUAL_OVERLAP_PX
          this.line.clear()
          this.line.lineStyle(lineW, 0x000000)
          this.line.moveTo(plx, ply).lineTo(lx, ly)
          this.renderer.render({ container: this.line, target: (chunk as any).maskRT, clear: false })
          if (stats) stats.renderOps++

          if (grassMaskRT && carveGrass) {
            this._scratchGl.clear()
            this._scratchGl.lineStyle(lineW, 0x000000)
            this._scratchGl.moveTo(plx, ply + GRASS_MASK_HEADROOM).lineTo(lx, ly + GRASS_MASK_HEADROOM)
            this.renderer.render({ container: this._scratchGl, target: grassMaskRT, clear: false })
            if (stats) stats.renderOps++
          }
        }
      }
    }
  }

  scratchAt(
    sx: number,
    sy: number,
    camX: number,
    camY: number,
    tnx = 0,
    tny = 1,
    /**
     * 0…1: доля пути до конца текущего штриха (от ретро-опоры до бурового конца в мире).
     * Start-интро — наращивание канала по длине, а не масштаб овала в одной точке.
     */
    tunnelLengthProgress: number | null = null,
  ) {
    if (!this.renderer) return
    const stats = this._scratchFrameStats.active ? this._scratchFrameStats : null
    const t0 = stats ? performance.now() : 0
    if (stats) {
      stats.calls++
      if (this._scratchCallChunks.size > 0) this._scratchCallChunks.clear()
    }
    const ts = GameConfig.tunnelScratch
    const rx = ts.ellipseRadiusXPx
    const ry = ts.ellipseRadiusYPx
    const wxEnd = sx + camX, wyEnd = sy + camY
    const spacingMul = ts.segmentSpacingMul ?? 0.22
    const spacing = Math.min(rx, ry) * spacingMul

    let ftx = tnx, fty = tny
    const tl = Math.hypot(ftx, fty)
    if (tl < 1e-3) {
      ftx = 0
      fty = 1
    } else {
      ftx /= tl
      fty /= tl
    }
    // Всегда касательная пути, не хорда last→current: иначе при вертикали + дрожании X
    // овал поворачивается «не туда» и ширина коридора на экране меняется с направлением.
    const stampUx = ftx
    const stampUy = fty
    // Первый кадр копания: короткий ретро-сегмент, чтобы сразу прорезать верхний слой травы,
    // но без глубокого «провала» старта (как было при большом startPad).
    const startPad = TILE * 0.92
    const retroWx = wxEnd - stampUx * startPad
    const retroWy = wyEnd - stampUy * startPad
    const carvePartialIntro =
      tunnelLengthProgress != null &&
      tunnelLengthProgress < 1 - 1e-5
    // Во время start-интро каждый кадр от одной ретро-опоры до доли tl (lastPt не копим).
    const ax = carvePartialIntro ? retroWx : this.lastPt?.x ?? retroWx
    const ay = carvePartialIntro ? retroWy : this.lastPt?.y ?? retroWy
    const toEndDx = wxEnd - ax, toEndDy = wyEnd - ay
    const toEndLen = Math.hypot(toEndDx, toEndDy)
    // Не прорезаем большой стартовый сегмент мгновенно — только когда нет управления длиной по клипу.
    const maxAdvancePerTick = Math.max(spacing * 2.2, TILE * 0.16)
    let wxTarget = wxEnd
    let wyTarget = wyEnd
    const shouldClampAdvance = !carvePartialIntro && this.lastPt == null
    if (shouldClampAdvance && toEndLen > maxAdvancePerTick && toEndLen > 1e-6) {
      const k = maxAdvancePerTick / toEndLen
      wxTarget = ax + toEndDx * k
      wyTarget = ay + toEndDy * k
    }
    if (tunnelLengthProgress != null) {
      const tl = Math.max(1e-4, Math.min(1, tunnelLengthProgress))
      wxTarget = ax + (wxTarget - ax) * tl
      wyTarget = ay + (wyTarget - ay) * tl
    }
    const segdx = wxTarget - ax, segdy = wyTarget - ay
    const segLen = Math.hypot(segdx, segdy)

    const nSteps = segLen < 0.5 ? 1 : Math.max(2, Math.ceil(segLen / spacing))

    let prev: { x: number; y: number } | null = null
    for (let i = 0; i <= nSteps; i++) {
      const t = i / nSteps
      const wx = ax + segdx * t
      const wy = ay + segdy * t
      // Траву режем тем же полигоном что и землю (+ «нитка» между шагами), по всей длине сегмента.
      // Иначе остаётся «крышка» травы над первым шагом туннеля.
      const carveGrass = true
      this._scratchWorldTunnelStamp(wx, wy, rx, ry, stampUx, stampUy, prev, carveGrass)
      prev = { x: wx, y: wy }
    }
    // baked-режим: пересобрать displayRT всех чанков, чей maskRT изменился за этот кадр.
    if (USE_BAKED_TUNNEL_MASK && this._flattenDirtyKeys.size > 0) {
      for (const key of this._flattenDirtyKeys) {
        const ch = this.chunks.get(key)
        if (!ch) continue
        const dRT = (ch as any).displayRT as PIXI.RenderTexture | null | undefined
        const cont = (ch as any).content as PIXI.Container | null | undefined
        if (dRT && cont) this._flattenBakedChunk(cont, dRT)
      }
      this._flattenDirtyKeys.clear()
    }
    if (stats) {
      if (this._scratchCallChunks.size > 1) stats.multiChunkCalls++
      stats.timeMs += performance.now() - t0
    }

    if (!carvePartialIntro) {
      if (!this.lastPt) this.lastPt = { x: wxTarget, y: wyTarget }
      this.lastPt.x = wxTarget
      this.lastPt.y = wyTarget
    }
  }

  resetScratch() { this.lastPt = null }

  private _rebakeBakedChunk(chunk: Chunk): void {
    if (!USE_BAKED_TUNNEL_MASK) return
    const displayRT = (chunk as any).displayRT as PIXI.RenderTexture | null | undefined
    const content = (chunk as any).content as PIXI.Container | null | undefined
    if (displayRT && content) this._flattenBakedChunk(content, displayRT)
  }

  private _chunkInLastVisibleWindow(chunk: Chunk): boolean {
    if (!this._hasLastVisibleWindow) return true
    return (
      chunk.col >= this._lastVisibleColMin &&
      chunk.col <= this._lastVisibleColMax &&
      chunk.row >= this._lastVisibleRowMin &&
      chunk.row <= this._lastVisibleRowMax
    )
  }

  private _queueResetFlatten(key: string): void {
    if (this._resetFlattenQueueKeys.has(key)) return
    this._resetFlattenQueueKeys.add(key)
    this._resetFlattenQueue.push(key)
  }

  private _processResetFlattenQueue(maxCount: number, visibleOnly = false): void {
    if (!USE_BAKED_TUNNEL_MASK || this._resetFlattenQueue.length === 0) return
    let processed = 0
    for (let i = 0; i < this._resetFlattenQueue.length && processed < maxCount;) {
      const key = this._resetFlattenQueue[i]!
      const chunk = this.chunks.get(key)
      if (!chunk) {
        this._resetFlattenQueueKeys.delete(key)
        this._resetFlattenQueue.splice(i, 1)
        continue
      }
      if (visibleOnly && !this._chunkInLastVisibleWindow(chunk)) {
        i++
        continue
      }
      this._rebakeBakedChunk(chunk)
      this._resetFlattenQueueKeys.delete(key)
      this._resetFlattenQueue.splice(i, 1)
      processed++
    }
  }

  /**
   * Полный сброс следов копания/пещер на текущих чанках без пересоздания TileWorld.
   * Используется при возврате в idle, чтобы старый туннель не оставался на экране.
   */
  clearRuntimeDigging(): void {
    this.lastPt = null
    this._pendingCaves = []
    this._lastCavePath = null
    this._cavesByPosition.clear()
    this._decorLavaCaveCount = 0
    this.overrides.clear()
    this.invalidateOverrides()
    this._buildQueue.length = 0
    this._buildQueueKeys.clear()
    this._flattenDirtyKeys.clear()
    this._resetFlattenQueue.length = 0
    this._resetFlattenQueueKeys.clear()

    // Сбрасываем маски чанков в "цельный грунт" (white) и очищаем лаву (black).
    if (!this.renderer) return
    for (const [key, chunk] of this.chunks) {
      const maskRT = (chunk as any).maskRT as PIXI.RenderTexture | undefined
      const lavaRT = (chunk as any).lavaRT as PIXI.RenderTexture | undefined
      const grassMaskRT = (chunk as any).grassMaskRT as PIXI.RenderTexture | undefined
      if (!maskRT) continue
      this._scratchDb.clear().beginFill(0xffffff).drawRect(0, 0, maskRT.width, maskRT.height).endFill()
      this.renderer.render({ container: this._scratchDb, target: maskRT, clear: true })
      if (grassMaskRT) {
        this._scratchDb.clear().beginFill(0xffffff).drawRect(0, 0, grassMaskRT.width, grassMaskRT.height).endFill()
        this.renderer.render({ container: this._scratchDb, target: grassMaskRT, clear: true })
      }
      if (lavaRT) {
        this._scratchDb.clear().beginFill(0x000000).drawRect(0, 0, lavaRT.width, lavaRT.height).endFill()
        this.renderer.render({ container: this._scratchDb, target: lavaRT, clear: true })
      }
      if (USE_BAKED_TUNNEL_MASK) {
        if (this._chunkInLastVisibleWindow(chunk)) this._rebakeBakedChunk(chunk)
        else this._queueResetFlatten(key)
      }
    }
  }

  // ── Пещеры ─────────────────────────────────────────────────────────────────

  private _generateCavePath(
    centerX: number,
    centerY: number,
    _seed: number,
    _preset: 'normal' | 'lavaTerminal' = 'normal',
  ): CavePath {
    const hw = LAVA_CAVE_HW
    const hh = LAVA_CAVE_HH
    const rect = { cx: centerX, cy: centerY, hw, hh, cr: LAVA_CAVE_CORNER_R }
    const zoneR = Math.hypot(hw, hh)
    const points = [{ x: centerX, y: centerY, r: zoneR }]
    return { rect, points }
  }

  private _applyCavePathToExistingChunks(cave: CavePath): number {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    if (cave.rect) {
      const { cx, cy, hw, hh } = cave.rect
      minX = cx - hw; maxX = cx + hw; minY = cy - hh; maxY = cy + hh
    } else {
      for (const p of cave.points) {
        minX = Math.min(minX, p.x - p.r); maxX = Math.max(maxX, p.x + p.r)
        minY = Math.min(minY, p.y - p.r); maxY = Math.max(maxY, p.y + p.r)
      }
    }
    const colMin = Math.floor(minX / CPW), colMax = Math.floor(maxX / CPW)
    const rowMin = Math.floor(minY / CPH), rowMax = Math.floor(maxY / CPH)

    let count = 0
    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        if (row < 0) continue
        const chunk = this.chunks.get(`${col}_${row}`)
        if (!chunk) continue
        const offX = col * CPW, offY = row * CPH
        const lavaContainer = (chunk as any).lavaContainer as PIXI.Container | null | undefined
        this._applyCavePathToChunk(
          cave,
          col,
          row,
          (chunk as any).maskRT,
          (chunk as any).lavaRT,
          lavaContainer ?? null,
          offX,
          offY,
          (chunk as any).earthRT ?? null,
        )
        // Flatten-режим: maskRT обновился → пересобрать displayRT этого чанка.
        const dRT = (chunk as any).displayRT as PIXI.RenderTexture | null | undefined
        const cont = (chunk as any).content as PIXI.Container | null | undefined
        if (USE_BAKED_TUNNEL_MASK && dRT && cont) this._flattenBakedChunk(cont, dRT)
        count++
      }
    }

    return count
  }

   /** Есть ли слот под ещё одну декоративную лавовую пещеру */
  canSpawnMoreDecorCaves(): boolean {
    return this._decorLavaCaveCount < GameConfig.lava.maxDecorCaves
  }

  spawnCave(
    wx: number,
    wy: number,
    seed: number,
    options?: { accept?: (path: CavePath) => boolean; lavaTerminal?: boolean },
  ) {
    const accept = options?.accept
    const lavaTerminal = options?.lavaTerminal ?? false
    const path = this._generateCavePath(wx, wy, seed, lavaTerminal ? 'lavaTerminal' : 'normal')
    if (accept && !accept(path)) return false
    if (!lavaTerminal && !this.canSpawnMoreDecorCaves()) return false
    this._pendingCaves.push(path)
    this._lastCavePath = path
    this._cavesByPosition.set(`${Math.round(wx)},${Math.round(wy)}`, path)
    this._applyCavePathToExistingChunks(path)
    // Лаву инициализируем один раз на пещеру — не по каждому чанку (иначе дубли и «пустые» зоны).
    if (this.lavaSimulation && path.rect) {
      this.lavaSimulation.addStaticLavaPool(path.rect)
    }
    if (!lavaTerminal) this._decorLavaCaveCount++
    return true
  }

  getLastCavePath(): CavePath | null { return this._lastCavePath }
  getCavePathAt(wx: number, wy: number): CavePath | null {
    return this._cavesByPosition.get(`${Math.round(wx)},${Math.round(wy)}`) || null
  }

  /** Снимок для __DR_PERF__: активные чанки, очереди, подложка туннеля. */
  getPerfSnapshot(): {
    activeChunks: number
    buildQueue: number
    tunnelBgPanels: number
    pendingCaves: number
    viewportChunksWxH: string
    scratchCalls: number
    scratchStamps: number
    scratchRenderOps: number
    scratchChunksTouched: number
    scratchMultiChunkCalls: number
    scratchTimeMs: number
  } {
    const vp = GameConfig.viewportChunks
    return {
      activeChunks: this.chunks.size,
      buildQueue: this._buildQueue.length,
      tunnelBgPanels: this._tunnelBgPanels.size,
      pendingCaves: this._pendingCaves.length,
      viewportChunksWxH: `${vp.widthPx}×${vp.heightPx}`,
      scratchCalls: this._scratchFrameStats.calls,
      scratchStamps: this._scratchFrameStats.stamps,
      scratchRenderOps: this._scratchFrameStats.renderOps,
      scratchChunksTouched: this._scratchFrameStats.chunksTouched,
      scratchMultiChunkCalls: this._scratchFrameStats.multiChunkCalls,
      scratchTimeMs: this._scratchFrameStats.timeMs,
    }
  }

  beginScratchFrameDiagnostics(active: boolean): void {
    this._scratchFrameStats.active = active
    this._scratchFrameStats.calls = 0
    this._scratchFrameStats.stamps = 0
    this._scratchFrameStats.renderOps = 0
    this._scratchFrameStats.chunksTouched = 0
    this._scratchFrameStats.multiChunkCalls = 0
    this._scratchFrameStats.timeMs = 0
    if (this._scratchFrameChunks.size > 0) this._scratchFrameChunks.clear()
    if (this._scratchCallChunks.size > 0) this._scratchCallChunks.clear()
  }

  beginBuildDiagnostics(active: boolean): void {
    this._buildDiagnostics.active = active
    this._buildDiagnostics.chunksBuilt = 0
    this._buildDiagnostics.chunkBuildTotalMs = 0
    this._buildDiagnostics.maxChunkBuildMs = 0
    this._buildDiagnostics.renderTexturesCreated = 0
    this._buildDiagnostics.renderCalls = 0
    this._buildDiagnostics.spritesCreated = 0
    this._buildDiagnostics.graphicsCreated = 0
    this._buildDiagnostics.maskPoolReused = 0
    this._buildDiagnostics.grassMaskPoolReused = 0
    this._buildDiagnostics.tunnelBgPanelsBuilt = 0
  }

  getBuildDiagnostics(): Record<string, string | number | boolean> {
    const d = this._buildDiagnostics
    const avgChunkMs = d.chunksBuilt > 0 ? d.chunkBuildTotalMs / d.chunksBuilt : 0
    return {
      chunksBuilt: d.chunksBuilt,
      chunkBuildTotalMs: Number(d.chunkBuildTotalMs.toFixed(2)),
      avgChunkBuildMs: Number(avgChunkMs.toFixed(2)),
      maxChunkBuildMs: Number(d.maxChunkBuildMs.toFixed(2)),
      renderTexturesCreated: d.renderTexturesCreated,
      renderCalls: d.renderCalls,
      spritesCreatedApprox: d.spritesCreated,
      graphicsCreatedApprox: d.graphicsCreated,
      maskPoolReused: d.maskPoolReused,
      grassMaskPoolReused: d.grassMaskPoolReused,
      tunnelBgPanelsBuilt: d.tunnelBgPanelsBuilt,
      buildQueueAfter: this._buildQueue.length,
      activeChunksAfter: this.chunks.size,
    }
  }

  getChunkDebugSnapshot(): Array<{ col: number; row: number; x: number; y: number; w: number; h: number }> {
    const out: Array<{ col: number; row: number; x: number; y: number; w: number; h: number }> = []
    for (const chunk of this.chunks.values()) {
      out.push({
        col: chunk.col,
        row: chunk.row,
        x: chunk.col * CPW,
        y: chunk.row * CPH,
        w: CPW,
        h: CPH,
      })
    }
    return out
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  /**
   * @param _screenW устар.: окно чанков задаётся `GameConfig.viewportChunks` (или `chunkViewport`).
   * @param _screenH устар.: то же.
   * @param chunkViewport если задан (idle) — временно подменяет размер окна для чанков/подложки.
   */
  update(
    camX: number,
    camY: number,
    _screenW: number,
    _screenH: number,
    chunkViewport?: { w: number; h: number },
  ) {
    const vw = chunkViewport?.w ?? GameConfig.viewportChunks.widthPx
    const vh = chunkViewport?.h ?? GameConfig.viewportChunks.heightPx
    // Perf: keep a smaller offscreen buffer. Too large buffer explodes active chunks,
    // which multiplies the cost of RT masks + scene graph traversal.
    const buf    = TILEWORLD_CHUNK_VIEW_BUF_PX
    const colMin = Math.floor((camX-buf)/CPW)
    const colMax = Math.ceil((camX+vw+buf)/CPW)
    const rowMin = Math.max(0, Math.floor((camY-buf)/CPH))
    const rowMax = Math.ceil((camY+vh+buf)/CPH)

    const needRebuild =
      !this.overridesBuilt ||
      colMin < this._ovColMin-2 || colMax > this._ovColMax+2 ||
      rowMin < this._ovRowMin-2 || rowMax > this._ovRowMax+2

    if (needRebuild) {
      const oc0=colMin-6, oc1=colMax+6, or0=rowMin, or1=rowMax+8
      const skipAir = this.overridesBuilt &&
        oc0===this._ovColMin && oc1===this._ovColMax &&
        or0===this._ovRowMin && or1===this._ovRowMax
      const newOv=buildOverrides(oc0,or0,oc1,or1,this.seed,this.totalRows,this._pathWaypoints,this._pathSurfY,this._pathProtectY,skipAir)
      for(const[k,v]of newOv)this.overrides.set(k,v)
      this._ovColMin=oc0;this._ovColMax=oc1;this._ovRowMin=or0;this._ovRowMax=or1
      this.overridesBuilt=true
    }

    // Visible viewport (no buffer) — build immediately to avoid blank tiles on screen.
    const vc0 = Math.floor(camX / CPW)
    const vc1 = Math.ceil((camX + vw) / CPW)
    const vr0 = Math.max(0, Math.floor(camY / CPH))
    const vr1 = Math.ceil((camY + vh) / CPH)
    this._hasLastVisibleWindow = true
    this._lastVisibleColMin = vc0
    this._lastVisibleColMax = vc1
    this._lastVisibleRowMin = vr0
    this._lastVisibleRowMax = vr1

    // If a previously offscreen, reset-but-not-rebaked chunk becomes visible, heal it before draw.
    this._processResetFlattenQueue(Number.POSITIVE_INFINITY, true)

    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        const key = `${col}_${row}`
        if (this.chunks.has(key) || this._buildQueueKeys.has(key)) continue
        const inViewport = col >= vc0 && col <= vc1 && row >= vr0 && row <= vr1
        if (inViewport) {
          this._buildChunk(col, row)
        } else {
          this._buildQueue.push({ col, row })
          this._buildQueueKeys.add(key)
        }
      }
    }

    // Drain build queue — spread GPU cost (count from GameConfig).
    const maxDrain = Math.max(1, Math.floor(GameConfig.performance.tileWorldChunkBuildsPerFrame))
    const drainN = Math.min(maxDrain, this._buildQueue.length)
    for (let i = 0; i < drainN; i++) {
      const item = this._buildQueue.shift()!
      const k = `${item.col}_${item.row}`
      this._buildQueueKeys.delete(k)
      if (!this.chunks.has(k)) this._buildChunk(item.col, item.row)
    }

    this._processResetFlattenQueue(maxDrain)

    this._extendBg(colMin, colMax, rowMin, rowMax)

    const cull = TILEWORLD_CHUNK_CULL_MARGIN
    for (const [key, chunk] of this.chunks) {
      if (chunk.col < colMin-cull || chunk.col > colMax+cull ||
          chunk.row < rowMin-cull || chunk.row > rowMax+cull) {
        this._forgetEarthVariantsForChunk(chunk.col, chunk.row)
        // Clear masks BEFORE removeChild so _renderGroup is still valid and PixiJS v8 can
        // properly tear down the AlphaMask instruction from the render pipeline.
        for (const child of chunk.gfx.children) {
          if ((child as PIXI.Container).mask) (child as PIXI.Container).mask = null
        }
        this.chunkContainer.removeChild(chunk.gfx)
        // Pool mask RTs instead of destroy(true) — avoids PixiJS v8 stale-BindGroup crash.
        const evictMaskRT = (chunk as any).maskRT as PIXI.RenderTexture | undefined
        const evictGrassRT = (chunk as any).grassMaskRT as PIXI.RenderTexture | undefined
        if (evictMaskRT) this._maskRTPool.push(evictMaskRT)
        if (evictGrassRT) this._grassMaskRTPool.push(evictGrassRT)
        this._resetFlattenQueueKeys.delete(key)
        chunk.gfx.destroy({children:true})
        ;(chunk as any).lavaRT?.destroy(true)
        ;(chunk as any).earthRT?.destroy(true)
        ;(chunk as any).displayRT?.destroy(true)
        this.chunks.delete(key)
      }
    }

    // Purge queue entries that fell outside cull bounds.
    for (let i = this._buildQueue.length - 1; i >= 0; i--) {
      const { col, row } = this._buildQueue[i]!
      if (col < colMin-cull || col > colMax+cull || row < rowMin-cull || row > rowMax+cull) {
        this._buildQueueKeys.delete(`${col}_${row}`)
        this._buildQueue.splice(i, 1)
      }
    }

    this._syncTunnelBgEarthTiles(camX, camY, vw, vh)
  }

  private _extendBg(_colMin:number, _colMax:number, _rowMin:number, _rowMax:number) {
    // bgLight — бесконечный прямоугольник, _extendBg больше не нужен
  }

  invalidateOverrides() {
    this.overridesBuilt=false
    this._ovColMin=this._ovColMax=this._ovRowMin=this._ovRowMax=0
  }

  private _buildChunk(col: number, row: number) {
    const _diagT0 = this._buildDiagnostics.active ? performance.now() : 0
    const key  = `${col}_${row}`
    const offX = col*CPW, offY = row*CPH
    const topOverlap = chunkTopVisualOverlap(row)
    const visualH = CPH + topOverlap + CHUNK_VISUAL_OVERLAP_PX

    const content = new PIXI.Container()
    content.name = 'chunkContent'
    let earthRT: PIXI.RenderTexture | null = null

    const hasEarth = TileWorld.earthTex.some(t => t != null)
    if (hasEarth) {
      const earthLayer = new PIXI.Container()
      earthLayer.name = 'earthLayer'
      // Важно: не растягиваем baked RT на overlap-зону.
      // Иначе крайние пиксели чанка пересэмплируются, что даёт двойные линии/дыры на стыках.
      // Вместо этого печём RT сразу в реальном визуальном размере чанка и подмешиваем
      // соседние пограничные тайлы, из которых в overlap попадут только нужные 3px полосы.
      const minTileX = -1
      const maxTileX = CHUNK_W
      const minTileY = topOverlap > 0 ? -1 : 0
      const maxTileY = CHUNK_H
      for (let ly = minTileY; ly <= maxTileY; ly++) {
        for (let lx = minTileX; lx <= maxTileX; lx++) {
          const gCol = col * CHUNK_W + lx
          const gRow = row * CHUNK_H + ly
          const vi = this._pickEarthVariant(gCol, gRow)
          const tex = TileWorld.earthTex[vi]
          if (!tex) continue
          const cell = new PIXI.Sprite(tex)
          if (this._buildDiagnostics.active) this._buildDiagnostics.spritesCreated++
          cell.name = 'earthCell'
          cell.width = TILE
          cell.height = TILE
          cell.x = lx * TILE + CHUNK_VISUAL_OVERLAP_PX
          cell.y = ly * TILE + topOverlap
          if (cell.x + TILE <= 0 || cell.x >= MASK_W || cell.y + TILE <= 0 || cell.y >= visualH) {
            cell.destroy()
            continue
          }
          earthLayer.addChild(cell)
        }
      }
      // Big perf win: bake 24 tile sprites into one RT sprite per chunk.
      if (this.renderer) {
        const baked = this._bakeToRenderTexture(earthLayer, MASK_W, visualH)
        if (baked) {
          earthRT = baked
          const spr = new PIXI.Sprite(baked)
          if (this._buildDiagnostics.active) this._buildDiagnostics.spritesCreated++
          spr.name = 'earthBaked'
          spr.x = -CHUNK_VISUAL_OVERLAP_PX
          spr.y = -topOverlap
          content.addChild(spr)
          earthLayer.destroy({ children: true })
        } else {
          content.addChild(earthLayer)
        }
      } else {
        content.addChild(earthLayer)
      }
    } else if (TileWorld.groundTex) {
      const spr = new PIXI.TilingSprite(TileWorld.groundTex, CPW + CHUNK_VISUAL_OVERLAP_PX * 2, visualH)
      if (this._buildDiagnostics.active) this._buildDiagnostics.spritesCreated++
      spr.name = 'groundTiling'
      spr.x = -CHUNK_VISUAL_OVERLAP_PX
      spr.y = -topOverlap
      spr.tileScale.set(TILE/TileWorld.groundTex.width, TILE/TileWorld.groundTex.height)
      content.addChild(spr)
    } else {
      const fb = new PIXI.Graphics()
      if (this._buildDiagnostics.active) this._buildDiagnostics.graphicsCreated++
      fb.name = 'groundFallback'
      fb.beginFill(0x5a2d14)
        .drawRect(-CHUNK_VISUAL_OVERLAP_PX, -topOverlap, CPW + CHUNK_VISUAL_OVERLAP_PX * 2, visualH)
        .endFill()
      content.addChild(fb)
    }

    let topGrassSpr: PIXI.Sprite | null = null
    // Верхнюю траву рисуем отдельным спрайтом, но маскируем тем же maskRT,
    // чтобы она стиралась вместе с грунтом при прокапывании туннеля/пещер.
    if (row===0 && TileWorld.grassTex) {
      const spr = new PIXI.Sprite(TileWorld.grassTex)
      if (this._buildDiagnostics.active) this._buildDiagnostics.spritesCreated++
      spr.name = 'topGrass'
      spr.x = -CHUNK_VISUAL_OVERLAP_PX
      spr.y = GRASS_SPRITE_Y_OFFSET
      spr.width = CPW + CHUNK_VISUAL_OVERLAP_PX * 2
      spr.height = TILE
      topGrassSpr = spr
    }

    const pooledMaskRT = this._maskRTPool.pop()
    if (this._buildDiagnostics.active && pooledMaskRT) this._buildDiagnostics.maskPoolReused++
    const maskRT  = pooledMaskRT ?? PIXI.RenderTexture.create({width:MASK_W, height:MASK_H})
    if (this._buildDiagnostics.active && !pooledMaskRT) this._buildDiagnostics.renderTexturesCreated++
    const maskSpr = new PIXI.Sprite(maskRT)
    if (this._buildDiagnostics.active) this._buildDiagnostics.spritesCreated++
    maskSpr.name = 'maskSpr'
    maskSpr.x = -CHUNK_VISUAL_OVERLAP_PX
    maskSpr.y = -CHUNK_VISUAL_OVERLAP_PX
    maskSpr.renderable = false

    // Perf: darkBg/darkMaskRT removed — darkInsetPx=5 (5px border, barely visible),
    // but each sprite-mask costs a GPU push/pop per chunk per frame. -1 mask = -50% mask ops.
    const lavaRT: PIXI.RenderTexture | null = null
    let grassMaskRT: PIXI.RenderTexture | null = null
    let grassMaskSpr: PIXI.Sprite | null = null
    if (topGrassSpr) {
      const pooledGrassMaskRT = this._grassMaskRTPool.pop()
      if (this._buildDiagnostics.active && pooledGrassMaskRT) this._buildDiagnostics.grassMaskPoolReused++
      grassMaskRT = pooledGrassMaskRT ?? PIXI.RenderTexture.create({width: MASK_W, height: MASK_H + GRASS_MASK_HEADROOM})
      if (this._buildDiagnostics.active && !pooledGrassMaskRT) this._buildDiagnostics.renderTexturesCreated++
      grassMaskSpr = new PIXI.Sprite(grassMaskRT)
      if (this._buildDiagnostics.active) this._buildDiagnostics.spritesCreated++
      grassMaskSpr.name = 'grassMaskSpr'
      grassMaskSpr.x = -CHUNK_VISUAL_OVERLAP_PX
      grassMaskSpr.y = -GRASS_MASK_HEADROOM - CHUNK_VISUAL_OVERLAP_PX
      grassMaskSpr.renderable = false
    }

    if (this.renderer) {
      // Perf: reuse scratch Graphics instead of allocating new ones per chunk.
      this._scratchDb.clear().beginFill(0xffffff).drawRect(0, 0, MASK_W, MASK_H).endFill()
      this.renderer.render({ container: this._scratchDb, target: maskRT, clear: true })
      if (this._buildDiagnostics.active) this._buildDiagnostics.renderCalls++
      if (grassMaskRT) {
        this._scratchWb.clear().beginFill(0xffffff).drawRect(0, 0, MASK_W, MASK_H + GRASS_MASK_HEADROOM).endFill()
        this.renderer.render({ container: this._scratchWb, target: grassMaskRT, clear: true })
        if (this._buildDiagnostics.active) this._buildDiagnostics.renderCalls++
      }
    }

    const lavaContainer: PIXI.Container | null = null

    for (const cave of this._pendingCaves) {
      this._applyCavePathToChunk(cave, col, row, maskRT, lavaRT, lavaContainer, offX, offY, earthRT)
    }

    const container = new PIXI.Container()
    container.name = `chunk(${col},${row})`
    container.x = offX; container.y = offY

    let displayRT: PIXI.RenderTexture | null = null

    if (USE_BAKED_TUNNEL_MASK) {
      // Flatten-режим: maskSpr — ребёнок content (самодостаточный маск-юнит),
      // content маскируется и один раз рендерится в displayRT; на кадре рисуется
      // плоский displaySpr (батчится, без per-frame AlphaMaskPipe).
      content.addChild(maskSpr)
      content.mask = maskSpr
      content.renderable = false
      displayRT = PIXI.RenderTexture.create({ width: MASK_W, height: MASK_H })
      if (this._buildDiagnostics.active) this._buildDiagnostics.renderTexturesCreated++
      const displaySpr = new PIXI.Sprite(displayRT)
      displaySpr.name = 'chunkDisplay'
      displaySpr.x = -CHUNK_VISUAL_OVERLAP_PX
      displaySpr.y = -CHUNK_VISUAL_OVERLAP_PX
      container.addChild(content)        // невидимый источник для ре-флэттена
      container.addChild(displaySpr)
      if (topGrassSpr) {
        if (grassMaskSpr) topGrassSpr.mask = grassMaskSpr
        container.addChild(topGrassSpr)
      }
      if (grassMaskSpr) container.addChild(grassMaskSpr)
      this._flattenBakedChunk(content, displayRT)
    } else {
      // Живая маска (legacy): per-frame AlphaMaskPipe. Оставлена для отката.
      content.mask = maskSpr
      if (topGrassSpr && grassMaskSpr) topGrassSpr.mask = grassMaskSpr
      container.addChild(content)
      if (topGrassSpr) container.addChild(topGrassSpr)
      container.addChild(maskSpr)
      if (grassMaskSpr) container.addChild(grassMaskSpr)
    }

    this.chunkContainer.addChild(container)
    this.chunks.set(key, {gfx:container, col, row, ...{maskRT, lavaRT, grassMaskRT, earthRT, displayRT, content, lavaContainer}} as any)
    if (this._buildDiagnostics.active) {
      const elapsed = performance.now() - _diagT0
      this._buildDiagnostics.chunksBuilt++
      this._buildDiagnostics.chunkBuildTotalMs += elapsed
      if (elapsed > this._buildDiagnostics.maxChunkBuildMs) this._buildDiagnostics.maxChunkBuildMs = elapsed
    }
  }

  /**
   * Flatten-режим: рендерит замаскированный `content` (земля под maskRT) в `displayRT`
   * одним проходом. Источники (earthRT+maskRT) ≠ цель (displayRT) → нет RT-feedback.
   * Сдвиг content на +overlap: его локальная точка (-overlap,-overlap) → (0,0) displayRT.
   */
  private _flattenBakedChunk(content: PIXI.Container, displayRT: PIXI.RenderTexture): void {
    if (!this.renderer) return
    const parent = content.parent
    const px = content.x, py = content.y
    const pr = content.renderable
    // Кладём content в обёртку → при render он НЕ корень render-group, и его .mask
    // применяется при обходе (корню v8 собственную маску не накладывает).
    this._flattenWrapper.addChild(content)
    content.position.set(CHUNK_VISUAL_OVERLAP_PX, CHUNK_VISUAL_OVERLAP_PX)
    content.renderable = true
    this.renderer.render({ container: this._flattenWrapper, target: displayRT, clear: true })
    content.renderable = pr
    content.position.set(px, py)
    // Возвращаем content на место (он renderable=false, z-порядок в чанке не важен).
    if (parent) parent.addChild(content)
    else this._flattenWrapper.removeChild(content)
    if (this._buildDiagnostics.active) this._buildDiagnostics.renderCalls++
  }

  private _applyCavePathToChunk(
    cave: CavePath,
    col: number, row: number,
    maskRT: PIXI.RenderTexture,
    lavaRT: PIXI.RenderTexture | null,
    lavaContainer: PIXI.Container | null,
    offX: number, offY: number,
    earthRT: PIXI.RenderTexture | null = null
  ) {
    if (!this.renderer) return

    const g = this._caveGfx
    g.clear()
    let hasContent = false

    if (cave.rect) {
      const { cx, cy, hw, hh, cr } = cave.rect
      const rx0 = cx - hw - offX + CHUNK_VISUAL_OVERLAP_PX
      const ry0 = cy - hh - offY + CHUNK_VISUAL_OVERLAP_PX
      const rw = 2 * hw
      const rh = 2 * hh
      if (rx0 + rw > 0 && rx0 < CPW && ry0 + rh > 0 && ry0 < CPH) {
        hasContent = true
        ;(g as any).beginFill(0x000000).drawRoundedRect(rx0, ry0, rw, rh, cr).endFill()
      }
    } else if (cave.points.length === 1) {
      const p  = cave.points[0]!
      const lx = p.x - offX + CHUNK_VISUAL_OVERLAP_PX
      const ly = p.y - offY + CHUNK_VISUAL_OVERLAP_PX
      if (lx + p.r >= 0 && lx - p.r <= CPW && ly + p.r >= 0 && ly - p.r <= CPH) {
        hasContent = true
        g.beginFill(0x000000).drawCircle(lx, ly, p.r).endFill()
      }
    } else {
      for (let i = 0; i < cave.points.length - 1; i++) {
        const a   = cave.points[i]!
        const b   = cave.points[i + 1]!
        const lax = a.x - offX + CHUNK_VISUAL_OVERLAP_PX
        const lay = a.y - offY + CHUNK_VISUAL_OVERLAP_PX
        const lbx = b.x - offX + CHUNK_VISUAL_OVERLAP_PX
        const lby = b.y - offY + CHUNK_VISUAL_OVERLAP_PX

        const minX = Math.min(lax, lbx) - Math.max(a.r, b.r)
        const maxX = Math.max(lax, lbx) + Math.max(a.r, b.r)
        const minY = Math.min(lay, lby) - Math.max(a.r, b.r)
        const maxY = Math.max(lay, lby) + Math.max(a.r, b.r)
        if (maxX < 0 || minX > CPW || maxY < 0 || minY > CPH) continue

        hasContent = true
        drawCapsule(g, lax, lay, a.r, lbx, lby, b.r, 0x000000)
      }
    }

    if (!hasContent) return

    // Карв в maskRT: opaque-чёрный тоннель. v8 sprite-маска читает КРАСНЫЙ канал
    // (mask.frag: masky.r) → белое (r=1) = земля, чёрный тоннель (r=0) = дыра.
    // Отдельная текстура → нет RT-feedback с земляным спрайтом.
    this.renderer.render({ container: g, target: maskRT, clear: false })
    if (this._buildDiagnostics.active) this._buildDiagnostics.renderCalls++

    if (lavaRT && lavaContainer) {
      const gWhite = new PIXI.Graphics()
      if (this._buildDiagnostics.active) this._buildDiagnostics.graphicsCreated++
      if (cave.rect) {
        const { cx, cy, hw, hh, cr } = cave.rect
        const rx0 = cx - hw - offX
        const ry0 = cy - hh - offY
        ;(gWhite as any).beginFill(0xffffff).drawRoundedRect(rx0, ry0, 2 * hw, 2 * hh, cr).endFill()
      } else if (cave.points.length === 1) {
        const p = cave.points[0]!
        gWhite.beginFill(0xffffff).drawCircle(p.x - offX, p.y - offY, p.r).endFill()
      } else {
        for (let i = 0; i < cave.points.length - 1; i++) {
          const a = cave.points[i]!, b = cave.points[i + 1]!
          const lax = a.x - offX, lay = a.y - offY
          const lbx = b.x - offX, lby = b.y - offY
          const minX = Math.min(lax, lbx) - Math.max(a.r, b.r)
          const maxX = Math.max(lax, lbx) + Math.max(a.r, b.r)
          const minY = Math.min(lay, lby) - Math.max(a.r, b.r)
          const maxY = Math.max(lay, lby) + Math.max(a.r, b.r)
          if (maxX < 0 || minX > CPW || maxY < 0 || minY > CPH) continue
          drawCapsule(gWhite, lax, lay, a.r, lbx, lby, b.r, 0xffffff)
        }
      }
      this.renderer.render({ container: gWhite, target: lavaRT, clear: false })
      if (this._buildDiagnostics.active) this._buildDiagnostics.renderCalls++
      gWhite.destroy()
    }
  }

  updateLavas(deltaTime: number, viewW?: number, viewH?: number) {
    if (!this.lavaSimulation) return
    if (viewW != null && viewH != null) {
      if (viewW !== this._lavaViewportW || viewH !== this._lavaViewportH) {
        this._lavaViewportW = viewW
        this._lavaViewportH = viewH
        this.lavaSimulation.setViewport(viewW, viewH)
      }
    }
    this.lavaSimulation.update(deltaTime)
  }

  destroy() {
    this._buildQueue.length = 0
    this._buildQueueKeys.clear()
    this._resetFlattenQueue.length = 0
    this._resetFlattenQueueKeys.clear()
    for(const c of this.chunks.values()){
      this._forgetEarthVariantsForChunk(c.col, c.row)
      for (const child of c.gfx.children) {
        if ((child as PIXI.Container).mask) (child as PIXI.Container).mask = null
      }
      const dMaskRT = (c as any).maskRT as PIXI.RenderTexture | undefined
      const dGrassRT = (c as any).grassMaskRT as PIXI.RenderTexture | undefined
      if (dMaskRT) this._maskRTPool.push(dMaskRT)
      if (dGrassRT) this._grassMaskRTPool.push(dGrassRT)
      c.gfx.destroy({children:true})
      ;(c as any).lavaRT?.destroy(true)
      ;(c as any).earthRT?.destroy(true)
      ;(c as any).displayRT?.destroy(true)
    }
    this.chunks.clear()
    for (const rt of this._maskRTPool) rt.destroy(true)
    this._maskRTPool.length = 0
    for (const rt of this._grassMaskRTPool) rt.destroy(true)
    this._grassMaskRTPool.length = 0
    this._earthVariant.clear()
    this._pendingCaves.length = 0
    this._decorLavaCaveCount = 0
    this.brush.destroy(); this.line.destroy()
    this._scratchDb.destroy(); this._scratchWb.destroy()
    this._scratchGb.destroy(); this._scratchGl.destroy()
    this._caveGfx.destroy()
    for (const p of this._tunnelBgPanels.values()) {
      p.spr.destroy({ texture: false })
      p.rt.destroy(true)
    }
    this._tunnelBgPanels.clear()
    this._tunnelBgGroundTiling = null
    this._tunnelBgColorFill = null
    this.bgLight.destroy({ children: true })
  }
}
