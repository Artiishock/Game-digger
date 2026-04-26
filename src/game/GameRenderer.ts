import * as PIXI from 'pixi.js'
import { initDevtools } from '@pixi/devtools'
import { gameEngine }   from './GameEngine'
import { useGameStore } from '../store/gameStore'
import type { RoundEvent, EventType } from '../rgs/client'
import { TileWorld, TILE } from './Tileworld'
import { LavaSimulation } from './LavaSimulation'
import { SpineAnimator, HERO_ANIM, ROCK_ANIM, GOLD_ANIM, GOLD_STAGE, STONE_STAGE, BREAK_ACTION_DURATION, getSpineItemSize } from './SpineAnimator'
import type { Spine } from 'pixi-spine'
import { GameConfig, HERO_MAX_SIDE_PX } from './GameConfig'
import { gameAudio } from '../audio/GameAudio'
import { GameAssets } from './gameAssets'
import { buildRoundPathV2, buildRoundPathV3, cavePathHitsTunnel } from './WorldMap'
import type { FullPathResult, PathPoint, RoadPoint } from './WorldMap'

// ── Переключение варианта пути ──────────────────────────────────────────────
// 'V2' = Коридор + сетка (плавный путь с синусоидальным блужданием)
// 'V3' = Path-as-sequence (более случайное блуждание, сетка ячеек)
const PATH_VARIANT: 'V2' | 'V3' = 'V2'
const buildRoundPath = PATH_VARIANT === 'V2' ? buildRoundPathV2 : buildRoundPathV3

const STEP_PATH_Y = TILE * GameConfig.spawn.intervalTiles
/** На сколько тайлов ниже стартового экрана начинаем спавнить предметы. */
const START_SPAWN_OFFSCREEN_TILES = 1.5
/** Стартовые точки туннеля должны быть близко к месту начала копания. */
const START_PATH_SOFTEN_POINTS = 8
const START_PATH_MAX_DX_PX = TILE * 0.85

/** X на оси туннеля для произвольной глубины (линейная интерполяция по сегментам path). */
function pathXAtWorldY(wy: number, path: PathPoint[], surfY: number): number {
  if (path.length === 0) return 0
  if (path.length === 1) return path[0]!.x
  const p0 = path[0]!
  if (wy <= p0.y) return p0.x
  const pl = path[path.length - 1]!
  if (wy >= pl.y) return pl.x
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!, b = path[i + 1]!
    if (wy <= b.y) {
      const dy = b.y - a.y
      const t = dy > 1e-6 ? (wy - a.y) / dy : 0
      return a.x + t * (b.x - a.x)
    }
  }
  return pl.x
}

/** Длина дуги до заданной глубины Y (монотонно по пути сверху вниз). */
function tunnelArcLengthAtWorldY(wy: number, path: PathPoint[], cum: number[]): number {
  if (path.length === 0 || cum.length === 0) return 0
  if (path.length === 1) return 0
  const p0 = path[0]!
  if (wy <= p0.y) return 0
  const lastIdx = path.length - 1
  const pl = path[lastIdx]!
  if (wy >= pl.y) return cum[lastIdx] ?? 0
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!, b = path[i + 1]!
    if (wy <= b.y) {
      const dy = b.y - a.y
      const t = dy > 1e-6 ? (wy - a.y) / dy : 0
      const segLen = (cum[i + 1] ?? cum[i] ?? 0) - (cum[i] ?? 0)
      return (cum[i] ?? 0) + segLen * t
    }
  }
  return cum[lastIdx] ?? 0
}

/** Префиксные длины вдоль полилинии: cum[i] = длина от path[0] до path[i]. */
function tunnelPathCumulativeLengths(path: PathPoint[]): number[] {
  if (path.length === 0) return []
  const cum: number[] = [0]
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!, b = path[i + 1]!
    cum.push(cum[i]! + Math.hypot(b.x - a.x, b.y - a.y))
  }
  return cum
}

/** Точка на туннеле на расстоянии s по дуге от начала + единичная касательная (направление движения). */
function pointOnTunnelAtArcLength(
  path: PathPoint[],
  cum: number[],
  s: number,
): { x: number; y: number; nx: number; ny: number } {
  if (path.length === 0) return { x: 0, y: 0, nx: 0, ny: 1 }
  const p0 = path[0]!
  if (path.length === 1) return { x: p0.x, y: p0.y, nx: 0, ny: 1 }
  const total = cum[cum.length - 1]!
  const clampedS = Math.max(0, Math.min(s, total))
  let i = 0
  while (i < path.length - 1 && cum[i + 1]! < clampedS) i++
  const a = path[i]!, b = path[i + 1]!
  const segLen = cum[i + 1]! - cum[i]!
  const t = segLen > 1e-6 ? (clampedS - cum[i]!) / segLen : 0
  const x = a.x + (b.x - a.x) * t
  const y = a.y + (b.y - a.y) * t
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x, y, nx: dx / len, ny: dy / len }
}

/** Ближайшая длина дуги до (wx, wy) — для старта и синхронизации после пещеры / брейка. */
function projectWorldXYToTunnelArcLength(path: PathPoint[], cum: number[], wx: number, wy: number): number {
  if (path.length === 0) return 0
  if (path.length === 1) return 0
  let bestS = 0
  let bestD2 = Infinity
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!, b = path[i + 1]!
    const segLen = cum[i + 1]! - cum[i]!
    const dx = b.x - a.x, dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 > 1e-6
      ? ((wx - a.x) * dx + (wy - a.y) * dy) / len2
      : 0
    const tt = Math.max(0, Math.min(1, t))
    const px = a.x + tt * dx, py = a.y + tt * dy
    const d2 = (wx - px) ** 2 + (wy - py) ** 2
    if (d2 < bestD2) {
      bestD2 = d2
      bestS = cum[i]! + tt * segLen
    }
  }
  return bestS
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const C = {
  skyDeep:0x1a3a5c, sky:0x5BA3DC, grass:0x7CB944, grassEdge:0x5a8a30,
  coin:0xFFD700, gold:0xFFB830, diamond:0x4ECDC4, bomb:0x222222,
  stone:0x888888, lava:0xFF4500, lavaGlow:0xFF8C00, bg:0x1A0E08,
  skin:0xF5CBA7, skinDk:0xD4A574, shirt:0x3498DB, shirtDk:0x2176AE,
  pants:0x2C3E50, boots:0x5D4037, helmet:0xFFB830, helmetRim:0xCC8800,
  lamp:0xFFFF99, axeShaft:0x6B4226, axeBlade:0xAAAAAA, axeShine:0xDDDDDD,
  dirtChunk:0x8B5E3C,
  particleColors:{
    COIN:0xFFD700,GOLD:0xFFB830,DIAMOND:0x4ECDC4,
    BOMB:0xFF4500,STONE:0x888888,LAVA:0xFF4500,HOME:0x7CFC00,
  } as Record<EventType,number>,
}

const CHAR_SPEED = GameConfig.movement.charSpeed
const IDLE_SPEED = GameConfig.movement.idleSpeed
const COLL_R  = TILE * GameConfig.collision.radiusTiles

/** Масштаб PNG пикапов (текстура → мир). Якорь 0.5 — центр совпадает с маркером и коллизией. */
const PICKUP_SPRITE_SCALE = 0.150

/**
 * gold.png / stone.png — холст 220×249; у coin/bomb/gem шире/выше → при одном scale золото и камень мельче.
 * Крути здесь, чтобы визуально догнать остальные пикапы.
 */
const PICKUP_SCALE_GOLD_STONE_MUL = 2.6

function pickupTextureScale(type: EventType): number {
  if (type === 'GOLD' || type === 'STONE') return PICKUP_SPRITE_SCALE * PICKUP_SCALE_GOLD_STONE_MUL
  return PICKUP_SPRITE_SCALE
}

const LIVE_WIN_BADGE_OFFSET_Y = -20
const LIVE_WIN_AMOUNT_OFFSET_Y = 21

function formatLiveWinAmount(value: number, currency: string): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0
  const display = safeValue >= 100
    ? safeValue.toFixed(0)
    : safeValue.toFixed(2)
  return `${display} ${currency || 'FUN'}`
}

// ─── SpriteCharacter (PNG hero) ──────────────────────────────────────────────

/**
 * Масштаб героя: `HERO_MAX_SIDE_PX` из GameConfig (= TILE×1.1) — та же величина, что полная ширина выкопа.
 * Раньше якорь был у ног (0.88); после смены на центр компенсируем сдвигом, чтобы ноги остались у корня.
 */
const HERO_LEGACY_FEET_ANCHOR_Y = 0.88
/**
 * PNG: вид сбоку, бур снизу. Вращение вокруг центра текстуры; «вперёд по копанию» по-прежнему вдоль локального +Y.
 * Угол касательной (nx,ny): atan2(ny,nx) + GameConfig.hero.drillFacingOffsetRad.
 */
const HERO_SPINE_SCALE = HERO_MAX_SIDE_PX / GameConfig.hero.spineRefHeightPx

class SpriteCharacter {
  root: PIXI.Container
  chunkParent: PIXI.Container | null = null
  private _spr: PIXI.Sprite | null = null
  private _spine: Spine | null = null
  /** Сдвиг по Y: центр текстуры → прежняя точка у ног остаётся в origin корня. */
  private _pivotFootCompensateY = 0
  /** Текущий поворот (рад). */
  private _facingRad = 0
  private _activeAnim = ''
  private _animHoldSec = 0
  private _dieLocked = false

  constructor() {
    this.root = new PIXI.Container()
  }

  private _setAnim(name: string, loop = true): void {
    if (!this._spine) return
    if (this._activeAnim === name) return
    if (!this._spine.spineData.findAnimation(name)) return
    SpineAnimator.setAnimation(this._spine, name, loop)
    this._activeAnim = name
  }

  private _setYOffset(active: boolean): void {
    if (this._spr) {
      this._spr.y =
        this._pivotFootCompensateY +
        (active ? GameConfig.hero.dig.spriteOffsetYPx : GameConfig.hero.idle.spriteOffsetYPx)
    }
    if (this._spine) {
      this._spine.y = active ? GameConfig.hero.dig.spriteOffsetYPx : GameConfig.hero.idle.spriteOffsetYPx
    }
  }

  setHeroSpine(spine: Spine | null): boolean {
    if (!spine) return false
    if (this._spr) {
      this.root.removeChild(this._spr)
      this._spr.destroy()
      this._spr = null
    }
    if (this._spine) {
      this.root.removeChild(this._spine)
      SpineAnimator.remove(this._spine)
      this._spine.destroy()
      this._spine = null
    }
    spine.scale.set(HERO_SPINE_SCALE)
    spine.rotation = this._facingRad
    this._spine = spine
    this._activeAnim = ''
    this._dieLocked = false
    this._animHoldSec = 0
    this._setYOffset(false)
    this._setAnim(HERO_ANIM.idle, true)
    this.root.addChild(spine)
    return true
  }

  setHeroTexture(tex: PIXI.Texture | null) {
    if (this._spine) {
      this.root.removeChild(this._spine)
      SpineAnimator.remove(this._spine)
      this._spine.destroy()
      this._spine = null
      this._activeAnim = ''
      this._animHoldSec = 0
      this._dieLocked = false
    }
    if (this._spr) {
      this.root.removeChild(this._spr)
      this._spr.destroy()
      this._spr = null
    }
    if (!tex) return
    const s = new PIXI.Sprite(tex)
    s.anchor.set(0.5, 0.5)
    const sc = HERO_MAX_SIDE_PX / Math.max(tex.width, tex.height)
    s.scale.set(sc)
    const h = tex.height * sc
    this._pivotFootCompensateY = (HERO_LEGACY_FEET_ANCHOR_Y - 0.5) * h
    this._setYOffset(false)
    this._spr = s
    this.root.addChild(s)
    this._spr.y = this._pivotFootCompensateY + GameConfig.hero.idle.spriteOffsetYPx
  }

  setIdleMode(idle: boolean) {
    const active = !idle
    this._setYOffset(active)
    if (this._spine && !this._dieLocked) {
      this._animHoldSec = 0
      this._setAnim(idle ? HERO_ANIM.idle : HERO_ANIM.digLoop, true)
    }
  }

  playStartDigTransition() {
    if (!this._spine || this._dieLocked) return
    const startAnim = this._spine.spineData.findAnimation(HERO_ANIM.start)
    if (!startAnim) {
      this._setAnim(HERO_ANIM.digLoop, true)
      return
    }
    this._animHoldSec = Math.max(0.05, startAnim.duration)
    this._activeAnim = HERO_ANIM.start
    this._spine.state.setAnimation(0, HERO_ANIM.start, false)
    this._spine.state.addAnimation(0, HERO_ANIM.digLoop, true, 0)
  }

  playDie() {
    if (!this._spine || this._dieLocked) return
    this._dieLocked = true
    this._animHoldSec = 999
    this._setAnim(HERO_ANIM.die, false)
  }

  resetFacing() {
    this._facingRad = 0
    if (this._spr) this._spr.rotation = 0
    if (this._spine) this._spine.rotation = 0
  }

  /**
   * Мгновенно: локальный +Y спрайта (ось «тело → бур») совпадает с направлением (dx,dy) в мире.
   */
  snapFacingToWorldDir(dx: number, dy: number) {
    if (!this._spr && !this._spine) return
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) return
    const nx = dx / len, ny = dy / len
    let t = Math.atan2(ny, nx) + GameConfig.hero.drillFacingOffsetRad
    while (t > Math.PI) t -= Math.PI * 2
    while (t < -Math.PI) t += Math.PI * 2
    this._facingRad = t
    if (this._spr) this._spr.rotation = this._facingRad
    if (this._spine) this._spine.rotation = this._facingRad
  }

  /** Плавный поворот вдоль единичного направления (или ненормализованного вектора скорости). */
  orientAlongWorldDir(dx: number, dy: number, dt: number, strength = 12) {
    if (!this._spr && !this._spine) return
    const len = Math.hypot(dx, dy)
    if (len < 1e-4) return
    const nx = dx / len, ny = dy / len
    let target = Math.atan2(ny, nx) + GameConfig.hero.drillFacingOffsetRad
    while (target > Math.PI) target -= Math.PI * 2
    while (target < -Math.PI) target += Math.PI * 2
    let da = target - this._facingRad
    while (da > Math.PI) da -= Math.PI * 2
    while (da < -Math.PI) da += Math.PI * 2
    const k = Math.min(1, strength * dt)
    this._facingRad += da * k
    if (this._spr) this._spr.rotation = this._facingRad
    if (this._spine) this._spine.rotation = this._facingRad
  }

  /** Есть клип старта копания в hero Spine — тогда раунд ждёт его конца. */
  heroHasStartDigClip(): boolean {
    if (!this._spine || this._dieLocked) return false
    return !!this._spine.spineData.findAnimation(HERO_ANIM.start)
  }

  /** true пока не истёк hold после playStartDigTransition (анимация старта ещё идёт). */
  isHeroStartIntroPlaying(): boolean {
    return this._animHoldSec > 0
  }

  update(_dt: number, _spd: number, digging: boolean) {
    if (!this._spr && !this._spine) return
    const inHeroStartIntro =
      !!this._spine &&
      !this._dieLocked &&
      !!this._spine.spineData.findAnimation(HERO_ANIM.start) &&
      this._activeAnim === HERO_ANIM.start &&
      this._animHoldSec > 0

    if (this._animHoldSec > 0) this._animHoldSec = Math.max(0, this._animHoldSec - _dt)
    const active = digging && !inHeroStartIntro
    this._setYOffset(active)
    if (this._spine && !this._dieLocked && this._animHoldSec <= 0) {
      this._setAnim(active ? HERO_ANIM.digLoop : HERO_ANIM.idle, true)
    }
  }

  destroy() {
    if (this._spine) {
      SpineAnimator.remove(this._spine)
      this._spine.destroy()
      this._spine = null
    }
    if (this._spr) this._spr.destroy()
    this.root.destroy({ children: true })
  }
}


// ─── SpawnedObj ───────────────────────────────────────────────────────────────

interface SpawnedObj {
  type:        EventType
  gfx:         PIXI.Graphics
  spine:       Spine | null
  worldX:      number
  worldY:      number
  collected:   boolean
  terminal:    boolean
  isRoadItem:  boolean
  width:       number
  height:      number
  roadMarker?: PIXI.Graphics   // пульсирующий маркер на road-предмете
  valueLabel?: PIXI.Text       // надпись со значением (+N / ×N) для COIN/DIAMOND
  /** Соответствующее событие RGS (тот же объект, что в rgsQueue) */
  rgsEventRef?: RoundEvent
}

// ─── ObjectSpawner ────────────────────────────────────────────────────────────

class ObjectSpawner {
  private layer:   PIXI.Container
  private objects: SpawnedObj[] = []
  private seed:    number
  private surfY:   number

  private drawPickup:    (g: PIXI.Graphics, type: EventType) => void
  private drawHome:      (g: PIXI.Graphics, cx: number, cy: number, sprScale?: number) => void
  private drawLava:      (g: PIXI.Graphics, cx: number, cy: number) => void
  private getPickupSize: (type: EventType) => { w: number; h: number }
  private getHomeSize:   () => { w: number; h: number }
  private getLavaSize:   () => { w: number; h: number }

  private _roadItems:      SpawnedObj[] = []
  // Pre-calculated safe decoration positions from WorldMap
  private _safeObjects:    import('./WorldMap').SafeObject[] = []
  private _safeSpawnedIdx: number = 0
  private rgsEvents:       RoundEvent[] = []

  _onPromoted: (() => void) | null = null
  /** Декоративные зоны лавы из WorldMap (`kind: 'lava'`) — спавн пещеры в TileWorld */
  onLavaDecorObstacle: ((so: import('./WorldMap').SafeObject) => void) | null = null

  // ── Getters ───────────────────────────────────────────────────────────────
  getNextRoadTarget(): SpawnedObj | null {
    for (const item of this._roadItems) {
      if (!item.collected && !item.terminal) return item
    }
    for (const item of this._roadItems) {
      if (!item.collected && item.terminal) return item
    }
    return null
  }
  getRoadItems():  readonly SpawnedObj[] { return this._roadItems }
  getObjects():    readonly SpawnedObj[] { return this.objects }

  constructor(
    layer: PIXI.Container, seed: number, surfY: number,
    drawPickup: (g: PIXI.Graphics, t: EventType) => void,
    drawHome:   (g: PIXI.Graphics, cx: number, cy: number, sprScale?: number) => void,
    drawLava:   (g: PIXI.Graphics, cx: number, cy: number) => void,
    getPickupSize: (type: EventType) => { w: number; h: number },
    getHomeSize:   () => { w: number; h: number },
    getLavaSize:   () => { w: number; h: number },
  ) {
    this.layer = layer; this.seed = seed; this.surfY = surfY
    this.drawPickup = drawPickup; this.drawHome = drawHome; this.drawLava = drawLava
    this.getPickupSize = getPickupSize; this.getHomeSize = getHomeSize; this.getLavaSize = getLavaSize
  }

  /**
   * Принимает точные позиции road items от WorldMap и спавнит их сразу.
   * Никакого промоутинга — предметы ставятся в заданные координаты.
   */
  setRgsEvents(
    events:     RoundEvent[],
    ppm:        number,
    roadPoints: import('./WorldMap').RoadPoint[],
    safeObjects: import('./WorldMap').SafeObject[],
    roadEventsOrdered: RoundEvent[],
  ) {
    this.rgsEvents     = events
    this._roadItems    = []
    this._safeObjects  = [...safeObjects].sort((a, b) => a.y - b.y || a.x - b.x)
    this._safeSpawnedIdx = 0

    for (let i = 0; i < roadPoints.length; i++) {
      const rp = roadPoints[i]
      if (rp.type === 'LAVA') continue
      this._spawnExact(rp.type as EventType, rp.worldX, rp.worldY, rp.terminal)
      const obj = this.objects[this.objects.length - 1]
      if (obj) {
        obj.isRoadItem = true
        obj.rgsEventRef = roadEventsOrdered[i]
        this._attachMarker(obj)
        this._attachValueLabel(obj)
        this._roadItems.push(obj)
      }
    }

    console.log(`[spawner] road items: ${this._roadItems.map(o => `${o.type}@(${o.worldX},${o.worldY.toFixed(0)})`).join(' → ')}`)
  }

  /**
   * Спавним декоративные объекты из pre-calculated safe positions.
   * По мере движения персонажа вниз добавляем объекты впереди.
   */
  update(charX: number, charY: number, aheadPx: number) {
    const genUpTo = charY + aheadPx

    // Спавним безопасные декорации из WorldMap (по мере продвижения)
    while (this._safeSpawnedIdx < this._safeObjects.length) {
      const so = this._safeObjects[this._safeSpawnedIdx]
      if (so.y > genUpTo) break
      this._safeSpawnedIdx++
      if (so.kind === 'decor') {
        this._spawnDecor(so.x, so.y, so.decorVisual)
      } else if (so.kind === 'lava') {
        this.onLavaDecorObstacle?.(so)
      }
    }

    // Пульсация маркеров road items
    const pulse = 0.45 + 0.55 * Math.sin(Date.now() * 0.004)
    for (const obj of this._roadItems) {
      const m = obj.roadMarker
      if (!m || obj.collected || (m as any).destroyed) continue
      try {
        m.clear()
        m.lineStyle(3, 0xFFD700, pulse)
        const r = Math.max(obj.width, obj.height) * 0.55 + 10
        m.drawCircle(0, 0, r)
      } catch { obj.roadMarker = undefined }
    }

    // Culling
    this.objects = this.objects.filter(o => {
      if (o.collected) return false
      if (o.worldY < charY - TILE * 15) {
        SpineAnimator.remove(o.spine)
        if (o.roadMarker) {
          if (o.roadMarker.parent) o.roadMarker.parent.removeChild(o.roadMarker)
          o.roadMarker.destroy()
        }
        if (o.valueLabel) {
          if (o.valueLabel.parent) o.valueLabel.parent.removeChild(o.valueLabel)
          o.valueLabel.destroy()
        }
        if (o.gfx.parent) o.gfx.parent.removeChild(o.gfx)
        o.gfx.destroy()
        return false
      }
      return true
    })
  }

  private _roadItemHit(charX: number, charY: number, o: SpawnedObj): boolean {
    const hw = Math.max(o.width,  TILE * 0.5) / 2
    const hh = Math.max(o.height, TILE * 0.5) / 2
    return charX > o.worldX - hw - COLL_R && charX < o.worldX + hw + COLL_R &&
      charY > o.worldY - hh - COLL_R && charY < o.worldY + hh + COLL_R
  }

  checkCollisions(charX: number, charY: number, onCollect: (obj: SpawnedObj) => void) {
    const hits: SpawnedObj[] = []
    for (const o of this.objects) {
      if (o.collected || !o.isRoadItem) continue
      if (this._roadItemHit(charX, charY, o)) hits.push(o)
    }
    if (hits.length === 0) return
    hits.sort((a, b) => a.worldY - b.worldY || a.worldX - b.worldX)
    const o = hits[0]!
    o.collected = true
    onCollect(o)
  }

  skipTo(minY: number): void {
    // Пропускаем safe objects до minY
    while (this._safeSpawnedIdx < this._safeObjects.length &&
           this._safeObjects[this._safeSpawnedIdx].y < minY) {
      const so = this._safeObjects[this._safeSpawnedIdx]
      if (so.kind === 'lava') this.onLavaDecorObstacle?.(so)
      this._safeSpawnedIdx++
    }
  }

  /** Сдвигает все координаты спавнера по X (очередь + уже созданные объекты/лейблы/маркеры). */
  shiftWorldX(dx: number): void {
    if (Math.abs(dx) < 1e-6) return
    for (const so of this._safeObjects) so.x += dx
    for (const o of this.objects) {
      o.worldX += dx
      o.gfx.x += dx
      if (o.roadMarker) o.roadMarker.x += dx
      if (o.valueLabel) o.valueLabel.x += dx
    }
  }

  reset() {
    this.objects.forEach(o => {
      SpineAnimator.remove(o.spine)
      if (o.roadMarker) {
        if (o.roadMarker.parent) o.roadMarker.parent.removeChild(o.roadMarker)
        o.roadMarker.destroy()
      }
      if (o.valueLabel) {
        if (o.valueLabel.parent) o.valueLabel.parent.removeChild(o.valueLabel)
        o.valueLabel.destroy()
      }
      if (o.gfx.parent) o.gfx.parent.removeChild(o.gfx)
      o.gfx.destroy()
    })
    this.objects         = []
    this._roadItems      = []
    this._safeObjects    = []
    this._safeSpawnedIdx = 0
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Спавн в точно заданных координатах */
  private _spawnExact(type: EventType, worldX: number, worldY: number, terminal: boolean): void {
    const size = this._sizeForType(type)
    const gfx  = new PIXI.Graphics()

    if (type === 'HOME') {
      this.drawHome(gfx, worldX, worldY)
      gfx.x = worldX; gfx.y = worldY
    } else {
      const spineInst = SpineAnimator.createItem(type)
      if (spineInst) {
        gfx.x = worldX; gfx.y = worldY
        gfx.addChild(spineInst)
        this.layer.addChild(gfx)
        this.objects.push({ type, gfx, spine: spineInst, worldX, worldY, collected: false, terminal, isRoadItem: false, width: size.w, height: size.h })
        return
      }
      this.drawPickup(gfx, type)
      gfx.x = worldX; gfx.y = worldY
    }

    this.layer.addChild(gfx)
    this.objects.push({ type, gfx, spine: null, worldX, worldY, collected: false, terminal, isRoadItem: false, width: size.w, height: size.h })
  }

  /** Спавн декоративного объекта (не road item); `preset` — тип из WorldMap, иначе случайный. */
  private _spawnDecor(worldX: number, worldY: number, preset?: EventType): void {
    const type = preset ?? this._pickType(worldY, this._rng(worldY ^ 0xABC))
    const size = this._sizeForType(type)
    const gfx  = new PIXI.Graphics()
    if (type === 'HOME') {
      // Тот же масштаб, что у road HOME (_spawnExact), иначе «фейковая» кровать визуально меньше
      this.drawHome(gfx, worldX, worldY)
      gfx.x = worldX; gfx.y = worldY
      this.layer.addChild(gfx)
      this.objects.push({ type, gfx, spine: null, worldX, worldY, collected: false, terminal: false, isRoadItem: false, width: size.w, height: size.h })
      return
    }
    const spineInst = SpineAnimator.createItem(type)
    if (spineInst) {
      gfx.x = worldX; gfx.y = worldY
      gfx.addChild(spineInst)
      this.layer.addChild(gfx)
      this.objects.push({ type, gfx, spine: spineInst, worldX, worldY, collected: false, terminal: false, isRoadItem: false, width: size.w, height: size.h })
      this._attachValueLabel(this.objects[this.objects.length - 1])
      return
    }
    this.drawPickup(gfx, type)
    gfx.x = worldX; gfx.y = worldY
    this.layer.addChild(gfx)
    this.objects.push({ type, gfx, spine: null, worldX, worldY, collected: false, terminal: false, isRoadItem: false, width: size.w, height: size.h })
    this._attachValueLabel(this.objects[this.objects.length - 1])
  }

  private _attachMarker(obj: SpawnedObj): void {
    const m = new PIXI.Graphics()
    m.x = obj.worldX; m.y = obj.worldY
    m.lineStyle(3, 0xFFD700, 1)
    const r = Math.max(obj.width, obj.height) * 0.55 + 10
    m.drawCircle(0, 0, r)
    this.layer.addChild(m)
    obj.roadMarker = m
  }

  private _attachValueLabel(obj: SpawnedObj): void {
    let value: number | null = null
    let prefix = ''
    const eff = obj.rgsEventRef?.effect
    if (eff) {
      if (obj.type === 'COIN' && eff.op === 'add')         { value = eff.value; prefix = '+' }
      else if (obj.type === 'DIAMOND' && eff.op === 'mul') { value = eff.value; prefix = '×' }
    } else if (obj.type === 'COIN') {
      const v = GameConfig.items.COIN.addValues
      value = v[Math.floor(Math.random() * v.length)]; prefix = '+'
    } else if (obj.type === 'DIAMOND') {
      const v = GameConfig.items.DIAMOND.multValues
      value = v[Math.floor(Math.random() * v.length)]; prefix = '×'
    }
    if (value == null) return

    const cfg  = GameConfig.valueLabel
    const size = Math.max(obj.width, obj.height)
    const sh   = cfg.shadow
    const dx   = sh.offsetX, dy = sh.offsetY
    const dist = Math.hypot(dx, dy)
    const angle = dist > 0 ? Math.atan2(dy, dx) : 0
    const tier = cfg.tiers[`${obj.type}:${value}`] ?? cfg.fallback
    const label = new PIXI.Text(`${prefix}${value}`, {
      fontFamily:         cfg.fontFamily,
      fontSize:           tier.fontSize,
      fontWeight:         cfg.fontWeight as PIXI.TextStyleFontWeight,
      fill:               tier.color,
      stroke:             cfg.strokeColor,
      strokeThickness:    cfg.strokeThickness,
      align:              'center',
      dropShadow:         sh.enabled,
      dropShadowColor:    sh.color,
      dropShadowAngle:    angle,
      dropShadowDistance: dist,
      dropShadowBlur:     sh.blur,
      dropShadowAlpha:    sh.alpha,
    })
    label.anchor.set(0.5, 0.5)
    label.rotation = (cfg.rotationDeg * Math.PI) / 180
    label.x = obj.worldX + size * cfg.offsetXFactor
    label.y = obj.worldY + size * cfg.offsetYFactor
    this.layer.addChild(label)
    obj.valueLabel = label
  }

  private _sizeForType(type: EventType): { w: number; h: number } {
    if (type === 'HOME') return this.getHomeSize()
    if (type === 'LAVA') return this.getLavaSize()
    const spine = getSpineItemSize(type)
    if (spine.w > 0) return spine
    const px = this.getPickupSize(type)
    return { w: Math.max(px.w, 24), h: Math.max(px.h, 24) }
  }

  private _pickType(y: number, r: number): EventType {
    const depth = y / (TILE * 10)
    const { types } = GameConfig.spawn
    const bombChance  = Math.min(types.bombMax,  types.bombBase  + depth * types.bombDepthScale)
    const stoneChance = Math.min(types.stoneMax, types.stoneBase + depth * types.stoneDepthScale)
    if (r < types.coinBase)                            return 'COIN'
    if (r < types.coinBase + bombChance)               return 'BOMB'
    if (r < types.coinBase + bombChance + stoneChance) return 'STONE'
    if (r < types.goldThreshold)                       return 'GOLD'
    const homeDecor = (types as { homeDecorChance?: number }).homeDecorChance ?? 0
    if (r < types.goldThreshold + homeDecor)          return 'HOME'
    return 'DIAMOND'
  }

  private _rng(y: number): number {
    let s = ((y * 73856093) ^ this.seed) >>> 0
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

// ─── Particles ────────────────────────────────────────────────────────────────

interface Particle{gfx:PIXI.Graphics;vx:number;vy:number;life:number}

// ─── Деревья (слой _sceneryLayer): настройка размера и позиции ─────────────
/** Мир Y базовой линии (якорь спрайта 0.5, 1 = низ текстуры) */
const TREE_ANCHOR_WORLD_Y = TILE + 20
/**
 * Сдвиг мир Y для [дерево1, 2, 3]. В Pixi Y растёт вниз → отрицательное поднимает дерево.
 * Левое (tree1) при больших высотах часто «ниже» из‑за паддинга в PNG — крути первое значение.
 */
const TREE_Y_OFFSET: readonly [number, number, number] = [-110, 0, 0]
/**
 * Доп. подъём только левого: доля от его targetH. Растёт вместе с TREE_HEIGHTS_PX[0].
 */
const TREE0_LIFT_FRAC_OF_HEIGHT = -0.06
/** Целевая высота спрайта в пикселях [дерево 1, 2, 3] */
const TREE_HEIGHTS_PX: readonly [number, number, number] = [540, 450, 460]
/** Мир X в idle (фиксированные позиции) */
const TREE_X_IDLE: readonly [number, number, number] = [-1000, 420, 820]
/** В раунде: смещения от charX для тех же трёх деревьев */
const TREE_X_RUN_DX: readonly [number, number, number] = [-480, 180, 520]

// ─── GameRenderer ─────────────────────────────────────────────────────────────

export class GameRenderer {
  app:PIXI.Application
  /** Подложка под выкопом (текстура земли / цвет из TileWorld.bgLight). */
  private worldBgLayer:   PIXI.Container
  /** Чанки травы/земли и лава — поверх неба и деревьев. */
  private worldChunkLayer: PIXI.Container
  private objectsLayer: PIXI.Container  // ← объекты всегда поверх чанков
  private skyLayer:     PIXI.Container
  private _sceneryLayer: PIXI.Container = new PIXI.Container()
  private minerLayer:   PIXI.Container = new PIXI.Container()
  private miner: SpriteCharacter
  private liveWinBadge: PIXI.Container = new PIXI.Container()
  private liveWinTitleText: PIXI.Text = new PIXI.Text('WIN', {
    fontFamily: 'Arial Black, Arial, sans-serif',
    fontSize: 14,
    fontWeight: '800',
    fill: 0xFFFFFF,
    stroke: 0x000000,
    strokeThickness: 2,
    align: 'center',
  })
  private liveWinAmountText: PIXI.Text = new PIXI.Text('', {
    fontFamily: 'Arial Black, Arial, sans-serif',
    fontSize: 25,
    fontWeight: '900',
    fill: 0xFACB32,
    stroke: 0x000000,
    strokeThickness: 2,
    align: 'center',
  })
  private liveWinAmountCached = ''
  private _cloudT = 0
  private _treeRunDx: [number, number, number] = [...TREE_X_RUN_DX]
  private spawner:ObjectSpawner|null=null
  private tunnelActive = false
  private W=0; private H=0
  private camX=0; private camY=0
  private tileWorld:TileWorld|null=null
  private worldSeed=0xdeadbeef
  private get surfY(){ return TILE }
  private get idleCamY(){ return this.surfY-this.H*0.70 }

  // Idle
  private idleActive=true
  private idleX=0; private idleDir=1; private _bounceT=0

  // Round
  private running=false
  /** Spine start_2 играет до первого кадра с running=true (копание ещё не началось). */
  private _awaitingStartAnim=false
  /** Во время стартовой анимации фиксируем X, чтобы герой шёл строго вниз. */
  private _startIntroX=0
  /** Во время стартовой анимации текущий экранный Y корня героя. */
  private _startIntroY=0
  private charX=0; private charY=0
  private charScreenY=0
  private multiplier=1; private depth=0; private distance=0
  private particles:Particle[]=[]
  private ppm=TILE*2
  private rgsQueue:RoundEvent[]=[]
  private rgsEvents:RoundEvent[]=[]   // оригинальный список — нужен для вычисления дельты

  private _waypoints:number[]=[]
  private _ended=false
  // Счётчик promoted items — триггер перестройки пути
  private _promotedCount = 0
  // Случайная скорость спуска
  private _speedMult = 1.0        // текущий множитель скорости
  private _speedTarget = 1.0      // целевой множитель
  private _speedChangeTimer = 0   // таймер смены скорости
  // Velocity — физическая инерция персонажа
  private _velY = 0               // текущая скорость по Y (px/sec)
  private _velX = 0               // текущая скорость по X (px/sec)
  // Отталкивание — Set объектов которые уже оттолкнули персонажа в этом раунде
  private _repulseTimer    = 0   // секунд осталось заморозки X после отталкивания
  private _repulseDir      = 1   // направление последнего отталкивания (+1 / -1)
  private _lossRound    = false // LAVA round: финальный спуск через _stepLossPitFall
  private _lossTerminalDescent = false // end of LOSS path: smooth fall, no tunnel snap
  /** X оси у терминальной лавы (конец предрасчёта туннеля LOSS); `null` если не LOSS */
  private _lossLavaCenterX: number | null = null
  private _caveZones:   Array<{x:number; y:number; r:number}> = []  // круги всех активных пещер
  /** Позиция вдоль туннеля: длина дуги от начала path; скорость = const вдоль этой дуги */
  private _pathArcS = 0
  private _tunnelCumLen: number[] = []
  private _tunnelCumPathLen = 0
  private _pathTangentNx = 0
  private _pathTangentNy = 1
  private _arcSpeedSmoothed = 0
  /** Накопление длины дуги туннеля для throttled SFX копания */
  private _digSoundCarry = 0

  // Stone breaking
  private stoneBreakActive = false;
  private stoneBreakRemainingTime = 0;
  private stoneBreakTotalDuration = 0;
  private stoneBreakStartMultiplier = 0;
  private stoneBreakTickTimer = 0;      // таймер до следующего тика (-1/сек)
  private stoneBreakDisplayMult = 0;   // текущее отображаемое значение

  // Золотой самородок — останавливает персонажа, множитель растёт ×3/сек
  private goldBreakActive = false;
  private goldBreakRemainingTime = 0;
  private goldBreakTotalDuration = 0;
  private goldBreakStartMultiplier = 0;
  private goldBreakTickTimer = 0;       // таймер до следующего тика (+N/сек)
  private goldBreakDisplayMult = 0;    // текущее отображаемое значение

  // Активный объект во время брейка (показываем action-анимацию)
  private _breakSpine: import('pixi-spine').Spine | null = null;
  private _breakGfx:   PIXI.Graphics | null = null;
  // Стадия брейка: 0=idle(не начат), 1=state1, 2=state2, 3=action
  private _breakStage = 0;

  // Кэш текстур
  private _textures: Map<string, PIXI.Texture> = new Map()
  private _texturesLoading: Promise<void> | null = null

  // Эффект грязи в точке входа (dirt_show → dirt_idle)
  private _dirtEntry: import('pixi-spine').Spine | null = null
  private _dirtEntryGfx: PIXI.Container | null = null

  // Пещеры
  private _lastCaveY = 0
  private _caveInterval = TILE * 15
  private _caveSeed = 0

  // Предгенерированный маршрут
  private _roundPath: FullPathResult | null = null
  /** Копия полилинии туннеля (расширяется вместе с _waypoints для проверки пещер) */
  private _tunnelPath: PathPoint[] = []

  private activeLavas: Map<PIXI.Graphics, {renderer: any, wx: number, wy: number}> = new Map()
  private lavasCavePathUpdated: WeakSet<any> = new WeakSet()
  private lavaSimulation: LavaSimulation | null = null
  private _worldMask: PIXI.Graphics = new PIXI.Graphics()

  constructor(canvas:HTMLCanvasElement,w:number,h:number){
    this.W=w;this.H=h
    const dpr=Math.min(window.devicePixelRatio||1,2)
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)
    const base:PIXI.IApplicationOptions={
      view:canvas,width:w,height:h,backgroundColor:C.bg,
      antialias:true,resolution:dpr,autoDensity:true,hello:false,
    } as any
    let app:PIXI.Application
    try{
      app=new PIXI.Application(base)
      const gl=(app.renderer as any).context?.gl
      if(gl?.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)===0){app.destroy(false);throw new Error('')}
    }catch{
      app=new PIXI.Application({...base,antialias:false,forceCanvas:true})
    }
    this.app=app

    // ─── PixiJS Devtools setup ──────────────────────────────────────────────
    // All three methods combined for maximum compatibility:
    // 1) window.__PIXI_DEVTOOLS__ — official manual setup (synchronous)
    // 2) initDevtools()           — official package setup (passes stage+renderer)
    // 3) window.__PIXI_APP__     — unofficial fallback (pixi-inspector style)
    if (import.meta.env.DEV) {
      ;(window as any).__PIXI_DEVTOOLS__ = {
        pixi:     PIXI,
        app:      this.app,
        stage:    this.app.stage,
        renderer: this.app.renderer,
      }
      ;(window as any).__PIXI_APP__ = this.app
      initDevtools({ app: this.app })
    }
    // ────────────────────────────────────────────────────────────────────────

    this.skyLayer    = new PIXI.Container()
    this.worldBgLayer   = new PIXI.Container()
    this.worldChunkLayer = new PIXI.Container()
    this.objectsLayer= new PIXI.Container()  // ← между миром и персонажем

    // Фон мира → небо → деревья → игровое поле (чанки) → предметы → герой
    this.app.stage.addChild(
      this.worldBgLayer,
      this.skyLayer,
      this._sceneryLayer,
      this.worldChunkLayer,
      this.objectsLayer,
      this.minerLayer,
    )

    // Маска для skyLayer: небо видно только выше линии травы на экране
    this._worldMask = new PIXI.Graphics()
    this.app.stage.addChild(this._worldMask)
    this.skyLayer.mask = this._worldMask
    this._updateWorldMask(w, h)

    this.charScreenY=h*0.42
    this._buildSky()
    this._makeIdleWorld()
    this.miner=new SpriteCharacter()
    this.miner.chunkParent=this.worldChunkLayer
    this._createLiveWinBadge()
    this.idleX=0
    {
      const hi = GameConfig.hero.idle
      this.miner.root.x = this.idleX + hi.rootOffsetXPx
      this.miner.root.y = this.surfY + hi.rootOffsetYPx
    }
    this.minerLayer.addChild(this.miner.root, this.liveWinBadge)
    this.camX = this.idleX + GameConfig.hero.idle.rootOffsetXPx - w / 2
    this.camY = this.idleCamY
    this._syncLayerScroll()
    this._buildTunnel()
    this._loadTextures()
    void SpineAnimator.load()
    void SpineAnimator.loadHero().then(() => {
      if (!this.app) return
      const heroSpine = SpineAnimator.createHero(HERO_SPINE_SCALE)
      if (heroSpine) this.miner.setHeroSpine(heroSpine)
    })
    SpineAnimator.loadGoldStone()   // грузим параллельно с текстурами, не ждём
    this.app.ticker.add(this._tick.bind(this))
  }

  private _createLiveWinBadge(): void {
    this.liveWinBadge.visible = false
    this.liveWinBadge.zIndex = 10
    this.liveWinBadge.addChild(this.liveWinTitleText, this.liveWinAmountText)
    this.liveWinTitleText.anchor.set(0.5)
    this.liveWinAmountText.anchor.set(0.5)
    this.liveWinTitleText.position.set(0, 0)
    this.liveWinAmountText.position.set(0, LIVE_WIN_AMOUNT_OFFSET_Y)
  }

  private _updateLiveWinBadge(): void {
    const store = useGameStore.getState()
    if (!this.running || this.idleActive || this._ended) {
      this.liveWinBadge.visible = false
      return
    }

    const visibleMultiplier = this.stoneBreakActive
      ? this.stoneBreakDisplayMult
      : this.goldBreakActive
        ? this.goldBreakDisplayMult
        : this.multiplier
    const liveWin = store.bet * Math.max(0, visibleMultiplier)
    const amount = formatLiveWinAmount(liveWin, store.currency)

    if (amount !== this.liveWinAmountCached) {
      this.liveWinAmountCached = amount
      this.liveWinAmountText.text = amount
    }

    this.liveWinBadge.position.set(this.miner.root.x, this.miner.root.y + LIVE_WIN_BADGE_OFFSET_Y)
    this.liveWinBadge.rotation = 0
    this.liveWinBadge.scale.set(1)
    this.liveWinBadge.visible = true
  }

  private _syncLayerScroll() {
    const x = -this.camX, y = -this.camY
    this.worldBgLayer.position.set(x, y)
    this._sceneryLayer.position.set(x, y)
    this.worldChunkLayer.position.set(x, y)
    this.objectsLayer.position.set(x, y)
    this.minerLayer.position.set(x, y)
  }

  private _buildTunnel(){
    if (this.tileWorld) {
      this.tileWorld.renderer = this.app.renderer as PIXI.Renderer
      this.tileWorld.initMasks()
    }
  }

  private _updateTunnel(sx: number, sy: number){
    if (this.tileWorld) {
      this.tileWorld.scratchAt(
        sx,
        sy,
        this.camX,
        this.camY,
        this._pathTangentNx,
        this._pathTangentNy,
      )
    }
  }

  private _showTunnel(){
    this.tunnelActive=true
    if(this.tileWorld){
      this.tileWorld.renderer=this.app.renderer as PIXI.Renderer
      this.tileWorld.showBg()
    }
  }
  private _hideTunnel(){
    this.tunnelActive=false
    if(this.tileWorld){
      this.tileWorld.resetScratch()
      this.tileWorld.hideBg()
    }
  }

  private _makeIdleWorld(){
    if(this.tileWorld){this.tileWorld.destroy();this.tileWorld=null}
    TileWorld.loadGrassTex().then(()=>{
      if(!this.app) return
      this.tileWorld=new TileWorld(this.worldBgLayer, this.worldChunkLayer, this.worldSeed)
      this.tileWorld.renderer=this.app.renderer as PIXI.Renderer
      this.tileWorld.initMasks()
      this.tileWorld.update(-this.W*2,this.idleCamY,this.W*5,this.H*2)
      this._initLavaSimulation()
      this._syncSurfaceScenery()
    })
  }

  private _initLavaSimulation() {
    if (this.lavaSimulation) {
      this.lavaSimulation.destroy()
      const old = this.lavaSimulation as any
      if (old.container?.parent) old.container.parent.removeChild(old.container)
      if (old.glowGfx?.parent)   old.glowGfx.parent.removeChild(old.glowGfx)
    }
    this.lavaSimulation = new LavaSimulation()
    this.lavaSimulation.setViewport(this.W, this.H)
    const lava = this.lavaSimulation as any
    this.worldChunkLayer.addChild(lava.glowGfx)
    this.worldChunkLayer.addChild(lava.container)
    if (this.tileWorld) {
      this.tileWorld.lavaSimulation = this.lavaSimulation
    }
  }

  private _buildSky(){
    const bgTex = this._textures.get('bg')
    if (bgTex) {
      const bgH = this.H * 0.70
      const tileH = bgTex.height * (this.W / bgTex.width)
      const spr = new PIXI.TilingSprite(bgTex, this.W, Math.max(bgH, tileH))
      const sc = this.W / bgTex.width
      spr.tileScale.set(sc, sc)
      spr.tilePosition.set(0, 0)
      spr.roundPixels = true
      spr.y = bgH - spr.height
      spr.name = 'bgSprite'
      this.skyLayer.addChild(spr)
    } else {
      const s1=new PIXI.Graphics()
      s1.beginFill(C.skyDeep);s1.drawRect(0,0,this.W,this.H*0.50);s1.endFill()
      const s2=new PIXI.Graphics()
      s2.beginFill(C.sky);s2.drawRect(0,this.H*0.20,this.W,this.H*0.35);s2.endFill()
      this.skyLayer.addChild(s1,s2)
    }

    const rockTex = this._textures.get('rock')
    if (rockTex) {
      const rock = new PIXI.Sprite(rockTex)
      rock.name = 'rockSprite'
      rock.anchor.set(0.5, 0.7)
      const rw = this.W * 0.36
      rock.scale.set(rw / rockTex.width)
      rock.x = this.W * 0.58
      rock.y = Math.max(0, Math.min(this.H, -this.camY)) - 4
      this.skyLayer.addChild(rock)
    }

    for (let i = 0; i < 3; i++) {
      const ct = this._textures.get(`cloud${i + 1}`)
      if (!ct) continue
      const c = new PIXI.Sprite(ct)
      c.name = `cloud${i + 1}`
      c.anchor.set(0.5, 0.5)
      const scl = Math.min(0.42, this.W / 900) * (0.85 + i * 0.08)
      c.scale.set(scl)
      c.x = this.W * (0.12 + i * 0.31)
      c.y = this.H * (0.10 + i * 0.06)
      ;(c as PIXI.Sprite & { _drift: number })._drift = 10 + i * 9
      this.skyLayer.addChild(c)
    }
  }

  private _syncSurfaceScenery() {
    this._sceneryLayer.removeChildren()
    const keys = ['tree1', 'tree2', 'tree3'] as const
    const xs = this.running
      ? this._treeRunDx.map(dx => this.charX + dx) as [number, number, number]
      : [...TREE_X_IDLE]
    for (let i = 0; i < 3; i++) {
      const tex = this._textures.get(keys[i])
      if (!tex) continue
      const s = new PIXI.Sprite(tex)
      s.name = keys[i]
      s.anchor.set(0.5, 1)
      s.x = xs[i]!
      const targetH = TREE_HEIGHTS_PX[i]!
      const lift0 = i === 0 ? targetH * TREE0_LIFT_FRAC_OF_HEIGHT : 0
      s.y = TREE_ANCHOR_WORLD_Y + TREE_Y_OFFSET[i]! - lift0
      s.scale.set(targetH / tex.height)
      this._sceneryLayer.addChild(s)
    }
  }

  /** Целочисленный сдвиг тайла неба — убирает вертикальный шов TilingSprite при параллаксе. */
  private _syncSkyBgParallax() {
    const bg = this.skyLayer.getChildByName('bgSprite') as PIXI.TilingSprite | null
    if (!bg) return
    bg.tilePosition.x = Math.round(-this.camX * 0.2)
    bg.tilePosition.y = 0
  }

  private _updateSkyDecor(dt: number) {
    this._cloudT += dt
    const top = Math.max(0, Math.min(this.H, -this.camY))
    const rock = this.skyLayer.getChildByName('rockSprite') as PIXI.Sprite | null
    if (rock) {
      rock.x = this.W * 0.58 - this.camX * 0.07
      rock.y = top - 6
    }
    for (const ch of this.skyLayer.children) {
      const name = (ch as PIXI.DisplayObject).name ?? ''
      if (!name.startsWith('cloud')) continue
      const c = ch as PIXI.Sprite & { _drift?: number }
      const drift = c._drift ?? 14
      c.x += drift * dt
      const half = (c.texture?.width ?? 100) * 0.5 * Math.abs(c.scale.x)
      if (c.x > this.W + half + 20) c.x = -half - 20
      c.y += Math.sin(this._cloudT * 0.7 + name.length) * 0.35 * dt
    }
  }

  /** Фиксирует смещения деревьев от героя в момент старта, чтобы сцена не прыгала. */
  private _captureTreeRunOffsets(startX: number): void {
    const offsets: number[] = []
    for (const ch of this._sceneryLayer.children) {
      const spr = ch as PIXI.Sprite
      if (!(spr.name ?? '').startsWith('tree')) continue
      offsets.push(spr.x - startX)
    }
    if (offsets.length >= 3) {
      this._treeRunDx = [offsets[0]!, offsets[1]!, offsets[2]!]
    } else {
      this._treeRunDx = [...TREE_X_RUN_DX]
    }
  }

  /** Сдвигает весь предрассчитанный маршрут по X, чтобы старт совпал с текущей позицией героя. */
  private _shiftRoundPathX(dx: number): void {
    if (Math.abs(dx) < 1e-6) return
    const rp = this._roundPath
    if (!rp) return
    for (const p of rp.pathPoints) p.x += dx
    for (const rpt of rp.roadPoints) rpt.worldX += dx
    for (const o of rp.obstacles) o.x += dx
    if (rp.terminalCave) rp.terminalCave.x += dx
    for (let i = 0; i < rp.waypoints.length; i++) {
      rp.waypoints[i] = rp.waypoints[i]! + dx
    }
    // Если активные массивы пути уже собраны — сдвигаем и их, чтобы не было X-рывка в момент старта.
    for (const p of this._tunnelPath) p.x += dx
    for (let i = 0; i < this._waypoints.length; i++) {
      this._waypoints[i] = this._waypoints[i]! + dx
    }
  }

  /**
   * Смягчает старт маршрута: первые точки пути держим близко к X старта,
   * чтобы вход в обычное копание был без резкого бокового рывка.
   */
  private _softenRoundPathStart(startX: number): void {
    const rp = this._roundPath
    if (!rp || rp.pathPoints.length === 0) return
    const n = Math.min(START_PATH_SOFTEN_POINTS, rp.pathPoints.length)
    for (let i = 0; i < n; i++) {
      const p = rp.pathPoints[i]!
      const t = n <= 1 ? 1 : i / (n - 1)
      const maxDx = START_PATH_MAX_DX_PX * t
      const minX = startX - maxDx
      const maxX = startX + maxDx
      const clampedX = Math.max(minX, Math.min(maxX, p.x))
      p.x = clampedX
      if (i < rp.waypoints.length) rp.waypoints[i] = clampedX
    }
    // После смягчения старта обязательно привязываем road points к финальному пути,
    // иначе первый предмет может оказаться вне траектории движения персонажа.
    for (const rpPoint of rp.roadPoints) {
      rpPoint.worldX = pathXAtWorldY(rpPoint.worldY, rp.pathPoints, this.surfY)
    }
  }

  // ─── Round ────────────────────────────────────────────────────────────────

  startRound(events:RoundEvent[],_spd:number){
    const startX = this.miner.root.x
    const startY = this.miner.root.y
    const startCamX = this.camX
    const startCamY = this.camY
    this._captureTreeRunOffsets(startX)

    this.running=false;this.idleActive=false;this._ended=false
    this._awaitingStartAnim=false
    this.multiplier=0;this.depth=0;this.distance=0
    this.particles=[]
    this.rgsQueue=[...events]
    this.rgsEvents=events
    this._lossRound = events.some(e => e.type === 'LAVA')
    this.stoneBreakActive = false;
    this.stoneBreakRemainingTime = 0;
    this.stoneBreakTotalDuration = 0;
    this.stoneBreakStartMultiplier = 0;
    this.stoneBreakTickTimer = 0;
    this.stoneBreakDisplayMult = 0;
    this.goldBreakActive = false;
    this.goldBreakRemainingTime = 0;
    this.goldBreakTotalDuration = 0;
    this.goldBreakStartMultiplier = 0;
    this.goldBreakTickTimer = 0;
    this.goldBreakDisplayMult = 0;
    this._breakStage = 0;
    this._destroyBreakObj();

    this.spawner?.reset()
    this.objectsLayer.removeChildren()  // ← чистим объекты

    const lastEv  = events[events.length-1]
    const depthM  = Math.max(lastEv.depth,50)
    const spread = GameConfig.round.depthSpreadScreenFactor ?? 2.5
    this.ppm      = Math.max(TILE*2, Math.round((this.H * spread)/depthM/TILE)*TILE)

    const baseSeed = events.reduce((a,e,i)=>a^(e.depth*31+i*97),0x1337) >>> 0
    const randSalt = (() => {
      try {
        const arr = new Uint32Array(1)
        crypto.getRandomValues(arr)
        return arr[0]!
      } catch {
        return Math.floor(Math.random() * 0xFFFFFFFF) >>> 0
      }
    })()
    // Соль на каждый запуск раунда: даже при одинаковых events маршрут/декор не повторяются.
    this.worldSeed = (baseSeed ^ randSalt) >>> 0
    if (!this.tileWorld) {
      TileWorld.loadGrassTex().then(() => {
        this.tileWorld?.rebuildTunnelBgFromTextures()
      })
      this.tileWorld = new TileWorld(this.worldBgLayer, this.worldChunkLayer, this.worldSeed)
      this.tileWorld.renderer = this.app.renderer as PIXI.Renderer
      this.tileWorld.initMasks()
    } else {
      // Единая сцена: не пересоздаём мир, только сбрасываем «копание».
      this.tileWorld.resetScratch()
      this.tileWorld.showBg()
    }
    this._initLavaSimulation()

    this._promotedCount=0
    this._speedMult = 1.0; this._speedTarget = 1.0; this._speedChangeTimer = 0
    this._arcSpeedSmoothed = CHAR_SPEED
    this._velY = 0; this._velX = 0
    this._repulseTimer = 0
    this._repulseDir   = 1
    this._lossTerminalDescent = false
    this._caveZones    = []
    this._digSoundCarry = 0

    this.charY=startY
    this._lastCaveY = this.surfY + TILE * 3
    this._caveSeed  = this.worldSeed ^ 0xCAFE1234

    // ← Spawner теперь использует objectsLayer — объекты всегда над чанками
    this.spawner=new ObjectSpawner(
      this.objectsLayer,
      this.worldSeed,
      this.surfY,
      this._drawPickup.bind(this),
      this._drawHome.bind(this),
      this._drawLavaCave.bind(this),
      this._getPickupSize.bind(this),
      this._getHomeSize.bind(this),
      this._getLavaSize.bind(this),
    )
    // ── Строим полный маршрут ДО спавна объектов ────────────────────────────
    this._roundPath = buildRoundPath(this.worldSeed, this.surfY, this.ppm, events)
    const initialPathX = pathXAtWorldY(startY, this._roundPath.pathPoints, this.surfY)
    this._shiftRoundPathX(startX - initialPathX)
    this._softenRoundPathStart(startX)
    this._waypoints   = this._roundPath.waypoints
    this._tunnelPath  = this._roundPath.pathPoints.map(p => ({ x: p.x, y: p.y }))
    this._lossLavaCenterX =
      this._lossRound && this._tunnelPath.length > 0
        ? this._tunnelPath[this._tunnelPath.length - 1]!.x
        : null
    this._promotedCount = 0
    this.charX = pathXAtWorldY(this.charY, this._tunnelPath, this.surfY)
    this._rebuildTunnelCumLengths()
    this._pathArcS = projectWorldXYToTunnelArcLength(this._tunnelPath, this._tunnelCumLen, this.charX, this.charY)
    {
      const pt0 = pointOnTunnelAtArcLength(this._tunnelPath, this._tunnelCumLen, this._pathArcS)
      this._pathTangentNx = pt0.nx
      this._pathTangentNy = pt0.ny
      this.miner.snapFacingToWorldDir(pt0.nx, pt0.ny)
    }
    this.camX = startCamX
    this.camY = startCamY

    // Передаём путь в TileWorld — лава не генерируется в коридоре
    // (для обоих типов раундов — персонаж не должен случайно попасть в лаву)
    this.tileWorld.setPathWaypoints(this._waypoints, this.surfY)

    // LOSS: терминальная пещера с лавой у конца полилинии туннеля.
    // Делаем fallback, если WorldMap по какой-то причине не вернул terminalCave.
    if (this._lossRound && this.tileWorld) {
      const pe = this._tunnelPath[this._tunnelPath.length - 1]
      const tc = this._roundPath.terminalCave ?? (
        pe
          ? { x: pe.x, y: pe.y + TILE * 2, seed: (this.worldSeed ^ 0xDEAD1234) >>> 0 }
          : null
      )
      if (tc) {
        // Центр терм. пещеры = хвост туннеля. Спавним с пересечением коридора —
        // иначе конец пути остаётся вне _caveZones и LavaSimulation не даёт проигрыш.
        const ok = this.tileWorld.spawnCave(tc.x, tc.y, tc.seed, { lavaTerminal: true })
        const cavePath = this.tileWorld.getLastCavePath()
        if (cavePath) this._caveZones.push(...cavePath.points)
        if (pe) {
          this._caveZones.push({ x: pe.x, y: pe.y + TILE * 0.5, r: TILE * 3.6 })
        }
        this.tileWorld.update(tc.x - this.W * 0.5, tc.y - this.H * 0.55, this.W, this.H)
        if (!ok) {
          console.warn('[GameRenderer] terminal lava cave spawn returned false, using fallback zone only')
        } else {
          console.log(`[GameRenderer] terminal cave (${tc.x.toFixed(0)}, ${tc.y.toFixed(0)})`)
        }
      }
    }

    // Передаём точные позиции road items + safe objects в spawner
    this.spawner.setRgsEvents(
      events,
      this.ppm,
      this._roundPath.roadPoints,
      this._roundPath.obstacles,
      this._roundPath.roadEventsOrdered,
    )
    // Стартовый экран должен быть чистым: первые предметы спавним ниже видимой зоны.
    // Мы знаем высоту видимой области до старта: [camY, camY + H].
    this.spawner.skipTo(this.camY + this.H + TILE * START_SPAWN_OFFSCREEN_TILES)
    this.spawner._onPromoted = () => this._promotedCount++
    this.spawner.onLavaDecorObstacle = so => {
      if (!this.tileWorld) return
      const seed =
        (Math.imul(Math.floor(so.x) ^ 0x9E3779B1, 2246822519) ^
          Math.floor(so.y) ^
          this.worldSeed) >>> 0
      const mask = GameConfig.lava.worldLavaSpawnMask ?? 3
      if ((seed & mask) !== 0) return
      this.tileWorld.spawnCave(so.x, so.y, seed, { lavaTerminal: false })
      const path = this.tileWorld.getLastCavePath()
      if (path) this._caveZones.push(...path.points)
    }

    this.tileWorld.update(this.camX,this.camY,this.W,this.H)
    this.minerLayer.addChild(this.miner.root, this.liveWinBadge)
    this.liveWinAmountCached = ''
    this._updateLiveWinBadge()
    this.miner.chunkParent=this.worldChunkLayer
    this.miner.root.x=this.charX;this.miner.root.y=this.charY
    this.miner.root.scale.x=1
    this._syncLayerScroll()

    const awaitHeroStart = this.miner.heroHasStartDigClip()
    if (awaitHeroStart) {
      // Start должен начаться ровно из текущей позиции персонажа на экране.
      this._startIntroX = this.miner.root.x
      this._startIntroY = this.miner.root.y
      this.miner.setIdleMode(true)
      this.miner.playStartDigTransition()
      this._awaitingStartAnim = true
      this.running = false
    } else {
      this.miner.playStartDigTransition()
      this.miner.setIdleMode(false)
      this._spawnDirtEntry()
      this.running = true
      this._syncSurfaceScenery()
    }
    // skyLayer visibility is managed dynamically in _tick based on camera depth
    this.skyLayer.visible = true
  }

  /**
   * После сбора предмета — путь уже полностью предрассчитан,
   * дополнительная перестройка не нужна.
   * Оставляем метод на случай будущих нужд.
   */
  private _rebuildPathToNext(): void {
    // Path-first архитектура: путь строится один раз в startRound
    // и гарантированно проходит через все road items
  }

  private _rebuildTunnelCumLengths(): void {
    const n = this._tunnelPath.length
    if (this._tunnelCumPathLen !== n) {
      this._tunnelCumLen = tunnelPathCumulativeLengths(this._tunnelPath)
      this._tunnelCumPathLen = n
    }
  }

  /** Спуск в яме LOSS с той же скоростью, что в туннеле (без привязки к дуге path). */
  private _stepLossPitFall(gameDt: number, dt: number): void {
    // Только финальный спуск к лаве — не тянуть X к финишу в промежуточных пещерах
    const pathLy = this._tunnelPath.length ? this._tunnelPath[this._tunnelPath.length - 1]!.y : Infinity
    const nearEnd = this.charY >= pathLy - STEP_PATH_Y * 2.0
    // Не clamp к 1: при большом gameDt иначе X «телепортируется» к центру за один тик.
    if (nearEnd && this._lossTerminalDescent && this._lossLavaCenterX != null) {
      const tx = this._lossLavaCenterX
      const dx = tx - this.charX
      const k = Math.min(0.09, 1.15 * gameDt)
      this.charX += dx * k
      this._velX = 0
    }
    this._speedChangeTimer -= gameDt
    if (this._speedChangeTimer <= 0) {
      this._speedTarget = GameConfig.movement.speedMultMin + Math.random() * (GameConfig.movement.speedMultMax - GameConfig.movement.speedMultMin)
      this._speedChangeTimer = GameConfig.movement.speedChangeMin + Math.random() * (GameConfig.movement.speedChangeMax - GameConfig.movement.speedChangeMin)
    }
    this._speedMult += (this._speedTarget - this._speedMult) * gameDt * GameConfig.movement.speedLerpFactor
    const targetVY = CHAR_SPEED * this._speedMult
    this._velY = targetVY
    this.charY += this._velY * gameDt
    this.depth    = (this.charY - this.surfY) / this.ppm
    this.distance += this._velY * gameDt / this.ppm
    this._velX += (0 - this._velX) * Math.min(dt * 2, 1)
    this.charX += this._velX * gameDt
  }

  /** Случайные waypoints — для хвоста пути после всех road items */
  private _buildWaypoints(n: number): number[] {
    const pts: number[] = []
    let seed = this.worldSeed ^ 0xABCDEF
    const rn = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 0x100000000 }
    let px = 0
    for (let i = 0; i < n; i++) {
      const dir = rn() < 0.5 ? 1 : -1
      px += dir * (TILE * 2 + rn() * TILE * 5)
      px = Math.max(-TILE * 14, Math.min(TILE * 14, px))
      pts.push(Math.round(px / TILE) * TILE)
    }
    return pts
  }

  // ─── Draw helpers ─────────────────────────────────────────────────────────

  private async _loadTextures() {
    if (this._texturesLoading) return this._texturesLoading
    this._texturesLoading = (async () => {
      const loads: [string, string][] = [
        ['coin', GameAssets.coin],
        ['gold', GameAssets.gold],
        ['diamond', GameAssets.gem],
        ['bomba', GameAssets.bomb],
        ['stoun', GameAssets.stone],
        ['home', GameAssets.home],
        ['bg', GameAssets.bg],
        ['rock', GameAssets.rock],
        ['cloud1', GameAssets.cloud1],
        ['cloud2', GameAssets.cloud2],
        ['cloud3', GameAssets.cloud3],
        ['tree1', GameAssets.tree1],
        ['tree2', GameAssets.tree2],
        ['tree3', GameAssets.tree3],
      ]
      for (const [key, url] of loads) {
        try {
          const tex = await PIXI.Texture.fromURL(url)
          if (key === 'bg') {
            tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF
          }
          this._textures.set(key, tex)
        } catch {
          console.warn(`[GameRenderer] Failed to load texture: ${url}`)
        }
      }
      const heroSpine = SpineAnimator.heroReady ? SpineAnimator.createHero(HERO_SPINE_SCALE) : null
      if (heroSpine) {
        this.miner.setHeroSpine(heroSpine)
      } else {
        try {
          const heroTex = await PIXI.Texture.fromURL(GameAssets.hero)
          this.miner.setHeroTexture(heroTex)
        } catch {
          console.warn('[GameRenderer] Failed to load hero texture')
        }
      }
      this.skyLayer.removeChildren()
      this._buildSky()
      this._syncSurfaceScenery()
    })()
    return this._texturesLoading
  }

  private _drawHome(gfx:PIXI.Graphics, _cx:number, _cy:number, sprScale = 0.3) {
    const tex = this._textures.get('home')
    if (tex) {
      const spr = new PIXI.Sprite(tex)
      spr.anchor.set(0.5, 0.5)
      spr.scale.set(sprScale, sprScale)
      spr.x = 0; spr.y = 0
      gfx.addChild(spr)
    } else {
      gfx.beginFill(0x27AE60).drawRect(-60, -60, 120, 120).endFill()
    }
  }

  private _drawLavaCave(gfx:PIXI.Graphics, cx:number, cy:number) {
    // Не рисуем ничего — лава уже визуализируется через LavaSimulation
    // Оставляем невидимый хитбокс для коллизии
  }

  private _drawPickup(gfx:PIXI.Graphics, type:EventType) {
    const typeMap: {[key in EventType]?: string} = {
      'COIN': 'coin', 'GOLD': 'gold', 'DIAMOND': 'diamond',
      'BOMB': 'bomba', 'STONE': 'stoun',
    }
    const fileName = typeMap[type]
    if (fileName) {
      const tex = this._textures.get(fileName)
      if (tex) {
        const spr = new PIXI.Sprite(tex)
        spr.anchor.set(0.5, 0.5)
        const sc = pickupTextureScale(type)
        spr.scale.set(sc, sc)
        gfx.addChild(spr)
        return
      }
    }
    gfx.beginFill(0xFFD700).drawCircle(0, 0, 10).endFill()
  }

  private _getPickupSize(type:EventType): {w:number, h:number} {
    const typeMap: {[key in EventType]?: string} = {
      'COIN': 'coin', 'GOLD': 'gold', 'DIAMOND': 'diamond',
      'BOMB': 'bomba', 'STONE': 'stoun',
    }
    const fileName = typeMap[type]
    if (fileName) {
      const tex = this._textures.get(fileName)
      if (tex) {
        const sc = pickupTextureScale(type)
        return { w: tex.width * sc, h: tex.height * sc }
      }
    }
    return { w: 10, h: 10 }
  }

  private _getHomeSize(): {w:number, h:number} {
    return { w: GameConfig.items.HOME.hitW, h: GameConfig.items.HOME.hitH }
  }

  private _getLavaSize(): {w:number, h:number} {
    return { w: 160, h: 120 }
  }

  /** Сдвиг корня героя вдоль/поперёк касательной туннеля (как при копании). */
  private _heroDigRootOffsetPx(): { ox: number; oy: number } {
    const h = GameConfig.hero.dig
    let ox = 0, oy = 0
    if (this._tunnelPath.length > 1) {
      const tx = this._pathTangentNx, ty = this._pathTangentNy
      if (Math.hypot(tx, ty) > 0.02) {
        const px = -ty, py = tx
        const across =
          h.tunnelOffsetAcrossPx * (tx < -0.02 ? -1 : 1)
        ox = tx * h.tunnelOffsetAlongPx + px * across
        oy = ty * h.tunnelOffsetAlongPx + py * across
      }
      ox += h.tunnelWorldOffsetXPx
      oy += h.tunnelWorldOffsetYPx
    }
    return { ox, oy }
  }

  // ─── Tick ─────────────────────────────────────────────────────────────────

  private _tick(delta:number){
    const dt=Math.min(delta/60, 0.1)  // cap 100ms — безопасно при лагге вкладки
    const store=useGameStore.getState()
    const spd=store.speed
    // gameDt — масштабированное время: вся игровая логика использует его,
    // чтобы spd=2 ускорял буквально всё (движение, анимации, таймеры, частицы).
    // Камера тоже использует gameDt — при высокой скорости она должна быть отзывчивее.
    const gameDt = dt * spd

    if(this.idleActive){
      if(this.tunnelActive) this._hideTunnel()
      this.idleX+=this.idleDir*IDLE_SPEED*dt   // idle не масштабируем — кнопка недоступна
      this._bounceT-=dt
      if(this._bounceT<=0){this._bounceT=3+Math.random()*4;this.idleDir*=-1}
      this.miner.resetFacing()
      this.miner.root.scale.x=this.idleDir
      const hiIdle = GameConfig.hero.idle
      this.miner.root.x = this.idleX + hiIdle.rootOffsetXPx
      this.miner.root.y = this.surfY + hiIdle.rootOffsetYPx
      const tcX = this.miner.root.x - this.W / 2
      this.camX+=(tcX-this.camX)*0.08
      this.camY+=(this.idleCamY-this.camY)*0.08
      this._syncLayerScroll()
      // Параллакс фона — двигается в 0.2x медленнее камеры
      this._syncSkyBgParallax()
      this._updateSkyDecor(dt)
      this._updateWorldMask(this.W, this.H)
      if(this.tileWorld)this.tileWorld.update(this.camX,this.camY,this.W,this.H)
      this.miner.update(dt,0.9,false)
      this._updateLiveWinBadge()
      this._pUpdate(dt);return
    }

    if (this._awaitingStartAnim) {
      this._startIntroY += CHAR_SPEED * gameDt
      this.miner.root.scale.x = 1
      this.miner.orientAlongWorldDir(0, 1, gameDt, 12)
      this.miner.root.x = this._startIntroX
      this.miner.root.y = this._startIntroY
      // Во время интро логическая точка копания следует за реальным положением корня.
      this.charX = this.miner.root.x
      this.charY = this.miner.root.y
      if (!this.tunnelActive) this._showTunnel()
      const tCX = this.charX - this.W / 2
      const tCY = this.charY - this.charScreenY
      const camLerp = Math.min(0.12 * spd, 0.9)
      this.camX += (tCX - this.camX) * camLerp
      this.camY += (tCY - this.camY) * camLerp
      this._syncLayerScroll()
      this._updateTunnel(this.charX - this.camX, this.charY - this.camY)
      const skyVisible = this.camY < this.surfY + TILE * 2
      if (this.skyLayer.visible !== skyVisible) this.skyLayer.visible = skyVisible
      this._syncSkyBgParallax()
      this._updateSkyDecor(dt)
      this._updateWorldMask(this.W, this.H)
      if (this.tileWorld) this.tileWorld.update(this.camX, this.camY, this.W, this.H)
      // Декор/предметы должны быть видны уже во время start-интро.
      // Коллизии остаются выключены, т.к. running=false.
      if (this.spawner) this.spawner.update(this.charX, this.charY, this.H * 5)
      this.miner.update(gameDt, 1, true)
      if (!this.miner.isHeroStartIntroPlaying()) {
        this._awaitingStartAnim = false
        // Стартуем running без скачка корня: переводим root -> char через текущий dig-offset.
        const { ox, oy } = this._heroDigRootOffsetPx()
        this.charX = this.miner.root.x - ox
        this.charY = this.miner.root.y - oy
        this._rebuildTunnelCumLengths()
        // После start фиксируем arc по текущей глубине Y, чтобы не «подбрасывало» вверх
        // из-за ближайшей точки на соседнем сегменте.
        this._pathArcS = tunnelArcLengthAtWorldY(this.charY, this._tunnelPath, this._tunnelCumLen)
        {
          const pt = pointOnTunnelAtArcLength(this._tunnelPath, this._tunnelCumLen, this._pathArcS)
          this._pathTangentNx = pt.nx
          this._pathTangentNy = pt.ny
        }
        this.miner.setIdleMode(false)
        this._spawnDirtEntry()
        this.running = true
        this._syncSurfaceScenery()
      }
      this._pUpdate(gameDt)
      return
    }

    if(!this.running){this._pUpdate(dt);return}

    // ── DIGGING ───────────────────────────────────────────────────────────────

    let canMove=true
    let lavaTrailAx = this.charX
    let lavaTrailAy = this.charY

    if (this.stoneBreakActive) {
      this.stoneBreakRemainingTime -= gameDt
      this.stoneBreakTickTimer     -= gameDt

      // Каждую секунду — шаг уменьшения множителя
      if (this.stoneBreakTickTimer <= 0) {
        const elapsed      = this.stoneBreakTotalDuration - Math.max(0, this.stoneBreakRemainingTime)
        const totalTicks   = Math.floor(this.stoneBreakTotalDuration)
        const ticksDone    = Math.min(Math.floor(elapsed), totalTicks)
        const stepSize     = (this.stoneBreakStartMultiplier - this.multiplier) / Math.max(totalTicks, 1)
        this.stoneBreakDisplayMult = Math.max(
          this.multiplier,
          this.stoneBreakStartMultiplier - stepSize * ticksDone
        )
        this.stoneBreakTickTimer = 0.5 / spd   // следующий тик через 1 игровую секунду
        store.updateStats({ multiplier: Math.round(this.stoneBreakDisplayMult * 100) / 100 })
      }

      // Переключение стадий анимации камня:
      // stage_02 — бурение (выставляется при коллекте)
      // stage_04 — последние BREAK_ACTION_DURATION сек (пробурено)
      if (this._breakSpine) {
        if (this.stoneBreakRemainingTime <= BREAK_ACTION_DURATION && this._breakStage < 3) {
          this._breakStage = 3
          SpineAnimator.setAnimation(this._breakSpine, STONE_STAGE.done, false)
        }
      }

      if (this.stoneBreakRemainingTime <= 0) {
        this.stoneBreakActive = false
        store.updateStats({ multiplier: Math.round(this.multiplier * 100) / 100 })
        this._breakStage = 0
        this._destroyBreakObj()
        this._applyRepulseDeferred('STONE')
        canMove = true
      } else {
        canMove = false
      }
    }

    // Золотой самородок — стоим на месте, множитель визуально растёт до значения RGS
    if (this.goldBreakActive) {
      this.goldBreakRemainingTime -= gameDt
      this.goldBreakTickTimer     -= gameDt

      // Каждую секунду — шаг увеличения множителя
      if (this.goldBreakTickTimer <= 0) {
        const elapsed      = this.goldBreakTotalDuration - Math.max(0, this.goldBreakRemainingTime)
        const totalTicks   = Math.floor(this.goldBreakTotalDuration)
        const ticksDone    = Math.min(Math.floor(elapsed), totalTicks)
        const stepSize     = (this.multiplier - this.goldBreakStartMultiplier) / Math.max(totalTicks, 1)
        this.goldBreakDisplayMult = Math.min(
          this.multiplier,
          this.goldBreakStartMultiplier + stepSize * ticksDone
        )
        this.goldBreakTickTimer = 0.5 / spd   // следующий тик через 1 игровую секунду
        store.updateStats({ multiplier: Math.round(this.goldBreakDisplayMult * 100) / 100 })
      }
      if (Math.random() < 0.3) {
        this._burst(this.charX, this.charY, C.gold, 3)
      }

      // Переключение стадий анимации золота:
      // stage_02 — бурение (выставляется при коллекте)
      // stage_04 — последние BREAK_ACTION_DURATION сек (пробурено)
      if (this._breakSpine) {
        if (this.goldBreakRemainingTime <= BREAK_ACTION_DURATION && this._breakStage < 3) {
          this._breakStage = 3
          SpineAnimator.setAnimation(this._breakSpine, GOLD_STAGE.done, false)
        }
      }

      if (this.goldBreakRemainingTime <= 0) {
        this.goldBreakActive = false
        store.updateStats({ multiplier: Math.round(this.multiplier * 100) / 100 })
        this._breakStage = 0
        this._destroyBreakObj()
        this._applyRepulseDeferred('GOLD')
        canMove = true
      } else {
        canMove = false
      }
    }

    if (canMove) {
      const pathArcBeforeMove = this._pathArcS
      lavaTrailAx = this.charX
      lavaTrailAy = this.charY

      if (this._caveZones.length > 500 && !this._lossTerminalDescent) {
        this._caveZones = this._caveZones.filter(z => z.y > this.camY - TILE * 5)
      }

      // LOSS: при падении ниже полилинии у конца пути включаем терминальный спуск к лаве.
      if (
        this._lossRound &&
        !this._lossTerminalDescent &&
        this._tunnelPath.length &&
        this._tunnelCumLen.length
      ) {
        const ptProbe = pointOnTunnelAtArcLength(this._tunnelPath, this._tunnelCumLen, this._pathArcS)
        const pathLy = this._tunnelPath[this._tunnelPath.length - 1]!.y
        const nearEnd = this.charY >= pathLy - STEP_PATH_Y * 2.0
        if (nearEnd && this.charY > ptProbe.y + STEP_PATH_Y * 0.35) {
          this._lossTerminalDescent = true
        }
      }

      if (this._lossTerminalDescent) {
        this._stepLossPitFall(gameDt, dt)
      } else {
        this._speedChangeTimer -= gameDt
        if (this._speedChangeTimer <= 0) {
          this._speedTarget = GameConfig.movement.speedMultMin + Math.random() * (GameConfig.movement.speedMultMax - GameConfig.movement.speedMultMin)
          this._speedChangeTimer = GameConfig.movement.speedChangeMin + Math.random() * (GameConfig.movement.speedChangeMax - GameConfig.movement.speedChangeMin)
        }
        this._speedMult += (this._speedTarget - this._speedMult) * gameDt * GameConfig.movement.speedLerpFactor

        const targetSpeed = CHAR_SPEED * this._speedMult
        this._velX = 0
        this._repulseTimer = 0

        {
          const yIdx = Math.max(0, Math.floor((this.charY - this.surfY) / STEP_PATH_Y))
          // LOSS: не удлиняем полилинию — терминальная лава привязана к концу buildRoundPath;
          // иначе хвост уезжает в сторону, а лава и падение остаются у старой точки.
          if (!this._lossRound && yIdx >= this._waypoints.length - 10) {
            const more = this._buildWaypoints(200)
            const base = this._tunnelPath.length
            for (let j = 0; j < more.length; j++) {
              this._tunnelPath.push({ x: more[j]!, y: this.surfY + (base + j) * STEP_PATH_Y })
            }
            this._waypoints.push(...more)
          }
        }

        this._rebuildTunnelCumLengths()
        const totalArc = this._tunnelCumLen[this._tunnelCumLen.length - 1] ?? 0
        const arcLerp = GameConfig.movement.arcSpeedLerp
        this._arcSpeedSmoothed += (targetSpeed - this._arcSpeedSmoothed) * Math.min(1, gameDt * arcLerp)
        this._pathArcS = Math.min(this._pathArcS + this._arcSpeedSmoothed * gameDt, totalArc)
        if (this._lossRound && totalArc > 0 && this._pathArcS >= totalArc - 0.05) {
          this._lossTerminalDescent = true
        }
        const pt = pointOnTunnelAtArcLength(this._tunnelPath, this._tunnelCumLen, this._pathArcS)
        this.charX = pt.x
        this.charY = pt.y
        const tSm = GameConfig.movement.tangentSmooth
        const tK = Math.min(1, gameDt * tSm)
        this._pathTangentNx += (pt.nx - this._pathTangentNx) * tK
        this._pathTangentNy += (pt.ny - this._pathTangentNy) * tK
        this._velY = pt.ny * this._arcSpeedSmoothed

        this.depth    = (this.charY - this.surfY) / this.ppm
        this.distance += this._arcSpeedSmoothed * gameDt / this.ppm
      }

      if (
        this.running &&
        !this._ended &&
        !this._lossTerminalDescent &&
        !this.stoneBreakActive &&
        !this.goldBreakActive
      ) {
        const ds = this._pathArcS - pathArcBeforeMove
        if (ds > 0.2) {
          this._digSoundCarry += ds
          const step = TILE * 1.6
          while (this._digSoundCarry >= step) {
            this._digSoundCarry -= step
            gameAudio.playDig()
          }
        }
      }
    } else {
      // STONE / GOLD — плавное торможение по Y; X остаётся на оси туннеля
      this._velY += (0 - this._velY) * Math.min(dt * 10, 1)
      this._velX = 0
      this.charY += this._velY * gameDt
      const txb = pathXAtWorldY(this.charY, this._tunnelPath, this.surfY)
      const kxb = GameConfig.movement.tunnelXSmoothing
      this.charX += (txb - this.charX) * Math.min(1, kxb * gameDt)
      this._rebuildTunnelCumLengths()
      this._pathArcS = projectWorldXYToTunnelArcLength(this._tunnelPath, this._tunnelCumLen, this.charX, this.charY)
      const ptB = pointOnTunnelAtArcLength(this._tunnelPath, this._tunnelCumLen, this._pathArcS)
      this._pathTangentNx = ptB.nx
      this._pathTangentNy = ptB.ny
    }

    // Поворот по касательной туннеля. Без scale.x — иначе зеркалит поворот.
    this.miner.root.scale.x = 1
    if (this._tunnelPath.length > 1) {
      const tx = this._pathTangentNx, ty = this._pathTangentNy
      if (Math.hypot(tx, ty) > 0.02) {
        this.miner.orientAlongWorldDir(tx, ty, gameDt, 12)
      }
    }

    const { ox, oy } = this._heroDigRootOffsetPx()
    this.miner.root.x = this.charX + ox
    this.miner.root.y = this.charY + oy

    if(!this.tunnelActive) this._showTunnel()

    const tCX=this.charX-this.W/2
    const tCY=this.charY-this.charScreenY
    // Камера с gameDt — при высокой скорости закрывает большее расстояние за тик
    const camLerp=Math.min(0.12*spd, 0.9)
    this.camX+=(tCX-this.camX)*camLerp
    this.camY+=(tCY-this.camY)*camLerp

    this._syncLayerScroll()
    // Рисуем туннель после обновления камеры — иначе он «убегает» вперёд.
    this._updateTunnel(this.charX - this.camX, this.charY - this.camY)

    // Show bg sky only when camera is still near the surface
    // surfY is TILE (120px), hide bg when camera has moved more than 1 tile below surface
    const skyVisible = this.camY < this.surfY + TILE * 2
    if (this.skyLayer.visible !== skyVisible) this.skyLayer.visible = skyVisible

    this._syncSkyBgParallax()
    this._updateSkyDecor(dt)

    this._updateWorldMask(this.W, this.H)
    if(this.tileWorld)this.tileWorld.update(this.camX,this.camY,this.W,this.H)
    this._spawnCavesAhead()
    if(this.spawner)this.spawner.update(this.charX,this.charY,this.H*5)

    this.miner.update(gameDt, 1, true)
    this._updateLiveWinBadge()

    store.updateStats({
      depth:    Math.max(0,Math.round(this.depth*10)/10),
      distance: Math.round(this.distance*10)/10,
      // Во время брейков multiplier обновляет их собственная логика (плавно)
      ...((!this.stoneBreakActive && !this.goldBreakActive) && {
        multiplier: Math.round(this.multiplier*100)/100,
      }),
    })

    if(this.spawner && !this._ended && !this.stoneBreakActive){
      this.spawner.checkCollisions(this.charX,this.charY,(obj)=>{
        this._onCollect(obj)
      })
    }

    // Проверяем лаву только после минимального погружения (TILE*5 ≈ первые метры)
    // чтобы исключить ложное срабатывание в самом начале раунда
    const minDepthForLava = this.surfY + TILE * GameConfig.lava.minDepthTiles
    const lavaHit =
      this.lavaSimulation &&
      (this.lavaSimulation.touchesPoint(this.charX, this.charY) ||
        (canMove &&
          this.lavaSimulation.touchesSegment(lavaTrailAx, lavaTrailAy, this.charX, this.charY)))
    if (!this._ended && !this.stoneBreakActive && !this.goldBreakActive && this.charY > minDepthForLava && lavaHit) {
      this._ended=true
      this.running=false
      this.miner.playDie()
      gameAudio.playSfx('sfx_lava.ogg')
      this._burst(this.charX,this.charY,C.lava,20)
      // Потребляем LAVA-ивент из rgsQueue — исход тот же (поражение),
      // просто физическая лава догнала раньше чем SpawnedObj терминал
      const lavaIdx = this.rgsQueue.findIndex(e => e.type === 'LAVA')
      if (lavaIdx >= 0) this.rgsQueue.splice(lavaIdx, 1)
      this._logTerminal('simulation', 'LAVA')
      setTimeout(()=>{
        gameEngine.onRoundComplete(0,false)
        this._returnToIdle()
      },GameConfig.round.loseDelayMs)
    }

    this._pUpdate(gameDt)
  }

  // ─── Сбор объекта ─────────────────────────────────────────────────────────

  // ─── Лог сбора предмета ───────────────────────────────────────────────────

  private _logCollect(type: EventType, before: number, after: number, durationSec?: number): void {
    const tag    = type.padEnd(7)
    const bStr   = `×${before.toFixed(2)}`
    const aStr   = `×${after.toFixed(2)}`
    const delta  = after - before
    const dStr   = (delta >= 0 ? '+' : '') + delta.toFixed(2)
    let effect: string
    switch (type) {
      case 'BOMB':    effect = `÷${(before / Math.max(after, 0.001)).toFixed(1)}`; break
      case 'DIAMOND': effect = `×${(after / Math.max(before, 0.001)).toFixed(2)}`; break
      case 'GOLD': {
        const secs = durationSec ?? 0
        const gain = after - before
        effect = `${secs.toFixed(1)}s → +${gain.toFixed(2)} к мульт`
        break
      }
      case 'STONE': {
        const secs = durationSec ?? 0
        const pct  = before > 0 ? ((before - after) / before * 100) : 0
        const sign = pct >= 0 ? '-' : '+'
        effect = `${secs.toFixed(1)}s → ${sign}${Math.abs(pct).toFixed(1)}% от мульт`
        break
      }
      case 'COIN':    effect = `+${delta.toFixed(2)}`; break
      case 'HOME':    effect = 'WIN ✓'; break
      case 'LAVA':    effect = 'LOSE ✗'; break
      default:        effect = dStr
    }
    console.log(`[${tag}]  до: ${bStr.padStart(6)}  →  после: ${aStr.padStart(6)}  (${dStr}) | ${effect}`)
  }

  private _logTerminal(source: 'object' | 'simulation', type: 'HOME' | 'LAVA'): void {
    console.log(`--- КОНЕЦ РАУНДА [${type}] источник=${source} mult=×${this.multiplier.toFixed(2)} ---`)
    if (this.rgsQueue.length > 0) {
      console.warn(
        `[WARN] В rgsQueue остались необработанные события (${this.rgsQueue.length}):`,
        this.rgsQueue.map(e => `${e.type}(depth=${e.depth})`).join(', ')
      )
      const staleLava = this.rgsQueue.filter(e => e.type === 'LAVA')
      const staleItems = this.rgsQueue.filter(e => e.type !== 'HOME' && e.type !== 'LAVA')
      if (staleLava.length > 0) {
        console.error(
          `[STALE LAVA] Найдено ${staleLava.length} LAVA-ивент(ов) в очереди! depth=${staleLava.map(e=>e.depth).join(',')}`,
          '— это "старая лава" которая не была обработана как объект'
        )
      }
      if (staleItems.length > 0) {
        console.warn(`[SKIP] Пропущены предметы: ${staleItems.map(e=>e.type).join(', ')}`)
      }
    }
  }

  private _onCollect(obj:SpawnedObj){
    const type=obj.type

    if (type === 'STONE') {
      gameAudio.playSfx('sfx_stone.ogg')
      this.stoneBreakActive = true
      this.stoneBreakStartMultiplier = this.multiplier
      const multBefore = this.multiplier
      const rgsIdx = obj.rgsEventRef
        ? this.rgsQueue.findIndex(e => e === obj.rgsEventRef)
        : this.rgsQueue.findIndex(e => e.type === 'STONE')
      let duration = GameConfig.items.STONE.durationMin + Math.random() * (GameConfig.items.STONE.durationMax - GameConfig.items.STONE.durationMin)
      let stoneSub: number | null = null
      if (rgsIdx >= 0) {
        const ev = this.rgsQueue.splice(rgsIdx, 1)[0]
        if (ev.durationMs) duration = ev.durationMs / 1000
        if (ev.effect && ev.effect.op === 'sub') stoneSub = ev.effect.value
      }
      if (stoneSub == null) {
        stoneSub = GameConfig.items.STONE.subValues[
          Math.floor(Math.random() * GameConfig.items.STONE.subValues.length)
        ]
      }
      this.multiplier = Math.max(GameConfig.multiplier.floor, this.multiplier - stoneSub)
      this._logCollect('STONE', multBefore, this.multiplier, duration)
      this.stoneBreakTotalDuration = duration
      this.stoneBreakRemainingTime = duration
      this.stoneBreakDisplayMult   = multBefore   // начинаем с текущего значения
      this.stoneBreakTickTimer     = 0.5           // первый тик через 1 сек
      this._breakStage = 1
      if (obj.spine) {
        console.log('[DEBUG STONE] spine exists, setting stage_02, goldStoneReady=', SpineAnimator.goldStoneReady)
        SpineAnimator.setAnimation(obj.spine, STONE_STAGE.drill, true)
        console.log('[DEBUG STONE] current anim after set:', (obj.spine.state as any).tracks?.[0]?.animation?.name)
        this._breakSpine = obj.spine
        this._breakGfx   = obj.gfx
      } else {
        console.log('[DEBUG STONE] NO spine (null), goldStoneReady=', SpineAnimator.goldStoneReady)
        this._breakSpine = null
        this._breakGfx   = obj.gfx
      }
      this._applyRepulse(obj, true)  // запоминаем направление, импульс — после разрушения
      return
    }

    // Золотой самородок — останавливаемся и получаем ×3/сек пока бурим
    if (type === 'GOLD') {
      gameAudio.playSfx('sfx_gold.ogg')
      this.goldBreakActive = true
      this.goldBreakStartMultiplier = this.multiplier
      const multBefore = this.multiplier
      const rgsIdx = obj.rgsEventRef
        ? this.rgsQueue.findIndex(e => e === obj.rgsEventRef)
        : this.rgsQueue.findIndex(e => e.type === 'GOLD')
      let duration = GameConfig.items.GOLD.durationMin + Math.random() * (GameConfig.items.GOLD.durationMax - GameConfig.items.GOLD.durationMin)
      let goldAdd: number | null = null
      if (rgsIdx >= 0) {
        const ev = this.rgsQueue.splice(rgsIdx, 1)[0]
        if (ev.durationMs) duration = ev.durationMs / 1000
        if (ev.effect && ev.effect.op === 'add') goldAdd = ev.effect.value
      }
      if (goldAdd == null) {
        goldAdd = GameConfig.items.GOLD.addValues[
          Math.floor(Math.random() * GameConfig.items.GOLD.addValues.length)
        ]
      }
      this.multiplier = this.multiplier + goldAdd
      this._logCollect('GOLD', multBefore, this.multiplier, duration)
      this.goldBreakRemainingTime = duration
      this.goldBreakTotalDuration = duration
      this.goldBreakDisplayMult   = multBefore   // начинаем с текущего значения
      this.goldBreakTickTimer     = 1.0           // первый тик через 1 сек
      this._breakStage = 1
      this._burst(obj.worldX, obj.worldY, C.gold, 12)
      if (obj.spine) {
        console.log('[DEBUG GOLD] spine exists, setting stage_02, goldStoneReady=', SpineAnimator.goldStoneReady)
        SpineAnimator.setAnimation(obj.spine, GOLD_STAGE.drill, true)
        console.log('[DEBUG GOLD] current anim after set:', (obj.spine.state as any).tracks?.[0]?.animation?.name)
        this._breakSpine = obj.spine
        this._breakGfx   = obj.gfx
      } else {
        console.log('[DEBUG GOLD] NO spine (null), goldStoneReady=', SpineAnimator.goldStoneReady)
        this._breakSpine = null
        this._breakGfx   = obj.gfx
      }
      this._applyRepulse(obj, true)  // запоминаем направление, импульс — после разрушения
      return
    }

    const multBefore = this.multiplier
    const rgsMatch = obj.rgsEventRef
      ? this.rgsQueue.findIndex(e => e === obj.rgsEventRef)
      : this.rgsQueue.findIndex(e => e.type === type)
    let rgsEffect: { op: 'add'|'sub'|'mul'|'div', value: number } | null = null
    if(rgsMatch>=0){
      const ev = this.rgsQueue.splice(rgsMatch,1)[0]
      if (ev.effect) rgsEffect = ev.effect
    }
    if(type!=='HOME'&&type!=='LAVA'){
      const { floor } = GameConfig.multiplier
      if (rgsEffect) {
        switch (rgsEffect.op) {
          case 'add': this.multiplier = this.multiplier + rgsEffect.value; break
          case 'sub': this.multiplier = Math.max(floor, this.multiplier - rgsEffect.value); break
          case 'mul': this.multiplier = this.multiplier * rgsEffect.value; break
          case 'div': this.multiplier = Math.max(floor, this.multiplier / rgsEffect.value); break
        }
      } else {
        this.multiplier = this._applyEffect(type, this.multiplier)
      }
    }
    this._logCollect(type, multBefore, this.multiplier)
    useGameStore.getState().updateStats({multiplier:Math.round(this.multiplier*100)/100})

    if (!obj.terminal) {
      if (type === 'COIN' || type === 'DIAMOND' || type === 'BOMB' || type === 'HOME' || type === 'LAVA') {
        gameAudio.playCollect(type)
      }
    }

    this._burst(obj.worldX,obj.worldY,C.particleColors[type],type==='HOME'?24:12)
    this._applyRepulse(obj)

    if(obj.terminal){
      this._ended=true
      this.running=false
      if (type === 'LAVA') this.miner.playDie()
      obj.gfx.visible=false

      // Фактический исход определяет RGS — ищем HOME или LAVA в очереди
      const rgsTermIdx = obj.rgsEventRef
        ? this.rgsQueue.findIndex(e => e === obj.rgsEventRef)
        : this.rgsQueue.findIndex(e => e.type === 'HOME' || e.type === 'LAVA')
      let won = type === 'HOME'  // fallback если RGS не прислал терминал
      if (rgsTermIdx >= 0) {
        const rgsTermEv = this.rgsQueue.splice(rgsTermIdx, 1)[0]
        won = rgsTermEv.type === 'HOME'
      }

      if (type === 'HOME') gameAudio.playCollect('HOME', { terminal: true, won })
      else if (type === 'LAVA') gameAudio.playCollect('LAVA', { terminal: true })

      this._logTerminal('object', won ? 'HOME' : 'LAVA')
      setTimeout(()=>{
        gameEngine.onRoundComplete(won?this.multiplier:0,won)
        this._returnToIdle()
      },won ? GameConfig.round.winDelayMs : GameConfig.round.loseDelayMs)
    }else{
      if (obj.valueLabel) {
        if (obj.valueLabel.parent) obj.valueLabel.parent.removeChild(obj.valueLabel)
        obj.valueLabel.destroy()
        obj.valueLabel = undefined
      }
      this._animCollect(obj.gfx, obj.spine)
      // Перестраиваем путь к следующему реальному предмету
      this._rebuildPathToNext()
    }
  }

  /**
   * Вычисляет и запоминает направление подхода к объекту.
   * Вызывается в момент коллизии (сбора).
   * Для STONE/GOLD — только запоминает направление, импульс применяется позже.
   * Для остальных — сразу применяет импульс.
   */
  private _applyRepulse(obj: SpawnedObj, deferred = false): void {
    const cfg = GameConfig.repulsion[obj.type]
    if (!cfg || cfg.strength <= 0) return
    const dx = this.charX - obj.worldX
    const dir = dx !== 0 ? Math.sign(dx) : (Math.random() < 0.5 ? 1 : -1)
    this._repulseDir = dir   // запоминаем направление всегда
    if (!deferred) {
      this._velX = dir * cfg.strength
      this._repulseTimer = Math.max(this._repulseTimer, cfg.freezeDurSec)
    }
  }

  /** Применяет отложенный импульс (вызывается по завершении брейка) */
  private _applyRepulseDeferred(type: string): void {
    const cfg = GameConfig.repulsion[type]
    if (!cfg || cfg.strength <= 0) return
    this._velX = this._repulseDir * cfg.strength
    this._repulseTimer = Math.max(this._repulseTimer, cfg.freezeDurSec)
  }

  private _destroyBreakObj(){
    if (this._breakSpine) { SpineAnimator.remove(this._breakSpine); this._breakSpine = null }
    if (this._breakGfx && !(this._breakGfx as any).destroyed) {
      this._breakGfx.destroy()
    }
    this._breakGfx = null
  }

  private _applyEffect(type:EventType, m:number):number{
    const { floor } = GameConfig.multiplier
    const pick = (arr:number[]) => arr[Math.floor(Math.random() * arr.length)]
    switch(type){
      case 'COIN':    return m + pick(GameConfig.items.COIN.addValues)
      case 'GOLD':    return m  // обрабатывается через goldBreak
      case 'DIAMOND': return m * pick(GameConfig.items.DIAMOND.multValues)
      case 'BOMB':    return Math.max(floor, m / GameConfig.items.BOMB.divisor)
      case 'STONE':   return m  // обрабатывается через stoneBreak
      default:        return m
    }
  }

  // ─── Точка входа — эффект грязи ──────────────────────────────────────────

  private _spawnDirtEntry(): void {
    this._destroyDirtEntry()
  }

  private _destroyDirtEntry(): void {
    if (this._dirtEntry) {
      SpineAnimator.remove(this._dirtEntry)
      this._dirtEntry = null
    }
    if (this._dirtEntryGfx) {
      if (this._dirtEntryGfx.parent) this._dirtEntryGfx.parent.removeChild(this._dirtEntryGfx)
      this._dirtEntryGfx.destroy({ children: true })
      this._dirtEntryGfx = null
    }
  }

  private _returnToIdle(){
    this._hideTunnel()
    this.spawner?.reset(); this.spawner=null

    // Убираем эффект грязи
    this._destroyDirtEntry()

    for (const {renderer} of this.activeLavas.values()) {
      renderer.destroy()
    }
    this.activeLavas.clear()
    this.lavasCavePathUpdated = new WeakSet()
    if (this.lavaSimulation) {
      const lava = this.lavaSimulation as any
      if (lava.container?.parent) lava.container.parent.removeChild(lava.container)
      if (lava.glowGfx?.parent)   lava.glowGfx.parent.removeChild(lava.glowGfx)
      this.lavaSimulation.destroy()
      this.lavaSimulation = null
    }

    if (this.tileWorld) {
      this.tileWorld.lavaSimulation = null
      this.tileWorld.clearRuntimeDigging()
      // В idle не нужен защитный коридор пути.
      this.tileWorld.setPathWaypoints([], this.surfY)
    }

    this.objectsLayer.removeChildren()  // ← чистим объекты при возврате
    this.minerLayer.addChild(this.miner.root)
    this.idleX=this.charX;this.idleDir=1;this._bounceT=3
    this.idleActive=true
    this._awaitingStartAnim = false
    this.miner.setIdleMode(true)
    this.miner.resetFacing()
    this.skyLayer.visible = true    // показываем фон в idle
    {
      const hi = GameConfig.hero.idle
      this.miner.root.x = this.idleX + hi.rootOffsetXPx
      this.miner.root.y = this.surfY + hi.rootOffsetYPx
    }
    this.camX = this.miner.root.x - this.W / 2
    this.camY = this.idleCamY
    this._syncLayerScroll()
    this.stoneBreakActive = false
    this._destroyBreakObj()
  }

  // ─── Particles ────────────────────────────────────────────────────────────

  private _burst(wx:number,wy:number,col:number,n:number){
    for(let i=0;i<n;i++){
      const g=new PIXI.Graphics()
      g.beginFill(col);g.drawCircle(0,0,Math.random()*5+2);g.endFill()
      g.x=wx;g.y=wy;this.objectsLayer.addChild(g)  // ← частицы тоже в objectsLayer
      const a=Math.random()*Math.PI*2,s=Math.random()*100+60
      this.particles.push({gfx:g,vx:Math.cos(a)*s,vy:Math.sin(a)*s-80,life:1})
    }
  }

  private _animCollect(gfx:PIXI.Graphics, spine: import('pixi-spine').Spine | null = null){
    SpineAnimator.remove(spine)
    let t=0
    const tick=()=>{
      t+=0.1;gfx.scale.set(1.5-t*0.5);gfx.alpha=1-t
      if(t>=1){gfx.visible=false;this.app.ticker.remove(tick)}
    }
    this.app.ticker.add(tick)
  }

  private _pUpdate(dt:number){
    SpineAnimator.tick(dt)

    this.particles=this.particles.filter(p=>{
      p.life-=dt*1.8
      if(p.life<=0){this.objectsLayer.removeChild(p.gfx);p.gfx.destroy();return false}
      p.gfx.x+=p.vx*dt;p.gfx.y+=p.vy*dt;p.vy+=260*dt
      p.gfx.alpha=p.life;p.gfx.scale.set(p.life*0.7+0.3);return true
    })

    if (this.lavaSimulation) {
      this.lavaSimulation.setCameraPos(this.camX, this.camY)
      this.lavaSimulation.setViewport(this.W, this.H)
      this.lavaSimulation.cullFarCells(this.camX, this.camY, this.W, this.H)
    }
    if (this.tileWorld) this.tileWorld.updateLavas(dt, this.W, this.H)
  }

  /** Пещера с лавой только если капсула не пересекает коридор маршрута */
  private _spawnCaveClearOfTunnel(wx: number, wy: number, seed: number): boolean {
    if (!this.tileWorld || !this.tileWorld.canSpawnMoreDecorCaves()) return false
    const tunnel = this._tunnelPath
    const surf = this.surfY
    for (let a = 0; a < 12; a++) {
      const s = (seed ^ (a * 0x9E3779B1)) >>> 0
      const dx = ((a % 5) - 2) * TILE * 1.5
      const dy = Math.floor(a / 5) * TILE
      if (this.tileWorld.spawnCave(wx + dx, wy + dy, s, {
        accept: path => !cavePathHitsTunnel(path.points, tunnel, surf, path.rect),
      })) {
        return true
      }
    }
    return false
  }

  private _spawnCavesAhead() {
    if (!this.tileWorld || !this.running) return

    const aheadY = this.charY + this.H * 5.0  // далеко вперёд — текстуры успевают загрузиться
    const path = this._tunnelPath
    const pathEndY = path.length > 0 ? path[path.length - 1]!.y : Infinity
    const perFrameCap = GameConfig.lava.maxCavesSpawnPerFrame ?? 2
    const caveBase = GameConfig.lava.proceduralCaveBaseTiles ?? 20
    const caveDepth = GameConfig.lava.proceduralCaveDepthAdd ?? 6
    const secThr = GameConfig.lava.secondaryCaveChance16 ?? 4
    let spawnedThisTick = 0

    while (spawnedThisTick < perFrameCap) {
      const depthFactor = Math.max(0.5, Math.min(2, (this._lastCaveY - this.surfY) / 2000))
      const interval = TILE * (caveBase + caveDepth * depthFactor)
      if (this._lastCaveY + interval > aheadY) break
      if (this._lastCaveY + interval > pathEndY + TILE * 8) break

      this._lastCaveY += interval
      this._caveSeed = (Math.imul(1664525, this._caveSeed) + 1013904223) >>> 0
      const localSeed = this._caveSeed

      const xOffset = ((localSeed & 0xFF) / 0xFF - 0.5) * TILE * 12
      const caveWY = this._lastCaveY
      const tunX = pathXAtWorldY(caveWY, path, this.surfY)
      const caveWX = tunX + xOffset

      if (spawnedThisTick < perFrameCap && this._spawnCaveClearOfTunnel(caveWX, caveWY, localSeed)) {
        const cavePath1 = this.tileWorld.getLastCavePath()
        if (cavePath1) this._caveZones.push(...cavePath1.points)
        spawnedThisTick++
      }

      const localSeed2 = (Math.imul(69069, localSeed) + 1) >>> 0
      if (
        spawnedThisTick < perFrameCap &&
        (localSeed2 & 0xF) < secThr
      ) {
        const dx2 = ((localSeed2 & 0xFF) / 0xFF - 0.5) * TILE * 8
        const dy2 = TILE * (4 + (localSeed2 & 0x7))
        if (this._spawnCaveClearOfTunnel(caveWX + dx2, caveWY + dy2, localSeed2 ^ 0xABCD)) {
          const cavePath2 = this.tileWorld.getLastCavePath()
          if (cavePath2) this._caveZones.push(...cavePath2.points)
          spawnedThisTick++
        }
      }
    }
  }

  // ─── Resize / destroy ─────────────────────────────────────────────────────

  private _updateWorldMask(w: number, h: number) {
    // Маска только для skyLayer. Слои мира скроллятся одинаково (worldBg / scenery / worldChunk).
    // surfY — мир Y линии травы; на экране верх травы: -camY при world*.y = -camY.
    // During idle, camY is negative (camera above surface), so screenSurfY > 0 — correct.
    // During digging, camY increases, screenSurfY decreases — eventually clips the full height.
    // We always allow a small overlap (surfY on screen) to show the grass line.
    // Маска для skyLayer: показываем небо только в области ВЫШЕ верхнего края травы.
    // Grass row=0 верхний край = world y=0, на экране = (0 - camY) = -camY.
    // Маска = прямоугольник от 0 до screenGrassTop.
    const screenGrassTop = Math.max(0, Math.min(h, -this.camY))
    this._worldMask.clear()
    this._worldMask.beginFill(0xffffff)
    this._worldMask.drawRect(0, 0, w, screenGrassTop)
    this._worldMask.endFill()
  }

  resize(w:number,h:number){
    this.W=w;this.H=h;this.charScreenY=h*0.42
    this.lavaSimulation?.setViewport(w, h)
    this.app.renderer.resize(w,h)
    this.skyLayer.removeChildren();this._buildSky()
    this._updateWorldMask(w, h)
    this._buildTunnel()
    if (this.idleActive) {
      this.camY = this.idleCamY
      this._syncLayerScroll()
    }
  }

  destroy(){
    this.skyLayer.mask=null
    this.worldBgLayer.mask=null
    this.worldChunkLayer.mask=null
    this._worldMask.destroy()
    this.spawner?.reset()
    this.tileWorld?.destroy()
    this.miner.destroy()
    this.app.destroy(false,{children:true,texture:true})
  }
}