import * as PIXI from 'pixi.js'
import { GameAssets } from './gameAssets'
import { perf } from '../dev/PerfProfiler'

export const CELL_PX = 40

const SIM_CELL     = CELL_PX / 2   // 20px
const MAX_AMOUNT   = 1.0
const MIN_FLOW     = 0.04
const FLOW_SPEED   = 0.45
const GRAVITY_BIAS = 0.85

export class LavaSimulation {
  private _texLayer!:     PIXI.Container
  private _texMaskGfx!:   PIXI.Graphics
  private _tilingSprite: PIXI.TilingSprite | null = null
  private cells: Map<string, { amount: number; static?: boolean }> = new Map()
  private dirty: Set<string> = new Set()

  readonly container: PIXI.Container

  private _caveMaskGfx:  PIXI.Graphics   // маска = форма пещеры
  private _texOffX = 0
  private _texOffY = 0
  private _camX = 0
  private _camY = 0
  /** Размер вьюпорта (экрана) для отсечения рендера — иначе перерисовываются все ячейки мира */
  private _viewW = 1920
  private _viewH = 1080
  private time = 0
  private _destroyed = false
  /** Прямоугольные «бассейны» со скруглением — маска текстуры и коллизия по полной форме (без дыр в углах от сетки). */
  private _fullStaticLavaRects: Array<{ cx: number; cy: number; hw: number; hh: number; cr: number }> = []

  constructor() {
    this.container = new PIXI.Container()

    // Только TilingSprite + маска по ячейкам (без метаболов / blur / шейдера).
    this._texLayer   = new PIXI.Container()
    this._texMaskGfx = new PIXI.Graphics()
    this._texLayer.addChild(this._texMaskGfx)
    this._texLayer.mask = this._texMaskGfx
    this.container.addChild(this._texLayer)

    this._caveMaskGfx = new PIXI.Graphics()
    this.container.addChild(this._caveMaskGfx)
    this.container.mask = this._caveMaskGfx

    const proceduralTex = this._makeProceduralLavaTex()
    this._tilingSprite = new PIXI.TilingSprite(proceduralTex, 4096, 4096)
    this._tilingSprite.blendMode = PIXI.BLEND_MODES.NORMAL
    this._tilingSprite.alpha = 0.92
    this._texLayer.addChild(this._tilingSprite)
    PIXI.Texture.fromURL(GameAssets.lavaTex)
      .then(tex => { if (this._tilingSprite) this._tilingSprite.texture = tex })
      .catch(() => {})
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

  /** Точка внутри скруглённого прямоугольника (центр cx,cy, полуразмеры hw/hh, радиус угла cr). */
  private _pointInRoundedRect(
    px: number,
    py: number,
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    cr: number,
  ): boolean {
    const dx = Math.abs(px - cx)
    const dy = Math.abs(py - cy)
    if (dx > hw || dy > hh) return false
    const iw = hw - cr
    const ih = hh - cr
    if (cr <= 0 || dx <= iw || dy <= ih) return true
    const qx = dx - iw
    const qy = dy - ih
    return qx * qx + qy * qy <= cr * cr
  }

  /** Центр клетки (gx,gy) уже внутри статического бассейна — дублировать rect в маске не нужно. */
  private _cellCenterInsideAnyStaticPool(gx: number, gy: number): boolean {
    if (this._fullStaticLavaRects.length === 0) return false
    const px = gx * SIM_CELL + SIM_CELL / 2
    const py = gy * SIM_CELL + SIM_CELL / 2
    for (const r of this._fullStaticLavaRects) {
      if (this._pointInRoundedRect(px, py, r.cx, r.cy, r.hw, r.hh, r.cr)) return true
    }
    return false
  }

  /** Ячейки симуляции, центр которых попадает в axis-aligned прямоугольник (мир). */
  private _registerAabbCells(
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    cr: number,
    outKeys: Set<string>,
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
        const key = `${gx},${gy}`
        if (!this.cells.has(key)) this.cells.set(key, { amount: 0 })
        outKeys.add(key)
      }
    }
  }

  // Открывает ячейки туннеля только если туннель пересекает ячейку с лавой (amount > 0)
  openAreaIfNearLava(wx: number, wy: number, rx: number, ry: number, _ux: number, _uy: number) {
    const rm = Math.max(rx, ry) + 4
    const cr = Math.ceil(rm / SIM_CELL) + 1
    const cx = Math.floor(wx / SIM_CELL)
    const cy = Math.floor(wy / SIM_CELL)

    // Проверяем есть ли рядом ячейки с реальной лавой (не просто зарегистрированные)
    let hasLavaNear = false
    for (let dy = -cr; dy <= cr && !hasLavaNear; dy++) {
      for (let dx = -cr; dx <= cr && !hasLavaNear; dx++) {
        const cell = this.cells.get(`${cx+dx},${cy+dy}`)
        if (cell && cell.amount > 0.1) hasLavaNear = true
      }
    }
    if (!hasLavaNear) return

    // Регистрируем ячейки для физики течения (лава статичная, но коллизия нужна).
    // Маску пещеры НЕ расширяем — статичная лава не вытекает за пределы rect-зоны.
    this._registerCircleCells(wx, wy, rm, undefined)
  }

  addLavaSource(
    points: Array<{x: number; y: number; r: number}>,
    fillFraction = 0.75,
    opts?: { static?: boolean; rect?: { cx: number; cy: number; hw: number; hh: number; cr?: number } },
  ) {
    const rect = opts?.rect
    if (rect) {
      this._addCaveMaskRect(rect)
      const cr0 = Math.max(0, rect.cr ?? 0)
      this._fullStaticLavaRects.push({
        cx: rect.cx,
        cy: rect.cy,
        hw: rect.hw,
        hh: rect.hh,
        cr: cr0,
      })
      const caveKeys = new Set<string>()
      this._registerAabbCells(rect.cx, rect.cy, rect.hw, rect.hh, cr0, caveKeys)
      if (caveKeys.size === 0) return
      for (const key of caveKeys) {
        const cell = this.cells.get(key)
        if (!cell) continue
        cell.amount = MAX_AMOUNT
        cell.static = true
        this.dirty.add(key)
      }
      return
    }

    if (points.length === 0) return

    this._addCaveMask(points)

    const caveKeys = new Set<string>()

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
      const [gx, gy] = key.split(',').map(Number)
      if (!byRow.has(gy)) byRow.set(gy, [])
      byRow.get(gy)!.push(gx)
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
    const filledKeys = new Set<string>()
    for (let i = 0; i < topPart && i < n; i++) {
      const [gx, gy] = allCells[i]!
      const key = `${gx},${gy}`
      if (filledKeys.has(key)) continue
      filledKeys.add(key)
      const cell = this.cells.get(key)!
      cell.amount = MAX_AMOUNT
      this.dirty.add(key)
    }
    for (let j = 0; j < botPart && j < n; j++) {
      const [gx, gy] = allCells[n - 1 - j]!
      const key = `${gx},${gy}`
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
  }

  // ── Регистрация ячеек по кругу ────────────────────────────────────────────

  private _registerCircleCells(wx: number, wy: number, r: number, outKeys?: Set<string>) {
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
        const key = `${cx+dx},${cy+dy}`
        if (!this.cells.has(key)) this.cells.set(key, { amount: 0 })
        outKeys?.add(key)
      }
    }
  }

  // ── Регистрация ячеек по капсуле (отрезок A→B с радиусом r) ──────────────

  private _registerCapsuleCells(
    ax: number, ay: number,
    bx: number, by: number,
    r:  number,
    outKeys?: Set<string>
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
        const key = `${gx},${gy}`
        if (!this.cells.has(key)) this.cells.set(key, { amount: 0 })
        outKeys?.add(key)
      }
    }
  }

  // ── Расстояние от точки до отрезка ───────────────────────────────────────


  // Заполняет пробелы между ячейками — гарантирует связность сетки
  private _fillGaps(keys: Set<string>) {
    let changed = true
    while (changed) {
      changed = false
      for (const key of keys) {
        const [gx, gy] = key.split(',').map(Number)
        for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
          const nk = `${gx+dx},${gy+dy}`
          if (keys.has(nk)) continue
          // Если у соседа есть ещё один сосед из keys — заполняем пробел
          let neighborCount = 0
          for (const [dx2, dy2] of [[0,1],[0,-1],[1,0],[-1,0]]) {
            if (keys.has(`${gx+dx+dx2},${gy+dy+dy2}`)) neighborCount++
          }
          if (neighborCount >= 2) {
            keys.add(nk)
            if (!this.cells.has(nk)) this.cells.set(nk, { amount: 0 })
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
    this._camX = camX
    this._camY = camY
  }

  setViewport(viewW: number, viewH: number) {
    this._viewW = Math.max(320, viewW)
    this._viewH = Math.max(240, viewH)
  }

  /** Есть что рисовать или крутить в симуляции (без полного скана сетки по viewport). */
  hasRenderableLava(): boolean {
    if (this._fullStaticLavaRects.length > 0) return true
    for (const c of this.cells.values()) {
      if (c.amount >= MIN_FLOW) return true
    }
    return false
  }

  update(dt: number) {
    if (this._destroyed) return
    if (!this.hasRenderableLava()) {
      if (this.container.visible) this.container.visible = false
      return
    }
    if (!this.container.visible) this.container.visible = true

    let hasFlowing = false
    for (const c of this.cells.values()) {
      if (!c.static && c.amount >= MIN_FLOW) {
        hasFlowing = true
        break
      }
    }
    const _tf = perf.begin('lava.flow', 1)
    if (hasFlowing) {
      this._flow(false)
    }
    perf.end('lava.flow', _tf)
    // Текстура лавы должна "жить" всегда, даже у статичных источников (пещер).
    this.time += dt
    this._texOffX += dt * 6
    this._texOffY += dt * 3.5
    const _tr = perf.begin('lava.render', 1)
    this._render()
    perf.end('lava.render', _tr)
    if (this._destroyed) return
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
    const lavaCells: Array<[string, number, number]> = []
    for (const [key, cell] of this.cells) {
      // Статика не течёт — не тащим тысячи декоративных ячеек через сортировку и проход.
      if (cell.static || cell.amount < MIN_FLOW) continue
      const [gx, gy] = key.split(',').map(Number)
      lavaCells.push([key, gx, gy])
    }
    lavaCells.sort((a, b) => topDown ? a[2] - b[2] : b[2] - a[2])

    for (const [key, gx, gy] of lavaCells) {
      const cell = this.cells.get(key)
      if (!cell || cell.amount < MIN_FLOW || cell.static) continue

      // Вниз
      const downKey = `${gx},${gy+1}`
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
        const dlKey = `${gx-1},${gy+1}`, drKey = `${gx+1},${gy+1}`
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
        const sideKey = `${gx+dx},${gy}`
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
    this.dirty.clear()
  }

  // ── Рендер ────────────────────────────────────────────────────────────────

  private _render() {
    if (this._destroyed) return
    const g = this._texMaskGfx
    g.clear()

    const padPx = CELL_PX * 8
    const vx0 = this._camX - padPx
    const vx1 = this._camX + this._viewW + padPx
    const vy0 = this._camY - padPx
    const vy1 = this._camY + this._viewH + padPx

    // Один beginFill/endFill: меньше state changes в Graphics; ячейки под статическими бассейнами не дублируем.
    g.beginFill(0xffffff, 1)
    for (const r of this._fullStaticLavaRects) {
      const x = r.cx - r.hw
      const y = r.cy - r.hh
      const w = 2 * r.hw
      const h = 2 * r.hh
      if (r.cr > 0) (g as any).drawRoundedRect(x, y, w, h, r.cr)
      else g.drawRect(x, y, w, h)
    }
    // Только ячейки из Map в окне камеры — O(кол-во ячеек лавы), а не O(площадь viewport).
    for (const [key, cell] of this.cells) {
      if (cell.static || cell.amount < MIN_FLOW) continue
      const comma = key.indexOf(',')
      const gx = +key.slice(0, comma)
      const gy = +key.slice(comma + 1)
      const x0 = gx * SIM_CELL
      const y0 = gy * SIM_CELL
      if (x0 + SIM_CELL < vx0 || x0 > vx1 || y0 + SIM_CELL < vy0 || y0 > vy1) continue
      if (this._cellCenterInsideAnyStaticPool(gx, gy)) continue
      g.drawRect(x0, y0, SIM_CELL, SIM_CELL)
    }
    g.endFill()
  }

  // ── Коллизия ──────────────────────────────────────────────────────────────

  /** Снимок для __DR_PERF__: размер сетки лавы и статические бассейны. */
  getPerfSnapshot(): { lavaCells: number; staticLavaPools: number } {
    return {
      lavaCells: this.cells.size,
      staticLavaPools: this._fullStaticLavaRects.length,
    }
  }

  /**
   * Быстрая проверка для спавнера (много раз за кадр): пересечение с лавой.
   * Без sqrt по кругам ячеек — статические бассейны + сетка 3×3 вокруг точки (и углы AABB декора).
   */
  decorBlocksSpawnAt(wx: number, wy: number, w = 0, h = 0): boolean {
    const hit = (px: number, py: number): boolean => {
      for (const r of this._fullStaticLavaRects) {
        if (this._pointInRoundedRect(px, py, r.cx, r.cy, r.hw, r.hh, r.cr)) return true
      }
      const gx = Math.floor(px / SIM_CELL)
      const gy = Math.floor(py / SIM_CELL)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cell = this.cells.get(`${gx + dx},${gy + dy}`)
          if (cell && cell.amount >= MIN_FLOW) return true
        }
      }
      return false
    }
    const hw = w > 2 ? w * 0.5 : 0
    const hh = h > 2 ? h * 0.5 : 0
    if (hw <= 0 && hh <= 0) return hit(wx, wy)
    return (
      hit(wx, wy) ||
      hit(wx - hw, wy - hh) ||
      hit(wx + hw, wy - hh) ||
      hit(wx - hw, wy + hh) ||
      hit(wx + hw, wy + hh)
    )
  }

  touchesPoint(wx: number, wy: number, charRadius: number = CELL_PX * 0.45): boolean {
    for (const r of this._fullStaticLavaRects) {
      if (this._pointInRoundedRect(wx, wy, r.cx, r.cy, r.hw, r.hh, r.cr)) return true
    }
    const gx = Math.round(wx / SIM_CELL)
    const gy = Math.round(wy / SIM_CELL)
    const cr = Math.ceil(charRadius / SIM_CELL) + 1
    for (let dy = -cr; dy <= cr; dy++) {
      for (let dx = -cr; dx <= cr; dx++) {
        const cell = this.cells.get(`${gx+dx},${gy+dy}`)
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
    if (this.cells.size === 0 && this._fullStaticLavaRects.length === 0) return

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
    // _fullStaticLavaRects не режем здесь: иначе при отъезде камеры пропадает маска текстуры,
    // хотя _caveMaskGfx и геометрия пещеры остаются — при возврате будут щели.

    for (const key of this.cells.keys()) {
      const [gx, gy] = key.split(',').map(Number)
      const cell = this.cells.get(key)
      if (cell?.static) {
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

  /**
   * Сбрасывает состояние симуляции для повторного использования между раундами.
   * Контейнер и текстуры не пересоздаются — только чистим данные и графику.
   */
  reset() {
    if (this._destroyed) return
    this.cells.clear()
    this.dirty.clear()
    this._fullStaticLavaRects.length = 0
    this._caveMaskGfx.clear()
    this._texMaskGfx.clear()
    this.time = 0
    this._texOffX = 0
    this._texOffY = 0
    this.container.visible = false
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    this.container.destroy({ children: true })
    this._tilingSprite = null
    this.cells.clear()
  }
}