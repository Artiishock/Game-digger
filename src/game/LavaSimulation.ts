import * as PIXI from 'pixi.js'
import { TILE } from './Tileworld'

/**
 * LavaSimulation — физическая симуляция течения лавы с эффектом metaballs
 *
 * Принцип metaballs:
 *   - Рисуем мягкие круглые блобы лавы в отдельный Container
 *   - BlurFilter размывает их, создавая градиентные хвосты
 *   - Кастомный threshold-шейдер обрезает по порогу → блобы сливаются
 *     в единую органическую массу, как настоящая жидкая лава
 */

export const CELL_PX  = TILE
const MAX_AMOUNT       = 1.0
const FLOW_SPEED       = 0.5
const MIN_FLOW         = 0.05
const GRAVITY_BIAS     = 0.8

// ── Metaball threshold fragment shader ────────────────────────────────────────
// Принимает размытую текстуру, обрезает по alpha-порогу, перекрашивает в лаву
const METABALL_FRAG = `
precision mediump float;

varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime;

void main(void) {
  vec4 col = texture2D(uSampler, vTextureCoord);

  // Порог metaball: всё что выше 0.35 alpha — считаем "внутри" лавы
  float alpha = col.a;
  float threshold = 0.35;

  if (alpha < threshold) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Нормализуем: 0=граница, 1=центр блоба
  float t = clamp((alpha - threshold) / (1.0 - threshold), 0.0, 1.0);

  // Анимированный шум для пульсации цвета
  float wave = sin(vTextureCoord.x * 18.0 + uTime * 1.8) 
             * cos(vTextureCoord.y * 14.0 + uTime * 1.3) * 0.15;
  t = clamp(t + wave, 0.0, 1.0);

  // Цветовой градиент: тёмный центр → ярко-оранжевый → красный край
  vec3 coreColor  = vec3(0.95, 0.35, 0.0);  // насыщенный оранжевый
  vec3 edgeColor  = vec3(0.75, 0.10, 0.0);  // тёмно-красный
  vec3 hotColor   = vec3(1.0,  0.75, 0.1);  // жёлтая горячая точка

  // Смешиваем: край → основа → горячее ядро
  vec3 lavaColor = mix(edgeColor, coreColor, smoothstep(0.0, 0.6, t));
  lavaColor      = mix(lavaColor, hotColor,  smoothstep(0.7, 1.0, t));

  // Блик на поверхности — тонкая светлая кромка
  float rim = smoothstep(0.35, 0.42, alpha) * (1.0 - smoothstep(0.42, 0.55, alpha));
  lavaColor += vec3(1.0, 0.9, 0.4) * rim * 0.6;

  gl_FragColor = vec4(lavaColor, 1.0);
}
`

export class LavaSimulation {
  private cells:    Map<string, { amount: number; open: boolean }> = new Map()
  private dirty:    Set<string> = new Set()

  // Публичный контейнер — добавляется в worldLayer вместо отдельных graphics
  readonly container: PIXI.Container

  // Внутренние слои
  private blobGfx:  PIXI.Graphics    // мягкие круглые блобы (до фильтра)
  private glowGfx:  PIXI.Graphics    // внешнее свечение (за пределами контейнера)

  // Для совместимости с GameRenderer — он добавляет эти два объекта
  get graphics(): PIXI.DisplayObject { return this.container }

  private _blurFilter:   PIXI.filters.BlurFilter
  private _threshFilter: PIXI.Filter
  private time: number = 0

  constructor() {
    // ── Metaball container (размытие + threshold) ──────────────────────────
    this.container = new PIXI.Container()
    this.blobGfx   = new PIXI.Graphics()
    this.container.addChild(this.blobGfx)

    // BlurFilter — размывает блобы, создавая перекрывающиеся градиенты
    this._blurFilter = new PIXI.filters.BlurFilter(18, 4)
    this._blurFilter.padding = 40

    // Threshold shader — превращает размытое пятно в чёткую органическую форму
    this._threshFilter = new PIXI.Filter(undefined, METABALL_FRAG, {
      uTime: 0.0,
    })

    this.container.filters = [this._blurFilter, this._threshFilter]

    // ── Внешнее свечение (не проходит через threshold) ────────────────────
    this.glowGfx = new PIXI.Graphics()
    this.glowGfx.alpha = 0.18
  }

  // GameRenderer вызывает lavaSimulation.glowGfx — отдаём отдельный объект свечения
  // (добавляется под container в worldLayer)

  openArea(wx: number, wy: number, r: number = 50) {
    const cr = Math.ceil(r / CELL_PX)
    const cx = Math.round(wx / CELL_PX)
    const cy = Math.round(wy / CELL_PX)
    for (let dy = -cr; dy <= cr; dy++) {
      for (let dx = -cr; dx <= cr; dx++) {
        if (dx*dx + dy*dy > cr*cr) continue
        const key = `${cx+dx},${cy+dy}`
        const cell = this.cells.get(key)
        if (cell) {
          cell.open = true
        } else {
          this.cells.set(key, { amount: 0, open: true })
        }
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

    const gx0 = Math.floor(minX / CELL_PX)
    const gx1 = Math.ceil(maxX  / CELL_PX)
    const gy0 = Math.floor(minY / CELL_PX)
    const gy1 = Math.ceil(maxY  / CELL_PX)

    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const px = gx * CELL_PX
        const py = gy * CELL_PX

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

  update(dt: number) {
    this.time += dt
    this._simulateFlow()
    this._render()
    // Обновляем uniform времени для анимации шейдера
    if (this._threshFilter.uniforms) {
      this._threshFilter.uniforms.uTime = this.time
    }
  }

  private _simulateFlow() {
    const lavaCells: Array<[string, number, number, number]> = []
    for (const [key, cell] of this.cells) {
      if (cell.amount < MIN_FLOW || !cell.open) continue
      const [gx, gy] = key.split(',').map(Number)
      lavaCells.push([key, gx, gy, cell.amount])
    }

    lavaCells.sort((a, b) => b[2] - a[2])

    for (const [key, gx, gy, amount] of lavaCells) {
      const cell = this.cells.get(key)
      if (!cell || cell.amount < MIN_FLOW) continue

      const downKey = `${gx},${gy+1}`
      const down = this.cells.get(downKey)
      if (down?.open && down.amount < MAX_AMOUNT) {
        const flow = Math.min(cell.amount * GRAVITY_BIAS, (MAX_AMOUNT - down.amount) * GRAVITY_BIAS * 1.2)
        if (flow > MIN_FLOW) {
          cell.amount  -= flow
          down.amount  += flow
          this.dirty.add(key); this.dirty.add(downKey)
          if (cell.amount < MIN_FLOW) continue
        }
      }

      if (down && (!down.open || down.amount >= MAX_AMOUNT - MIN_FLOW)) {
        const dlKey = `${gx-1},${gy+1}`
        const drKey = `${gx+1},${gy+1}`
        const dl = this.cells.get(dlKey)
        const dr = this.cells.get(drKey)
        const canL = dl?.open && (dl.amount ?? MAX_AMOUNT) < MAX_AMOUNT - MIN_FLOW
        const canR = dr?.open && (dr.amount ?? MAX_AMOUNT) < MAX_AMOUNT - MIN_FLOW
        if (canL && canR) {
          const flow = Math.min(cell.amount * 0.6, FLOW_SPEED * 1.3)
          if (flow > MIN_FLOW) {
            cell.amount -= flow
            dl!.amount  += flow * 0.5
            dr!.amount  += flow * 0.5
            this.dirty.add(key); this.dirty.add(dlKey); this.dirty.add(drKey)
            if (cell.amount < MIN_FLOW) continue
          }
        } else if (canL) {
          const flow = Math.min(cell.amount * 0.6, FLOW_SPEED * 1.2)
          if (flow > MIN_FLOW) { cell.amount -= flow; dl!.amount += flow; this.dirty.add(key); this.dirty.add(dlKey) }
          if (cell.amount < MIN_FLOW) continue
        } else if (canR) {
          const flow = Math.min(cell.amount * 0.6, FLOW_SPEED * 1.2)
          if (flow > MIN_FLOW) { cell.amount -= flow; dr!.amount += flow; this.dirty.add(key); this.dirty.add(drKey) }
          if (cell.amount < MIN_FLOW) continue
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
          cell.amount -= flow
          side.amount += flow
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

  private _render() {
    this.blobGfx.clear()
    this.glowGfx.clear()

    const cs = CELL_PX

    for (const [key, cell] of this.cells) {
      if (cell.amount < MIN_FLOW) continue

      const [gx, gy] = key.split(',').map(Number)
      const cx = gx * cs + cs / 2
      const cy = gy * cs + cs / 2

      // Радиус блоба зависит от amount — больше лавы → больший блоб
      // Чуть больше клетки чтобы соседи перекрывались и сливались
      const r = cs * (0.55 + cell.amount * 0.25)

      // Рисуем белый/непрозрачный круг — threshold shader покрасит сам
      // alpha = amount чтобы центр был плотнее краёв
      this.blobGfx.beginFill(0xFFFFFF, cell.amount)
      this.blobGfx.drawCircle(cx, cy, r)
      this.blobGfx.endFill()

      // Внешнее свечение — за пределами metaball контейнера
      this.glowGfx.beginFill(0xFF6600, 0.06 * cell.amount)
      this.glowGfx.drawCircle(cx, cy, r * 1.8)
      this.glowGfx.endFill()
    }
  }

  /**
   * Проверяет, касается ли точка (мировые координаты) лавы.
   * Возвращает true если в любой из ячеек в радиусе charRadius есть лава.
   */
  touchesPoint(wx: number, wy: number, charRadius: number = CELL_PX): boolean {
    const cr = Math.ceil(charRadius / CELL_PX)
    const cx = Math.round(wx / CELL_PX)
    const cy = Math.round(wy / CELL_PX)
    for (let dy = -cr; dy <= cr; dy++) {
      for (let dx = -cr; dx <= cr; dx++) {
        const cell = this.cells.get(`${cx + dx},${cy + dy}`)
        if (cell && cell.amount >= 0.3) return true
      }
    }
    return false
  }

  destroy() {
    this.container.destroy({ children: true })
    this.glowGfx.destroy()
    this.cells.clear()
  }

  cullFarCells(camX: number, camY: number, viewW: number, viewH: number) {
    const margin = CELL_PX * 30
    const gx0 = Math.floor((camX - margin) / CELL_PX)
    const gx1 = Math.ceil((camX + viewW + margin) / CELL_PX)
    const gy0 = Math.floor((camY - margin) / CELL_PX)
    const gy1 = Math.ceil((camY + viewH + margin) / CELL_PX)

    for (const key of this.cells.keys()) {
      const [gx, gy] = key.split(',').map(Number)
      if (gx < gx0 || gx > gx1 || gy < gy0 || gy > gy1) {
        this.cells.delete(key)
      }
    }
  }
}