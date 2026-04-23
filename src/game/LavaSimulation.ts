import * as PIXI from 'pixi.js'
import { GameAssets } from './gameAssets'
import { GameConfig } from './GameConfig'

export const CELL_PX = 40

/** Овал в мире: rx поперёк (ux,uy), ry вдоль. */
function ellipsePolyRotWorld(
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
  const out: number[] = []
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const ca = Math.cos(a), sa = Math.sin(a)
    out.push(cx + rx * ca * px + ry * sa * tx, cy + rx * ca * py + ry * sa * ty)
  }
  return out
}

const SIM_CELL     = CELL_PX / 2   // 20px
const MAX_AMOUNT   = 1.0
const MIN_FLOW     = 0.04
const FLOW_SPEED   = 0.45
const GRAVITY_BIAS = 0.85

const METABALL_FRAG = `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime;

void main(void) {
  vec4 col = texture2D(uSampler, vTextureCoord);
  float alpha = col.a;
  float threshold = 0.35;
  if (alpha < threshold) { gl_FragColor = vec4(0.0); return; }

  float t = clamp((alpha - threshold) / (1.0 - threshold), 0.0, 1.0);
  float wave = sin(vTextureCoord.x * 18.0 + uTime * 1.8)
             * cos(vTextureCoord.y * 14.0 + uTime * 1.3) * 0.15;
  t = clamp(t + wave, 0.0, 1.0);

  vec3 coreColor = vec3(0.95, 0.35, 0.0);
  vec3 edgeColor = vec3(0.75, 0.10, 0.0);
  vec3 hotColor  = vec3(1.0,  0.75, 0.1);
  vec3 lavaColor = mix(edgeColor, coreColor, smoothstep(0.0, 0.6, t));
  lavaColor      = mix(lavaColor, hotColor,  smoothstep(0.7, 1.0, t));
  float rim = smoothstep(0.35, 0.42, alpha) * (1.0 - smoothstep(0.42, 0.55, alpha));
  lavaColor += vec3(1.0, 0.9, 0.4) * rim * 0.6;
  gl_FragColor = vec4(lavaColor, 1.0);
}
`

export class LavaSimulation {
  private _texLayer:     PIXI.Container = new PIXI.Container()
  private _texMaskGfx:   PIXI.Graphics  = new PIXI.Graphics()
  private _tilingSprite: PIXI.TilingSprite | null = null
  private cells: Map<number, { amount: number; static?: boolean; gx: number; gy: number }> = new Map()
  private dirty: Set<number> = new Set()

  readonly container: PIXI.Container
  readonly glowGfx:   PIXI.Graphics

  private _inner:        PIXI.Container
  private blobGfx:       PIXI.Graphics
  private _caveMaskGfx:  PIXI.Graphics   // маска = форма пещеры
  private _texOffX = 0
  private _texOffY = 0
  private _camX = 0
  private _camY = 0
  /** Размер вьюпорта (экрана) для отсечения рендера — иначе перерисовываются все ячейки мира */
  private _viewW = 1920
  private _viewH = 1080
  private _blurFilter:   PIXI.BlurFilter
  private _threshFilter: PIXI.Filter
  private time = 0
  private _renderDirty = true
  private _lastRenderCamX = -Infinity
  private _lastRenderCamY = -Infinity

  /** Числовой ключ из координат сетки — избегаем аллокации строк и парсинга */
  private static _k(gx: number, gy: number): number {
    return ((gx + 65536) & 0x1FFFF) | (((gy + 65536) & 0x1FFFF) << 17)
  }

  constructor() {
    this.container = new PIXI.Container()
    this._inner    = new PIXI.Container()
    this.blobGfx   = new PIXI.Graphics()
    this._inner.addChild(this.blobGfx)

    // Слабее blur — заметно дешевле на GPU при большом числе метаболлов
    this._blurFilter         = new PIXI.BlurFilter(9, 3)
    this._blurFilter.padding = 28
    this._threshFilter       = new PIXI.Filter(undefined, METABALL_FRAG, { uTime: 0.0 })
    this._inner.filters      = [this._blurFilter, this._threshFilter]

    // _caveMaskGfx больше не нужен как маска — threshold шейдер сам обрезает
    // Лава ограничена через cells которые регистрируются только внутри пещер
    this._caveMaskGfx = new PIXI.Graphics()  // оставляем для совместимости методов
    this.container.addChild(this._inner)

    // Вариант A: TilingSprite поверх metaballs через MULTIPLY + маска из blobGfx
    this._texLayer   = new PIXI.Container()
    this._texMaskGfx = new PIXI.Graphics()
    this._texLayer.addChild(this._texMaskGfx)
    this._texLayer.mask = this._texMaskGfx
    this.container.addChild(this._texLayer)

    const proceduralTex = this._makeProceduralLavaTex()
    // Размер покрывает экран с запасом — позиция обновляется каждый кадр
    this._tilingSprite = new PIXI.TilingSprite(proceduralTex, 4096, 4096)
    this._tilingSprite.blendMode = PIXI.BLEND_MODES.MULTIPLY
    this._tilingSprite.alpha = 0.85
    this._texLayer.addChild(this._tilingSprite)
    PIXI.Texture.fromURL(GameAssets.lavaTex)
      .then(tex => { if (this._tilingSprite) this._tilingSprite.texture = tex })
      .catch(() => {})

    this.glowGfx       = new PIXI.Graphics()
    this.glowGfx.alpha = 0.18
  }

  // ── openArea: для туннеля игрока (scratchAt) ──────────────────────────────

  openArea(wx: number, wy: number, r: number) {
    this._registerCircleCells(wx, wy, r, undefined)
  }

  // ── addLavaSource: регистрирует капсулы и заливает лаву снизу вверх ───────


  // Генерирует процедурную текстуру лавы если файл не найден
  private _makeProceduralLavaTex(): PIXI.Texture {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size; canvas.height = size
    const ctx = canvas.getContext('2d')!

    // Тёмные прожилки на светлом фоне — через MULTIPLY дадут трещины в лаве
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)

    // Случайные тёмные вены
    const seed = 12345
    let s = seed
    const rng = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000 }

    for (let i = 0; i < 18; i++) {
      const x0 = rng() * size, y0 = rng() * size
      const x1 = x0 + (rng() - 0.5) * 120, y1 = y0 + (rng() - 0.5) * 120
      const w  = 4 + rng() * 12
      ctx.strokeStyle = `rgba(80, 20, 0, ${0.3 + rng() * 0.4})`
      ctx.lineWidth   = w
      ctx.lineCap     = 'round'
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
    }

    // Светлые горячие пятна
    for (let i = 0; i < 8; i++) {
      const x = rng() * size, y = rng() * size, r = 10 + rng() * 30
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
      grad.addColorStop(0, 'rgba(255,255,200,0.9)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = grad
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }

    return PIXI.Texture.from(canvas)
  }

  // Рисует форму пещеры в маску — лава не выходит за границы
  private _addCaveMask(points: Array<{x: number; y: number; r: number}>) {
    if (points.length === 0) return
    const g = this._caveMaskGfx
    if (points.length === 1) {
      const p = points[0]
      g.beginFill(0xffffff).drawCircle(p.x, p.y, p.r).endFill()
      return
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1]
      const dx = b.x - a.x, dy = b.y - a.y
      const len = Math.sqrt(dx*dx + dy*dy)
      if (len < 0.001) continue
      const STEPS = 10
      const verts: number[] = []
      for (let s = 0; s <= STEPS; s++) {
        const angle = Math.atan2(dy, dx) + Math.PI / 2 + (Math.PI / STEPS) * s
        verts.push(a.x + Math.cos(angle) * a.r, a.y + Math.sin(angle) * a.r)
      }
      for (let s = 0; s <= STEPS; s++) {
        const angle = Math.atan2(dy, dx) - Math.PI / 2 + (Math.PI / STEPS) * s
        verts.push(b.x + Math.cos(angle) * b.r, b.y + Math.sin(angle) * b.r)
      }
      g.beginFill(0xffffff).drawPolygon(verts).endFill()
    }
    // Круги на всех точках для ровных стыков
    for (const p of points) {
      g.beginFill(0xffffff).drawCircle(p.x, p.y, p.r).endFill()
    }
  }

  private _addCaveMaskRect(rect: { cx: number; cy: number; hw: number; hh: number; cr?: number }) {
    const g = this._caveMaskGfx
    const x = rect.cx - rect.hw
    const y = rect.cy - rect.hh
    const cr = Math.max(0, rect.cr ?? 0)
    if (cr > 0) (g as any).beginFill(0xffffff).drawRoundedRect(x, y, 2 * rect.hw, 2 * rect.hh, cr).endFill()
    else g.beginFill(0xffffff).drawRect(x, y, 2 * rect.hw, 2 * rect.hh).endFill()
  }

  /** Ячейки симуляции, центр которых попадает в axis-aligned прямоугольник (мир). */
  private _registerAabbCells(
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    cr: number,
    outKeys: Set<number>,
  ) {
    const minX = cx - hw
    const maxX = cx + hw
    const minY = cy - hh
    const maxY = cy + hh
    const gx0 = Math.floor(minX / SIM_CELL)
    const gx1 = Math.ceil(maxX / SIM_CELL)
    const gy0 = Math.floor(minY / SIM_CELL)
    const gy1 = Math.ceil(maxY / SIM_CELL)
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const px = gx * SIM_CELL + SIM_CELL / 2
        const py = gy * SIM_CELL + SIM_CELL / 2
        if (px < minX || px > maxX || py < minY || py > maxY) continue
        // Если есть скругление — выкидываем центры, попавшие в срезанные углы.
        if (cr > 0) {
          const dx = Math.abs(px - cx)
          const dy = Math.abs(py - cy)
          const ix = hw - cr
          const iy = hh - cr
          if (dx > ix && dy > iy) {
            const cx2 = dx - ix
            const cy2 = dy - iy
            if (cx2 * cx2 + cy2 * cy2 > cr * cr) continue
          }
        }
        const key = LavaSimulation._k(gx, gy)
        if (!this.cells.has(key)) this.cells.set(key, { amount: 0, gx, gy })
        outKeys.add(key)
      }
    }
  }

  // Открывает ячейки туннеля только если туннель пересекает ячейку с лавой (amount > 0)
  openAreaIfNearLava(wx: number, wy: number, rx: number, ry: number, ux: number, uy: number) {
    const rm = Math.max(rx, ry) + 4
    const cr = Math.ceil(rm / SIM_CELL) + 1
    const cx = Math.floor(wx / SIM_CELL)
    const cy = Math.floor(wy / SIM_CELL)

    // Проверяем есть ли рядом ячейки с реальной лавой (не просто зарегистрированные)
    let hasLavaNear = false
    for (let dy = -cr; dy <= cr && !hasLavaNear; dy++) {
      for (let dx = -cr; dx <= cr && !hasLavaNear; dx++) {
        const cell = this.cells.get(LavaSimulation._k(cx+dx, cy+dy))
        if (cell && cell.amount > 0.1) hasLavaNear = true
      }
    }
    if (!hasLavaNear) return

    // Регистрируем ячейки (по описанной окружности овала)
    this._registerCircleCells(wx, wy, rm, undefined)
    const steps = GameConfig.tunnelScratch.ellipsePolySteps ?? 36
    const poly = ellipsePolyRotWorld(wx, wy, rx, ry, ux, uy, steps)
    this._caveMaskGfx.beginFill(0xffffff).drawPolygon(poly).endFill()
  }

  addLavaSource(
    points: Array<{x: number; y: number; r: number}>,
    fillFraction = 0.75,
    opts?: { static?: boolean; rect?: { cx: number; cy: number; hw: number; hh: number; cr?: number } },
  ) {
    const rect = opts?.rect
    if (rect) {
      this._addCaveMaskRect(rect)
      const caveKeys = new Set<number>()
      this._registerAabbCells(rect.cx, rect.cy, rect.hw, rect.hh, Math.max(0, rect.cr ?? 0), caveKeys)
      if (caveKeys.size === 0) return
      for (const key of caveKeys) {
        const cell = this.cells.get(key)
        if (!cell) continue
        cell.amount = MAX_AMOUNT
        cell.static = true
        this.dirty.add(key)
      }
      this._renderDirty = true
      return
    }

    if (points.length === 0) return

    this._addCaveMask(points)

    const caveKeys = new Set<number>()

    if (points.length === 1) {
      this._registerCircleCells(points[0]!.x, points[0]!.y, points[0]!.r, caveKeys)
    } else {
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!, b = points[i + 1]!
        const r = (a.r + b.r) / 2
        this._registerCapsuleCells(a.x, a.y, b.x, b.y, r, caveKeys)
      }
      const last = points[points.length - 1]!
      this._registerCircleCells(last.x, last.y, last.r, caveKeys)
    }

    if (caveKeys.size === 0) return

    const byRow = new Map<number, number[]>()
    for (const key of caveKeys) {
      const cell = this.cells.get(key)
      if (!cell) continue
      if (!byRow.has(cell.gy)) byRow.set(cell.gy, [])
      byRow.get(cell.gy)!.push(cell.gx)
    }

    const allCells: [number, number][] = []
    for (const [gy, gxList] of byRow) {
      for (const gx of gxList) allCells.push([gx, gy])
    }
    allCells.sort((a, b) => a[1] - b[1])

    const n = allCells.length
    const fillCount = Math.max(1, Math.ceil(n * Math.min(0.99, fillFraction)))
    const topPart = Math.ceil(fillCount * 0.52)
    const botPart = fillCount - topPart
    const filledKeys = new Set<number>()
    for (let i = 0; i < topPart && i < n; i++) {
      const [gx, gy] = allCells[i]!
      const key = LavaSimulation._k(gx, gy)
      if (filledKeys.has(key)) continue
      filledKeys.add(key)
      const cell = this.cells.get(key)!
      cell.amount = MAX_AMOUNT
      this.dirty.add(key)
    }
    for (let j = 0; j < botPart && j < n; j++) {
      const [gx, gy] = allCells[n - 1 - j]!
      const key = LavaSimulation._k(gx, gy)
      if (filledKeys.has(key)) continue
      filledKeys.add(key)
      const cell = this.cells.get(key)!
      cell.amount = MAX_AMOUNT
      this.dirty.add(key)
    }

    const isStatic = !!opts?.static
    if (isStatic) {
      for (const key of caveKeys) {
        const c = this.cells.get(key)
        if (c) c.static = true
      }
    } else {
      this._warmUp(72)
    }

    if (!isStatic) {
      for (const key of caveKeys) {
        const cell = this.cells.get(key)
        if (cell && cell.amount < 0.01) {
          this.cells.delete(key)
        }
      }
    }
    this._renderDirty = true
  }

  // ── Регистрация ячеек по кругу ────────────────────────────────────────────

  private _registerCircleCells(wx: number, wy: number, r: number, outKeys?: Set<number>) {
    const cr  = Math.ceil(r / SIM_CELL) + 1
    const cx  = Math.floor(wx / SIM_CELL)
    const cy  = Math.floor(wy / SIM_CELL)
    const r2  = r * r
    for (let dy = -cr; dy <= cr; dy++) {
      for (let dx = -cr; dx <= cr; dx++) {
        const px = (cx + dx) * SIM_CELL + SIM_CELL / 2
        const py = (cy + dy) * SIM_CELL + SIM_CELL / 2
        const ddx = px - wx, ddy = py - wy
        if (ddx*ddx + ddy*ddy > r2) continue
        const key = LavaSimulation._k(cx+dx, cy+dy)
        if (!this.cells.has(key)) this.cells.set(key, { amount: 0, gx: cx+dx, gy: cy+dy })
        outKeys?.add(key)
      }
    }
  }

  // ── Регистрация ячеек по капсуле (отрезок A→B с радиусом r) ──────────────

  private _registerCapsuleCells(
    ax: number, ay: number,
    bx: number, by: number,
    r:  number,
    outKeys?: Set<number>
  ) {
    const minX = Math.min(ax, bx) - r
    const maxX = Math.max(ax, bx) + r
    const minY = Math.min(ay, by) - r
    const maxY = Math.max(ay, by) + r

    const gx0 = Math.floor(minX / SIM_CELL)
    const gx1 = Math.ceil (maxX / SIM_CELL)
    const gy0 = Math.floor(minY / SIM_CELL)
    const gy1 = Math.ceil (maxY / SIM_CELL)

    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const px = gx * SIM_CELL + SIM_CELL / 2
        const py = gy * SIM_CELL + SIM_CELL / 2
        if (this._distToSegment(px, py, ax, ay, bx, by) > r) continue
        const key = LavaSimulation._k(gx, gy)
        if (!this.cells.has(key)) this.cells.set(key, { amount: 0, gx, gy })
        outKeys?.add(key)
      }
    }
  }

  // ── Расстояние от точки до отрезка ───────────────────────────────────────


  // Заполняет пробелы между ячейками — гарантирует связность сетки
  private _fillGaps(keys: Set<number>) {
    let changed = true
    while (changed) {
      changed = false
      for (const key of keys) {
        const cell = this.cells.get(key)
        if (!cell) continue
        const gx = cell.gx, gy = cell.gy
        for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]] as const) {
          const nk = LavaSimulation._k(gx+dx, gy+dy)
          if (keys.has(nk)) continue
          let neighborCount = 0
          for (const [dx2, dy2] of [[0,1],[0,-1],[1,0],[-1,0]] as const) {
            if (keys.has(LavaSimulation._k(gx+dx+dx2, gy+dy+dy2))) neighborCount++
          }
          if (neighborCount >= 2) {
            keys.add(nk)
            if (!this.cells.has(nk)) this.cells.set(nk, { amount: 0, gx: gx+dx, gy: gy+dy })
            changed = true
          }
        }
      }
    }
  }

  private _distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay
    const len2 = dx*dx + dy*dy
    if (len2 === 0) return Math.sqrt((px-ax)**2 + (py-ay)**2)
    const t  = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / len2))
    const nx = ax + t*dx, ny = ay + t*dy
    return Math.sqrt((px-nx)**2 + (py-ny)**2)
  }

  // ── Прогрев ───────────────────────────────────────────────────────────────

  private _warmUp(steps: number) {
    for (let i = 0; i < steps; i++) this._flow(true)
    for (let i = 0; i < 20; i++)   this._flow(false)
    this.dirty.clear()
  }

  // ── Update ────────────────────────────────────────────────────────────────

  setCameraPos(camX: number, camY: number) {
    // Перерисовка нужна только если камера сдвинулась достаточно для изменения видимых ячеек
    if (Math.abs(camX - this._lastRenderCamX) > SIM_CELL * 2 ||
        Math.abs(camY - this._lastRenderCamY) > SIM_CELL * 2) {
      this._renderDirty = true
    }
    this._camX = camX
    this._camY = camY
  }

  setViewport(viewW: number, viewH: number) {
    this._viewW = Math.max(320, viewW)
    this._viewH = Math.max(240, viewH)
  }

  update(dt: number) {
    let hasFlowing = false
    for (const c of this.cells.values()) {
      if (!c.static && c.amount >= MIN_FLOW) {
        hasFlowing = true
        break
      }
    }
    if (hasFlowing) {
      this._flow(false)
      this.time += dt
      this._texOffX += dt * 6
      this._texOffY += dt * 3.5
    }
    this._render()
    this._threshFilter.uniforms.uTime = this.time
    if (this._tilingSprite) {
      // Спрайт следует за камерой — всегда покрывает видимую область
      this._tilingSprite.x = this._camX - 1024
      this._tilingSprite.y = this._camY - 1024
      this._tilingSprite.tilePosition.set(
        this._texOffX - this._camX,
        this._texOffY - this._camY
      )
    }

  }

  // ── Физика течения ────────────────────────────────────────────────────────

  private _flow(topDown: boolean) {
    const lavaCells: Array<[number, number, number]> = []
    for (const [key, cell] of this.cells) {
      if (cell.amount < MIN_FLOW) continue
      lavaCells.push([key, cell.gx, cell.gy])
    }
    lavaCells.sort((a, b) => topDown ? a[2] - b[2] : b[2] - a[2])

    for (const [key, gx, gy] of lavaCells) {
      const cell = this.cells.get(key)
      if (!cell || cell.amount < MIN_FLOW || cell.static) continue

      // Вниз
      const downKey = LavaSimulation._k(gx, gy+1)
      const down = this.cells.get(downKey)
      if (down && !down.static && down.amount < MAX_AMOUNT) {
        const flow = Math.min(cell.amount * GRAVITY_BIAS, (MAX_AMOUNT - down.amount) * GRAVITY_BIAS * 1.2)
        if (flow > MIN_FLOW) {
          cell.amount -= flow; down.amount += flow
          this.dirty.add(key); this.dirty.add(downKey)
          if (cell.amount < MIN_FLOW) continue
        }
      }

      // Диагональ вниз
      if (!down || down.static || down.amount >= MAX_AMOUNT - MIN_FLOW) {
        const dlKey = LavaSimulation._k(gx-1, gy+1), drKey = LavaSimulation._k(gx+1, gy+1)
        const dl = this.cells.get(dlKey), dr = this.cells.get(drKey)
        const canL = dl && !dl.static && dl.amount < MAX_AMOUNT - MIN_FLOW
        const canR = dr && !dr.static && dr.amount < MAX_AMOUNT - MIN_FLOW
        if (canL && canR) {
          const flow = Math.min(cell.amount * 0.6, FLOW_SPEED * 1.3)
          if (flow > MIN_FLOW) {
            cell.amount -= flow
            dl!.amount += flow * 0.5; dr!.amount += flow * 0.5
            this.dirty.add(key); this.dirty.add(dlKey); this.dirty.add(drKey)
          }
        } else if (canL) {
          const flow = Math.min(cell.amount * 0.6, FLOW_SPEED * 1.2)
          if (flow > MIN_FLOW) { cell.amount -= flow; dl!.amount += flow; this.dirty.add(key); this.dirty.add(dlKey) }
        } else if (canR) {
          const flow = Math.min(cell.amount * 0.6, FLOW_SPEED * 1.2)
          if (flow > MIN_FLOW) { cell.amount -= flow; dr!.amount += flow; this.dirty.add(key); this.dirty.add(drKey) }
        }
      }

      // Горизонталь
      for (const dx of [-1, 1]) {
        if (cell.amount < MIN_FLOW) break
        const sideKey = LavaSimulation._k(gx+dx, gy)
        const side = this.cells.get(sideKey)
        if (!side || side.static) continue
        const diff = cell.amount - side.amount
        if (diff > MIN_FLOW * 2) {
          const flow = diff * 0.35
          cell.amount -= flow; side.amount += flow
          this.dirty.add(key); this.dirty.add(sideKey)
        }
      }
    }

    for (const key of this.dirty) {
      const cell = this.cells.get(key)
      if (cell) cell.amount = Math.max(0, Math.min(MAX_AMOUNT, cell.amount))
    }
    this._renderDirty = true
    this.dirty.clear()
  }

  // ── Рендер ────────────────────────────────────────────────────────────────

  private _render() {
    if (!this._renderDirty) return
    this._renderDirty = false
    this._lastRenderCamX = this._camX
    this._lastRenderCamY = this._camY
    this.blobGfx.clear()
    this.glowGfx.clear()
    this._texMaskGfx.clear()

    const padPx = CELL_PX * 10 + this._blurFilter.padding * 2
    const minGX = Math.floor((this._camX - padPx) / SIM_CELL)
    const maxGX = Math.ceil ((this._camX + this._viewW + padPx) / SIM_CELL)
    const minGY = Math.floor((this._camY - padPx) / SIM_CELL)
    const maxGY = Math.ceil ((this._camY + this._viewH + padPx) / SIM_CELL)

    for (const [_key, cell] of this.cells) {
      if (cell.amount < MIN_FLOW) continue
      if (cell.gx < minGX || cell.gx > maxGX || cell.gy < minGY || cell.gy > maxGY) continue
      const gx = cell.gx, gy = cell.gy
      const cx = gx * SIM_CELL + SIM_CELL / 2
      const cy = gy * SIM_CELL + SIM_CELL / 2
      const r  = SIM_CELL * (0.6 + cell.amount * 0.25)

      this.blobGfx.beginFill(0xFFFFFF, cell.amount)
      this.blobGfx.drawCircle(cx, cy, r)
      this.blobGfx.endFill()

      this.glowGfx.beginFill(0xFF6600, 0.06 * cell.amount)
      this.glowGfx.drawCircle(cx, cy, r * 1.8)
      this.glowGfx.endFill()

      this._texMaskGfx.beginFill(0xFFFFFF, 1.0)
      this._texMaskGfx.drawCircle(cx, cy, r)
      this._texMaskGfx.endFill()
    }
  }

  // ── Коллизия ──────────────────────────────────────────────────────────────

  touchesPoint(wx: number, wy: number, charRadius: number = CELL_PX * 0.45): boolean {
    const gx = Math.round(wx / SIM_CELL)
    const gy = Math.round(wy / SIM_CELL)
    const cr = Math.ceil(charRadius / SIM_CELL) + 1
    for (let dy = -cr; dy <= cr; dy++) {
      for (let dx = -cr; dx <= cr; dx++) {
        const cell = this.cells.get(LavaSimulation._k(gx+dx, gy+dy))
        if (!cell || cell.amount < 0.5) continue
        const cx  = (gx+dx) * SIM_CELL + SIM_CELL / 2
        const cy2 = (gy+dy) * SIM_CELL + SIM_CELL / 2
        const r   = SIM_CELL * (0.6 + cell.amount * 0.25)
        const ddx = wx - cx, ddy = wy - cy2
        if (ddx*ddx + ddy*ddy < (r + charRadius) * (r + charRadius)) return true
      }
    }
    return false
  }

  /** Проверка траектории за кадр — при большом gameDt не «проскакиваем» лаву между точками. */
  touchesSegment(ax: number, ay: number, bx: number, by: number, charRadius: number = CELL_PX * 0.45): boolean {
    if (this.touchesPoint(ax, ay, charRadius) || this.touchesPoint(bx, by, charRadius)) return true
    const dx = bx - ax, dy = by - ay
    const len = Math.hypot(dx, dy)
    if (len < 1e-4) return false
    const step = SIM_CELL * 0.35
    const n = Math.min(40, Math.max(2, Math.ceil(len / step)))
    for (let i = 1; i < n; i++) {
      const t = i / n
      if (this.touchesPoint(ax + dx * t, ay + dy * t, charRadius)) return true
    }
    return false
  }

  // ── Culling ───────────────────────────────────────────────────────────────

  cullFarCells(camX: number, camY: number, viewW: number, viewH: number) {
    // Высокие пещеры: узкий margin по Y обрезал лаву ровной линией и «съедал» симуляцию вне кадра.
    const marginX = Math.max(CELL_PX * 40, viewW * 6)
    const marginY = Math.max(CELL_PX * 120, viewH * 22)
    const gx0 = Math.floor((camX - marginX) / SIM_CELL)
    const gx1 = Math.ceil ((camX + viewW + marginX) / SIM_CELL)
    const gy0 = Math.floor((camY - marginY) / SIM_CELL)
    const gy1 = Math.ceil ((camY + viewH + marginY) / SIM_CELL)
    // Статическая декоративная лава далеко от камеры — удаляем, иначе карта ячеек растёт без лимита
    const statPadX = Math.max(CELL_PX * 55, viewW * 8)
    const statPadY = Math.max(CELL_PX * 160, viewH * 20)
    const sx0 = Math.floor((camX - statPadX) / SIM_CELL)
    const sx1 = Math.ceil ((camX + viewW + statPadX) / SIM_CELL)
    const sy0 = Math.floor((camY - statPadY) / SIM_CELL)
    const sy1 = Math.ceil ((camY + viewH + statPadY) / SIM_CELL)
    for (const [key, cell] of this.cells) {
      const gx = cell.gx, gy = cell.gy
      if (cell.static) {
        if (gx >= sx0 && gx <= sx1 && gy >= sy0 && gy <= sy1) continue
        this.cells.delete(key)
        continue
      }
      if (gx >= gx0 && gx <= gx1 && gy >= gy0 && gy <= gy1) continue
      const loose =
        gx >= gx0 - 80 && gx <= gx1 + 80 &&
        gy >= gy0 - 120 && gy <= gy1 + 120
      if (loose && cell && cell.amount >= MIN_FLOW) continue
      this.cells.delete(key)
    }
  }

  destroy() {
    this._blurFilter.destroy()
    this._threshFilter.destroy()
    this._texMaskGfx.destroy()
    this._caveMaskGfx.destroy()
    this.blobGfx.destroy()
    if (this._tilingSprite) { this._tilingSprite.destroy(); this._tilingSprite = null }
    this.container.destroy({ children: true })
    this.glowGfx.destroy()
    this.cells.clear()
  }
}