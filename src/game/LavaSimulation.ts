import * as PIXI from 'pixi.js'
import { GameAssets } from './gameAssets'
import { GameConfig } from './GameConfig'
import { perf } from '../dev/PerfProfiler'

/** Размер клетки (px) — хитбокс героя и шаг субсэмпла `touchesSegment`. */
export const CELL_PX = 40

export type LavaPoolRect = { cx: number; cy: number; hw: number; hh: number; cr?: number }

type StaticPool = { cx: number; cy: number; hw: number; hh: number; cr: number }

/**
 * Визуал лавы в пещере: TilingSprite + маска по скруглённым прямоугольникам бассейнов.
 * Коллизии и декор — по тем же бассейнам (без сеточной «физики» потока).
 */
export class LavaSimulation {
  private _texLayer!: PIXI.Container
  private _texMaskGfx!: PIXI.Graphics
  private _tilingSprite: PIXI.TilingSprite | null = null

  readonly container: PIXI.Container

  private _caveMaskGfx: PIXI.Graphics
  private _texOffX = 0
  private _texOffY = 0
  private _camX = 0
  private _camY = 0
  private _viewW = 1920
  private _viewH = 1080
  private _destroyed = false

  private _pools: StaticPool[] = []
  private _lastRenderCamX = Infinity
  private _lastRenderCamY = Infinity

  constructor() {
    this.container = new PIXI.Container()

    this._texLayer = new PIXI.Container()
    this._texMaskGfx = new PIXI.Graphics()
    this._texLayer.addChild(this._texMaskGfx)
    this._texLayer.mask = this._texMaskGfx
    this.container.addChild(this._texLayer)

    this._caveMaskGfx = new PIXI.Graphics()
    this.container.addChild(this._caveMaskGfx)
    this.container.mask = this._caveMaskGfx

    const proceduralTex = this._makeProceduralLavaTex()
    const tw = Math.max(1024, GameConfig.lava.tilingWidthPx)
    const th = Math.max(1024, GameConfig.lava.tilingHeightPx)
    this._tilingSprite = new PIXI.TilingSprite(proceduralTex, tw, th)
    this._tilingSprite.blendMode = PIXI.BLEND_MODES.NORMAL
    this._tilingSprite.alpha = 0.92
    this._texLayer.addChild(this._tilingSprite)
    PIXI.Texture.fromURL(GameAssets.lavaTex)
      .then(tex => { if (this._tilingSprite) this._tilingSprite.texture = tex })
      .catch(() => {})
  }

  private _makeProceduralLavaTex(): PIXI.Texture {
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size; canvas.height = size
    const ctx = canvas.getContext('2d')!

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)

    const seed = 12345
    let s = seed
    const rng = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000 }

    for (let i = 0; i < 18; i++) {
      const x0 = rng() * size, y0 = rng() * size
      const x1 = x0 + (rng() - 0.5) * 120, y1 = y0 + (rng() - 0.5) * 120
      const w = 4 + rng() * 12
      ctx.strokeStyle = `rgba(80, 20, 0, ${0.3 + rng() * 0.4})`
      ctx.lineWidth = w
      ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
    }

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

  private _addCaveMaskRect(rect: StaticPool) {
    const g = this._caveMaskGfx
    const x = rect.cx - rect.hw
    const y = rect.cy - rect.hh
    const cr = Math.max(0, rect.cr)
    if (cr > 0) (g as any).beginFill(0xffffff).drawRoundedRect(x, y, 2 * rect.hw, 2 * rect.hh, cr).endFill()
    else g.beginFill(0xffffff).drawRect(x, y, 2 * rect.hw, 2 * rect.hh).endFill()
  }

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

  /** Одна лавовая пещера: геометрия пещеры в маску контейнера + бассейн для текстуры и хитов. */
  addStaticLavaPool(rect: LavaPoolRect) {
    const cr0 = Math.max(0, rect.cr ?? 0)
    const pool: StaticPool = { cx: rect.cx, cy: rect.cy, hw: rect.hw, hh: rect.hh, cr: cr0 }
    this._addCaveMaskRect(pool)
    this._pools.push(pool)
    this._lastRenderCamX = Infinity
    this._lastRenderCamY = Infinity
  }

  setCameraPos(camX: number, camY: number) {
    this._camX = camX
    this._camY = camY
  }

  setViewport(viewW: number, viewH: number) {
    this._viewW = Math.max(320, viewW)
    this._viewH = Math.max(240, viewH)
  }

  hasRenderableLava(): boolean {
    return this._pools.length > 0
  }

  update(dt: number) {
    if (this._destroyed) return
    if (!this.hasRenderableLava()) {
      if (this.container.visible) this.container.visible = false
      return
    }
    if (!this.container.visible) this.container.visible = true

    this._texOffX += dt * 6
    this._texOffY += dt * 3.5

    const movedX = Math.abs(this._camX - this._lastRenderCamX)
    const movedY = Math.abs(this._camY - this._lastRenderCamY)
    if (movedX > CELL_PX * 2 || movedY > CELL_PX * 2) {
      this._lastRenderCamX = this._camX
      this._lastRenderCamY = this._camY
      const _tr = perf.begin('lava.render', 1)
      this._render()
      perf.end('lava.render', _tr)
    }

    if (this._destroyed) return
    if (this._tilingSprite) {
      const tw = this._tilingSprite.width
      const th = this._tilingSprite.height
      const mx = Math.max(64, (tw - this._viewW) * 0.5)
      const my = Math.max(64, (th - this._viewH) * 0.5)
      this._tilingSprite.x = this._camX - mx
      this._tilingSprite.y = this._camY - my
      this._tilingSprite.tilePosition.set(
        this._texOffX - this._camX,
        this._texOffY - this._camY,
      )
    }
  }

  private _render() {
    if (this._destroyed) return
    const g = this._texMaskGfx
    g.clear()

    const padPx = CELL_PX * 8
    const vx0 = this._camX - padPx
    const vx1 = this._camX + this._viewW + padPx
    const vy0 = this._camY - padPx
    const vy1 = this._camY + this._viewH + padPx

    g.beginFill(0xffffff, 1)
    for (const r of this._pools) {
      const x = r.cx - r.hw
      const y = r.cy - r.hh
      const w = 2 * r.hw
      const h = 2 * r.hh
      if (x + w < vx0 || x > vx1 || y + h < vy0 || y > vy1) continue
      if (r.cr > 0) (g as any).drawRoundedRect(x, y, w, h, r.cr)
      else g.drawRect(x, y, w, h)
    }
    g.endFill()
  }

  getPerfSnapshot(): { lavaCells: number; staticLavaPools: number } {
    return { lavaCells: 0, staticLavaPools: this._pools.length }
  }

  decorBlocksSpawnAt(wx: number, wy: number, w = 0, h = 0): boolean {
    const hit = (px: number, py: number): boolean => {
      for (const r of this._pools) {
        if (this._pointInRoundedRect(px, py, r.cx, r.cy, r.hw, r.hh, r.cr)) return true
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
    for (const r of this._pools) {
      const ew = r.hw + charRadius
      const eh = r.hh + charRadius
      const ecr = Math.min(r.cr + charRadius, Math.min(ew, eh))
      if (this._pointInRoundedRect(wx, wy, r.cx, r.cy, ew, eh, ecr)) return true
    }
    return false
  }

  touchesSegment(ax: number, ay: number, bx: number, by: number, charRadius: number = CELL_PX * 0.45): boolean {
    if (this.touchesPoint(ax, ay, charRadius) || this.touchesPoint(bx, by, charRadius)) return true
    const dx = bx - ax, dy = by - ay
    const len = Math.hypot(dx, dy)
    if (len < 1e-4) return false
    const step = (CELL_PX * 0.5) * 0.35
    const n = Math.min(40, Math.max(2, Math.ceil(len / step)))
    for (let i = 1; i < n; i++) {
      const t = i / n
      if (this.touchesPoint(ax + dx * t, ay + dy * t, charRadius)) return true
    }
    return false
  }

  reset() {
    if (this._destroyed) return
    this._pools.length = 0
    this._caveMaskGfx.clear()
    this._texMaskGfx.clear()
    this._texOffX = 0
    this._texOffY = 0
    this._lastRenderCamX = Infinity
    this._lastRenderCamY = Infinity
    this.container.visible = false
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    this.container.destroy({ children: true })
    this._tilingSprite = null
    this._pools.length = 0
  }
}
