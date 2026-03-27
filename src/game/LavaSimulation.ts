import * as PIXI from 'pixi.js'
import { TILE } from './Tileworld'

export const CELL_PX  = TILE
const MAX_AMOUNT       = 1.0
const FLOW_SPEED       = 0.5
const MIN_FLOW         = 0.05
const GRAVITY_BIAS     = 0.8

interface LavaCell {
  amount: number
  open:   boolean
}

export class LavaSimulation {
  private cells: Map<string, LavaCell> = new Map()
  private dirty: Set<string>           = new Set()

  // Публичный контейнер — GameRenderer добавляет его в worldLayer
  readonly container: PIXI.Container

  // Внешнее свечение — GameRenderer добавляет его ПОД container
  readonly glowGfx: PIXI.Graphics

  // Внутренние объекты
  private lavaSprite:  PIXI.TilingSprite | null = null
  private fallbackGfx: PIXI.Graphics | null = null

  // Маска: Graphics добавленный в container — в PixiJS7 маска обязана быть в display tree
  private maskGfx: PIXI.Graphics

  // Дымок поверх
  private steamGfx: PIXI.Graphics

  private time        = 0
  private _texOffsetX = 0
  private _texOffsetY = 0

  constructor() {
    this.container = new PIXI.Container()
    this.glowGfx   = new PIXI.Graphics()
    this.glowGfx.alpha = 0.20

    // maskGfx — должен быть в display tree в PixiJS 7, иначе маска не работает
    this.maskGfx = new PIXI.Graphics()
    this.container.addChild(this.maskGfx)

    this.steamGfx = new PIXI.Graphics()
    this.steamGfx.alpha = 0.22
    this.container.addChild(this.steamGfx)

    // Загружаем текстуру
    this._loadTexture()
  }

  private async _loadTexture() {
    try {
      const tex = await PIXI.Texture.fromURL('./lava_texture.png')

      // TilingSprite покрывает большую область — маска ограничит видимую зону
      this.lavaSprite = new PIXI.TilingSprite(tex, 8192, 8192)
      this.lavaSprite.tileScale.set(0.50, 0.50)
      this.lavaSprite.x = -4096
      this.lavaSprite.y = -4096

      // Вставляем ПОД steamGfx
      this.container.addChildAt(this.lavaSprite, 0)

      // Применяем маску — maskGfx не в display tree, это правильно для PixiJS7
      this.lavaSprite.mask = this.maskGfx

    } catch (e) {
      console.warn('[LavaSimulation] lava_texture.png не найден, используем fallback')

      // Fallback: оранжевый прямоугольник с маской
      this.fallbackGfx = new PIXI.Graphics()
      this.fallbackGfx.beginFill(0xFF5500)
      this.fallbackGfx.drawRect(-4096, -4096, 8192, 8192)
      this.fallbackGfx.endFill()
      this.container.addChildAt(this.fallbackGfx, 0)
      this.fallbackGfx.mask = this.maskGfx
    }
  }

  // ── API ───────────────────────────────────────────────────────────────────

  openArea(wx: number, wy: number, r: number = 50) {
    const cr = Math.ceil(r / CELL_PX)
    const cx = Math.round(wx / CELL_PX)
    const cy = Math.round(wy / CELL_PX)
    for (let dy = -cr; dy <= cr; dy++) {
      for (let dx = -cr; dx <= cr; dx++) {
        if (dx*dx + dy*dy > cr*cr) continue
        const key = `${cx+dx},${cy+dy}`
        const cell = this.cells.get(key)
        if (cell) { cell.open = true }
        else       { this.cells.set(key, { amount: 0, open: true }) }
        this.dirty.add(key)
      }
    }
  }

  fillCave(points: Array<{x: number; y: number; r: number}>, fillFraction = 0.5) {
    if (points.length === 0) return

    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    for (const p of points) {
      minX = Math.min(minX, p.x - p.r); maxX = Math.max(maxX, p.x + p.r)
      minY = Math.min(minY, p.y - p.r); maxY = Math.max(maxY, p.y + p.r)
    }
    const fillTop = minY + (maxY - minY) * (1 - fillFraction)

    const gx0 = Math.floor(minX / CELL_PX), gx1 = Math.ceil(maxX / CELL_PX)
    const gy0 = Math.floor(minY / CELL_PX), gy1 = Math.ceil(maxY / CELL_PX)

    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const px = gx * CELL_PX, py = gy * CELL_PX
        let inside = false
        for (const p of points) {
          const dx = px - p.x, dy = py - p.y
          if (dx*dx + dy*dy <= p.r*p.r) { inside = true; break }
        }
        if (!inside) continue
        const key = `${gx},${gy}`
        const amount = py >= fillTop ? MAX_AMOUNT : 0
        const existing = this.cells.get(key)
        if (existing) {
          existing.open = true
          if (amount > existing.amount) existing.amount = amount
        } else {
          this.cells.set(key, { amount, open: true })
        }
        this.dirty.add(key)
      }
    }
  }

  // ── Главный update ────────────────────────────────────────────────────────

  update(dt: number) {
    this.time += dt
    this._simulateFlow()
    this._render(dt)
  }

  // ── Физика течения ────────────────────────────────────────────────────────

  private _simulateFlow() {
    const lavaCells: Array<[string, number, number, number]> = []
    for (const [key, cell] of this.cells) {
      if (cell.amount < MIN_FLOW || !cell.open) continue
      const [gx, gy] = key.split(',').map(Number)
      lavaCells.push([key, gx, gy, cell.amount])
    }
    lavaCells.sort((a, b) => b[2] - a[2])

    for (const [key, gx, gy] of lavaCells) {
      const cell = this.cells.get(key)
      if (!cell || cell.amount < MIN_FLOW) continue

      const downKey = `${gx},${gy+1}`
      const down = this.cells.get(downKey)
      if (down?.open && down.amount < MAX_AMOUNT) {
        const flow = Math.min(cell.amount * GRAVITY_BIAS, (MAX_AMOUNT - down.amount) * GRAVITY_BIAS * 1.2)
        if (flow > MIN_FLOW) {
          cell.amount -= flow; down.amount += flow
          this.dirty.add(key); this.dirty.add(downKey)
          if (cell.amount < MIN_FLOW) continue
        }
      }

      if (down && (!down.open || down.amount >= MAX_AMOUNT - MIN_FLOW)) {
        const dlKey = `${gx-1},${gy+1}`, drKey = `${gx+1},${gy+1}`
        const dl = this.cells.get(dlKey), dr = this.cells.get(drKey)
        const canL = dl?.open && (dl.amount ?? MAX_AMOUNT) < MAX_AMOUNT - MIN_FLOW
        const canR = dr?.open && (dr.amount ?? MAX_AMOUNT) < MAX_AMOUNT - MIN_FLOW
        if (canL && canR) {
          const flow = Math.min(cell.amount * 0.6, FLOW_SPEED * 1.3)
          if (flow > MIN_FLOW) {
            cell.amount -= flow; dl!.amount += flow * 0.5; dr!.amount += flow * 0.5
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

      for (const dx of [-1, 1]) {
        if (cell.amount < MIN_FLOW) break
        const sideKey = `${gx+dx},${gy}`
        const side = this.cells.get(sideKey)
        if (!side?.open) continue
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

  private _render(dt: number) {
    // Очищаем маску и вспомогательные слои
    this.maskGfx.clear()
    this.steamGfx.clear()
    this.glowGfx.clear()

    // Медленная прокрутка текстуры — эффект течения лавы
    if (this.lavaSprite) {
      this._texOffsetX += dt * 6
      this._texOffsetY += dt * 3.5
      this.lavaSprite.tilePosition.set(this._texOffsetX, this._texOffsetY)
    }

    const cs = CELL_PX
    let hasAnyLava = false

    for (const [key, cell] of this.cells) {
      if (cell.amount < MIN_FLOW) continue
      hasAnyLava = true

      const [gx, gy] = key.split(',').map(Number)
      const cx = gx * cs + cs / 2
      const cy = gy * cs + cs / 2

      // Радиус чуть больше клетки → соседние клетки перекрываются и сливаются
      const r = cs * (0.65 + cell.amount * 0.22)

      // Рисуем в маску — НЕ нужен blur/threshold, простые круги дают
      // достаточно органичную форму для текстурного подхода
      this.maskGfx.beginFill(0xFFFFFF, 1.0)
      this.maskGfx.drawCircle(cx, cy, r)
      this.maskGfx.endFill()

      // Мягкое внешнее свечение (оранжевое)
      this.glowGfx.beginFill(0xFF6600, 0.07 * cell.amount)
      this.glowGfx.drawCircle(cx, cy, r * 2.0)
      this.glowGfx.endFill()

      // Дымок только на поверхностных клетках (нет лавы выше)
      const aboveKey = `${gx},${gy-1}`
      const above = this.cells.get(aboveKey)
      const isSurface = !above || above.amount < MIN_FLOW
      if (isSurface && cell.amount > 0.35) {
        const t  = this.time * 0.85 + gx * 1.7
        const sx = cx + Math.sin(t) * 5
        const sy = cy - cs * 0.40
        const sa = 0.14 * cell.amount * (0.5 + Math.sin(this.time * 2.2 + gx) * 0.5)
        this.steamGfx.beginFill(0xCCBBAA, sa)
        this.steamGfx.drawEllipse(sx, sy, 7, 11)
        this.steamGfx.endFill()
      }
    }

    // Показываем/скрываем контейнер
    this.container.visible = hasAnyLava
    this.glowGfx.visible   = hasAnyLava
  }

  // ── Коллизия ──────────────────────────────────────────────────────────────

  touchesPoint(wx: number, wy: number, charRadius: number = CELL_PX): boolean {
    const cr = Math.ceil(charRadius / CELL_PX)
    const cx = Math.round(wx / CELL_PX)
    const cy = Math.round(wy / CELL_PX)
    for (let dy = -cr; dy <= cr; dy++) {
      for (let dx = -cr; dx <= cr; dx++) {
        const cell = this.cells.get(`${cx+dx},${cy+dy}`)
        if (cell && cell.amount >= 0.3) return true
      }
    }
    return false
  }

  cullFarCells(camX: number, camY: number, viewW: number, viewH: number) {
    const margin = CELL_PX * 30
    const gx0 = Math.floor((camX - margin) / CELL_PX)
    const gx1 = Math.ceil((camX + viewW + margin) / CELL_PX)
    const gy0 = Math.floor((camY - margin) / CELL_PX)
    const gy1 = Math.ceil((camY + viewH + margin) / CELL_PX)
    for (const key of this.cells.keys()) {
      const [gx, gy] = key.split(',').map(Number)
      if (gx < gx0 || gx > gx1 || gy < gy0 || gy > gy1) this.cells.delete(key)
    }
  }

  destroy() {
    this.maskGfx.destroy()
    this.container.destroy({ children: true })
    this.glowGfx.destroy()
    this.cells.clear()
  }
}