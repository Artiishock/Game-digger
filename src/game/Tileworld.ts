import * as PIXI from 'pixi.js'
import { LavaSimulation, CELL_PX } from './LavaSimulation'

export const TILE = 120
export const CHUNK_W = 6
export const CHUNK_H = 4

const CPW = CHUNK_W * TILE
const CPH = CHUNK_H * TILE

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
): TileOverride {
  const out: TileOverride = new Map()
  const set = (tc: number, tr: number, type: T) => {
    if (tr < 0) return
    out.set(`${tc},${tr}`, type)
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

  for (let tc = tc0; tc <= tc1; tc++)
    for (let tr = Math.max(tr0, 5); tr <= tr1; tr++)
      if (caveNoise(tc, tr, worldSeed) > 0.62) set(tc, tr, T.AIR)

  for (let tc = tc0; tc <= tc1; tc++) {
    for (let tr = Math.max(tr0, 10); tr <= tr1; tr++) {
      const depth = tr % 200
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
  if (type === T.LAVA || type === T.MAGMA) type = T.DEEP
  const [fill, shadow] = COL[type] ?? [0x555555, 0x333333]
  const rng = lcg(tileSeed)
  g.beginFill(fill); g.drawRect(px, py, TILE, TILE); g.endFill()
  g.beginFill(shadow, 0.30); g.drawRect(px, py+TILE-5, TILE, 5); g.endFill()
  g.beginFill(0x000000, 0.10); g.drawRect(px+TILE-3, py, 3, TILE); g.endFill()
  if (type !== T.LAVA && type !== T.MAGMA) {
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
  points: Array<{x: number, y: number, r: number}>
}

export class TileWorld {
  private container:  PIXI.Container
  private chunks:     Map<string, Chunk> = new Map()
  private overrides:  TileOverride = new Map()
  private seed:       number
  private totalRows:  number
  private overridesBuilt = false
  private _ovColMin = 0; private _ovColMax = 0
  private _ovRowMin = 0; private _ovRowMax = 0

  private brush: PIXI.Graphics = new PIXI.Graphics()
  private line:  PIXI.Graphics = new PIXI.Graphics()
  private lastPt: {x:number,y:number}|null = null
  renderer: PIXI.Renderer|null = null

  private _pendingCaves: CavePath[] = []
  private _lastCavePath: CavePath | null = null
  private _cavesByPosition: Map<string, CavePath> = new Map()
  private _caveGfx: PIXI.Graphics = new PIXI.Graphics()

  lavaSimulation: LavaSimulation | null = null

  private bgLight:  PIXI.Graphics = new PIXI.Graphics()
  private _bgLightAdded = false
  private bgMinX = 99999; private bgMaxX = -99999

  static grassTex:  PIXI.Texture | null = null
  static groundTex: PIXI.Texture | null = null

  static loadGrassTex(): Promise<void> {
    const p1 = TileWorld.grassTex
      ? Promise.resolve()
      : PIXI.Texture.fromURL('./grass.png').then(t=>{TileWorld.grassTex=t}).catch(()=>{TileWorld.grassTex=null})
    const p2 = TileWorld.groundTex
      ? Promise.resolve()
      : PIXI.Texture.fromURL('./graund.png').then(t=>{TileWorld.groundTex=t}).catch(()=>{TileWorld.groundTex=null})
    return Promise.all([p1, p2]).then(()=>{})
  }

  constructor(container: PIXI.Container, seed: number, _totalDepthPx?: number) {
    this.container = container
    this.seed      = seed
    this.totalRows = Number.MAX_SAFE_INTEGER

    // Светлый фон — бесконечный, без маски
    this.bgLight.beginFill(0x845D46)
      .drawRect(-500000, 0, 1000000, 1000000)
      .endFill()
    container.addChild(this.bgLight)
  }

  initMasks() {
    // per-chunk darkMask инициализируется в _buildChunk
  }

  showBg() { this.bgLight.visible = true  }
  hideBg()  { this.bgLight.visible = false }

  // ── Scratch ────────────────────────────────────────────────────────────────

  scratchAt(sx: number, sy: number, camX: number, camY: number) {
    if (!this.renderer) return
    const wx = sx + camX, wy = sy + camY
    const R = 70, R_bg = R - 5

    const colMin = Math.floor((wx-R)/CPW), colMax = Math.floor((wx+R)/CPW)
    const rowMin = Math.floor((wy-R)/CPH), rowMax = Math.floor((wy+R)/CPH)

    for (let row=rowMin; row<=rowMax; row++) {
      for (let col=colMin; col<=colMax; col++) {
        if (row<0) continue
        const chunk = this.chunks.get(`${col}_${row}`)
        if (!chunk) continue
        const lx = wx - col*CPW, ly = wy - row*CPH
        this.brush.clear()
        this.brush.beginFill(0x000000).drawCircle(lx, ly, R).endFill()
        this.renderer.render(this.brush, { renderTexture: (chunk as any).maskRT, clear: false })

        // Тёмный фон чанка — рисуем чёрный круг → darkBg скрывается → виден bgLight
        if ((chunk as any).darkMaskRT) {
          const db = new PIXI.Graphics()
          db.beginFill(0x000000).drawCircle(lx, ly, R_bg).endFill()
          this.renderer.render(db, { renderTexture: (chunk as any).darkMaskRT, clear: false })
          db.destroy()
        }

        if ((chunk as any).lavaRT) {
          const wb = new PIXI.Graphics()
          wb.beginFill(0xffffff).drawCircle(lx, ly, R).endFill()
          this.renderer.render(wb, { renderTexture: (chunk as any).lavaRT, clear: false })
          wb.destroy()
        }

        // Открываем ячейки лавы только если туннель пересекает пещеру
        if (this.lavaSimulation) {
          this.lavaSimulation.openAreaIfNearLava(wx, wy, R)
        }

        if (this.lastPt) {
          const plx = this.lastPt.x - col*CPW, ply = this.lastPt.y - row*CPH
          this.line.clear()
          this.line.lineStyle(R*2, 0x000000)
          this.line.moveTo(plx, ply).lineTo(lx, ly)
          this.renderer.render(this.line, { renderTexture: (chunk as any).maskRT, clear: false })

          if ((chunk as any).darkMaskRT) {
            const dl = new PIXI.Graphics()
            dl.lineStyle(R_bg*2, 0x000000)
            dl.moveTo(plx, ply).lineTo(lx, ly)
            this.renderer.render(dl, { renderTexture: (chunk as any).darkMaskRT, clear: false })
            dl.destroy()
          }
        }
      }
    }
    if (!this.lastPt) this.lastPt = {x:wx, y:wy}
    this.lastPt.x = wx; this.lastPt.y = wy
  }

  resetScratch() { this.lastPt = null }

  // ── Пещеры ─────────────────────────────────────────────────────────────────

  private _generateCavePath(centerX: number, centerY: number, seed: number): CavePath {
    const rng = (() => {
      let s = seed >>> 0
      return () => { s = Math.imul(1664525, s) + 1013904223 >>> 0; return s / 0x100000000 }
    })()
    const points: Array<{x:number, y:number, r:number}> = []
    let x = 0, y = 0
    let angle = rng() * Math.PI * 2
    const steps   = 28 + Math.floor(rng() * 42)
    const baseR   = 28 + rng() * 22
    const stepLen = 6 + rng() * 9

    for (let i = 0; i < steps; i++) {
      angle += (rng() - 0.5) * 1.2
      const len = stepLen * (0.7 + rng() * 0.8)
      x += Math.cos(angle) * len
      y += Math.sin(angle) * len
      const r = baseR * (0.6 + rng() * 0.8)
      points.push({ x: centerX + x, y: centerY + y, r })

      if (rng() < 0.22 && i > 5 && i < steps - 5) {
        const branchSteps = 5 + Math.floor(rng() * 10)
        let bx = x, by = y
        const branchAngle = angle + (rng() - 0.5) * Math.PI
        for (let j = 0; j < branchSteps; j++) {
          const blen = stepLen * 0.6
          bx += Math.cos(branchAngle) * blen
          by += Math.sin(branchAngle) * blen
          const br = baseR * (0.4 + rng() * 0.6)
          points.push({ x: centerX + bx, y: centerY + by, r: br })
        }
      }
    }
    return { points }
  }

  private _applyCavePathToExistingChunks(cave: CavePath): number {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of cave.points) {
      minX = Math.min(minX, p.x - p.r); maxX = Math.max(maxX, p.x + p.r)
      minY = Math.min(minY, p.y - p.r); maxY = Math.max(maxY, p.y + p.r)
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
        const lavaContainer = chunk.gfx.children[0] as PIXI.Container
        this._applyCavePathToChunk(cave, col, row, (chunk as any).maskRT, (chunk as any).darkMaskRT, (chunk as any).lavaRT, lavaContainer, offX, offY)
        count++
      }
    }

    return count
  }

  spawnCave(wx: number, wy: number, seed: number) {
    const path = this._generateCavePath(wx, wy, seed)
    this._pendingCaves.push(path)
    this._lastCavePath = path
    this._cavesByPosition.set(`${Math.round(wx)},${Math.round(wy)}`, path)
    this._applyCavePathToExistingChunks(path)
  }

  getLastCavePath(): CavePath | null { return this._lastCavePath }
  getCavePathAt(wx: number, wy: number): CavePath | null {
    return this._cavesByPosition.get(`${Math.round(wx)},${Math.round(wy)}`) || null
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  update(camX: number, camY: number, screenW: number, screenH: number) {
    const buf    = CPW*4  // больший буфер — чанки строятся заранее
    const colMin = Math.floor((camX-buf)/CPW)
    const colMax = Math.ceil((camX+screenW+buf)/CPW)
    const rowMin = Math.max(0, Math.floor((camY-buf)/CPH))
    const rowMax = Math.ceil((camY+screenH+buf)/CPH)

    const needRebuild =
      !this.overridesBuilt ||
      colMin < this._ovColMin-2 || colMax > this._ovColMax+2 ||
      rowMin < this._ovRowMin-2 || rowMax > this._ovRowMax+2

    if (needRebuild) {
      const oc0=colMin-6, oc1=colMax+6, or0=rowMin, or1=rowMax+8
      const newOv=buildOverrides(oc0,or0,oc1,or1,this.seed,this.totalRows)
      for(const[k,v]of newOv)this.overrides.set(k,v)
      this._ovColMin=oc0;this._ovColMax=oc1;this._ovRowMin=or0;this._ovRowMax=or1
      this.overridesBuilt=true
    }

    for(let row=rowMin;row<=rowMax;row++)
      for(let col=colMin;col<=colMax;col++){
        const key=`${col}_${row}`
        if(!this.chunks.has(key)) this._buildChunk(col,row)
      }

    this._extendBg(colMin, colMax, rowMin, rowMax)

    const cull=6
    for(const[key,chunk]of this.chunks){
      if(chunk.col<colMin-cull||chunk.col>colMax+cull||
         chunk.row<rowMin-cull||chunk.row>rowMax+cull){
        this.container.removeChild(chunk.gfx)
        chunk.gfx.destroy({children:true})
        ;(chunk as any).maskRT?.destroy(true)
        ;(chunk as any).darkMaskRT?.destroy(true)
        ;(chunk as any).lavaRT?.destroy(true)
        this.chunks.delete(key)
      }
    }
  }

  private _extendBg(_colMin:number, _colMax:number, _rowMin:number, _rowMax:number) {
    // bgLight — бесконечный прямоугольник, _extendBg больше не нужен
  }

  invalidateOverrides() {
    this.overridesBuilt=false
    this._ovColMin=this._ovColMax=this._ovRowMin=this._ovRowMax=0
  }

  private _buildChunk(col: number, row: number) {
    const key  = `${col}_${row}`
    const offX = col*CPW, offY = row*CPH

    const content = new PIXI.Container()

    if (TileWorld.groundTex) {
      const spr = new PIXI.TilingSprite(TileWorld.groundTex, CPW, CPH)
      spr.tileScale.set(TILE/TileWorld.groundTex.width, TILE/TileWorld.groundTex.height)
      content.addChild(spr)
    } else {
      const fb = new PIXI.Graphics()
      fb.beginFill(0x5a2d14).drawRect(0,0,CPW,CPH).endFill()
      content.addChild(fb)
    }

    if (row===0 && TileWorld.grassTex) {
      const spr = new PIXI.TilingSprite(TileWorld.grassTex, CPW, TILE)
      spr.tileScale.set(TILE/TileWorld.grassTex.width, TILE/TileWorld.grassTex.height)
      content.addChild(spr)
    }

    const maskRT  = PIXI.RenderTexture.create({width:CPW, height:CPH})
    const maskSpr = new PIXI.Sprite(maskRT)
    maskSpr.renderable = false

    const darkMaskRT  = PIXI.RenderTexture.create({width:CPW, height:CPH})
    const darkMaskSpr = new PIXI.Sprite(darkMaskRT)
    darkMaskSpr.renderable = false

    const lavaRT      = PIXI.RenderTexture.create({width:CPW, height:CPH})
    const lavaMaskSpr = new PIXI.Sprite(lavaRT)
    lavaMaskSpr.renderable = false

    if (this.renderer) {
      const wh = new PIXI.Graphics().beginFill(0xffffff).drawRect(0,0,CPW,CPH).endFill()
      this.renderer.render(wh, {renderTexture:maskRT, clear:true})
      this.renderer.render(wh, {renderTexture:darkMaskRT, clear:true})
      wh.destroy()
      const bl = new PIXI.Graphics().beginFill(0x000000).drawRect(0,0,CPW,CPH).endFill()
      this.renderer.render(bl, {renderTexture:lavaRT, clear:true})
      bl.destroy()
    }

    // Тёмный фон чанка (0x4E312B) — виден везде, скрывается в туннеле/пещере
    const darkBg = new PIXI.Graphics()
    darkBg.beginFill(0x4E312B).drawRect(0, 0, CPW, CPH).endFill()
    darkBg.mask = darkMaskSpr

    const lavaContainer = new PIXI.Container()
    lavaContainer.mask  = lavaMaskSpr

    for (const cave of this._pendingCaves) {
      this._applyCavePathToChunk(cave, col, row, maskRT, darkMaskRT, lavaRT, lavaContainer, offX, offY)
    }

    content.mask = maskSpr

    const container = new PIXI.Container()
    container.x = offX; container.y = offY
    container.addChild(lavaContainer)
    container.addChild(darkBg)
    container.addChild(darkMaskSpr)
    container.addChild(content)
    container.addChild(maskSpr)
    container.addChild(lavaMaskSpr)

    this.container.addChild(container)
    this.chunks.set(key, {gfx:container, col, row, ...{maskRT, darkMaskRT, lavaRT}} as any)
  }

  private _applyCavePathToChunk(
    cave: CavePath,
    col: number, row: number,
    maskRT: PIXI.RenderTexture,
    darkMaskRT: PIXI.RenderTexture | null,
    lavaRT: PIXI.RenderTexture,
    lavaContainer: PIXI.Container,
    offX: number, offY: number
  ) {
    if (!this.renderer) return

    const g = this._caveGfx
    g.clear()
    let hasContent = false

    // ── Рисуем настоящими капсулами (полигон по контуру) ────────────────────
    if (cave.points.length === 1) {
      const p  = cave.points[0]
      const lx = p.x - offX, ly = p.y - offY
      if (lx + p.r >= 0 && lx - p.r <= CPW && ly + p.r >= 0 && ly - p.r <= CPH) {
        hasContent = true
        g.beginFill(0x000000).drawCircle(lx, ly, p.r).endFill()
      }
    } else {
      for (let i = 0; i < cave.points.length - 1; i++) {
        const a   = cave.points[i]
        const b   = cave.points[i + 1]
        const lax = a.x - offX, lay = a.y - offY
        const lbx = b.x - offX, lby = b.y - offY

        // Пропускаем если капсула полностью вне чанка
        const minX = Math.min(lax, lbx) - Math.max(a.r, b.r)
        const maxX = Math.max(lax, lbx) + Math.max(a.r, b.r)
        const minY = Math.min(lay, lby) - Math.max(a.r, b.r)
        const maxY = Math.max(lay, lby) + Math.max(a.r, b.r)
        if (maxX < 0 || minX > CPW || maxY < 0 || minY > CPH) continue

        hasContent = true
        // Настоящая капсула — плавный контур без артефактов на стыках
        drawCapsule(g, lax, lay, a.r, lbx, lby, b.r, 0x000000)
      }
    }

    if (!hasContent) return

    this.renderer.render(g, { renderTexture: maskRT, clear: false })

    // Стираем тёмный фон пещеры (чёрный → darkBg скрывается → виден bgLight)
    if (darkMaskRT) {
      const gDark = new PIXI.Graphics()
      if (cave.points.length === 1) {
        const p = cave.points[0]
        gDark.beginFill(0x000000).drawCircle(p.x - offX, p.y - offY, Math.max(0, p.r - 10)).endFill()
      } else {
        for (let i = 0; i < cave.points.length - 1; i++) {
          const a = cave.points[i], b = cave.points[i + 1]
          const lax = a.x - offX, lay = a.y - offY
          const lbx = b.x - offX, lby = b.y - offY
          const minX = Math.min(lax,lbx)-Math.max(a.r,b.r), maxX = Math.max(lax,lbx)+Math.max(a.r,b.r)
          const minY = Math.min(lay,lby)-Math.max(a.r,b.r), maxY = Math.max(lay,lby)+Math.max(a.r,b.r)
          if (maxX < 0 || minX > CPW || maxY < 0 || minY > CPH) continue
          drawCapsule(gDark, lax, lay, Math.max(0,a.r-10), lbx, lby, Math.max(0,b.r-10), 0x000000)
        }
      }
      this.renderer.render(gDark, { renderTexture: darkMaskRT, clear: false })
      gDark.destroy()
    }

    // Белая маска для lavaRT — те же капсулы
    const gWhite = new PIXI.Graphics()
    if (cave.points.length === 1) {
      const p = cave.points[0]
      gWhite.beginFill(0xffffff).drawCircle(p.x - offX, p.y - offY, p.r).endFill()
    } else {
      for (let i = 0; i < cave.points.length - 1; i++) {
        const a = cave.points[i], b = cave.points[i + 1]
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
    this.renderer.render(gWhite, { renderTexture: lavaRT, clear: false })
    gWhite.destroy()

    if (this.lavaSimulation) {
      this.lavaSimulation.addLavaSource(cave.points, Math.random() * 0.6)
    }
  }

  updateLavas(deltaTime: number) {
    if (this.lavaSimulation) this.lavaSimulation.update(deltaTime)
  }

  destroy() {
    for(const c of this.chunks.values()){
      c.gfx.destroy({children:true})
      ;(c as any).maskRT?.destroy(true)
      ;(c as any).darkMaskRT?.destroy(true)
      ;(c as any).lavaRT?.destroy(true)
    }
    this.chunks.clear()
    this._pendingCaves.length = 0
    this.brush.destroy(); this.line.destroy()
    this._caveGfx.destroy()
    this.bgLight.destroy()
  }
}