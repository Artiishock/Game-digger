import * as PIXI from 'pixi.js'
import { Assets } from 'pixi.js'
import { initDevtools } from '@pixi/devtools'
import { gameEngine }   from './GameEngine'
import { useGameStore } from '../store/gameStore'
import type { RoundEvent, EventType } from '../rgs/client'
import * as RGS from '../rgs/client'
import * as Demo from '../rgs/demo'
import { TileWorld, TILE, tileWorldMaxChunkWindowFromConfig } from './Tileworld'
import { LavaSimulation } from './LavaSimulation'
import { SpineAnimator, HERO_ANIM, ROCK_ANIM, GOLD_ANIM, GOLD_STAGE, STONE_STAGE, BREAK_ACTION_DURATION, getSpineItemSize } from './SpineAnimator'
import type { Spine } from '@esotericsoftware/spine-pixi-v8'
import { GameConfig, computeSceneZoom, effectiveDevicePixelRatio, HERO_MAX_SIDE_PX } from './GameConfig'
import { gameAudio } from '../audio/GameAudio'
import { GameAssets } from './gameAssets'
import { buildRoundPathV2, buildRoundPathV3, cavePathHitsTunnel, decorGenerationHorizontalExtent, distancePointToTunnelPolyline, pruneDecorObstaclesAfterPathChange, tunnelXAtWorldY } from './WorldMap'
import type { FullPathResult, PathPoint, RoadPoint } from './WorldMap'
import { T } from '../i18n/t'
import { GameLogger } from '../dev/GameLogger'
import { perf, installPerfProfiler } from '../dev/PerfProfiler'
import { tickTickerFpsLog } from '../dev/tickerFpsLog'

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
/** Задержка старта прорезки туннеля в интро start-анимации (0 = резка сразу у травы). */
const START_TUNNEL_CARVE_DELAY_SEC = 0
/** Скорость «призрака» в die-сцене: базово ×2; после любого нажатия клавиши/клика — ещё ×3 (итого ×6 к исходной). */
const LAVA_GHOST_BASE_SPEED_MUL = 2
const LAVA_GHOST_INPUT_SPEED_MUL = 3
const CLOUD_DRIFT_PX_S = 14
/** Базовый масштаб спрайта облака (раньше 0.42). */
const CLOUD_SCALE_BASE = 0.35

function getDisplayName(obj: any): string {
  return obj.label || obj.name || obj.constructor?.name || 'Unknown';
}

function collectPixiSceneStats(root: PIXI.Container) {
  const byType = new Map<string, number>();
  const byName = new Map<string, number>();

  let total = 0;
  let visible = 0;
  let renderable = 0;
  let worldVisible = 0;

  function walk(obj: any) {
    total++;

    const type = obj.constructor?.name || 'Unknown';
    byType.set(type, (byType.get(type) ?? 0) + 1);

    const name = getDisplayName(obj);
    byName.set(name, (byName.get(name) ?? 0) + 1);

    if (obj.visible) visible++;
    if (obj.renderable) renderable++;
    if (obj.worldVisible) worldVisible++;

    if (obj.children) {
      for (const child of obj.children) {
        walk(child);
      }
    }
  }

  walk(root);

  console.clear();

  console.warn('[Pixi scene stats]', {
    total,
    visible,
    renderable,
    worldVisible,
  });

  console.warn('[Pixi scene stats] by type');
  console.table(
    [...byType.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([type, count]) => ({ type, count }))
  );

  console.warn('[Pixi scene stats] by name/label');
  console.table(
    [...byName.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([name, count]) => ({ name, count }))
  );
}

function collectPixiSubtreeStats(root: PIXI.Container) {
  const byType = new Map<string, number>();
  const byName = new Map<string, number>();

  let total = 0;
  let visible = 0;
  let renderable = 0;

  function walk(obj: any) {
    total++;
    // In prod builds Pixi classes may get mangled (e.g. '_Container2'),
    // so we count important buckets via instanceof, not constructor.name.
    if (obj instanceof PIXI.Graphics) {
      byType.set('Graphics', (byType.get('Graphics') ?? 0) + 1);
    } else if (obj instanceof PIXI.Sprite) {
      // Includes TilingSprite and normal Sprite.
      byType.set('Sprite', (byType.get('Sprite') ?? 0) + 1);
    } else if (obj instanceof PIXI.Container) {
      byType.set('Container', (byType.get('Container') ?? 0) + 1);
    } else {
      const type = obj.constructor?.name || 'Unknown';
      byType.set(type, (byType.get(type) ?? 0) + 1);
    }

    const name = getDisplayName(obj);
    byName.set(name, (byName.get(name) ?? 0) + 1);

    if (obj.visible) visible++;
    if (obj.renderable) renderable++;

    if (obj.children) {
      for (const child of obj.children) walk(child);
    }
  }

  walk(root);

  return { total, visible, renderable, byType, byName };
}

function collectPixiTopLayerStats(stage: PIXI.Container) {
  const layers = stage.children.filter(Boolean) as PIXI.Container[];
  const out: Array<{
    idx: number;
    name: string;
    type: string;
    total: number;
    renderable: number;
    Sprite: number;
    Graphics: number;
    Container: number;
  }> = [];

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i] as any;
    if (!layer) continue;
    if (!layer.children) continue;

    const st = collectPixiSubtreeStats(layer as PIXI.Container);
    const sprite = st.byType.get('Sprite') ?? 0;
    const gfx = st.byType.get('Graphics') ?? 0;
    const cont = st.byType.get('Container') ?? 0;

    out.push({
      idx: i,
      name: getDisplayName(layer),
      type: layer.constructor?.name || 'Unknown',
      total: st.total,
      renderable: st.renderable,
      Sprite: sprite,
      Graphics: gfx,
      Container: cont,
    });
  }

  out.sort((a, b) => (b.Sprite + b.Graphics + b.Container) - (a.Sprite + a.Graphics + a.Container));
  return out;
}

export function installSceneStats(app: PIXI.Application) {
  const intervalId = window.setInterval(() => {
    collectPixiSceneStats(app.stage);
  }, 1000);

  return () => {
    window.clearInterval(intervalId);
  };
}

export function installTopLayerStats(app: PIXI.Application) {
  const intervalId = window.setInterval(() => {
    const rows = collectPixiTopLayerStats(app.stage);
    console.warn('[Pixi top-layer stats] (sorted by Sprite+Graphics+Container)');
    console.table(rows.slice(0, 20));
  }, 1000);

  return () => {
    window.clearInterval(intervalId);
  };
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
  let lo = 0
  let hi = path.length - 2
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (wy <= path[mid + 1]!.y) hi = mid
    else lo = mid + 1
  }
  const i = lo
  const a = path[i]!
  const b = path[i + 1]!
  const dy = b.y - a.y
  const t = dy > 1e-6 ? (wy - a.y) / dy : 0
  const segLen = (cum[i + 1] ?? cum[i] ?? 0) - (cum[i] ?? 0)
  return (cum[i] ?? 0) + segLen * t
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
  let lo = 0
  let hi = path.length - 2
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid + 1]! >= clampedS) hi = mid
    else lo = mid + 1
  }
  const i = lo
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
    COIN:0xFFD700,GOLD_TICK:0xFFB830,DIAMOND:0x4ECDC4,
    BOMB:0xFF4500,STONE_TICK:0x888888,LAVA:0xFF4500,HOME:0x7CFC00,
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
  if (type === 'GOLD_TICK' || type === 'STONE_TICK') return PICKUP_SPRITE_SCALE * PICKUP_SCALE_GOLD_STONE_MUL
  return PICKUP_SPRITE_SCALE
}

const LIVE_WIN_AMOUNT_OFFSET_Y = 20
/**
 * Бейдж крепится к кости головы, но якорь контейнера — центр строки «MULTIPLIER»;
 * сумма (`fontSize` 25) идёт ниже на `LIVE_WIN_AMOUNT_OFFSET_Y`. Чтобы блок целиком
 * был НАД головой, поднимаем на высоту нижней части бейджа + зазор от макушки.
 */
const LIVE_WIN_BADGE_BELOW_ANCHOR_PX = LIVE_WIN_AMOUNT_OFFSET_Y + 50
const LIVE_WIN_BADGE_GAP_CROWN_TO_BADGE_BOTTOM_PX = 14
const LIVE_WIN_BADGE_LIFT_ABOVE_HEAD_PX =
  LIVE_WIN_BADGE_BELOW_ANCHOR_PX + LIVE_WIN_BADGE_GAP_CROWN_TO_BADGE_BOTTOM_PX

function formatLiveWinAmount(value: number, currency: string): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0
  const display = safeValue >= 100
    ? safeValue.toFixed(0)
    : safeValue.toFixed(2)
  return `${display} ${currency || 'FUN'}`
}

/** Безопасное destroy: HMR / двойной teardown / WebGL уже снят — иначе Pixi кидает refCount. */
function safePixiDestroyDisplay(obj: PIXI.Container | null | undefined): void {
  if (!obj) return
  if ((obj as { destroyed?: boolean }).destroyed) return
  try {
    obj.destroy({ children: true })
  } catch {
    /* ignore */
  }
}

function isInViewWithMargin(
  x: number,
  y: number,
  w: number,
  h: number,
  camX: number,
  camY: number,
  viewW: number,
  viewH: number,
  marginPx: number,
): boolean {
  const halfW = Math.max(1, w * 0.5)
  const halfH = Math.max(1, h * 0.5)
  const left = camX - marginPx
  const right = camX + viewW + marginPx
  const top = camY - marginPx
  const bottom = camY + viewH + marginPx
  return (
    x + halfW >= left &&
    x - halfW <= right &&
    y + halfH >= top &&
    y - halfH <= bottom
  )
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
  /** Длительность клипа `start` (сек); совпадает с начальным `_animHoldSec` при playStartDigTransition. */
  private _heroStartAnimDurationSec = 0
  /** По worldY кости root: после тика Spine — защёлка «ушёл от старта и вернулся» до начала прореза. */
  private _startCarvePoseBaselineY: number | null = null
  private _startCarvePoseDeparted = false
  private _startCarveLatched = false
  /** Остаток hold в момент защёлки — от него считаем 0…1 до конца клипа start. */
  private _startCarveLatchHoldRefSec = 0

  constructor() {
    this.root = new PIXI.Container()
    this.root.sortableChildren = true
  }

  private _setAnim(name: string, loop = true): void {
    if (!this._spine) return
    if (this._activeAnim === name) return
    if (!this._spine.skeleton.data.findAnimation(name)) return
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
    this._heroStartAnimDurationSec = 0
    this._animHoldSec = 0
    this._resetStartCarveLatchPose()
    this._setYOffset(false)
    this._setAnim(HERO_ANIM.idle, true)
    spine.zIndex = 0
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
      this._heroStartAnimDurationSec = 0
      this._resetStartCarveLatchPose()
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
    s.zIndex = 0
    this.root.addChild(s)
    this._spr.y = this._pivotFootCompensateY + GameConfig.hero.idle.spriteOffsetYPx
  }

  setIdleMode(idle: boolean) {
    const active = !idle
    this._setYOffset(active)
    if (this._spine && !this._dieLocked) {
      this._animHoldSec = 0
      this._heroStartAnimDurationSec = 0
      this._resetStartCarveLatchPose()
      this._setAnim(idle ? HERO_ANIM.idle : HERO_ANIM.digLoop, true)
    }
  }

  playStartDigTransition() {
    if (!this._spine || this._dieLocked) return
    const startAnim = this._spine.skeleton.data.findAnimation(HERO_ANIM.start)
    if (!startAnim) {
      this._heroStartAnimDurationSec = 0
      this._resetStartCarveLatchPose()
      this._setAnim(HERO_ANIM.digLoop, true)
      return
    }
    this._resetStartCarveLatchPose()
    this._heroStartAnimDurationSec = Math.max(0.05, startAnim.duration)
    this._animHoldSec = this._heroStartAnimDurationSec
    this._activeAnim = HERO_ANIM.start
    this._spine.state.setAnimation(0, HERO_ANIM.start, false)
    this._spine.state.addAnimation(0, HERO_ANIM.digLoop, true, 0)
  }

  /** LAVA: `loop: true` — `die` крутится, пока идёт подъём. */
  playDie(opts?: { loop?: boolean }) {
    if (!this._spine || this._dieLocked) return
    this._dieLocked = true
    this._animHoldSec = 999
    this._setAnim(HERO_ANIM.die, opts?.loop === true)
  }

  /**
   * Подъём к поверхности: отдельный поворот только у Spine/PNG с die — root (бейдж, контейнер) не вращается.
   */
  applyLavaDeathAscentVisual() {
    this.resetFacing()
    const a = GameConfig.hero.lavaDieExtraRotationRad ?? 0
    if (this._spine) this._spine.rotation = a
    if (this._spr) this._spr.rotation = a
  }

  clearLavaDeathVisualOverride() {
    this.root.scale.set(1, 1)
    this.root.rotation = 0
    this.resetFacing()
  }

  /** Сброс после LAVA-концовки: снова idle в главном меню. */
  resetFromDeath() {
    this.clearLavaDeathVisualOverride()
    if (!this._dieLocked) {
      this._animHoldSec = 0
      this._setYOffset(false)
      if (this._spine) this._setAnim(HERO_ANIM.idle, true)
      return
    }
    this._dieLocked = false
    this._animHoldSec = 0
    this._setYOffset(false)
    if (this._spine) this._setAnim(HERO_ANIM.idle, true)
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
    return !!this._spine.skeleton.data.findAnimation(HERO_ANIM.start)
  }

  /** true пока не истёк hold после playStartDigTransition (анимация старта ещё идёт). */
  isHeroStartIntroPlaying(): boolean {
    return this._animHoldSec > 0
  }

  private _resetStartCarveLatchPose(): void {
    this._startCarvePoseBaselineY = null
    this._startCarvePoseDeparted = false
    this._startCarveLatched = false
    this._startCarveLatchHoldRefSec = 0
  }

  private _readTrackedBoneWorldY(): number | null {
    if (!this._spine) return null
    const skel = this._spine.skeleton as { findBone?(n: string): { worldY?: number; y?: number } | null; bones?: { worldY?: number; y?: number }[] }
    if (!skel) return null
    const b = skel.findBone?.("root") ?? skel.bones?.[0]
    if (!b) return null
    const wy = typeof b.worldY === "number" ? b.worldY : b.y
    return wy != null && Number.isFinite(wy) ? wy : null
  }

  /**
   * Вызывать после SpineAnimator.tick на этом кадре: фиксируем «уйти по Y от начального и вернуться»,
   * затем включается прорезание (до этого getHeroStartTunnelLengthProgress даёт null).
   */
  syncStartCarveLatchAfterSpineTick(): void {
    const START_DEPART = 4
    /** Чуть выше порога замыкания по Y → прорез начинается раньше, до полного совпадения с первым кадром. */
    const START_RETURN = 5.4
    const FALLBACK_TRACK_RATIO = 0.37
    if (!this._spine || this._dieLocked) return
    if (this._activeAnim !== HERO_ANIM.start) return
    if (this._startCarveLatched) return

    const track = (this._spine.state as { tracks?: { trackTime?: number; animation?: { duration?: number } | null }[] }).tracks?.[0]
    const dur = track?.animation?.duration ?? 0
    const tt = typeof track?.trackTime === "number" ? track.trackTime : 0
    const ratio = dur > 1e-6 ? tt / dur : 0

    const y = this._readTrackedBoneWorldY()
    if (y != null) {
      if (this._startCarvePoseBaselineY == null) {
        this._startCarvePoseBaselineY = y
      } else {
        const base = this._startCarvePoseBaselineY
        if (!this._startCarvePoseDeparted && Math.abs(y - base) > START_DEPART) this._startCarvePoseDeparted = true
        if (this._startCarvePoseDeparted && Math.abs(y - base) < START_RETURN) {
          this._startCarveLatched = true
          this._startCarveLatchHoldRefSec = this._animHoldSec
          return
        }
      }
    }
    if (ratio >= FALLBACK_TRACK_RATIO) {
      this._startCarveLatched = true
      this._startCarveLatchHoldRefSec = this._animHoldSec
    }
  }

  /**
   * Доля длины туннеля (0…1) по остатку hold после защёлки «Y снова как в начале».
   * null — прорез ещё не начинать (GameRenderer не вызывает scratch).
   */
  getHeroStartTunnelLengthProgress(): number | null {
    if (!this._spine || this._dieLocked) return null
    if (!this._spine.skeleton.data.findAnimation(HERO_ANIM.start)) return null
    if (this._activeAnim !== HERO_ANIM.start) return 1
    if (!this._startCarveLatched) return null
    const H = this._startCarveLatchHoldRefSec
    if (H <= 1e-6) return 1
    const tLin = Math.max(0, Math.min(1, 1 - this._animHoldSec / H))
    const t = tLin * tLin * (3 - 2 * tLin)
    return Math.max(0.015, Math.min(1, t))
  }

  /**
   * Якорь бейджа в **локальных** координатах `this.root`.
   * Spine: та же геометрия, что у pixi-spine (слот головы или `bone.matrix`), иначе бейдж
   * нельзя вешать на `spine` — каждый `update()` перезаписывает `spine.children` только слотами.
   * Вызывать после `SpineAnimator.tick`.
   */
  getLiveWinBadgePositionInRootLocal(out: PIXI.Point): void {
    const root = this.root
    const spine = this._spine
    if (spine?.skeleton) {
      const skel = spine.skeleton
      const slotContainers = (spine as unknown as { slotContainers?: PIXI.Container[] }).slotContainers
      if (slotContainers && skel.slots) {
        for (let i = 0; i < skel.slots.length; i++) {
          const slot = skel.slots[i]
          if (!slot || slot.bone.data.name !== 'character_head') continue
          const sc = slotContainers[i]
          if (!sc) continue
          out.set(sc.x, sc.y)
          spine.toGlobal(out, out)
          root.toLocal(out, undefined, out)
          return
        }
      }
      const bone = skel.findBone('character_head')
      if (bone) {
        const m = (bone as unknown as { matrix?: { tx?: number; ty?: number } }).matrix
        if (m && typeof m.tx === 'number' && typeof m.ty === 'number') {
          out.set(m.tx, m.ty)
          spine.toGlobal(out, out)
          root.toLocal(out, undefined, out)
          return
        }
      }
    }
    if (this._spr) {
      out.set(0, -HERO_MAX_SIDE_PX * 0.42)
      this._spr.toGlobal(out, out)
      root.toLocal(out, undefined, out)
      return
    }
    out.set(0, -HERO_MAX_SIDE_PX * 0.4)
  }

  update(_dt: number, _spd: number, digging: boolean) {
    if (!this._spr && !this._spine) return
    const inHeroStartIntro =
      !!this._spine &&
      !this._dieLocked &&
      !!this._spine.skeleton.data.findAnimation(HERO_ANIM.start) &&
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
  isSpineSleeping: boolean
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

/** Не разгребать всю очередь safeObjects за один кадр (скачок камеры / fast-forward). */
const SPAWNER_SAFE_STEPS_PER_FRAME = 36

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
  /** Текущая полилиния туннеля — для viewport-спавна вокруг оси движения. */
  private _pathPointsForSpawn: import('./WorldMap').PathPoint[] = []
  private rgsEvents:       RoundEvent[] = []

  _onPromoted: (() => void) | null = null
  /** Декоративные зоны лавы из WorldMap (`kind: 'lava'`) — спавн пещеры в TileWorld */
  onLavaDecorObstacle: ((so: import('./WorldMap').SafeObject) => void) | null = null
  /** Возвращает true, если декоративный объект нельзя спавнить в этой позиции (например, зона лавы). */
  shouldSkipDecorSpawn: ((x: number, y: number, w: number, h: number) => boolean) | null = null
  /**
   * STONE/GOLD после коллизии помечаются `collected`, но `gfx` ещё нужен для сценария бурения
   * (`GameRenderer._breakGfx`). Пока колбэк true — не вызывать `_disposeSpawnedVisual` в update.
   */
  retainCollectedGfx: ((o: SpawnedObj) => boolean) | null = null

  /**
   * Кэш `decorGenerationHorizontalExtent` по полосе Y (как в WorldMap placeObstacles) + viewW.
   * Иначе на каждом safe-шаге заново гоняется tunnelXEnvelopeAroundY (~сотни tunnelXAtWorldY).
   */
  private _horizExtentCache = new Map<number, { minX: number; maxX: number }>()

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

  /** Снимок для __DR_PERF__: объекты спавнера и прогресс safe-декора. */
  getPerfSnapshot(): {
    spawnedObjects: number
    roadItems: number
    safeDecorProgress: string
  } {
    return {
      spawnedObjects: this.objects.length,
      roadItems: this._roadItems.length,
      safeDecorProgress: `${this._safeSpawnedIdx}/${this._safeObjects.length}`,
    }
  }

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
    pathPoints: import('./WorldMap').PathPoint[],
    roadPoints: import('./WorldMap').RoadPoint[],
    safeObjects: import('./WorldMap').SafeObject[],
    roadEventsOrdered: RoundEvent[],
  ) {
    this.rgsEvents     = events
    this._pathPointsForSpawn = [...pathPoints]
    this._roadItems    = []
    this._safeObjects  = [...safeObjects].sort((a, b) => a.y - b.y || a.x - b.x)
    this._safeSpawnedIdx = 0
    this._horizExtentCache.clear()

    for (let i = 0; i < roadPoints.length; i++) {
      const rp = roadPoints[i]
      if (rp.type === 'LAVA') continue
      this._spawnExact(rp.type as EventType, rp.worldX, rp.worldY, rp.terminal)
      const obj = this.objects[this.objects.length - 1]
      if (obj) {
        obj.isRoadItem = true
        obj.rgsEventRef = roadEventsOrdered[i]
        this._attachValueLabel(obj)
        this._roadItems.push(obj)
      }
    }

    if (import.meta.env.DEV) {
      console.log(`[spawner] road items: ${this._roadItems.map(o => `${o.type}@(${o.worldX},${o.worldY.toFixed(0)})`).join(' → ')}`)
    }
  }

  /**
   * Спавним декоративные объекты из pre-calculated safe positions.
   * По мере движения персонажа вниз добавляем объекты впереди.
   */
  update(charY: number, camX: number, camY: number, viewW: number, viewH: number) {
    // Генерим по реальному viewport (а не по позиции героя), чтобы на любых экранах
    // зона подготовки декора масштабировалась от размера видимой области.
    const preloadPx = Math.max(viewH, viewW) * 1.2
    const genUpTo = camY + viewH + preloadPx

    // Спавним безопасные декорации из WorldMap (по мере продвижения)
    const skipDecor = this.shouldSkipDecorSpawn
    let safeSteps = 0
    while (
      safeSteps < SPAWNER_SAFE_STEPS_PER_FRAME &&
      this._safeSpawnedIdx < this._safeObjects.length
    ) {
      const so = this._safeObjects[this._safeSpawnedIdx]
      if (so.y > genUpTo) break
      this._safeSpawnedIdx++
      safeSteps++
      // Совпадает с WorldMap.placeObstacles: полоса следует траектории (envelope zigzag по Y), не точке оси только на этой глубости.
      if (!this._decorSpawnAcceptCached(so.x, so.y, viewW)) continue
      if (so.kind === 'decor') {
        const decorType = so.decorVisual ?? this._pickType(so.y, this._rng(so.y ^ 0xABC))
        const sz = this._sizeForType(decorType)
        if (skipDecor?.(so.x, so.y, sz.w, sz.h)) continue
        this._spawnDecor(so.x, so.y, decorType)
      } else if (so.kind === 'lava') {
        this.onLavaDecorObstacle?.(so)
      }
    }

    // Culling — in-place, без нового массива каждый кадр (GC / CPU).
    const objs = this.objects
    const viewM = TILE * 2.4
    const vLeft = camX - viewM
    const vRight = camX + viewW + viewM
    const vTop = camY - viewM
    const vBottom = camY + viewH + viewM
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i]!
      if (o.collected) {
        if (this.retainCollectedGfx?.(o)) continue
        this._disposeSpawnedVisual(o)
        objs.splice(i, 1)
        continue
      }
      // Сначала дешёвый отсев выше камеры — не дергаем лаву/декор-хуки для «ушедших» объектов.
      if (o.worldY < camY - TILE * 15) {
        this._disposeSpawnedVisual(o)
        objs.splice(i, 1)
        continue
      }
      if (!o.isRoadItem && skipDecor?.(o.worldX, o.worldY, o.width, o.height)) {
        this._disposeSpawnedVisual(o)
        objs.splice(i, 1)
        continue
      }
      const hw = Math.max(1, o.width * 0.5)
      const hh = Math.max(1, o.height * 0.5)
      const inView =
        o.worldX + hw >= vLeft &&
        o.worldX - hw <= vRight &&
        o.worldY + hh >= vTop &&
        o.worldY - hh <= vBottom
      const sleep = !inView
      if (o.spine) {
        if (o.isSpineSleeping !== sleep) {
          o.isSpineSleeping = sleep
          ;(o.spine as any).sleeping = sleep
        }
      }
      if (o.gfx.visible !== inView) o.gfx.visible = inView
      if (o.roadMarker && o.roadMarker.visible !== inView) o.roadMarker.visible = inView
      if (o.valueLabel && o.valueLabel.visible !== inView) o.valueLabel.visible = inView
    }
  }

  private _disposeSpawnedVisual(o: SpawnedObj): void {
    SpineAnimator.remove(o.spine)
    safePixiDestroyDisplay(o.roadMarker)
    safePixiDestroyDisplay(o.valueLabel)
    safePixiDestroyDisplay(o.gfx)
  }

  /**
   * Swept segment collision — fixes missed hits at high speed (×5) + low FPS.
   * Instead of a single point test, we check whether the segment from (x0,y0)
   * to (x1,y1) passes through the item's AABB (including COLL_R margin).
   * The lava system already uses an equivalent segment test (touchesSegment).
   */
  private _roadItemHit(
    x0: number, y0: number,   // start-of-frame position (prev tick)
    x1: number, y1: number,   // end-of-frame position   (this tick)
    o: SpawnedObj,
  ): boolean {
    const hw = Math.max(o.width,  TILE * 0.5) / 2
    const hh = Math.max(o.height, TILE * 0.5) / 2
    const itemTop    = o.worldY - hh - COLL_R
    const itemBottom = o.worldY + hh + COLL_R
    const itemLeft   = o.worldX - hw - COLL_R
    const itemRight  = o.worldX + hw + COLL_R

    // Quick Y-range cull
    const yMin = y0 < y1 ? y0 : y1
    const yMax = y0 < y1 ? y1 : y0
    if (yMax < itemTop || yMin > itemBottom) return false

    // Interpolate X at the item's worldY to check horizontal overlap.
    // Uses the midpoint when there is negligible vertical displacement.
    const dy = y1 - y0
    let xAt: number
    if (Math.abs(dy) < 0.5) {
      xAt = (x0 + x1) * 0.5
    } else {
      const t = Math.max(0, Math.min(1, (o.worldY - y0) / dy))
      xAt = x0 + t * (x1 - x0)
    }
    return xAt > itemLeft && xAt < itemRight
  }

  checkCollisions(
    prevCharX: number, prevCharY: number,
    charX: number, charY: number,
    onCollect: (obj: SpawnedObj) => void,
  ) {
    let best: SpawnedObj | null = null
    for (const o of this.objects) {
      if (o.collected || !o.isRoadItem) continue
      if (!this._roadItemHit(prevCharX, prevCharY, charX, charY, o)) continue
      // Among all swept candidates pick the shallowest (first in direction of travel)
      if (!best || o.worldY < best.worldY || (o.worldY === best.worldY && o.worldX < best.worldX)) best = o
    }
    if (!best) return
    best.collected = true
    onCollect(best)
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
    this._horizExtentCache.clear()
    for (const so of this._safeObjects) so.x += dx
    for (const o of this.objects) {
      o.worldX += dx
      o.gfx.x += dx
      if (o.roadMarker) o.roadMarker.x += dx
      if (o.valueLabel) o.valueLabel.x += dx
    }
  }

  /** Быстрый аналог decorSpawnAcceptByPath с кэшем по Y-полосе (10 px) и ширине экрана. */
  private _decorSpawnAcceptCached(worldX: number, worldY: number, viewW: number): boolean {
    const path = this._pathPointsForSpawn
    if (path.length === 0) return false
    const yKey = Math.round(worldY / 10)
    const cacheKey = yKey * 1_000_003 + (viewW | 0)
    let ext = this._horizExtentCache.get(cacheKey)
    if (!ext) {
      ext = decorGenerationHorizontalExtent(path, worldY, viewW)
      if (this._horizExtentCache.size < 6000) this._horizExtentCache.set(cacheKey, ext)
    }
    return worldX >= ext.minX && worldX <= ext.maxX
  }

  /**
   * После `_destroyBreakObj`: `gfx` уже уничтожен, убрать «висячие» collected-записи STONE/GOLD.
   */
  removeDeferredCollectedBreakVisual(gfx: PIXI.Container) {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i]!
      if (o.collected && o.gfx === gfx) {
        safePixiDestroyDisplay(o.roadMarker)
        safePixiDestroyDisplay(o.valueLabel)
        this.objects.splice(i, 1)
        break
      }
    }
    for (let i = this._roadItems.length - 1; i >= 0; i--) {
      const o = this._roadItems[i]!
      if (o.collected && o.gfx === gfx) {
        this._roadItems.splice(i, 1)
        break
      }
    }
  }

  reset() {
    this.objects.forEach(o => {
      SpineAnimator.remove(o.spine)
      safePixiDestroyDisplay(o.roadMarker)
      safePixiDestroyDisplay(o.valueLabel)
      safePixiDestroyDisplay(o.gfx)
    })
    this.objects         = []
    this._roadItems      = []
    this._safeObjects    = []
    this._safeSpawnedIdx = 0
    this._horizExtentCache.clear()
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
        this.objects.push({ type, gfx, spine: spineInst, isSpineSleeping: false, worldX, worldY, collected: false, terminal, isRoadItem: false, width: size.w, height: size.h })
        return
      }
      this.drawPickup(gfx, type)
      gfx.x = worldX; gfx.y = worldY
    }

    this.layer.addChild(gfx)
    this.objects.push({ type, gfx, spine: null, isSpineSleeping: false, worldX, worldY, collected: false, terminal, isRoadItem: false, width: size.w, height: size.h })
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
      this.objects.push({ type, gfx, spine: null, isSpineSleeping: false, worldX, worldY, collected: false, terminal: false, isRoadItem: false, width: size.w, height: size.h })
      return
    }
    const spineInst = SpineAnimator.createItem(type)
    if (spineInst) {
      gfx.x = worldX; gfx.y = worldY
      gfx.addChild(spineInst)
      this.layer.addChild(gfx)
      this.objects.push({ type, gfx, spine: spineInst, isSpineSleeping: false, worldX, worldY, collected: false, terminal: false, isRoadItem: false, width: size.w, height: size.h })
      this._attachValueLabel(this.objects[this.objects.length - 1])
      return
    }
    this.drawPickup(gfx, type)
    gfx.x = worldX; gfx.y = worldY
    this.layer.addChild(gfx)
    this.objects.push({ type, gfx, spine: null, isSpineSleeping: false, worldX, worldY, collected: false, terminal: false, isRoadItem: false, width: size.w, height: size.h })
    this._attachValueLabel(this.objects[this.objects.length - 1])
  }

  private _attachMarker(obj: SpawnedObj): void {
    const m = new PIXI.Graphics()
    m.x = obj.worldX; m.y = obj.worldY
    const r = Math.max(obj.width, obj.height) * 0.55 + 10
    m.circle(0, 0, r).stroke({ width: 3, color: 0xFFD700, alpha: 1 })
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
    const label = new PIXI.Text({ text: `${prefix}${value}`, style: {
      fontFamily:  cfg.fontFamily,
      fontSize:    tier.fontSize,
      fontWeight:  cfg.fontWeight as PIXI.TextStyleFontWeight,
      fill:        tier.color,
      stroke:      { color: cfg.strokeColor, width: cfg.strokeThickness },
      align:       'center',
      dropShadow:  sh.enabled ? { color: sh.color, angle, distance: dist, blur: sh.blur, alpha: sh.alpha } : undefined,
    }})
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
    if (r < types.coinBase + bombChance + stoneChance) return 'STONE_TICK'
    if (r < types.goldThreshold)                       return 'GOLD_TICK'
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

interface Particle{gfx:PIXI.Sprite;vx:number;vy:number;life:number}
interface FloatText{txt:PIXI.Text;vy:number;life:number}

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
/**
 * Центр тройки idle-деревьев в «нулевом» слоте сетки (m0=0).
 * Сдвиг m0 от `anchorX` нужно считать от него, а не от базы tree2: иначе при сильном сдвиге камеры
 * (лавовый idle слева) `Math.round((anchorX - 420)/step)` даёт лишний −1 и tree1 уезжает на −3880.
 */
const TREE_IDLE_TRIPLET_CENTER_X = (TREE_X_IDLE[0] + TREE_X_IDLE[1] + TREE_X_IDLE[2]) / 3
/** Шаг между соседними копиями одного дерева в idle (мир px), не от ширины канваса (= 1920×1.5). */
const TREE_IDLE_COPY_STEP_PX = TILE * 24

// ─── GameRenderer ─────────────────────────────────────────────────────────────

export class GameRenderer {
  app:PIXI.Application
  /** Resolves when PixiJS renderer + ticker are ready (app.init completes). */
  ready!:Promise<void>
  /** Подложка под выкопом (текстура земли / цвет из TileWorld.bgLight). */
  private worldBgLayer:   PIXI.Container
  /** Чанки травы/земли и лава — поверх неба и деревьев. */
  private worldChunkLayer: PIXI.Container
  private objectsLayer: PIXI.Container  // ← объекты всегда поверх чанков
  private skyLayer:     PIXI.Container
  /** Все облака под `rockSprite` (как весь `skyLayer` под `_sceneryLayer` с деревьями). */
  private readonly _skyCloudLayer = new PIXI.Container()
  private _sceneryLayer: PIXI.Container = new PIXI.Container()
  private minerLayer:   PIXI.Container = new PIXI.Container()
  private miner: SpriteCharacter
  private liveWinBadge: PIXI.Container = new PIXI.Container()
  private liveWinTitleText: PIXI.Text = new PIXI.Text({ text: T('win label'), style: {
    fontFamily: 'Arial Black, Arial, sans-serif',
    fontSize: 14,
    fontWeight: '800',
    fill: 0xFFFFFF,
    stroke: { color: 0x000000, width: 2 },
    align: 'center',
  }})
  private liveWinAmountText: PIXI.Text = new PIXI.Text({ text: '', style: {
    fontFamily: 'Arial Black, Arial, sans-serif',
    fontSize: 25,
    fontWeight: '900',
    fill: 0xFACB32,
    stroke: { color: 0x000000, width: 2 },
    align: 'center',
  }})
  private liveWinAmountCached = ''
  private _liveWinBadgeFading = false
  private _liveWinBadgeFadeT = 1
  private readonly _badgeAnchorScratch = new PIXI.Point()
  private _cloudT = 0
  private _cloudPrevCamX: number | null = null
  private _cloudSpawnTimer = 0
  private _cloudCount = 6
  private _lastWorldMaskGrassTop = -999
  private _lastWorldMaskW = 0
  private _particleTexture: PIXI.Texture = PIXI.Texture.EMPTY
  private _forestSprite: PIXI.TilingSprite | null = null
  private _forestMask: PIXI.Graphics | null = null
  private _prevScrollCamX = NaN
  private _prevScrollCamY = NaN
  private _lastSentDepth = -1
  private _lastSentDistance = -1
  private _lastSentMultiplier = -1
  private spawner:ObjectSpawner|null=null
  private tunnelActive = false
  private W=0; private H=0
  private _resizeRaf = 0
  private _pendingResizeW = 0
  private _pendingResizeH = 0
  /** Масштаб сцены (0.25–1). app.stage.scale = _zoom; виртуальные W/H = actualSize/_zoom. */
  private _zoom = 1.0
  private camX=0; private camY=0
  private tileWorld:TileWorld|null=null
  private worldSeed=0xdeadbeef
  private get surfY(){ return TILE }
  private get idleCamY(){ return this.surfY-this.H*0.70 }

  // Idle
  private idleActive=true
  private idleX=0; private idleDir=1; private _bounceT=0

  /** Page Visibility: стоп тикера в фоне; при возврате — снова лимит FPS для idle. */
  private readonly _onPageVisibility = (): void => {
    const cfg = GameConfig.performance
    if (!this.app || !cfg.pauseTickerWhenPageHidden) return
    if (document.visibilityState === 'hidden') {
      this.app.ticker.stop()
    } else {
      this.app.ticker.start()
      this._syncTickerPowerSave()
    }
  }

  // Round
  private running=false
  /** Spine start_2 играет до первого кадра с running=true (копание ещё не началось). */
  private _awaitingStartAnim=false
  /** Во время стартовой анимации фиксируем X, чтобы герой шёл строго вниз. */
  private _startIntroX=0
  /** Во время стартовой анимации текущий экранный Y корня героя. */
  private _startIntroY=0
  /** Сколько секунд осталось до начала прорезки туннеля в start-интро. */
  private _startTunnelCarveDelaySec = 0
  private charX=0; private charY=0
  private charScreenY=0
  private multiplier=0; private depth=0; private distance=0
  private particles:Particle[]=[]
  private floatTexts:FloatText[]=[]
  private _particlePool:PIXI.Sprite[]=[]
  private _floatTextPool:PIXI.Text[]=[]
  private _collectAnims:Array<{gfx:PIXI.Graphics;t:number}>=[]
  private ppm=TILE*2
  private rgsQueue:RoundEvent[]=[]
  private rgsEvents:RoundEvent[]=[]   // оригинальный список — нужен для вычисления дельты
  /** Совпадает с `store.roundID` после `startRound` для этого раунда; иначе мгновенный финиш недоступен (RAF ещё не применил события). */
  private _rendererRoundId = ''

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
  /** Смерть в лаве: камера застывает, один персонаж с die летит вверх за время `finish_lose.ogg`. */
  private _lavaDeathCinematic = false
  private _lavaDeathX = 0
  private _lavaDeathRootY = 0
  /** Кадр камеры застывает с момента контакта с лавой. */
  private _lavaFrozenCamX = 0
  private _lavaFrozenCamY = 0
  /** Мировая Y верхней границы, при достижении корень считается ушедшим за экран (−Y = вверх). */
  private _lavaDeathExitWorldY = 0
  /** Подбирается как (старт − exit) / (длина_SFX × deathSceneMotionScale). */
  private _lavaDeathAscentSpeedPx = 0
  /** true между `_tryStartLavaDeathCinematic` и успешным handoff cleanup; не смешиваем с WIN-idle. */
  private _lavaExitFlightActive = false
  /** После loseDelayMs: камера летит из застывшего подзёмного вида к кадру idle без мгновенного телепорта. */
  private _lavaLossIdleGlideActive = false
  private _lavaLossIdleGlideT = 0
  private _lavaLossIdleGlideDurSec = 1
  private _lavaLossIdleGlideFromCx = 0
  private _lavaLossIdleGlideFromCy = 0
  private _lavaLossIdleGlideToCx = 0
  private _lavaLossIdleGlideToCy = 0
  private _lavaLossTimeoutPending = false
  private _lavaLossResultTimerId: ReturnType<typeof setTimeout> | null = null
  /** HOME/LAVA через `_onCollect` / лава в движении — отменяется в `startRound`, иначе двойной исход после раннего спина. */
  private _terminalOutcomeTimerId: ReturnType<typeof setTimeout> | null = null
  /** Режим ускорения x10 при повторном нажатии Spin во время RUNNING. */
  private _turboActive = false
  private _pendingOutcomeFn: (() => void) | null = null
  private _pendingLossResultFn: (() => void) | null = null
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
  private _stoneCrashPlayed = false;   // crash уже сыгран в финальной фазе

  // Золотой самородок — останавливает персонажа, множитель растёт ×3/сек
  private goldBreakActive = false;
  private goldBreakRemainingTime = 0;
  private goldBreakTotalDuration = 0;
  private goldBreakStartMultiplier = 0;
  private goldBreakTickTimer = 0;       // таймер до следующего тика (+N/сек)
  private goldBreakDisplayMult = 0;    // текущее отображаемое значение
  private _goldCrashPlayed = false;     // crash уже сыгран в финальной фазе (как у камня)

  // Активный объект во время брейка (показываем action-анимацию)
  private _breakSpine: import('@esotericsoftware/spine-pixi-v8').Spine | null = null;
  private _breakGfx:   PIXI.Graphics | null = null;
  // Стадия брейка: 0=idle(не начат), 1=state1, 2=state2, 3=action
  private _breakStage = 0;

  // Кэш текстур
  private _textures: Map<string, PIXI.Texture> = new Map()
  private _texturesLoading: Promise<void> | null = null

  // Эффект грязи в точке входа (dirt_show → dirt_idle)
  private _dirtEntry: import('@esotericsoftware/spine-pixi-v8').Spine | null = null
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
    // ── Адаптивный zoom по min(W,H): виртуальный мир крупнее экрана → объекты масштабируются ──
    this._zoom = computeSceneZoom(w, h)
    this.W = w / this._zoom   // виртуальная ширина мира (игровая логика работает в этих пикселях)
    this.H = h / this._zoom   // виртуальная высота мира
    const dpr = effectiveDevicePixelRatio()
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)
    const aa = GameConfig.performance.webglAntialias

    // PixiJS v8: new Application() без аргументов — renderer и ticker создаются в async init()
    this.app = new PIXI.Application()
    // stage.scale применяется до первого render — объекты в виртуальных px отображаются в реальные
    this.app.stage.scale.set(this._zoom)

    // ─── Текстура частиц через canvas — не требует renderer ───────────────
    {
      const sz = 16
      const cvs = document.createElement('canvas')
      cvs.width = sz; cvs.height = sz
      const ctx2d = cvs.getContext('2d')!
      ctx2d.fillStyle = '#ffffff'
      ctx2d.beginPath(); ctx2d.arc(sz / 2, sz / 2, sz / 2, 0, Math.PI * 2); ctx2d.fill()
      this._particleTexture = PIXI.Texture.from(cvs)
    }

    this.skyLayer    = new PIXI.Container()
    this.worldBgLayer   = new PIXI.Container()
    this.worldChunkLayer = new PIXI.Container()
    this.objectsLayer= new PIXI.Container()

    this.worldBgLayer.label = 'worldBgLayer'
    this.skyLayer.label = 'skyLayer'
    this._skyCloudLayer.label = 'skyCloudLayer'
    this._sceneryLayer.label = 'sceneryLayer'
    this.worldChunkLayer.label = 'worldChunkLayer'
    this.objectsLayer.label = 'objectsLayer'
    this.minerLayer.label = 'minerLayer'
    this._worldMask.label = 'worldMask'

    // app.stage — class field в v8, доступен до init()
    this.app.stage.addChild(
      this.worldBgLayer,
      this.skyLayer,
      this.worldChunkLayer,
      this.objectsLayer,
      this.minerLayer,
    )

    this._worldMask = new PIXI.Graphics()
    this._worldMask.label = 'worldMask'
    // addChild и mask= переносим в .then() — до init() AlphaMaskPipe не инициализирован
    // Маска рисуется в виртуальных пикселях — stage.scale переводит их в экранные
    this._updateWorldMask(this.W, this.H)

    this.charScreenY = this.H * 0.42  // виртуальная позиция Y персонажа на экране
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
    this.miner.root.addChild(this.liveWinBadge)
    this.minerLayer.addChild(this.miner.root)
    this.camX = this.idleX + GameConfig.hero.idle.rootOffsetXPx - w / 2
    this.camY = this.idleCamY
    this._syncLayerScroll()
    this._buildTunnel()
    this._loadTextures()
    void SpineAnimator.load()
    void SpineAnimator.loadHero().then(() => {
      if (!this.app) return
      const heroSpine = SpineAnimator.createHero(HERO_SPINE_SCALE)
      if (heroSpine) {
        this.miner.setHeroSpine(heroSpine)
        SpineAnimator.setHighPriority(heroSpine, true)
      }
    })
    SpineAnimator.loadGoldStone()

    // ─── Async PixiJS init: renderer + ticker доступны только после этого ──
    this.ready = this.app.init({
      canvas,
      width:w, height:h,
      backgroundColor:C.bg,
      antialias:aa,
      resolution:dpr,
      autoDensity:true,
      hello:false,
      powerPreference:'high-performance',
    } as any).then(() => {
      if (!this.app) return  // компонент размонтирован до завершения init
      // Маска skyLayer требует инициализированного AlphaMaskPipe — только после init()
      this.app.stage.addChild(this._worldMask)
      this.skyLayer.mask = this._worldMask
      // _sceneryLayer (лес + деревья) живёт внутри skyLayer — наследует маску и не просвечивает через туннель
      this.skyLayer.addChild(this._sceneryLayer)
      this._lastWorldMaskGrassTop = Infinity  // сброс кэша, чтобы _updateWorldMask точно отрисовал
      this._updateWorldMask(this.W, this.H)
      this.app.ticker.add(this._tick.bind(this))
      this._installPageVisibilityPowerSave()
      this._syncTickerPowerSave()
      if (
        GameConfig.performance.pauseTickerWhenPageHidden &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        this.app.ticker.stop()
      }
      if (import.meta.env.DEV) {
        ;(window as any).__PIXI_DEVTOOLS__ = {
          pixi:     PIXI,
          app:      this.app,
          stage:    this.app.stage,
          renderer: this.app.renderer,
        }
        ;(window as any).__PIXI_APP__ = this.app
        initDevtools({ app: this.app })
        installPerfProfiler()
        if ((window as any).__DR_TOP_LAYER_STATS__) {
          installTopLayerStats(this.app)
        }
      }
    })
  }

  private _createLiveWinBadge(): void {
    this.liveWinBadge.visible = false
    this.liveWinBadge.zIndex = 20
    this.liveWinBadge.addChild(this.liveWinTitleText, this.liveWinAmountText)
    this.liveWinTitleText.anchor.set(0.5)
    this.liveWinAmountText.anchor.set(0.5)
    this.liveWinTitleText.position.set(0, 0)
    this.liveWinAmountText.position.set(0, LIVE_WIN_AMOUNT_OFFSET_Y)
  }

  private _updateLiveWinBadge(dt = 0): void {
    const store = useGameStore.getState()
    if ((!this.running || this.idleActive || this._ended) && !this._liveWinBadgeFading) {
      this.liveWinBadge.visible = false
      return
    }

    if (this._liveWinBadgeFading) {
      this._liveWinBadgeFadeT = Math.max(0, this._liveWinBadgeFadeT - dt / 0.5)
      this.liveWinBadge.alpha = this._liveWinBadgeFadeT
      if (this._liveWinBadgeFadeT <= 0) {
        this._liveWinBadgeFading = false
        this.liveWinBadge.visible = false
        this.liveWinBadge.alpha = 1
        return
      }
    } else {
      this.liveWinBadge.alpha = 1
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

    this.miner.getLiveWinBadgePositionInRootLocal(this._badgeAnchorScratch)
    this._badgeAnchorScratch.y -= LIVE_WIN_BADGE_LIFT_ABOVE_HEAD_PX
    this.liveWinBadge.position.copyFrom(this._badgeAnchorScratch)
    this.liveWinBadge.rotation = 0
    this.liveWinBadge.scale.set(1)
    this.liveWinBadge.visible = true
  }

  private _syncLayerScroll() {
    if (this.camX === this._prevScrollCamX && this.camY === this._prevScrollCamY) return
    this._prevScrollCamX = this.camX
    this._prevScrollCamY = this.camY
    const dpr = (this.app.renderer as PIXI.Renderer | undefined)?.resolution ?? 1
    const x = -Math.round(this.camX * dpr) / dpr
    const y = -Math.round(this.camY * dpr) / dpr
    this.worldBgLayer.position.set(x, y)
    this._sceneryLayer.position.set(x, y)
    this.worldChunkLayer.position.set(x, y)
    this.objectsLayer.position.set(x, y)
    this.minerLayer.position.set(x, y)
  }

  /**
   * Камера: тот же темп сходимости к цели, что и фиксированный lerp за кадр при 60 FPS,
   * но масштабированный по реальному `dt` — на 30/120 Hz персонаж не «уезжает» к краю экрана.
   */
  private _camFollowAlpha(lerpPerTickAt60: number, dtStep: number): number {
    const l = Math.min(Math.max(lerpPerTickAt60, 1e-6), 0.95)
    const n = 60 * Math.max(0, dtStep)
    if (n <= 0) return 0
    return 1 - Math.pow(1 - l, n)
  }

  private _buildTunnel(){
    if (this.tileWorld) {
      this.tileWorld.renderer = this.app.renderer as PIXI.Renderer
      this.tileWorld.initMasks()
    }
  }

  /** Прогресс длины прореза start-интро (0–1): только для `_awaitingStartAnim`; иначе `null`. */
  private _updateTunnel(sx: number, sy: number, tunnelLengthProgress: number | null = null) {
      if (this.tileWorld) {
      // При LAVA или подъезде к idle не стираем туннель в фоне.
      if (this._lavaDeathCinematic || this._lavaLossIdleGlideActive) return
      this.tileWorld.scratchAt(sx, sy, this.camX, this.camY, this._pathTangentNx, this._pathTangentNy, tunnelLengthProgress)
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

  private _makeIdleWorld() {
    if (this.tileWorld) {
      this.tileWorld.destroy()
      this.tileWorld = null
    }
    // Сначала трава/чанки, затем дожидаемся текстур (constructor уже вызывает _loadTextures()).
    // Иначе первый _syncSurfaceScenery уходит без forest/tree — пустой сценарий на старте.
    void TileWorld.loadGrassTex().then(async () => {
      await this.ready  // гарантируем что app.renderer доступен
      if (!this.app) return
      this.tileWorld = new TileWorld(this.worldBgLayer, this.worldChunkLayer, this.worldSeed)
      this.tileWorld.renderer = this.app.renderer as PIXI.Renderer
      this.tileWorld.initMasks()
      this.tileWorld.update(-this.W * 2, this.idleCamY, this.W, this.H, { w: this.W * 5, h: this.H * 2 })
      this._initLavaSimulation()
      await this._loadTextures()
      if (!this.app) return
      this._syncSurfaceScenery()
    })
  }

  private _initLavaSimulation() {
    if (this.lavaSimulation) {
      // Reuse existing instance — avoid destroying/recreating GL shaders on every round.
      this.lavaSimulation.reset()
      this.lavaSimulation.setViewport(this.W, this.H)
    } else {
      this.lavaSimulation = new LavaSimulation()
      this.lavaSimulation.setViewport(this.W, this.H)
      const lava = this.lavaSimulation as any
      this.worldChunkLayer.addChild(lava.container)
    }
    if (this.tileWorld) {
      this.tileWorld.lavaSimulation = this.lavaSimulation
    }
  }

  /** Обновляет размеры неба/скалы без сноса слоя — убирает чёрный кадр в Chrome при resize. */
  private _resizeSkyInPlace(): void {
    const top = Math.max(0, Math.min(this.H, -this.camY))
    const bgTex = this._textures.get('bg')
    let bg = this.skyLayer.getChildByLabel('bgSprite') as PIXI.TilingSprite | null
    if (bgTex) {
      const bgH = this.H * 0.70
      const sc = bgH / bgTex.height
      if (!bg) {
        bg = new PIXI.TilingSprite({ texture: bgTex, width: this.W, height: bgH })
        bg.tileScale.set(sc, sc)
        bg.tilePosition.set(0, 0)
        bg.roundPixels = true
        bg.y = 0
        bg.label = 'bgSprite'
        this.skyLayer.addChildAt(bg, 0)
      } else {
        bg.texture = bgTex
        bg.width = this.W
        bg.height = bgH
        bg.tileScale.set(sc, sc)
      }
    } else if (bg) {
      this.skyLayer.removeChild(bg)
      bg.destroy()
    }

    if (!this._skyCloudLayer.parent) {
      const rock = this.skyLayer.getChildByLabel('rockSprite')
      const idx = rock ? this.skyLayer.getChildIndex(rock) : this.skyLayer.children.length
      this.skyLayer.addChildAt(this._skyCloudLayer, Math.max(0, idx))
    }

    const rockTex = this._textures.get('rock')
    let rock = this.skyLayer.getChildByLabel('rockSprite') as PIXI.Sprite | null
    if (rockTex) {
      const rh = this.H * 0.5
      if (!rock) {
        rock = new PIXI.Sprite(rockTex)
        rock.label = 'rockSprite'
        rock.anchor.set(0.5, 1)
        this.skyLayer.addChild(rock)
      } else {
        rock.texture = rockTex
      }
      rock.scale.set(rh / rockTex.height)
      rock.x = this.W * 0.58
      rock.y = top - 6
    } else if (rock) {
      this.skyLayer.removeChild(rock)
      rock.destroy()
    }

    if (!this._sceneryLayer.parent) {
      this.skyLayer.addChild(this._sceneryLayer)
    }
  }

  private _buildSky(){
    this._cloudCount = 10
    for (let i = this._skyCloudLayer.children.length - 1; i >= 0; i--) {
      const ch = this._skyCloudLayer.removeChildAt(i)
      ch.destroy({ children: true })
    }
    const bgTex = this._textures.get('bg')
    if (bgTex) {
      const bgH = this.H * 0.70
      const sc = bgH / bgTex.height
      const spr = new PIXI.TilingSprite({ texture: bgTex, width: this.W, height: bgH })
      spr.tileScale.set(sc, sc)
      spr.tilePosition.set(0, 0)
      spr.roundPixels = true
      spr.y = 0
      spr.label = 'bgSprite'
      this.skyLayer.addChild(spr)
    } else {
      const s1=new PIXI.Graphics()
      s1.rect(0,0,this.W,this.H*0.50).fill(C.skyDeep)
      const s2=new PIXI.Graphics()
      s2.rect(0,this.H*0.20,this.W,this.H*0.35).fill(C.sky)
      this.skyLayer.addChild(s1,s2)
    }

    this.skyLayer.addChild(this._skyCloudLayer)

    const cloudKeys = ['cloud1','cloud2','cloud3','cloud4','cloud5','cloud6'] as const
    const topAtBuild = Math.max(0, Math.min(this.H, -this.camY))
    const spreadW = Math.max(this.W, 900)
    for (let i = 0; i < 10; i++) {
      const ct = this._textures.get(cloudKeys[i % 6]!)
      if (!ct) continue
      const c = new PIXI.Sprite(ct)
      c.label = `cloud${i + 1}`
      c.anchor.set(0.5, 0.5)
      const scl = CLOUD_SCALE_BASE * (0.75 + Math.random() * 0.45)
      c.scale.set(scl)
      const drift = CLOUD_DRIFT_PX_S
      c.x = -spreadW * 0.3 + (i / 50) * spreadW * 4.6
      const dy = -(this.H * (0.25 + Math.random() * 0.30))
      c.y = topAtBuild + dy
      ;(c as PIXI.Sprite & { _topDy: number })._topDy = dy
      ;(c as PIXI.Sprite & { _drift: number })._drift = drift
      this._skyCloudLayer.addChild(c)
    }

    const rockTex = this._textures.get('rock')
    if (rockTex) {
      const rock = new PIXI.Sprite(rockTex)
      rock.label = 'rockSprite'
      rock.anchor.set(0.5, 1)
      const rh = this.H * 0.5
      rock.scale.set(rh / rockTex.height)
      rock.x = this.W * 0.58
      rock.y = topAtBuild - 6
      this.skyLayer.addChild(rock)
    }

    if (!this._sceneryLayer.parent) {
      this.skyLayer.addChild(this._sceneryLayer)
    }
  }

  private _syncSurfaceScenery() {
    // Не трогаем TilingSprite «forest» — пересоздание даёт кадр без текстуры / мигание.
    for (let i = this._sceneryLayer.children.length - 1; i >= 0; i--) {
      const ch = this._sceneryLayer.children[i]!
      if (ch.label === 'forest') continue
      this._sceneryLayer.removeChildAt(i)
      ch.destroy({ children: true })
    }

    const forestTex = this._textures.get('forest')
    if (forestTex) {
      const sc = this.H * 0.2 / forestTex.height
      const forestH = forestTex.height * sc
      const pad = 4
      let forest = this._forestSprite
      if (!forest) {
        forest = new PIXI.TilingSprite({ texture: forestTex, width: this.W, height: forestH + pad })
        forest.label = 'forest'
        const forestMask = new PIXI.Graphics()
        forestMask.rect(0, pad, this.W, forestH).fill(0xffffff)
        forest.addChild(forestMask)
        forest.mask = forestMask
        this._sceneryLayer.addChildAt(forest, 0)
        this._forestSprite = forest
        this._forestMask = forestMask
      } else {
        forest.texture = forestTex
        forest.width = this.W
        forest.height = forestH + pad
        forest.tileScale.set(sc)
        if (this._forestMask) {
          this._forestMask.clear()
          this._forestMask.rect(0, pad, this.W, forestH).fill(0xffffff)
        }
      }
      forest.tileScale.set(sc)
      forest.y = TREE_ANCHOR_WORLD_Y - forestH - 140
      this._syncForestToCamera()
    } else {
      const dead = this._forestSprite
      if (dead) {
        // Clear mask before removeChild — PixiJS v8 needs _renderGroup valid to tear down AlphaMask.
        dead.mask = null
        this._sceneryLayer.removeChild(dead)
        dead.destroy({ children: true })
        this._forestSprite = null
        this._forestMask = null
      }
    }

    const keys = ['tree1', 'tree2', 'tree3'] as const

    // Idle: копии деревьев по X с фиксированным шагом; сдвигаем сетку к центру экрана, иначе после
    // глубокого раунда (большой world X) все копии остаются слева от камеры — «пропадают».
    const tileW = TREE_IDLE_COPY_STEP_PX
    const anchorX = this.camX + this.W * 0.5
    const m0 = Math.round((anchorX - TREE_IDLE_TRIPLET_CENTER_X) / tileW)
    const COPIES = 6
    for (let i = 0; i < 3; i++) {
      const tex = this._textures.get(keys[i])
      if (!tex) continue
      const targetH = TREE_HEIGHTS_PX[i]!
      const lift0 = i === 0 ? targetH * TREE0_LIFT_FRAC_OF_HEIGHT : 0
      const baseX = TREE_X_IDLE[i]!
      for (let k = -COPIES; k <= COPIES; k++) {
        const s = new PIXI.Sprite(tex)
        if (k === 0) s.label = keys[i]
        s.anchor.set(0.5, 1)
        s.x = baseX + (m0 + k) * tileW
        s.y = TREE_ANCHOR_WORLD_Y + TREE_Y_OFFSET[i]! - lift0
        s.scale.set(targetH / tex.height)
        this._sceneryLayer.addChild(s)
      }
    }
  }


  /** Целочисленный сдвиг тайла неба — убирает вертикальный шов TilingSprite при параллаксе. */
  private _syncSkyBgParallax() {
    const bg = this.skyLayer.getChildByLabel('bgSprite') as PIXI.TilingSprite | null
    if (!bg) return
    bg.tilePosition.x = 0
    bg.tilePosition.y = 0
  }

  /** Лес привязан к camX; вызывать после любого скачка камеры до первого _tick (старт раунда / спин). */
  private _syncForestToCamera(): void {
    const forest = this._forestSprite
    if (!forest) return
    forest.x = this.camX
    forest.tilePosition.x = -this.camX * 0.4
    forest.tilePosition.y = 0
  }

  private _updateSkyDecor(dt: number) {
    this._cloudT += dt
    const camDx = this._cloudPrevCamX === null ? 0 : (this.camX - this._cloudPrevCamX)
    this._cloudPrevCamX = this.camX
    const top = Math.max(0, Math.min(this.H, -this.camY))
    const rock = this.skyLayer.getChildByLabel('rockSprite') as PIXI.Sprite | null
    if (rock) {
      rock.x = this.W * 0.58
      rock.y = top - 6
    }
    for (const ch of this._skyCloudLayer.children) {
      const name = (ch as PIXI.Container).name ?? ''
      if (!name.startsWith('cloud')) continue
      const c = ch as PIXI.Sprite & { _drift?: number; _topDy?: number }
      const drift = c._drift ?? CLOUD_DRIFT_PX_S
      c.x += drift * dt
      c.y = top + (c._topDy ?? c.y - top)
      const half = (c.texture?.width ?? 100) * 0.5 * Math.abs(c.scale.x)
      if (c.x > this.W + half + 20) {
        const cloudKeys = ['cloud1','cloud2','cloud3','cloud4','cloud5','cloud6'] as const
        const tex = this._textures.get(cloudKeys[Math.floor(Math.random() * 6)]!)
        if (tex) c.texture = tex
        const scl = CLOUD_SCALE_BASE * (0.75 + Math.random() * 0.45)
        c.scale.set(scl)
        const newHalf = (tex?.width ?? 100) * 0.5 * scl
        c._drift = CLOUD_DRIFT_PX_S
        c.x = -newHalf - 20 - CLOUD_DRIFT_PX_S * (2 + Math.random() * 3)
        const dy = -(this.H * (0.25 + Math.random() * 0.30))
        c._topDy = dy
        c.y = top + dy
      }
    }
    this._syncForestToCamera()

    if (this._cloudCount < 10) {
      this._cloudSpawnTimer -= dt
      if (this._cloudSpawnTimer <= 0) {
        this._spawnCloud(top)
        this._cloudCount++
        this._cloudSpawnTimer = 1.5 + Math.random() * 2
      }
    }
  }

  private _spawnCloud(top: number) {
    const cloudKeys = ['cloud1','cloud2','cloud3','cloud4','cloud5','cloud6'] as const
    const tex = this._textures.get(cloudKeys[Math.floor(Math.random() * 6)]!)
    if (!tex) return
    const c = new PIXI.Sprite(tex) as PIXI.Sprite & { _drift: number; _topDy: number }
    c.label = `cloud_dyn_${this._cloudCount}`
    c.anchor.set(0.5, 0.5)
    const scl = CLOUD_SCALE_BASE * (0.75 + Math.random() * 0.45)
    c.scale.set(scl)
    const half = tex.width * 0.5 * scl
    c.x = -half - 20
    const dy = Math.random() * this.H * 0.25
    c._topDy = dy
    c.y = top + dy
    c._drift = CLOUD_DRIFT_PX_S
    this._skyCloudLayer.addChild(c)
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
    // После смягчения старта пересчитываем X дорожных точек по финальному пути,
    // сохраняя Y-глубину каждой точки неизменной.
    for (const rpPoint of rp.roadPoints) {
      rpPoint.worldX = tunnelXAtWorldY(rp.pathPoints, rpPoint.worldY)
    }
  }

  /** Финальный runtime-filter: декор не должен касаться фактического коридора пути. */
  private _pruneDecorNearTunnelPath(obstacles: import('./WorldMap').SafeObject[]): import('./WorldMap').SafeObject[] {
    const path = this._roundPath?.pathPoints
    if (!path || path.length === 0) return obstacles
    return obstacles.filter((o) => {
      if (o.kind !== 'decor') return true
      const halfW = Math.max(1, o.w * 0.5)
      const halfH = Math.max(1, o.h * 0.5)
      const radius = Math.hypot(halfW, halfH)
      const d = distancePointToTunnelPolyline(o.x, o.y, path)
      return d > radius + TILE * 0.06
    })
  }

  // ─── Round ────────────────────────────────────────────────────────────────

  startRound(events:RoundEvent[],_spd:number){
    const _t0 = performance.now()
    const startX = this.miner.root.x
    const startY = this.miner.root.y
    const startCamX = this.camX
    const startCamY = this.camY

    if (this._terminalOutcomeTimerId !== null) {
      clearTimeout(this._terminalOutcomeTimerId)
      this._terminalOutcomeTimerId = null
    }

    this.running=false;this.idleActive=false;this._ended=false
    this._awaitingStartAnim=false
    this._startTunnelCarveDelaySec = 0
    this._cleanupLavaDeathCinematic()
    this.miner.resetFromDeath()
    this._lavaLossTimeoutPending = false
    this._lavaLossIdleGlideActive = false
    this._lavaLossIdleGlideT = 0
    if (this._lavaLossResultTimerId !== null) {
      clearTimeout(this._lavaLossResultTimerId)
      this._lavaLossResultTimerId = null
    }
    this._pendingOutcomeFn = null
    this._pendingLossResultFn = null
    this._turboActive = false
    this.multiplier=0;this.depth=0;this.distance=0
    this.particles=[]
    this.floatTexts=[]
    this.rgsQueue=[...events]
    this.rgsEvents=events
    this._rendererRoundId = ''
    this._lossRound = events.some(e => e.type === 'LAVA')
    {
      const _st = useGameStore.getState()
      GameLogger.roundStart({ roundID: _st.roundID, bet: _st.bet, events })
    }
    this.stoneBreakActive = false;
    this.stoneBreakRemainingTime = 0;
    this.stoneBreakTotalDuration = 0;
    this.stoneBreakStartMultiplier = 0;
    this.stoneBreakTickTimer = 0;
    this.stoneBreakDisplayMult = 0;
    this._stoneCrashPlayed = false;
    this.goldBreakActive = false;
    this.goldBreakRemainingTime = 0;
    this.goldBreakTotalDuration = 0;
    this.goldBreakStartMultiplier = 0;
    this.goldBreakTickTimer = 0;
    this.goldBreakDisplayMult = 0;
    this._goldCrashPlayed = false;
    this._breakStage = 0;
    this._destroyBreakObj();

    this.spawner?.reset()
    this.objectsLayer.removeChildren()  // ← чистим объекты

    const lastEv  = events[events.length-1]
    const depthM  = Math.max(lastEv.depth,20)
    const spread = GameConfig.round.depthSpreadScreenFactor ?? 2.5
    this.ppm      = Math.max(TILE*2, Math.round((this.H * spread)/depthM/TILE)*TILE)

    const store = useGameStore.getState()
    if (store.replayMode) {
      if (store.worldSeed !== 0) {
        this.worldSeed = store.worldSeed
        console.log('[Replay] startRound — using SAVED worldSeed:', this.worldSeed)
      } else {
        this.worldSeed = events.reduce((a,e,i)=>a^(e.depth*31+i*97),0x1337) >>> 0
        console.log('[Replay] startRound — using DETERMINISTIC worldSeed (Stake):', this.worldSeed)
      }
    } else {
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
      this.worldSeed = (baseSeed ^ randSalt) >>> 0
      console.log('[Round] startRound — new worldSeed:', this.worldSeed, '(baseSeed:', baseSeed, ')')
      store.setWorldSeed(this.worldSeed)
    }
    if (!this.tileWorld) {
      TileWorld.loadGrassTex().then(() => {
        this.tileWorld?.rebuildTunnelBgFromTextures()
      })
      this.tileWorld = new TileWorld(this.worldBgLayer, this.worldChunkLayer, this.worldSeed)
      this.tileWorld.renderer = this.app.renderer as PIXI.Renderer
      this.tileWorld.initMasks()
    } else {
      // Единая сцена: не пересоздаём мир — полный сброс следов копания/пещер между раундами
      // (ранний спин в WIN мог пропустить `_returnToIdle` → только resetScratch недостаточно).
      this.tileWorld.clearRuntimeDigging()
      this.tileWorld.resetScratch()
      this.tileWorld.showBg()
    }
    this._initLavaSimulation()

    const _t1 = performance.now() // after tileWorld reset + lava init

    this._promotedCount=0
    this._speedMult = 1.0; this._speedTarget = 1.0; this._speedChangeTimer = 0
    this._arcSpeedSmoothed = CHAR_SPEED
    this._velY = 0; this._velX = 0
    this._repulseTimer = 0
    this._repulseDir   = 1
    this._lossTerminalDescent = false
    this._caveZones    = []
    this._collectAnims = []
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
    this.spawner.retainCollectedGfx = (o) => this._breakGfx !== null && this._breakGfx === o.gfx
    // ── Строим полный маршрут ДО спавна объектов ────────────────────────────
    this._roundPath = buildRoundPath(this.worldSeed, this.surfY, this.ppm, events, this.W)
    const initialPathX = tunnelXAtWorldY(this._roundPath.pathPoints, startY)
    this._shiftRoundPathX(startX - initialPathX)
    this._softenRoundPathStart(startX)
    this._roundPath.obstacles = pruneDecorObstaclesAfterPathChange(
      this._roundPath.pathPoints,
      this.surfY,
      this._roundPath.obstacles,
    )
    this._roundPath.obstacles = this._pruneDecorNearTunnelPath(this._roundPath.obstacles)
    this._waypoints   = this._roundPath.waypoints
    this._tunnelPath  = this._roundPath.pathPoints.map(p => ({ x: p.x, y: p.y }))
    this._lossLavaCenterX = null  // будет обновлён после спавна терминальной пещеры
    this._promotedCount = 0
    this.charX = tunnelXAtWorldY(this._tunnelPath, this.charY)
    this._tunnelCumPathLen = 0  // invalidate cache — new round, new geometry
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

    const _t2 = performance.now() // after buildRoundPath + path geometry

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
        // Целевой X для притяжения персонажа = реальный центр лавовой пещеры, а не ось туннеля
        this._lossLavaCenterX = tc.x
        if (import.meta.env.DEV) {
          if (!ok) {
            console.warn('[GameRenderer] terminal lava cave spawn returned false, using fallback zone only')
          } else {
            console.log(`[GameRenderer] terminal cave (${tc.x.toFixed(0)}, ${tc.y.toFixed(0)})`)
          }
        }
      }
    }

    const _t3 = performance.now() // after setPathWaypoints + terminal cave

    // Передаём точные позиции road items + safe objects в spawner
    this.spawner.setRgsEvents(
      events,
      this.ppm,
      this._roundPath.pathPoints,
      this._roundPath.roadPoints,
      this._roundPath.obstacles,
      this._roundPath.roadEventsOrdered,
    )
    // Логируем плановый маршрут: позиции предметов на карте vs ожидания RGS
    {
      const _surfY = this.surfY
      const _ppm   = this.ppm
      const _items = this.spawner.getRoadItems()
      GameLogger.pathPlan(_items.map((it, i) => ({
        seq:          i + 1,
        type:         it.type,
        worldX:       it.worldX,
        worldY:       it.worldY,
        actualDepthM: (_ppm > 0) ? (it.worldY - _surfY) / _ppm : 0,
        rgsDepthM:    it.rgsEventRef?.depth ?? 0,
        rgsDistM:     it.rgsEventRef?.distance ?? 0,
        terminal:     it.terminal,
      })))
    }

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
    this.spawner.shouldSkipDecorSpawn = (x, y, w, h) =>
      !!this.lavaSimulation?.decorBlocksSpawnAt(x, y, w, h)

    const _t4 = performance.now() // after spawner.setRgsEvents

    this.tileWorld.update(this.camX,this.camY,this.W,this.H)
    const _t5 = performance.now() // after tileWorld.update (chunk builds)

    this.minerLayer.addChild(this.miner.root)
    this.liveWinAmountCached = ''
    this.miner.chunkParent=this.worldChunkLayer
    this.miner.root.x=this.charX;this.miner.root.y=this.charY
    this.miner.root.scale.x=1
    this._syncLayerScroll()
    // До первого _tick лес иначе один кадр с параллаксом от старой камеры (idle) — заметно при нажатии спина.
    this._syncForestToCamera()

    const _t6 = performance.now() // end of startRound
    performance.mark('dr-renderer-end')
    performance.measure('[DR] renderer.startRound total', 'dr-raf-fired', 'dr-renderer-end')
    if (import.meta.env.DEV) {
      console.table({
        'tileWorld reset + lava':  { ms: (_t1 - _t0).toFixed(1) },
        'buildRoundPath + geom':   { ms: (_t2 - _t1).toFixed(1) },
        'setPathWaypoints + cave': { ms: (_t3 - _t2).toFixed(1) },
        'spawner.setRgsEvents':    { ms: (_t4 - _t3).toFixed(1) },
        'tileWorld.update (chunks)':{ ms: (_t5 - _t4).toFixed(1) },
        'rest (miner/sync)':       { ms: (_t6 - _t5).toFixed(1) },
        '── RENDERER TOTAL':       { ms: (_t6 - _t0).toFixed(1) },
      })
    }

    const awaitHeroStart = this.miner.heroHasStartDigClip()
    if (awaitHeroStart) {
      // Start должен начаться ровно из текущей позиции персонажа на экране.
      this._startIntroX = this.miner.root.x
      this._startIntroY = this.miner.root.y
      this.miner.setIdleMode(true)
      this.miner.playStartDigTransition()
      this._awaitingStartAnim = true
      this._startTunnelCarveDelaySec = START_TUNNEL_CARVE_DELAY_SEC
      this.running = false
    } else {
      this.miner.playStartDigTransition()
      this.miner.setIdleMode(false)
      this._spawnDirtEntry()
      this.running = true
      this._syncSurfaceScenery()
    }
    this._rendererRoundId = useGameStore.getState().roundID
    // skyLayer visibility is managed dynamically in _tick based on camera depth
    this.skyLayer.visible = true
    this._syncTickerPowerSave()
    SpineAnimator.tick(0)
    this.miner.update(0, 1, !this.running)
    this._updateLiveWinBadge()
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
    // Притяжение к центру лавовой пещеры — прогрессивно усиливается при приближении.
    if (this._lossLavaCenterX != null) {
      const tx = this._lossLavaCenterX
      const dx = tx - this.charX
      const distToEnd = Math.max(0, pathLy - this.charY)
      const t = 1 - Math.min(1, distToEnd / (TILE * 4))
      const k = Math.min(0.95, (0.12 + t * 0.7) * gameDt * 60)
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
        ['cloud4', GameAssets.cloud4],
        ['cloud5', GameAssets.cloud5],
        ['cloud6', GameAssets.cloud6],
        ['forest', GameAssets.forest],
        ['tree1', GameAssets.tree1],
        ['tree2', GameAssets.tree2],
        ['tree3', GameAssets.tree3],
      ]
      for (const [key, url] of loads) {
        try {
          const tex = await Assets.load<PIXI.Texture>(url)
          if (key === 'bg') {
            tex.source.mipLevelCount = 1
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
          const heroTex = await Assets.load<PIXI.Texture>(GameAssets.hero)
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
      gfx.rect(-60, -60, 120, 120).fill(0x27AE60)
    }
  }

  private _drawLavaCave(gfx:PIXI.Graphics, cx:number, cy:number) {
    // Не рисуем ничего — лава уже визуализируется через LavaSimulation
    // Оставляем невидимый хитбокс для коллизии
  }

  private _drawPickup(gfx:PIXI.Graphics, type:EventType) {
    const typeMap: {[key in EventType]?: string} = {
      'COIN': 'coin', 'GOLD_TICK': 'gold', 'DIAMOND': 'diamond',
      'BOMB': 'bomba', 'STONE_TICK': 'stoun',
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
    gfx.circle(0, 0, 10).fill(0xFFD700)
  }

  private _getPickupSize(type:EventType): {w:number, h:number} {
    const typeMap: {[key in EventType]?: string} = {
      'COIN': 'coin', 'GOLD_TICK': 'gold', 'DIAMOND': 'diamond',
      'BOMB': 'bomba', 'STONE_TICK': 'stoun',
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

  // ─── LAVA: камера без движения, призрак с die летит вверх за длительность finish_lose.ogg ─

  private _cleanupLavaDeathCinematic(opts?: { snapToSurfaceIdlePose?: boolean }): void {
    const didLava = this._lavaExitFlightActive
    if (didLava) this._lavaExitFlightActive = false
    this._lavaDeathCinematic = false
    if (!didLava) return
    if (opts?.snapToSurfaceIdlePose === false) return

    this.miner.clearLavaDeathVisualOverride()
    this.miner.root.visible = true
    const hi = GameConfig.hero.idle
    this.miner.root.x = this._lavaDeathX
    this.miner.root.y = this.surfY + hi.rootOffsetYPx
    this.camX = this._lavaDeathX - this.W / 2
    this.camY = this.idleCamY
    this._syncLayerScroll()
    this._syncSkyBgParallax()
  }

  /** Всегда true: fallbacks — старый setTimeout(lose) не нужен. */
  private _tryStartLavaDeathCinematic(): boolean {
    const m = GameConfig.lava.deathSceneMotionScale ?? 1
    const sfxSec =
      gameAudio.getSfxBufferDurationSec('finish_lose.ogg') ??
      GameConfig.lava.finishLoseSfxDurationFallbackSec
    const denom = Math.max(1e-3, sfxSec * m)

    this._lavaDeathCinematic = true
    this._lavaLossTimeoutPending = false
    this._liveWinBadgeFading = true
    this._liveWinBadgeFadeT = 1
    this._lavaDeathX = this.charX
    this._lavaDeathRootY = this.miner.root.y
    this._lavaFrozenCamX = this.camX
    this._lavaFrozenCamY = this.camY
    // Верх кадра в мирах ≈ frozenCamY; запас чтобы спрайт целиком ушёл над краем.
    const offTopPx = TILE * 2 + HERO_MAX_SIDE_PX * 0.42
    this._lavaDeathExitWorldY = this._lavaFrozenCamY - offTopPx
    const distPx = Math.max(TILE, this._lavaDeathRootY - this._lavaDeathExitWorldY)
    this._lavaDeathAscentSpeedPx = distPx / denom * (GameConfig.lava.deathAscentSpeedMul ?? 1)

    this._lavaExitFlightActive = true
    this.miner.root.visible = true
    this.miner.applyLavaDeathAscentVisual()

    return true
  }

  private _scheduleLavaLossResult(): void {
    if (this._lavaLossTimeoutPending) return
    this._lavaLossTimeoutPending = true
    const cb = () => {
      this._lavaLossTimeoutPending = false
      this._lavaLossResultTimerId = null
      this._pendingLossResultFn = null
      gameEngine.onRoundComplete(0, false)
      this._startLavaLossIdleGlideOrIdle()
    }
    this._pendingLossResultFn = cb
    this._lavaLossResultTimerId = setTimeout(cb, this._turboActive ? 0 : GameConfig.round.loseDelayMs)
  }

  /** Skip the lava death cinematic on any user input. Returns true if something was skipped. */
  skipLavaDeath(): boolean {
    const active = this._lavaDeathCinematic || this._lavaLossIdleGlideActive || this._lavaLossTimeoutPending
    if (!active) return false

    const needsRoundComplete = this._lavaDeathCinematic

    if (this._lavaLossResultTimerId !== null) {
      clearTimeout(this._lavaLossResultTimerId)
      this._lavaLossResultTimerId = null
    }
    this._pendingLossResultFn = null
    this._lavaLossTimeoutPending = false
    this._lavaLossIdleGlideActive = false
    this._returnToIdle()

    if (needsRoundComplete) {
      void gameEngine.onRoundComplete(0, false)
    }
    return true
  }

  /**
   * Повторный Spin во время RUNNING: ускоряем анимацию до x10 скорости.
   * Если уже в turbo-режиме — игнорируем.
   */
  activateTurbo(): void {
    if (this._turboActive) return
    if (!this.running || this._ended || this.idleActive) return
    this._turboActive = true
    if (this._terminalOutcomeTimerId !== null && this._pendingOutcomeFn) {
      clearTimeout(this._terminalOutcomeTimerId)
      this._terminalOutcomeTimerId = null
      const fn = this._pendingOutcomeFn
      this._pendingOutcomeFn = null
      setTimeout(fn, 0)
    }
    if (this._lavaLossResultTimerId !== null && this._pendingLossResultFn) {
      clearTimeout(this._lavaLossResultTimerId)
      this._lavaLossResultTimerId = null
      const fn = this._pendingLossResultFn
      this._pendingLossResultFn = null
      setTimeout(fn, 0)
    }
  }

  /**
   * Повторный Spin во время RUNNING: сразу считаем исход как после сбора всех предметов
   * по цепочке `rgsEvents` (тот же порядок эффектов, что при обычном прохождении).
   */
  async instantFinishRoundFromRoad(): Promise<void> {
    const store = useGameStore.getState()
    if (store.phase !== 'RUNNING') return
    if (this.idleActive || this._ended) return
    if (this._awaitingStartAnim) return
    if (this.rgsEvents.length === 0) return
    if (!store.roundID || this._rendererRoundId !== store.roundID) return

    const { mult, won } = this._computeFullRoadOutcome(this.rgsEvents)
    this.multiplier = mult
    store.updateStats({ multiplier: Math.round(mult * 100) / 100 })

    if (this._lavaLossResultTimerId !== null) {
      clearTimeout(this._lavaLossResultTimerId)
      this._lavaLossResultTimerId = null
    }
    if (this._terminalOutcomeTimerId !== null) {
      clearTimeout(this._terminalOutcomeTimerId)
      this._terminalOutcomeTimerId = null
    }
    this._pendingOutcomeFn = null
    this._pendingLossResultFn = null
    this._lavaLossTimeoutPending = false

    this._ended = true
    this.running = false
    this._awaitingStartAnim = false
    this._lossTerminalDescent = false

    this.stoneBreakActive = false
    this.goldBreakActive = false
    this.stoneBreakRemainingTime = 0
    this.goldBreakRemainingTime = 0
    this._destroyBreakObj()

    gameAudio.setLoop('drill.ogg', false)
    this._cleanupLavaDeathCinematic({ snapToSurfaceIdlePose: false })
    this._lavaDeathCinematic = false
    this._lavaExitFlightActive = false
    this._lavaLossIdleGlideActive = false
    this.miner.clearLavaDeathVisualOverride()

    this.rgsQueue = []

    if (won) {
      gameAudio.playCollect('HOME', { terminal: true, won: true, multiplier: mult })
    } else {
      gameAudio.stopMusicForLose()
      gameAudio.playCollect('LAVA', { terminal: true })
    }

    this._logTerminal('simulation', won ? 'HOME' : 'LAVA')

    await gameEngine.onRoundComplete(won ? mult : 0, won)
    this._returnToIdle()
  }

  /** После звука/задержки: либо ~1 с выезда камеры к поверхности, либо сразу сборка idle. */
  private _startLavaLossIdleGlideOrIdle(): void {
    const glideSec = GameConfig.round.loseIdleGlideSec ?? 1
    if (!this._lavaExitFlightActive || glideSec <= 0) {
      this._returnToIdle()
      return
    }

    this._lavaDeathCinematic = false

    this._lavaLossIdleGlideDurSec = glideSec
    this._lavaLossIdleGlideT = 0
    this._lavaLossIdleGlideActive = true

    this._lavaLossIdleGlideFromCx = this._lavaFrozenCamX
    this._lavaLossIdleGlideFromCy = this._lavaFrozenCamY
    this._lavaLossIdleGlideToCx = this._lavaDeathX - this.W / 2
    this._lavaLossIdleGlideToCy = this.idleCamY

    // Показываем "нового" idle-героя сразу во время подъёма камеры:
    // он уже стоит в финальной позиции, куда прилетит камера.
    const hi = GameConfig.hero.idle
    this.miner.clearLavaDeathVisualOverride()
    this.miner.resetFromDeath()
    this.miner.setIdleMode(true)
    this.miner.root.visible = true
    this.miner.root.x = this._lavaDeathX
    this.miner.root.y = this.surfY + hi.rootOffsetYPx
  }

  private _tickLavaLossIdleGlide(dt: number): void {
    this._lavaLossIdleGlideT += dt / this._lavaLossIdleGlideDurSec
    const uRaw = Math.min(1, Math.max(0, this._lavaLossIdleGlideT))
    const e = 1 - Math.pow(1 - uRaw, 3)
    this.camX =
      this._lavaLossIdleGlideFromCx +
      (this._lavaLossIdleGlideToCx - this._lavaLossIdleGlideFromCx) * e
    this.camY =
      this._lavaLossIdleGlideFromCy +
      (this._lavaLossIdleGlideToCy - this._lavaLossIdleGlideFromCy) * e

    this._syncLayerScroll()
    const skyVisible = this.camY < this.surfY + TILE * 2
    if (this.skyLayer.visible !== skyVisible) this.skyLayer.visible = skyVisible
    this._syncSkyBgParallax()
    this._updateSkyDecor(dt)
    this._updateWorldMask(this.W, this.H)
    if (this.tileWorld) this.tileWorld.update(this.camX, this.camY, this.W, this.H)
    this.miner.update(dt, 0.9, false)
    this._pUpdate(dt, dt)
    this._perfPushSceneSnapshot()

    if (uRaw >= 1) {
      this._lavaLossIdleGlideActive = false
      this.camX = this._lavaLossIdleGlideToCx
      this.camY = this._lavaLossIdleGlideToCy
      this._returnToIdle()
    }
  }

  private _tickLavaDeathCinematic(dt: number): void {
    const m = GameConfig.lava.deathSceneMotionScale ?? 1
    const gameDtM = dt * m

    this.camX = this._lavaFrozenCamX
    this.camY = this._lavaFrozenCamY

    if (!this._lavaLossTimeoutPending) {
      this._lavaDeathRootY -= this._lavaDeathAscentSpeedPx * gameDtM
      this.miner.root.x = this._lavaDeathX
      this.miner.root.y = this._lavaDeathRootY

      this.charX = this._lavaDeathX
      this.charY = this._lavaDeathRootY

      if (this._lavaDeathRootY <= this._lavaDeathExitWorldY) {
        this.miner.root.visible = false
        this._scheduleLavaLossResult()
      }

      this.miner.update(gameDtM, 1, false)
    }

    this._syncLayerScroll()
    this._updateTunnel(this.charX - this.camX, this.charY - this.camY)
    const skyVisible = this.camY < this.surfY + TILE * 2
    if (this.skyLayer.visible !== skyVisible) this.skyLayer.visible = skyVisible
    this._syncSkyBgParallax()
    this._updateSkyDecor(dt * m)
    this._updateWorldMask(this.W, this.H)
    if (this.tileWorld) this.tileWorld.update(this.camX, this.camY, this.W, this.H)
    // Spine: реальный dt кадра — иначе deathSceneMotionScale на gameDtM даёт рваный die.
    this._pUpdate(gameDtM, dt)
    this._updateLiveWinBadge(dt)
    this._perfPushSceneSnapshot()
  }

  // ─── Tick ─────────────────────────────────────────────────────────────────

  private _tick(ticker:PIXI.Ticker){
    tickTickerFpsLog(ticker.deltaMS)
    const dt=Math.min(ticker.deltaTime/60, 0.1)  // cap 100ms — безопасно при лагге вкладки
    const store=useGameStore.getState()
    // В режиме replay фиксируем скорость на 1× — иначе x2/x5 делает анимацию хаотичной.
    const spd = store.replayMode ? 1.0 : store.speed
    // gameDt — масштабированное время: вся игровая логика использует его,
    // чтобы spd=2 ускорял буквально всё (движение, анимации, таймеры, частицы).
    // Камера тоже использует gameDt — при высокой скорости она должна быть отзывчивее.
    // Turbo-скорость: на мобильных (zoom < threshold) снижаем с 10× до 3× —
    // меньше GPU-работы за кадр (скратч туннеля, Spine, коллизии), читабельнее анимации.
    const turboMul = this._zoom < GameConfig.round.turboMobileZoomThreshold
      ? GameConfig.round.turboSpeedMobile
      : GameConfig.round.turboSpeedDesktop
    const gameDt = dt * (this._turboActive ? Math.max(turboMul, spd) : spd)

    if(this.idleActive){
      if(this.tunnelActive) this._hideTunnel()
      this.idleX+=this.idleDir*IDLE_SPEED*dt   // idle не масштабируем — кнопка недоступна
      this._bounceT-=dt
      if(this._bounceT<=0){this._bounceT=3+Math.random()*4;this.idleDir*=-1}
      this.miner.resetFacing()
      // Idle: не зеркалим персонажа при смене направления, меняем только траекторию движения.
      this.miner.root.scale.x = 1
      const hiIdle = GameConfig.hero.idle
      this.miner.root.x = this.idleX + hiIdle.rootOffsetXPx
      this.miner.root.y = this.surfY + hiIdle.rootOffsetYPx
      const tcX = this.miner.root.x - this.W / 2
      const aIdle = this._camFollowAlpha(0.08, dt)
      this.camX += (tcX - this.camX) * aIdle
      this.camY += (this.idleCamY - this.camY) * aIdle
      this._syncLayerScroll()
      // Параллакс фона — двигается в 0.2x медленнее камеры
      this._syncSkyBgParallax()
      this._updateSkyDecor(dt)
      this._updateWorldMask(this.W, this.H)
      if(this.tileWorld)this.tileWorld.update(this.camX,this.camY,this.W,this.H)
      this.miner.update(dt,0.9,false)
      this._pUpdate(dt)
      this._updateLiveWinBadge()
      this._perfPushSceneSnapshot()
      return
    }

    // ── Пауза во время спина при открытии любой модалки ────────────────────
    // Если игра в фазе RUNNING и открыто меню или окно настроек автоспина —
    // пропускаем обновление: все объекты замораживаются на текущем кадре.
    if (store.phase === 'RUNNING' && (store.menuOpen || store.autoplayOpen)) {
      return
    }
    // ────────────────────────────────────────────────────────────────────────

    if (this._awaitingStartAnim) {
      // Пока идёт Spine start — корень не двигаем по миру; спуск начинается после клипа.
      if (!this.miner.isHeroStartIntroPlaying()) {
        this._startIntroY += CHAR_SPEED * gameDt
      }
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
      const camA = this._camFollowAlpha(Math.min(0.12 * spd, 0.9), gameDt)
      this.camX += (tCX - this.camX) * camA
      this.camY += (tCY - this.camY) * camA
      this._syncLayerScroll()
      this._startTunnelCarveDelaySec = Math.max(0, this._startTunnelCarveDelaySec - gameDt)
      const skyVisible = this.camY < this.surfY + TILE * 2
      if (this.skyLayer.visible !== skyVisible) this.skyLayer.visible = skyVisible
      this._syncSkyBgParallax()
      this._updateSkyDecor(dt)
      this._updateWorldMask(this.W, this.H)
      if (this.tileWorld) this.tileWorld.update(this.camX, this.camY, this.W, this.H)
      // Декор/предметы должны быть видны уже во время start-интро.
      // Коллизии остаются выключены, т.к. running=false.F
      if (this.spawner) this.spawner.update(this.charY, this.camX, this.camY, this.W, this.H)
      this.miner.update(gameDt, 1, true)
      this._pUpdate(gameDt)
      this.miner.syncStartCarveLatchAfterSpineTick()
      this._perfPushSceneSnapshot()
      if (this._startTunnelCarveDelaySec <= 0) {
        const p = this.miner.getHeroStartTunnelLengthProgress()
        if (p !== null) {
          this._updateTunnel(this.charX - this.camX, this.charY - this.camY, p)
        }
      }
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
      return
    }

    if (this._lavaLossIdleGlideActive) {
      this._tickLavaLossIdleGlide(dt)
      return
    }

    if (this._lavaDeathCinematic) {
      this._tickLavaDeathCinematic(dt)
      return
    }

    if (!this.running) {
      this._pUpdate(dt)
      this._perfPushSceneSnapshot()
      return
    }

    // ── DIGGING ───────────────────────────────────────────────────────────────

    let canMove=true
    let lavaTrailAx = this.charX
    let lavaTrailAy = this.charY

    if (this.stoneBreakActive) {
      gameAudio.setLoop('stone.ogg', true)
      this.stoneBreakRemainingTime -= gameDt
      this.stoneBreakTickTimer     -= gameDt

      // Шаг отображения множителя: квант 0.5 с игрового времени (как пауза sN/gN)
      if (this.stoneBreakTickTimer <= 0) {
        const elapsed      = this.stoneBreakTotalDuration - Math.max(0, this.stoneBreakRemainingTime)
        const totalTicks   = Math.max(1, Math.round(this.stoneBreakTotalDuration * 2))
        const ticksDone    = Math.min(Math.floor(elapsed * 2), totalTicks)
        const stepSize     = (this.stoneBreakStartMultiplier - this.multiplier) / totalTicks
        this.stoneBreakDisplayMult = Math.max(
          this.multiplier,
          this.stoneBreakStartMultiplier - stepSize * ticksDone
        )
        this.stoneBreakTickTimer = 0.5 / spd   // следующий тик через 1 игровую секунду
        store.updateStats({ multiplier: Math.round(this.stoneBreakDisplayMult * 100) / 100 })
        if (stepSize > 0) this._floatText(this.charX, this.charY, `-${Math.round(stepSize * 100) / 100}`, C.stone)
      }

      // Переключение стадий анимации камня:
      // stage_02 — бурение (выставляется при коллекте)
      // stage_04 — последние _breakDoneLeadSec (пробурено)
      if (this._breakSpine) {
        if (
          this.stoneBreakRemainingTime <= this._breakDoneLeadSec(this.stoneBreakTotalDuration) &&
          this._breakStage < 3
        ) {
          this._breakStage = 3
          SpineAnimator.setAnimation(this._breakSpine, STONE_STAGE.done, false)
          // Играем crash в момент финальной фазы (разлёт на кусочки), а не в самом конце.
          if (!this._stoneCrashPlayed) {
            gameAudio.playSfx('stone_crash.ogg')
            this._stoneCrashPlayed = true
          }
        }
      }

      if (this.stoneBreakRemainingTime <= 0) {
        gameAudio.setLoop('stone.ogg', false)
        this.stoneBreakActive = false
        store.updateStats({ multiplier: Math.round(this.multiplier * 100) / 100 })
        this._breakStage = 0
        this._destroyBreakObj()
        this._applyRepulseDeferred('STONE_TICK')
        canMove = true
      } else {
        canMove = false
      }
    }

    // Золотой самородок — стоим на месте, множитель визуально растёт до значения RGS
    if (this.goldBreakActive) {
      gameAudio.setLoop('gold.ogg', true)
      this.goldBreakRemainingTime -= gameDt
      this.goldBreakTickTimer     -= gameDt

      // Шаг отображения множителя: квант 0.5 с (как пауза gN)
      if (this.goldBreakTickTimer <= 0) {
        const elapsed      = this.goldBreakTotalDuration - Math.max(0, this.goldBreakRemainingTime)
        const totalTicks   = Math.max(1, Math.round(this.goldBreakTotalDuration * 2))
        const ticksDone    = Math.min(Math.floor(elapsed * 2), totalTicks)
        const stepSize     = (this.multiplier - this.goldBreakStartMultiplier) / totalTicks
        this.goldBreakDisplayMult = Math.min(
          this.multiplier,
          this.goldBreakStartMultiplier + stepSize * ticksDone
        )
        this.goldBreakTickTimer = 0.5 / spd   // следующий тик через 1 игровую секунду
        store.updateStats({ multiplier: Math.round(this.goldBreakDisplayMult * 100) / 100 })
        if (stepSize > 0) this._floatText(this.charX, this.charY, `+${Math.round(stepSize * 100) / 100}`, C.gold)
      }
      if (Math.random() < 0.3) {
        this._burst(this.charX, this.charY, C.gold, GameConfig.performance.burstGoldBreakParticles)
      }

      // Переключение стадий анимации золота:
      // stage_02 — бурение (выставляется при коллекте)
      // stage_04 — последние _breakDoneLeadSec (пробурено)
      if (this._breakSpine) {
        if (
          this.goldBreakRemainingTime <= this._breakDoneLeadSec(this.goldBreakTotalDuration) &&
          this._breakStage < 3
        ) {
          this._breakStage = 3
          SpineAnimator.setAnimation(this._breakSpine, GOLD_STAGE.done, false)
          // Как у камня: crash в момент финальной фазы, а не после остановки лупа.
          if (!this._goldCrashPlayed) {
            gameAudio.playSfx('gold_crash.ogg')
            this._goldCrashPlayed = true
          }
        }
      }

      if (this.goldBreakRemainingTime <= 0) {
        gameAudio.setLoop('gold.ogg', false)
        this.goldBreakActive = false
        store.updateStats({ multiplier: Math.round(this.multiplier * 100) / 100 })
        this._breakStage = 0
        this._destroyBreakObj()
        this._applyRepulseDeferred('GOLD_TICK')
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
        const cutY = this.camY - TILE * 5
        for (let _ci = this._caveZones.length - 1; _ci >= 0; _ci--) {
          if (this._caveZones[_ci]!.y <= cutY) {
            this._caveZones[_ci] = this._caveZones[this._caveZones.length - 1]!
            this._caveZones.pop()
          }
        }
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
            const lastY = this._tunnelPath[this._tunnelPath.length - 1]?.y ?? this.surfY
            for (let j = 0; j < more.length; j++) {
              this._tunnelPath.push({ x: more[j]!, y: lastY + (j + 1) * STEP_PATH_Y })
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
      // gameDt: при скорости ×5 торможение тоже ×5 быстрее — персонаж не уносит вперёд
      this._velY += (0 - this._velY) * Math.min(gameDt * 10, 1)
      this._velX = 0
      this.charY += this._velY * gameDt
      const txb = tunnelXAtWorldY(this._tunnelPath, this.charY)
      const kxb = GameConfig.movement.tunnelXSmoothing
      this.charX += (txb - this.charX) * Math.min(1, kxb * gameDt)
      this._rebuildTunnelCumLengths()
      this._pathArcS = Math.max(
        this._pathArcS,
        projectWorldXYToTunnelArcLength(this._tunnelPath, this._tunnelCumLen, this.charX, this.charY),
      )
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
    const camA = this._camFollowAlpha(Math.min(0.12 * spd, 0.9), gameDt)
    this.camX+=(tCX-this.camX)*camA
    this.camY+=(tCY-this.camY)*camA

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

    const _ptw = perf.begin('tileWorld', 3)
    if(this.tileWorld)this.tileWorld.update(this.camX,this.camY,this.W,this.H)
    perf.end('tileWorld', _ptw)

    this._spawnCavesAhead()

    const _psp = perf.begin('spawner', 1)
    if(this.spawner)this.spawner.update(this.charY, this.camX, this.camY, this.W, this.H)
    perf.end('spawner', _psp)

    const _pmn = perf.begin('miner', 1)
    this.miner.update(gameDt, 1, true)
    perf.end('miner', _pmn)

    {
      const depth    = Math.max(0, Math.round(this.depth * 10) / 10)
      const distance = Math.round(this.distance * 10) / 10
      const mult     = (!this.stoneBreakActive && !this.goldBreakActive)
        ? Math.round(this.multiplier * 100) / 100
        : null
      if (
        depth !== this._lastSentDepth ||
        distance !== this._lastSentDistance ||
        (mult !== null && mult !== this._lastSentMultiplier)
      ) {
        store.updateStats({
          depth,
          distance,
          ...(mult !== null && { multiplier: mult }),
        })
        this._lastSentDepth = depth
        this._lastSentDistance = distance
        if (mult !== null) this._lastSentMultiplier = mult
      }
    }

    if(this.spawner && !this._ended && !this.stoneBreakActive && !this.goldBreakActive){
      const _pco = perf.begin('collide', 0.5)
      this.spawner.checkCollisions(lavaTrailAx,lavaTrailAy,this.charX,this.charY,(obj)=>{
        this._onCollect(obj)
      })
      perf.end('collide', _pco)
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
      gameAudio.stopMusicForLose()
      this.miner.playDie({ loop: true })
      gameAudio.playSfx('finish_lose.ogg')
      this._burst(this.charX, this.charY, C.lava, GameConfig.performance.burstLavaHitParticles)
      // Потребляем LAVA-ивент из rgsQueue — исход тот же (поражение),
      // просто физическая лава догнала раньше чем SpawnedObj терминал
      const lavaIdx = this.rgsQueue.findIndex(e => e.type === 'LAVA')
      if (lavaIdx >= 0) this.rgsQueue.splice(lavaIdx, 1)
      console.log(
        `%c[MOVE] 🔥 лава настигла персонажа @ (${this.charX.toFixed(0)}, ${this.charY.toFixed(0)})  глубина: ${this.depth.toFixed(1)}м  arc: ${this._pathArcS.toFixed(0)}px`,
        'color:#ff6b6b',
      )
      this._logTerminal('simulation', 'LAVA')
      if (!this._tryStartLavaDeathCinematic()) {
        if (this._terminalOutcomeTimerId !== null) {
          clearTimeout(this._terminalOutcomeTimerId)
          this._terminalOutcomeTimerId = null
        }
        const cbLavaCatch = () => {
          this._terminalOutcomeTimerId = null
          this._pendingOutcomeFn = null
          gameEngine.onRoundComplete(0, false)
          this._returnToIdle()
        }
        this._pendingOutcomeFn = cbLavaCatch
        this._terminalOutcomeTimerId = setTimeout(cbLavaCatch, this._turboActive ? 0 : GameConfig.round.loseDelayMs)
      }
    }

    const _ppu = perf.begin('pUpdate', 3)
    this._pUpdate(gameDt)
    perf.end('pUpdate', _ppu)

    this._updateLiveWinBadge()

    this._perfPushSceneSnapshot()
  }

  /** Снимок сцены для __DR_PERF__ (чанки, лава, спавнер, FX) — нулевая цена, если профайлер выкл. */
  private _perfPushSceneSnapshot(): void {
    if (!perf.enabled || !this.tileWorld) return
    const tw = this.tileWorld.getPerfSnapshot()
    const win = tileWorldMaxChunkWindowFromConfig()
    const lava = this.lavaSimulation?.getPerfSnapshot()
    const sp = this.spawner?.getPerfSnapshot()
    const phase = useGameStore.getState().phase
    const vp = GameConfig.viewportChunks
    const canvasMatchCfg = this.W === vp.widthPx && this.H === vp.heightPx
    perf.setSceneSnapshot({
      phase,
      running: this.running,
      canvasWxH: `${this.W}×${this.H}`,
      viewportCfgChunks: tw.viewportChunksWxH,
      canvasMatchesViewportCfg: canvasMatchCfg,
      canvasDeltaIfAny:
        canvasMatchCfg
          ? '—'
          : `W${this.W - vp.widthPx >= 0 ? '+' : ''}${this.W - vp.widthPx} H${this.H - vp.heightPx >= 0 ? '+' : ''}${this.H - vp.heightPx}`,
      chunksActive: tw.activeChunks,
      chunksBuildQueue: tw.buildQueue,
      chunksInnerColsRows: `${win.innerCols}×${win.innerRows}`,
      chunksCullMargin: win.cullMarginChunks,
      chunksMaxColsRows: `${win.colsWithCull}×${win.rowsWithCull}`,
      chunksActiveVsMax: `${tw.activeChunks}/${win.chunksUpperBound}`,
      chunksUpperBound: win.chunksUpperBound,
      earthTileSpritesUpperBound: win.earthTileSpritesUpperBound,
      tunnelBgPanels: tw.tunnelBgPanels,
      tilePendingCaves: tw.pendingCaves,
      lavaCells: lava?.lavaCells ?? 0,
      lavaStaticPools: lava?.staticLavaPools ?? 0,
      particles: this.particles.length,
      floatTexts: this.floatTexts.length,
      spawnerObjects: sp?.spawnedObjects ?? 0,
      spawnerRoadItems: sp?.roadItems ?? 0,
      spawnerSafeDecor: sp?.safeDecorProgress ?? '—',
    })
  }

  // ─── Сбор объекта ─────────────────────────────────────────────────────────

  // ─── Лог сбора предмета ───────────────────────────────────────────────────

  private _logCollect(
    type: EventType,
    before: number,
    after: number,
    durationSec?: number,
    rgs?: { matched: boolean; effect?: { op: string; value: number } | null },
  ): void {
    const tag    = type.padEnd(7)
    const bStr   = `×${before.toFixed(2)}`
    const aStr   = `×${after.toFixed(2)}`
    const delta  = after - before
    const dStr   = (delta >= 0 ? '+' : '') + delta.toFixed(2)
    let effect: string
    switch (type) {
      case 'BOMB':    effect = rgs?.effect?.value != null ? `÷${rgs.effect.value}` : before > 0.001 ? `÷${(before / Math.max(after, 0.001)).toFixed(1)}` : `÷${GameConfig.items.BOMB.divisor}`; break
      case 'DIAMOND': effect = `×${(after / Math.max(before, 0.001)).toFixed(2)}`; break
      case 'GOLD_TICK': {
        const secs = durationSec ?? 0
        const gain = after - before
        effect = `${secs.toFixed(1)}s → +${gain.toFixed(2)} к мульт`
        break
      }
      case 'STONE_TICK': {
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
    const rgsTag = rgs == null ? '' : rgs.matched ? ' ✅RGS' : ' ❌random'
    console.log(`[${tag}]  до: ${bStr.padStart(6)}  →  после: ${aStr.padStart(6)}  (${dStr}) | ${effect}${rgsTag}`)

    GameLogger.itemCollect({
      type,
      multBefore: before,
      multAfter:  after,
      rgsMatched: rgs?.matched ?? true,
      rgsEffect:  rgs?.effect ?? null,
    })
  }

  private _logTerminal(source: 'object' | 'simulation', type: 'HOME' | 'LAVA'): void {
    const payoutMultiplier = (type === 'HOME' && RGS.isDemo())
      ? (Demo.peekPendingBaseCoeff() || this.multiplier)
      : this.multiplier
    console.log(`--- КОНЕЦ РАУНДА [${type}] источник=${source} mult=×${payoutMultiplier.toFixed(2)} ---`)
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
    GameLogger.roundEnd({
      result:          type === 'HOME' ? 'HOME' : 'LAVA',
      source,
      finalMultiplier: this.multiplier,
      settledMultiplier: payoutMultiplier,
      rgsRemainder:    [...this.rgsQueue],
    })
  }

  private _onCollect(obj:SpawnedObj){
    const type=obj.type

    if (type === 'STONE_TICK') {
      this.stoneBreakActive = true
      this.stoneBreakStartMultiplier = this.multiplier
      const multBefore = this.multiplier
      const rgsIdx = obj.rgsEventRef
        ? this.rgsQueue.findIndex(e => e === obj.rgsEventRef)
        : this.rgsQueue.findIndex(e => e.type === 'STONE_TICK')
      let duration =
        GameConfig.items.STONE.durationMin + Math.random() * (GameConfig.items.STONE.durationMax - GameConfig.items.STONE.durationMin)
      let stoneSub: number | null = null
      if (rgsIdx >= 0) {
        const ev = this.rgsQueue.splice(rgsIdx, 1)[0]
        if (ev.effect && ev.effect.op === 'sub') stoneSub = ev.effect.value
        if (ev.durationMs != null && ev.durationMs > 0) duration = ev.durationMs / 1000
        else if (stoneSub != null) duration = stoneSub * 0.5
      }
      if (stoneSub == null) {
        stoneSub = GameConfig.items.STONE.subValues[
          Math.floor(Math.random() * GameConfig.items.STONE.subValues.length)
        ]
      }
      this.multiplier = this._roundMultiplier(
        Math.max(GameConfig.multiplier.floor, this.multiplier - stoneSub),
      )
      this._logCollect('STONE_TICK', multBefore, this.multiplier, duration,
        { matched: rgsIdx >= 0, effect: rgsIdx >= 0 ? { op: 'sub', value: stoneSub! } : null })
      this.stoneBreakTotalDuration = duration
      this.stoneBreakRemainingTime = duration
      this.stoneBreakDisplayMult   = multBefore   // начинаем с текущего значения
      this.stoneBreakTickTimer     = 0.5           // первый тик UI через 0.5 игровой сек
      this._stoneCrashPlayed       = false
      this._breakStage = 1
      if (obj.spine) {
        SpineAnimator.setAnimation(obj.spine, STONE_STAGE.drill, true)
        this._breakSpine = obj.spine
        this._breakGfx   = obj.gfx
      } else {
        this._breakSpine = null
        this._breakGfx   = obj.gfx
      }
      this._applyRepulse(obj, true)  // запоминаем направление, импульс — после разрушения
      {
        const next = this.spawner?.getNextRoadTarget() ?? null
        const distPx = Math.hypot(this.charX - obj.worldX, this.charY - obj.worldY)
        GameLogger.charToTarget({
          charX: this.charX, charY: this.charY,
          charDepthM: this.depth, charArcS: this._pathArcS,
          collected: { type: obj.type, worldX: obj.worldX, worldY: obj.worldY, distPx },
          nextTarget: next ? { type: next.type, worldX: next.worldX, worldY: next.worldY, depthM: this.ppm > 0 ? (next.worldY - this.surfY) / this.ppm : 0 } : null,
        })
      }
      return
    }

    // Золотой самородок — останавливаемся и получаем ×3/сек пока бурим
    if (type === 'GOLD_TICK') {
      this.goldBreakActive = true
      this.goldBreakStartMultiplier = this.multiplier
      const multBefore = this.multiplier
      const rgsIdx = obj.rgsEventRef
        ? this.rgsQueue.findIndex(e => e === obj.rgsEventRef)
        : this.rgsQueue.findIndex(e => e.type === 'GOLD_TICK')
      let duration =
        GameConfig.items.GOLD.durationMin + Math.random() * (GameConfig.items.GOLD.durationMax - GameConfig.items.GOLD.durationMin)
      let goldAdd: number | null = null
      if (rgsIdx >= 0) {
        const ev = this.rgsQueue.splice(rgsIdx, 1)[0]
        if (ev.effect && ev.effect.op === 'add') goldAdd = ev.effect.value
        if (ev.durationMs != null && ev.durationMs > 0) duration = ev.durationMs / 1000
        else if (goldAdd != null) duration = goldAdd * 0.5
      }
      if (goldAdd == null) {
        goldAdd = GameConfig.items.GOLD.addValues[
          Math.floor(Math.random() * GameConfig.items.GOLD.addValues.length)
        ]
      }
      this.multiplier = this._roundMultiplier(this.multiplier + goldAdd)
      this._logCollect('GOLD_TICK', multBefore, this.multiplier, duration,
        { matched: rgsIdx >= 0, effect: rgsIdx >= 0 ? { op: 'add', value: goldAdd! } : null })
      this.goldBreakRemainingTime = duration
      this.goldBreakTotalDuration = duration
      this.goldBreakDisplayMult   = multBefore   // начинаем с текущего значения
      this.goldBreakTickTimer     = 0.5           // первый тик UI через 0.5 игровой сек
      this._goldCrashPlayed       = false
      this._breakStage = 1
      this._burst(obj.worldX, obj.worldY, C.gold, GameConfig.performance.burstGoldCollectParticles)
      if (obj.spine) {
        SpineAnimator.setAnimation(obj.spine, GOLD_STAGE.drill, true)
        this._breakSpine = obj.spine
        this._breakGfx   = obj.gfx
      } else {
        this._breakSpine = null
        this._breakGfx   = obj.gfx
      }
      this._applyRepulse(obj, true)  // запоминаем направление, импульс — после разрушения
      {
        const next = this.spawner?.getNextRoadTarget() ?? null
        const distPx = Math.hypot(this.charX - obj.worldX, this.charY - obj.worldY)
        GameLogger.charToTarget({
          charX: this.charX, charY: this.charY,
          charDepthM: this.depth, charArcS: this._pathArcS,
          collected: { type: obj.type, worldX: obj.worldX, worldY: obj.worldY, distPx },
          nextTarget: next ? { type: next.type, worldX: next.worldX, worldY: next.worldY, depthM: this.ppm > 0 ? (next.worldY - this.surfY) / this.ppm : 0 } : null,
        })
      }
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
          case 'add': this.multiplier = this._roundMultiplier(this.multiplier + rgsEffect.value); break
          case 'sub': this.multiplier = this._roundMultiplier(Math.max(floor, this.multiplier - rgsEffect.value)); break
          case 'mul': this.multiplier = this._roundMultiplier(this.multiplier * rgsEffect.value); break
          case 'div': this.multiplier = this._roundMultiplier(Math.max(floor, this.multiplier / rgsEffect.value)); break
        }
      } else {
        this.multiplier = this._applyEffect(type, this.multiplier)
      }
    }
    this._logCollect(type, multBefore, this.multiplier, undefined,
      { matched: rgsMatch >= 0, effect: rgsEffect })
    useGameStore.getState().updateStats({multiplier:Math.round(this.multiplier*100)/100})

    if (!obj.terminal) {
      if (type === 'COIN' || type === 'DIAMOND' || type === 'BOMB' || type === 'HOME' || type === 'LAVA') {
        gameAudio.playCollect(type)
      }
    }

    const pc = GameConfig.performance
    const burstN = type === 'HOME' ? pc.burstHomeParticles : pc.burstCollectParticles
    this._burst(obj.worldX, obj.worldY, C.particleColors[type], burstN)
    this._applyRepulse(obj)

    if(obj.terminal){
      this._ended=true
      this.running=false
      gameAudio.setLoop('drill.ogg', false)
      if (type === 'LAVA') this.miner.playDie({ loop: true })
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

      if (type === 'HOME') gameAudio.playCollect('HOME', { terminal: true, won, multiplier: this.multiplier })
      else if (type === 'LAVA') {
        gameAudio.stopMusicForLose()
        gameAudio.playCollect('LAVA', { terminal: true })
      }

      this._logTerminal('object', won ? 'HOME' : 'LAVA')
      if (this._terminalOutcomeTimerId !== null) {
        clearTimeout(this._terminalOutcomeTimerId)
        this._terminalOutcomeTimerId = null
      }
      if (won) {
        const cbWin = () => {
          this._terminalOutcomeTimerId = null
          this._pendingOutcomeFn = null
          gameEngine.onRoundComplete(this.multiplier, true)
          this._returnToIdle()
        }
        this._pendingOutcomeFn = cbWin
        this._terminalOutcomeTimerId = setTimeout(cbWin, this._turboActive ? 0 : GameConfig.round.winDelayMs)
      } else {
        if (!this._tryStartLavaDeathCinematic()) {
          const cbLose = () => {
            this._terminalOutcomeTimerId = null
            this._pendingOutcomeFn = null
            gameEngine.onRoundComplete(0, false)
            this._returnToIdle()
          }
          this._pendingOutcomeFn = cbLose
          this._terminalOutcomeTimerId = setTimeout(cbLose, this._turboActive ? 0 : GameConfig.round.loseDelayMs)
        }
      }
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

    // Логируем позицию персонажа и следующую цель
    {
      const next = this.spawner?.getNextRoadTarget() ?? null
      const distPx = Math.hypot(this.charX - obj.worldX, this.charY - obj.worldY)
      GameLogger.charToTarget({
        charX:      this.charX,
        charY:      this.charY,
        charDepthM: this.depth,
        charArcS:   this._pathArcS,
        collected: {
          type:   obj.type,
          worldX: obj.worldX,
          worldY: obj.worldY,
          distPx,
        },
        nextTarget: next ? {
          type:   next.type,
          worldX: next.worldX,
          worldY: next.worldY,
          depthM: this.ppm > 0 ? (next.worldY - this.surfY) / this.ppm : 0,
        } : null,
      })
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
    const breakGfx = this._breakGfx
    safePixiDestroyDisplay(this._breakGfx)
    this._breakGfx = null
    if (breakGfx) this.spawner?.removeDeferredCollectedBreakVisual(breakGfx)
  }

  /** Последние секунды бурения — переход в stage_04; при коротком sN/gN длина фазы не превышает долю от полного времени. */
  private _breakDoneLeadSec(totalDuration: number): number {
    if (!(totalDuration > 0)) return BREAK_ACTION_DURATION
    return Math.min(BREAK_ACTION_DURATION, Math.max(0.1, totalDuration * 0.36))
  }

  /**
   * Нормализация множителя без ступенчатого округления.
   * Внутри раунда считаем в полной точности, иначе накопленная погрешность
   * расходится с payout/base_coeff математики (например 0.25 -> 0.32).
   */
  private _roundMultiplier(v: number): number {
    if (!Number.isFinite(v)) return 0
    return Math.max(0, v)
  }

  private _applyEffect(type:EventType, m:number):number{
    const { floor } = GameConfig.multiplier
    const pick = (arr:number[]) => arr[Math.floor(Math.random() * arr.length)]
    switch(type){
      case 'COIN':    return this._roundMultiplier(m + pick(GameConfig.items.COIN.addValues))
      case 'GOLD_TICK':    return m  // обрабатывается через goldBreak
      case 'DIAMOND': return this._roundMultiplier(m * pick(GameConfig.items.DIAMOND.multValues))
      case 'BOMB':    return this._roundMultiplier(Math.max(floor, m / GameConfig.items.BOMB.divisor))
      case 'STONE_TICK':   return m  // обрабатывается через stoneBreak
      default:        return m
    }
  }

  private _applyEventEffectForSimulation(ev: RoundEvent, m: number): number {
    const e = ev.effect!
    const floor = GameConfig.multiplier.floor
    switch (e.op) {
      case 'add': return this._roundMultiplier(m + e.value)
      case 'sub': return this._roundMultiplier(Math.max(floor, m - e.value))
      case 'mul': return this._roundMultiplier(m * e.value)
      case 'div': return this._roundMultiplier(Math.max(floor, m / e.value))
    }
  }

  /** Итоговый множитель и WIN/LOSS по полной последовательности событий раунда. */
  private _computeFullRoadOutcome(events: readonly RoundEvent[]): { mult: number, won: boolean } {
    let m = 0
    for (const ev of events) {
      const t = ev.type
      if (t === 'HOME') return { mult: this._roundMultiplier(m), won: true }
      if (t === 'LAVA') return { mult: this._roundMultiplier(m), won: false }
      if (ev.effect) {
        m = this._applyEventEffectForSimulation(ev, m)
      } else if (t === 'STONE_TICK') {
        const stoneSub =
          GameConfig.items.STONE.subValues[
            Math.floor(Math.random() * GameConfig.items.STONE.subValues.length)
          ]!
        m = this._roundMultiplier(Math.max(GameConfig.multiplier.floor, m - stoneSub))
      } else if (t === 'GOLD_TICK') {
        const goldAdd =
          GameConfig.items.GOLD.addValues[
            Math.floor(Math.random() * GameConfig.items.GOLD.addValues.length)
          ]!
        m = this._roundMultiplier(m + goldAdd)
      } else {
        m = this._applyEffect(t, m)
      }
    }
    return { mult: this._roundMultiplier(m), won: false }
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
    if (this._terminalOutcomeTimerId !== null) {
      clearTimeout(this._terminalOutcomeTimerId)
      this._terminalOutcomeTimerId = null
    }
    gameAudio.resumeMusicAfterLose()
    gameAudio.setLoop('gold.ogg', false)
    gameAudio.setLoop('stone.ogg', false)
    const hadLavaContext =
      this._lavaExitFlightActive || this._lavaDeathCinematic || this._lavaLossTimeoutPending
    // Не делаем промежуточный snap-к кадру "idle над точкой смерти",
    // иначе виден двойной idle (сначала локальный, затем финальный стартовый).
    this._cleanupLavaDeathCinematic({ snapToSurfaceIdlePose: false })
    // После LAVA-подъёма root мог быть скрыт при выходе за верх кадра.
    // При skip snap обязательно возвращаем видимость вручную.
    this.miner.root.visible = true
    const hi = GameConfig.hero.idle
    // После LAVA стартуем idle рядом с точкой подъёма, чтобы не было прыжка фона в центр.
    this.idleX = hadLavaContext ? (this._lavaDeathX - hi.rootOffsetXPx) : 0
    this.idleDir = 1
    this._bounceT = 0
    this.miner.resetFromDeath()
    this.spawner?.reset(); this.spawner=null

    // Убираем эффект грязи
    this._destroyDirtEntry()

    for (const {renderer} of this.activeLavas.values()) {
      renderer.destroy()
    }
    this.activeLavas.clear()
    this.lavasCavePathUpdated = new WeakSet()
    if (this.tileWorld) {
      this.tileWorld.lavaSimulation = null
    }
    if (this.lavaSimulation) {
      // Do NOT removeChild before destroy — LavaSimulation.destroy() clears masks first,
      // then container.destroy() calls removeFromParent() internally. Calling removeChild
      // here first would null _renderGroup before masks are cleared, leaving stale
      // AlphaMask instructions in the render pipeline and causing a null.ids crash.
      this.lavaSimulation.destroy()
      this.lavaSimulation = null
    }

    // Сначала «залечиваем» маски чанков (цельная трава), затем скрываем подложку туннеля.
    // Иначе на кадр видны прорези при bgLight.visible=false → вспышка цвета фона Canvas.
    if (this.tileWorld) {
      this.tileWorld.clearRuntimeDigging()
      // В idle не нужен защитный коридор пути.
      this.tileWorld.setPathWaypoints([], this.surfY)
    }
    this._hideTunnel()

    this.floatTexts=[]
    this.objectsLayer.removeChildren()  // ← чистим объекты при возврате
    this.minerLayer.addChild(this.miner.root)
    // Как в конструкторе: не тянем X из charX (после раунда/лавы — герой вдали от стартовой сцены)
    this.running = false
    this._ended = false
    this._rendererRoundId = ''
    this._lastSentDepth = -1
    this._lastSentDistance = -1
    this._lastSentMultiplier = -1
    this._liveWinBadgeFading = false
    this._liveWinBadgeFadeT = 1
    this.liveWinBadge.alpha = 1
    this._lossRound = false
    this._lossTerminalDescent = false
    this._lossLavaCenterX = null
    this.goldBreakActive = false
    this.goldBreakRemainingTime = 0
    this.goldBreakTotalDuration = 0
    this.goldBreakStartMultiplier = 0
    this.goldBreakTickTimer = 0
    this.goldBreakDisplayMult = 0
    this._goldCrashPlayed = false
    this._turboActive = false
    this._pendingOutcomeFn = null
    this._pendingLossResultFn = null
    this.idleActive = true
    this._awaitingStartAnim = false
    this.miner.setIdleMode(true)
    this.miner.resetFacing()
    this.skyLayer.visible = true    // показываем фон в idle
    {
      this.miner.root.x = this.idleX + hi.rootOffsetXPx
      this.miner.root.y = this.surfY + hi.rootOffsetYPx
    }
    this.charX = 0
    this.charY = 0
    this.camX = this.idleX + GameConfig.hero.idle.rootOffsetXPx - this.W / 2
    this.camY = this.idleCamY
    this._syncLayerScroll()
    this._syncSurfaceScenery()
    this._syncSkyBgParallax()
    this._updateWorldMask(this.W, this.H)
    if (this.tileWorld) this.tileWorld.update(this.camX, this.camY, this.W, this.H)
    this._perfPushSceneSnapshot()
    this.stoneBreakActive = false
    this._destroyBreakObj()
    this._syncTickerPowerSave()
  }

  // ─── Particles ────────────────────────────────────────────────────────────

  private _floatText(wx:number,wy:number,label:string,color:number){
    let txt=this._floatTextPool.pop()
    if(txt){
      txt.text=label
      txt.style.fill=color
      txt.alpha=1;txt.visible=true;txt.scale.set(1)
    }else{
      txt=new PIXI.Text({ text: label, style: {
        fontFamily:'Arial,sans-serif',fontWeight:'900',fontSize:24,
        fill:color,stroke:{color:0x000000,width:3},
        dropShadow:{color:0x000000,blur:0,distance:2,angle:Math.PI/2,alpha:1},
      }})
      txt.anchor.set(0.5,0.5)
    }
    txt.x=wx+(Math.random()-0.5)*40
    txt.y=wy-40
    this.objectsLayer.addChild(txt)
    this.floatTexts.push({txt,vy:-(120+Math.random()*40),life:1})
  }

  private _burst(wx:number,wy:number,col:number,n:number){
    const maxP = GameConfig.performance.particleMax
    let room = maxP - this.particles.length
    if (room <= 0) return
    const useN = Math.min(Math.max(0, n), room)
    if (useN <= 0) return
    for(let i=0;i<useN;i++){
      const r=(Math.random()*5+2)*2
      const spr=this._particlePool.pop()??new PIXI.Sprite(this._particleTexture)
      spr.tint=col;spr.width=r;spr.height=r;spr.anchor.set(0.5)
      spr.x=wx;spr.y=wy;spr.alpha=1;spr.visible=true
      this.objectsLayer.addChild(spr)
      const a=Math.random()*Math.PI*2,s=Math.random()*100+60
      this.particles.push({gfx:spr,vx:Math.cos(a)*s,vy:Math.sin(a)*s-80,life:1})
    }
  }

  private _animCollect(gfx:PIXI.Graphics, spine: import('@esotericsoftware/spine-pixi-v8').Spine | null = null){
    SpineAnimator.remove(spine)
    this._collectAnims.push({gfx,t:0})
  }

  /**
   * @param dt — логическое время частиц / лавы и т.п.
   * @param spineDt — если задан, передаётся в SpineAnimator.tick (нормальный dt кадра для скелетов).
   */
  private _pUpdate(dt: number, spineDt?: number) {
    const _tsp = perf.begin('spine', 1)
    SpineAnimator.tick(spineDt ?? dt)
    perf.end('spine', _tsp)

    {
      let i = 0
      while (i < this.particles.length) {
        const p = this.particles[i]!
        p.life -= dt * 1.8
        if (p.gfx.destroyed || p.life <= 0) {
          if (!p.gfx.destroyed) { this.objectsLayer.removeChild(p.gfx); this._particlePool.push(p.gfx) }
          this.particles[i] = this.particles[this.particles.length - 1]!
          this.particles.pop()
        } else {
          p.gfx.x += p.vx * dt; p.gfx.y += p.vy * dt; p.vy += 260 * dt
          p.gfx.alpha = p.life; p.gfx.scale.set(p.life * 0.7 + 0.3)
          i++
        }
      }
    }
    {
      let i = 0
      while (i < this.floatTexts.length) {
        const f = this.floatTexts[i]!
        f.life -= dt * 1.1
        if ((f.txt as { destroyed?: boolean }).destroyed || f.life <= 0) {
          if (!(f.txt as { destroyed?: boolean }).destroyed) { this.objectsLayer.removeChild(f.txt); this._floatTextPool.push(f.txt) }
          this.floatTexts[i] = this.floatTexts[this.floatTexts.length - 1]!
          this.floatTexts.pop()
        } else {
          f.txt.y += f.vy * dt; f.vy *= Math.pow(0.92, dt * 60)
          f.txt.alpha = f.life; f.txt.scale.set(0.8 + f.life * 0.4)
          i++
        }
      }
    }

    {
      let i=0
      while(i<this._collectAnims.length){
        const a=this._collectAnims[i]!
        if((a.gfx as {destroyed?:boolean}).destroyed){
          this._collectAnims[i]=this._collectAnims[this._collectAnims.length-1]!
          this._collectAnims.pop();continue
        }
        a.t+=0.1
        a.gfx.scale.set(1.5-a.t*0.5)
        a.gfx.alpha=1-a.t
        if(a.t>=1){
          a.gfx.visible=false
          this._collectAnims[i]=this._collectAnims[this._collectAnims.length-1]!
          this._collectAnims.pop();continue
        }
        i++
      }
    }

    if (this.lavaSimulation?.hasRenderableLava()) {
      this.lavaSimulation.setCameraPos(this.camX, this.camY)
      this.lavaSimulation.setViewport(this.W, this.H)
    }
    const _tlv = perf.begin('lava', 2)
    if (this.tileWorld) this.tileWorld.updateLavas(dt, this.W, this.H)
    perf.end('lava', _tlv)
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
      const tunX = tunnelXAtWorldY(path, caveWY)
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
    if (Math.abs(screenGrassTop - this._lastWorldMaskGrassTop) < 0.5 && w === this._lastWorldMaskW) return
    this._lastWorldMaskGrassTop = screenGrassTop
    this._lastWorldMaskW = w
    this._worldMask.clear()
    this._worldMask.rect(0, 0, w, screenGrassTop)
    this._worldMask.fill({ color: 0xffffff })
  }

  private _installPageVisibilityPowerSave(): void {
    if (typeof document === 'undefined') return
    document.addEventListener('visibilitychange', this._onPageVisibility)
  }

  /** Лимит FPS: idle-меню → idleMenuMaxFps, геймплей → gameplayMaxFps (60). Снижает нагрузку на 120Hz Mac вдвое. */
  private _syncTickerPowerSave(): void {
    if (!this.app) return
    const cfg = GameConfig.performance
    if (cfg.pauseTickerWhenPageHidden && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return
    }
    const idleCap = cfg.idleMenuMaxFps ?? 0
    const gameplayCap = cfg.gameplayMaxFps ?? 60
    const idleMenuOnly =
      this.idleActive &&
      !this.running &&
      !this._awaitingStartAnim &&
      !this._lavaDeathCinematic &&
      !this._lavaLossIdleGlideActive
    if (idleMenuOnly && idleCap > 0) {
      this.app.ticker.maxFPS = idleCap
    } else {
      this.app.ticker.maxFPS = gameplayCap > 0 ? gameplayCap : 0
    }
  }

  resize(w:number,h:number){
    if (w <= 0 || h <= 0) return
    this._pendingResizeW = w
    this._pendingResizeH = h
    if (this._resizeRaf) return
    this._resizeRaf = requestAnimationFrame(() => {
      this._resizeRaf = 0
      this._applyResize(this._pendingResizeW, this._pendingResizeH)
    })
  }

  /** Один кадр на пачку resize-событий; сцена обновляется до resize WebGL, затем синхронный render. */
  private _applyResize(w: number, h: number): void {
    if (w <= 0 || h <= 0 || !this.app?.renderer) return

    this._zoom = computeSceneZoom(w, h)
    this.W = w / this._zoom
    this.H = h / this._zoom
    this.charScreenY = this.H * 0.42
    this.app.stage.scale.set(this._zoom)
    this.lavaSimulation?.setViewport(this.W, this.H)

    this._resizeSkyInPlace()
    this._lastWorldMaskGrassTop = Infinity
    this._updateWorldMask(this.W, this.H)
    this._buildTunnel()
    this._syncSurfaceScenery()

    if (this.tileWorld) {
      const idleVp = this.idleActive ? { w: this.W * 5, h: this.H * 2 } : undefined
      this.tileWorld.update(this.camX, this.camY, this.W, this.H, idleVp)
    }

    if (this.idleActive) {
      this.camY = this.idleCamY
    }
    this._syncLayerScroll()

    this.app.renderer.resize(w, h)
    this.app.renderer.render({ container: this.app.stage })
  }

  destroy(){
    if (this._resizeRaf) {
      cancelAnimationFrame(this._resizeRaf)
      this._resizeRaf = 0
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onPageVisibility)
    }
    this._lavaLossIdleGlideActive = false
    this.skyLayer.mask=null
    this.worldBgLayer.mask=null
    this.worldChunkLayer.mask=null
    this._worldMask.destroy()
    this._destroyBreakObj()
    this.spawner?.reset()
    this.tileWorld?.destroy()
    this.liveWinBadge.removeFromParent()
    this.miner.destroy()
    this.liveWinBadge.destroy({ children: true })
    for(const spr of this._particlePool) if(!spr.destroyed) spr.destroy()
    this._particlePool=[]
    for(const txt of this._floatTextPool) if(!(txt as {destroyed?:boolean}).destroyed) txt.destroy()
    this._floatTextPool=[]
    this._collectAnims=[]
    if (!this._particleTexture.destroyed) this._particleTexture.destroy(true)
    this.app.destroy(false,{children:true,texture:true})
  }
}
