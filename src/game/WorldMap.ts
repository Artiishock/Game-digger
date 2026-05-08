/**
 * WorldMap — физическое моделирование туннеля.
 *
 * Алгоритм:
 *  1. buildTunnel()     — строим путь как органичное блуждание
 *  2. capsuleTest()     — точное расстояние от точки до отрезка пути (капсула)
 *  3. placeRoadItems()  — road items на вершинах пути + snap на ось (полилиния)
 *  4. placeObstacles()  — объекты/лава/пещеры только вне всех капсул туннеля
 *
 * Гарантии:
 *  - Персонаж НИКОГДА не касается декораций/лавы/пещер
 *  - Road items стоят ТОЧНО на точках пути
 *  - Туннель физически проверен по всей длине
 */

import { GameConfig } from './GameConfig'
import type { RoundEvent, EventType } from '../rgs/client'

export const TILE = 120

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface PathPoint  { x: number; y: number }
export interface RoadPoint  { type: string; worldX: number; worldY: number; terminal: boolean }
export interface SafeObject {
  x: number; y: number; w: number; h: number
  kind: 'decor' | 'lava' | 'cave'
  /** Для decor — какой спрайт показать (совпадает с pickDecorType при генерации) */
  decorVisual?: EventType
}

export interface FullPathResult {
  waypoints:           number[]
  /** Полилиния туннеля (для проверок пещер/коллизий) */
  pathPoints:          PathPoint[]
  roadPoints:          RoadPoint[]
  /** События RGS в порядке roadPoints (без LAVA), для точного снятия с очереди */
  roadEventsOrdered:   RoundEvent[]
  obstacles:           SafeObject[]
  terminalCave:        { x: number; y: number; seed: number } | null
}

// ─── Константы ───────────────────────────────────────────────────────────────

/** Вертикальный шаг между вершинами полилинии туннеля. Больше — реже точки, меньше «слипания» коридора в зал. */
const STEP_Y        = TILE * 0.72
const TUNNEL_R      = TILE * 2.0    // радиус туннеля (половина ширины)
const CHAR_R        = TILE * 0.5    // радиус персонажа
const SAFE_R        = TUNNEL_R + CHAR_R  // полный зазор от оси пути до объекта
const MAX_DX        = TILE * 4.0    // макс смещение X за шаг
const X_MIN         = -TILE * 10
const X_MAX         =  TILE * 10

// Отступы от оси пути для каждого типа объектов
const DECOR_MARGIN  = SAFE_R + TILE * 0.5   // декорации (зазор к другим системам)
/**
 * Логическая капсула туннеля (широкая) — для лавы/далёкого декора.
 * Декоративные пикапы рядом с выкопом используют DECOR_VISUAL_TUNNEL_MARGIN.
 */
const DECOR_TUNNEL_PLACE_MARGIN = TUNNEL_R + 5
/** ~max полуось овала scratch (GameConfig.tunnelScratch) + зазор — «стенка» для игрока. */
const DECOR_VISUAL_TUNNEL_MARGIN =
  Math.ceil(
    Math.hypot(
      GameConfig.tunnelScratch.ellipseRadiusXPx,
      GameConfig.tunnelScratch.ellipseRadiusYPx,
    ),
  ) + 4
const LAVA_MARGIN   = SAFE_R + TILE * 1.0   // лава
const CAVE_MARGIN   = SAFE_R + TILE * 1.5   // пещеры

// ─── RNG ─────────────────────────────────────────────────────────────────────

function rng(y: number, seed: number): number {
  let s = ((y * 73856093) ^ seed) >>> 0
  s = (Math.imul(1664525, s) + 1013904223) >>> 0
  return s / 0x100000000
}

function caveNoise(x: number, y: number, seed: number): number {
  const sx = (seed & 0xFFFF) * 0.0001
  const sy = ((seed >> 16) & 0xFFFF) * 0.0001
  let v = 0
  v += 0.50 * Math.sin(x * 0.42 + sx)   * Math.cos(y * 0.38 + sy)
  v += 0.25 * Math.sin(x * 0.87 + sx*2) * Math.cos(y * 0.91 + sy*2)
  v += 0.15 * Math.sin(x * 1.70 + sx*3) * Math.cos(y * 1.55 + sy*3)
  v += 0.10 * Math.sin(x * 3.10 + sx*5) * Math.cos(y * 2.80 + sy*5)
  return (v + 1) / 2
}

function pickDecorType(y: number, r: number): EventType {
  const depth = y / (TILE * 10)
  const { types } = GameConfig.spawn
  const bombChance  = Math.min(types.bombMax,  types.bombBase  + depth * types.bombDepthScale)
  const stoneChance = Math.min(types.stoneMax, types.stoneBase + depth * types.stoneDepthScale)
  if (r < types.coinBase)                            return 'COIN'
  if (r < types.coinBase + bombChance)               return 'BOMB'
  if (r < types.coinBase + bombChance + stoneChance) return 'STONE'
  if (r < types.goldThreshold)                       return 'GOLD'
  const homeDecor = types.homeDecorChance ?? 0
  if (r < types.goldThreshold + homeDecor)           return 'HOME'
  return 'DIAMOND'
}

/** Декор между целями по пути: как pickDecorType, но без HOME (не маскируем терминал). */
function pickPathSegmentDecorType(y: number, r: number): EventType {
  const depth = y / (TILE * 10)
  const { types } = GameConfig.spawn
  const bombChance  = Math.min(types.bombMax,  types.bombBase  + depth * types.bombDepthScale)
  const stoneChance = Math.min(types.stoneMax, types.stoneBase + depth * types.stoneDepthScale)
  if (r < types.coinBase)                            return 'COIN'
  if (r < types.coinBase + bombChance)               return 'BOMB'
  if (r < types.coinBase + bombChance + stoneChance) return 'STONE'
  if (r < types.goldThreshold)                       return 'GOLD'
  return 'DIAMOND'
}

const ITEM_SZ: Record<string, number> = {
  COIN: 55, BOMB: 65, DIAMOND: 60, GOLD: 70, STONE: 70, HOME: 180,
}

/** Совпадает с ITEM_SZ.HOME — зазор при расстановке как у настоящей кровати по размеру спрайта */
const DECOR_HOME_PLACE_SZ = ITEM_SZ.HOME

// ─── 1. Капсульный тест ───────────────────────────────────────────────────────

/**
 * Расстояние от точки P до отрезка AB.
 * Используется для проверки пересечения с капсулой туннеля.
 */
function distPointSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

/** Проекция точки на отрезок + расстояние до неё */
function projectPointOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): { x: number; y: number; dist: number } {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    const d = Math.hypot(px - ax, py - ay)
    return { x: ax, y: ay, dist: d }
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  const x = ax + t * dx, y = ay + t * dy
  return { x, y, dist: Math.hypot(px - x, py - y) }
}

/** Минимальное расстояние от точки до полилинии пути (вся линия). */
export function distancePointToTunnelPolyline(px: number, py: number, path: PathPoint[]): number {
  if (path.length === 0) return Infinity
  if (path.length === 1) {
    const a = path[0]!
    return Math.hypot(px - a.x, py - a.y)
  }
  let best = Infinity
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!, b = path[i + 1]!
    best = Math.min(best, distPointSegment(px, py, a.x, a.y, b.x, b.y))
  }
  return best
}

/** Ближайшая точка на полилинии пути (ось туннеля). */
function nearestPointOnTunnelPolyline(px: number, py: number, path: PathPoint[]): { x: number; y: number; dist: number } {
  if (path.length === 0) return { x: px, y: py, dist: 0 }
  if (path.length === 1) {
    const a = path[0]!
    const d = Math.hypot(px - a.x, py - a.y)
    return { x: a.x, y: a.y, dist: d }
  }
  let bestX = path[0]!.x, bestY = path[0]!.y, bestD = Infinity
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!, b = path[i + 1]!
    const p = projectPointOnSegment(px, py, a.x, a.y, b.x, b.y)
    if (p.dist < bestD) {
      bestD = p.dist
      bestX = p.x
      bestY = p.y
    }
  }
  return { x: bestX, y: bestY, dist: bestD }
}

/**
 * Центр road-предмета лежит в «трубе» туннеля: расстояние до оси ≤ радиус предмета + зазор.
 * (Ось = полилиния, без доп. margin — только геометрия коридора игрока.)
 */
export function roadItemTouchesTunnelAxis(
  worldX: number,
  worldY: number,
  path: PathPoint[],
  itemType: string,
): boolean {
  const r = (ITEM_SZ[itemType] ?? 60) * 0.5
  const slack = TILE * 0.15
  const d = distancePointToTunnelPolyline(worldX, worldY, path)
  return d <= r + slack
}

/** Притягивает каждый road-предмет к ближайшей точке на оси туннеля. */
export function snapRoadPointsOntoTunnelAxis(roadPoints: RoadPoint[], path: PathPoint[]): RoadPoint[] {
  return roadPoints.map(rp => {
    const n = nearestPointOnTunnelPolyline(rp.worldX, rp.worldY, path)
    return { ...rp, worldX: n.x, worldY: n.y }
  })
}

/** X на оси туннеля для произвольной глубины (линейная интерполяция по сегментам path). */
export function tunnelXAtWorldY(path: PathPoint[], wy: number): number {
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

/**
 * Min/max X оси маршрута на вертикальном интервале [wy - halfYm, wy + halfYm].
 * После этого на полоску добавляются отступы (экран, паддинги) — иначе при зигзаге полилинии
 * декор оказывался «у края генерации»: полоса строится от одной точки tunnelXAtWorldY(y),
 * хотя поблизости персонаж проходит через другие X по тому же участку глубины.
 */
export function tunnelXEnvelopeAroundY(path: PathPoint[], wy: number, halfYm: number): { minX: number; maxX: number } {
  if (path.length === 0) return { minX: 0, maxX: 0 }
  const fallback = tunnelXAtWorldY(path, wy)
  const lo = wy - Math.max(halfYm, TILE * 0.01)
  const hi = wy + Math.max(halfYm, TILE * 0.01)
  const segments = Math.max(10, Math.ceil((2 * (hi - lo)) / (STEP_Y * 0.4)))
  let minX = Infinity
  let maxX = -Infinity
  for (let k = 0; k <= segments; k++) {
    const y = lo + ((hi - lo) * k) / segments
    const x = tunnelXAtWorldY(path, y)
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
  }
  return { minX: minX === Infinity ? fallback : minX, maxX: maxX === -Infinity ? fallback : maxX }
}

/** Та же логика, что горизонтальные пределы генерации декора в `placeObstacles` после смещений пути. */
export function decorGenerationHorizontalExtent(
  path: PathPoint[],
  worldY: number,
  viewportWidthPx?: number,
): { minX: number; maxX: number } {
  /** Тот же паддинг, что в placeObstacles. */
  const decorSpawnPadX = TILE * 1.4
  /** Расширяем область генерации за допустимый коридор по X минимум на ширину экрана. */
  const screenExtraX = viewportWidthPx && viewportWidthPx > 0 ? viewportWidthPx : TILE * 12
  const worldMinX = X_MIN - decorSpawnPadX - screenExtraX
  const worldMaxX = X_MAX + decorSpawnPadX + screenExtraX
  /**
   * Вертикальный захват огибания пути по X: большой шаг между вершинами + MAX_DX
   * может дать большой горизонтальный свинг за несколько секунд движения — берём окно шире.
   */
  /** По вертикали — достаточно широкое окно, но без охвата всего раунда (стоимость выборки). */
  const envelopeHalfY = Math.min(
    TILE * 55,
    Math.max(STEP_Y * 18, STEP_Y * 26 + MAX_DX * 2.6),
  )
  /** Дополнительный полуохват по горизонтали: камера и полоса генерации должны быть шире визуального коридора. */
  const decorLateralExtras = TILE * 4 + MAX_DX * 1.4

  let decorHalfSpan: number
  if (viewportWidthPx && viewportWidthPx > 0) {
    decorHalfSpan = viewportWidthPx * 1.12 + decorSpawnPadX + decorLateralExtras
  } else {
    decorHalfSpan = (worldMaxX - worldMinX) * 0.5 + decorLateralExtras
  }

  const env = tunnelXEnvelopeAroundY(path, worldY, envelopeHalfY)

  let minX = Math.max(worldMinX, env.minX - decorHalfSpan)
  let maxX = Math.min(worldMaxX, env.maxX + decorHalfSpan)

  const mid = (env.minX + env.maxX) * 0.5
  if (maxX - minX < TILE * 0.5) {
    minX = Math.max(worldMinX, mid - TILE * 0.25)
    maxX = Math.min(worldMaxX, mid + TILE * 0.25)
  }
  return { minX, maxX }
}

/**
 * Принято ли считать safeObject по X актуальной «полосой» декора после смещений пути
 * (расширенная область следования по zigzag без отсечения на поворотах).
 */
export function decorSpawnAcceptByPath(
  worldX: number,
  worldY: number,
  path: PathPoint[],
  viewportWidthPx?: number,
): boolean {
  const { minX, maxX } = decorGenerationHorizontalExtent(path, worldY, viewportWidthPx)
  return worldX >= minX && worldX <= maxX
}

/**
 * Проверяет: пересекает ли круг (cx, cy, r) туннель?
 * Туннель = набор капсул между соседними точками пути.
 * Проверяем только сегменты в диапазоне Y ± lookahead.
 */
export function intersectsTunnel(
  cx:      number,
  cy:      number,
  r:       number,
  path:    PathPoint[],
  surfY:   number,
  margin:  number = DECOR_MARGIN,
): boolean {
  const minDist = margin + r
  // Y-диапазон для поиска сегментов (±3 шага)
  const idxCenter = Math.round((cy - surfY) / STEP_Y)
  const lo = Math.max(0, idxCenter - 4)
  const hi = Math.min(path.length - 2, idxCenter + 4)

  for (let i = lo; i <= hi; i++) {
    const a = path[i], b = path[i + 1]
    if (!a || !b) continue
    if (distPointSegment(cx, cy, a.x, a.y, b.x, b.y) < minDist) return true
  }
  return false
}

/**
 * `placeObstacles` рассчитан по пути из buildRoundPath, но GameRenderer сдвигает
 * старт маршрута в `_softenRoundPathStart` — первая часть полилинии смещается по X.
 * Без этой чистки декор в начале визуально оказывается в коридоре (поверх выкопа).
 */
export function pruneDecorObstaclesAfterPathChange(
  path: PathPoint[],
  surfY: number,
  obstacles: SafeObject[],
): SafeObject[] {
  if (path.length === 0) return obstacles
  return obstacles.filter(o => {
    if (o.kind !== 'decor') return true
    const type = o.decorVisual ?? 'GOLD'
    const sz = type === 'HOME' ? DECOR_HOME_PLACE_SZ : (ITEM_SZ[type] ?? 60)
    const r = type === 'HOME' ? (sz * Math.SQRT1_2) : (sz / 2)
    return !intersectsTunnel(o.x, o.y, r, path, surfY, DECOR_VISUAL_TUNNEL_MARGIN)
  })
}

/** Прямоугольная лавовая пещера (мир): центр + полуразмеры + радиус скругления. */
export type LavaCaveRect = { cx: number; cy: number; hw: number; hh: number; cr?: number }

function pointInRoundedRect(x: number, y: number, rect: LavaCaveRect): boolean {
  const cr = Math.max(0, rect.cr ?? 0)
  const dx = Math.abs(x - rect.cx)
  const dy = Math.abs(y - rect.cy)
  if (dx > rect.hw || dy > rect.hh) return false
  if (cr <= 0) return true
  const ix = rect.hw - cr
  const iy = rect.hh - cr
  if (dx <= ix || dy <= iy) return true
  const cx2 = dx - ix
  const cy2 = dy - iy
  return cx2 * cx2 + cy2 * cy2 <= cr * cr
}

/** Пещера пересекает коридор туннеля (запрет спавна лавы на маршруте). */
export function cavePathHitsTunnel(
  cavePoints: Array<{ x: number; y: number; r: number }>,
  path:       PathPoint[],
  surfY:      number,
  rect?:      LavaCaveRect,
): boolean {
  if (rect) {
    const m = CAVE_MARGIN + TILE * 0.25
    const expanded: LavaCaveRect = {
      cx: rect.cx,
      cy: rect.cy,
      hw: rect.hw + m,
      hh: rect.hh + m,
      cr: Math.max(0, (rect.cr ?? 0) + m),
    }
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!, b = path[i + 1]!
      for (let k = 0; k <= 10; k++) {
        const t = k / 10
        const x = a.x + t * (b.x - a.x)
        const y = a.y + t * (b.y - a.y)
        if (pointInRoundedRect(x, y, expanded)) return true
      }
    }
    return false
  }
  for (const p of cavePoints) {
    if (intersectsTunnel(p.x, p.y, p.r, path, surfY, CAVE_MARGIN)) return true
  }
  return false
}

// ─── 2. Построение туннеля ────────────────────────────────────────────────────

/**
 * Строит путь как органичное блуждание.
 * Если roadTargets заданы — плавно притягиваемся к их X в нужный Y.
 */
export function buildTunnel(
  surfY:       number,
  terminalY:   number,
  worldSeed:   number,
  roadTargets: RoadPoint[],
  /** Раунд с лавой — меньше синусов, без резких зигзагов */
  calmPath = false,
): PathPoint[] {
  const path: PathPoint[] = []
  let curX = 0
  const targets = [...roadTargets].sort((a, b) => a.worldY - b.worldY)
  let tIdx = 0

  let y = surfY
  while (y <= terminalY + STEP_Y) {
    // Snap: плавный подход к X road item при приближении по Y
    let snapX: number | null = null
    for (let i = tIdx; i < targets.length; i++) {
      if (Math.abs(targets[i].worldY - y) <= STEP_Y * 1.5) {
        snapX = targets[i].worldX
        tIdx  = i + 1
        break
      }
    }

    if (snapX !== null) {
      const dx = snapX - curX
      const stepCap = MAX_DX * 0.88
      curX = Math.max(X_MIN, Math.min(X_MAX,
        curX + Math.max(-stepCap, Math.min(stepCap, dx))
      ))
      curX = Math.round(curX / TILE) * TILE
    } else {
      const nextT  = targets.find(t => t.worldY > y)
      const idealX = nextT ? nextT.worldX : 0

      const drift  = (idealX - curX) * (calmPath ? 0.14 : 0.09)
      const m      = calmPath ? 0.52 : 1.0
      const wave1  = Math.sin(y * 0.0020 + worldSeed * 0.00013) * TILE * 4.0 * m
      const wave2  = Math.sin(y * 0.0055 + worldSeed * 0.00031) * TILE * 2.0 * m
      const wave3  = Math.sin(y * 0.0130 + worldSeed * 0.00071) * TILE * 0.8 * m
      const jitter = (rng(y ^ 0xF0F0, worldSeed) - 0.5) * TILE * 2.0 * m

      const waveBlend   = calmPath ? 0.30 : 0.38
      const jitterBlend = calmPath ? 0.32 : 0.42
      const dx = drift + (wave1 + wave2 + wave3) * waveBlend + jitter * jitterBlend
      curX = Math.max(X_MIN, Math.min(X_MAX,
        curX + Math.max(-MAX_DX, Math.min(MAX_DX, dx))
      ))
    }

    path.push({ x: curX, y })
    y += STEP_Y
  }

  return path
}

// ─── 3. Road items точно на пути ─────────────────────────────────────────────

/**
 * Размещает road items точно на точках пути.
 * Каждый road item получает {x,y} от реальной PathPoint.
 * Точки выбираются в порядке Y, без повторов.
 */
export function placeRoadItems(
  roadEvents: Array<{ type: string; worldY: number; terminal: boolean }>,
  path:       PathPoint[],
  surfY:      number,
): RoadPoint[] {
  const out: RoadPoint[] = []
  let minIdx = 0

  for (const ev of roadEvents) {
    const targetIdx = Math.round((ev.worldY - surfY) / STEP_Y)
    const start = Math.min(Math.max(0, minIdx), Math.max(0, path.length - 1))
    const prevX = out.length > 0 ? out[out.length - 1]!.worldX : (path[start]?.x ?? 0)
    let bestIdx = -1
    let bestScore = Infinity

    // Глубина по индексу важнее; среди близких по Y выбираем больший горизонтальный шаг (зигзаг),
    // иначе score с штрафом за |dX| вытягивает все предметы почти в одну вертикаль.
    const depthWeight = TILE * 32
    for (let i = start; i < path.length; i++) {
      const dIdx = Math.abs(i - targetIdx)
      const lateral = Math.abs(path[i]!.x - prevX)
      const score = dIdx * depthWeight - lateral
      if (score < bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    if (bestIdx === -1) bestIdx = Math.max(0, path.length - 1)

    const pt = path[bestIdx]!
    minIdx = bestIdx + 1

    // Координаты вершины пути без сетки TILE — иначе центр уходит с полилинии между шагами.
    out.push({
      type:     ev.type,
      worldX:   pt.x,
      worldY:   pt.y,
      terminal: ev.terminal,
    })
  }

  return out
}

/** Тип цели только для buildTunnel (не спавнится как предмет). */
export const GHOST_WAYPOINT_TYPE = 'GHOST'

/**
 * Ложные точки между собираемыми — туннель виляет «случайно», но предметы остаются на RGS.
 * Для LOSS — вертикальный коридор под последним предметом к зоне лавы (без рывков в стороны).
 */
function buildGhostWaypoints(
  roughRoad: RoadPoint[],
  worldSeed: number,
  isLoss: boolean,
): RoadPoint[] {
  if (roughRoad.length === 0) return []
  const ghosts: RoadPoint[] = []

  const ghostGrid = TILE * 0.5
  for (let i = 0; i < roughRoad.length - 1; i++) {
    const a = roughRoad[i]!, b = roughRoad[i + 1]!
    const dy = b.worldY - a.worldY
    if (dy < STEP_Y * 1.5) continue

    let nMid = 1
    if (dy > STEP_Y * 34) nMid = 6
    else if (dy > STEP_Y * 26) nMid = 5
    else if (dy > STEP_Y * 18) nMid = 4
    else if (dy > STEP_Y * 11) nMid = 3
    else if (dy > STEP_Y * 5) nMid = 2

    for (let g = 0; g < nMid; g++) {
      const u = (g + 1) / (nMid + 1)
      const jitterT = (rng(i * 211 + g * 97, worldSeed) - 0.5) * 0.1
      let t = Math.min(0.9, Math.max(0.1, u + jitterT))
      const y = a.worldY + dy * t
      const tLin = (y - a.worldY) / dy
      const bx = a.worldX + (b.worldX - a.worldX) * tLin
      const jx = (rng(i * 313 + g * 41, worldSeed) - 0.5) * TILE * (3.8 + rng(i ^ 0x33, worldSeed) * 5.5)
      let x = bx + jx
      x = Math.max(X_MIN, Math.min(X_MAX, x))
      x = Math.round(x / ghostGrid) * ghostGrid
      ghosts.push({ type: GHOST_WAYPOINT_TYPE, worldX: x, worldY: y, terminal: false })
    }
  }

  if (isLoss) {
    const last  = roughRoad[roughRoad.length - 1]!
    const seedL = (worldSeed ^ 0x1055CAFE) >>> 0
    const r7    = rng(7, seedL)
    const caveHw = TILE * 2.15
    // Боковое смещение: ±caveHw → персонаж подходит к боковой грани пещеры, не к центру сверху
    const lateralOff = (r7 - 0.5) * 2 * caveHw  // −258..+258 px
    const targetX    = Math.max(X_MIN, Math.min(X_MAX, last.worldX + lateralOff))

    // Сначала прямо вниз, потом плавно уходим в сторону targetX
    const ySteps = [1.4, 2.1, 2.8, 3.5, 4.2, 5.0, 5.8, 6.6, 7.4, 8.2, 9.0, 9.8]
    for (let k = 0; k < ySteps.length; k++) {
      const t = Math.max(0, (k - 2) / (ySteps.length - 3))   // кривая начинается со шага 2
      const x = last.worldX + (targetX - last.worldX) * Math.min(1, t * 1.4)
      ghosts.push({
        type:     GHOST_WAYPOINT_TYPE,
        worldX:   Math.round(Math.max(X_MIN, Math.min(X_MAX, x)) / ghostGrid) * ghostGrid,
        worldY:   last.worldY + TILE * ySteps[k]!,
        terminal: false,
      })
    }
  }

  return ghosts
}

// ─── 4. Безопасные объекты ────────────────────────────────────────────────────

/**
 * Спавним декорации, лаву, пещеры — ТОЛЬКО вне туннеля.
 * Каждый объект проверяется как круг радиуса objR против всех капсул туннеля.
 */
export function placeObstacles(
  path:      PathPoint[],
  surfY:     number,
  terminalY: number,
  worldSeed: number,
  roadPoints: RoadPoint[] = [],
  viewportWidthPx?: number,
): SafeObject[] {
  const objects:  SafeObject[] = []
  const SPAWN_INTERVAL = TILE * GameConfig.spawn.decorIntervalTiles
  const maxRow = Math.ceil((terminalY + TILE * 8) / TILE)

  // ── Единый spatial grid для лавы и декора ────────────────────────────────────
  const PGRID = TILE * 3
  const _placedGrid = new Map<number, Array<{x:number; y:number; r:number}>>()
  const _pgKey = (gx: number, gy: number) => gx * 65536 + gy
  const _pgAdd = (x: number, y: number, r: number) => {
    const k = _pgKey(Math.floor(x / PGRID), Math.floor(y / PGRID))
    const c = _placedGrid.get(k)
    if (c) c.push({ x, y, r }); else _placedGrid.set(k, [{ x, y, r }])
  }
  const _pgHit = (x: number, y: number, minDist: number): boolean => {
    const cx = Math.floor(x / PGRID), cy = Math.floor(y / PGRID)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const items = _placedGrid.get(_pgKey(cx + dx, cy + dy))
      if (!items) continue
      for (const p of items) if (Math.hypot(x - p.x, y - p.y) < minDist + p.r) return true
    }
    return false
  }

  // ── Лава — размещается первой, регистрируется в общем grid ───────────────────
  const lavaSpots: Array<{ x: number; y: number; r: number; w: number; h: number }> = []
  for (let tr = 10; tr <= maxRow; tr++) {
    const wy = tr * TILE
    const depth = tr % 200
    const collectLava = (tc: number, scX: number, offX: number, scY: number, thresh: number, seed: number) => {
      const wx = tc * TILE
      if (caveNoise(tc * scX + offX, tr * scY, seed) <= thresh) return
      const lavaR = TILE * 0.8        // радиус для проверки с туннелем
      const lavaCaveR = TILE * 2.15   // реальный размер пещеры — для grid
      if (intersectsTunnel(wx, wy, lavaR, path, surfY, LAVA_MARGIN)) return
      if (_pgHit(wx, wy, lavaCaveR)) return
      _pgAdd(wx, wy, lavaCaveR)
      lavaSpots.push({ x: wx, y: wy, r: lavaR, w: TILE * 2, h: TILE * 2 })
    }
    if (depth >= 35  && depth <= 88)  for (let tc = -16; tc <= 16; tc++) collectLava(tc, 1.25, 50, 0.78, 0.56, worldSeed ^ 0xFF00)
    if (depth >= 118 && depth <= 192) for (let tc = -16; tc <= 16; tc++) collectLava(tc, 1.08, 30, 0.88, 0.52, worldSeed ^ 0xFF11)
  }

  // ── Декорации ──────────────────────────────────────────────────────────────
  const roadOccupancy = roadPoints.map(rp => {
    const sz = rp.type === 'HOME' ? DECOR_HOME_PLACE_SZ : (ITEM_SZ[rp.type] ?? 60)
    const r = rp.type === 'HOME' ? (sz * Math.SQRT1_2) : (sz / 2)
    return { x: rp.worldX, y: rp.worldY, r }
  })

  /** Минимум между центрами декора (чуть больше проплешин между объектами). */
  const decorClearance = TILE * 1.2

  /** Горизонтальные пределы (с кэшем: tunnelXEnvelopeAroundY дорогая, ~405 iter × path.len). */
  const _boundsCache = new Map<number, { minX: number; maxX: number; midX: number }>()
  const decorBoundsAtY = (worldY: number): { minX: number; maxX: number; midX: number } => {
    const key = Math.round(worldY / 10)
    const c = _boundsCache.get(key)
    if (c) return c
    const { minX, maxX } = decorGenerationHorizontalExtent(path, worldY, viewportWidthPx)
    const r = { minX, maxX, midX: (minX + maxX) * 0.5 }
    _boundsCache.set(key, r)
    return r
  }

  /** Принудительная постановка декора в заданную точку (для пост-заполнения видимой полосы по маршруту). */
  const tryPlaceDecorForced = (
    type: EventType,
    worldX: number,
    worldY: number,
    tunnelMargin = DECOR_TUNNEL_PLACE_MARGIN,
  ): boolean => {
    const sz = type === 'HOME' ? DECOR_HOME_PLACE_SZ : (ITEM_SZ[type] ?? 60)
    const r = type === 'HOME' ? (sz * Math.SQRT1_2) : (sz / 2)
    const b = decorBoundsAtY(worldY)
    const x = Math.max(b.minX, Math.min(b.maxX, worldX))
    if (intersectsTunnel(x, worldY, r, path, surfY, tunnelMargin)) return false
    for (const rp of roadOccupancy) {
      if (Math.hypot(x - rp.x, worldY - rp.y) < r + rp.r + TILE * 0.08) return false
    }
    const minD = r + decorClearance
    if (_pgHit(x, worldY, minD)) return false
    _pgAdd(x, worldY, r)
    objects.push({ x, y: worldY, w: sz, h: sz, kind: 'decor', decorVisual: type })
    return true
  }

  const tryDecor = (type: EventType, yRow: number) => {
    const sz = type === 'HOME' ? DECOR_HOME_PLACE_SZ : (ITEM_SZ[type] ?? 60)
    // Для квадратного HOME используем описанную окружность, иначе углы дома
    // могут «въезжать» в коридор при круговой проверке intersectsTunnel.
    const r  = type === 'HOME' ? (sz * Math.SQRT1_2) : (sz / 2)
    const ty = type.charCodeAt(0) ?? 0

    const tryPlace = (worldX: number, worldY: number, tunnelMargin = DECOR_TUNNEL_PLACE_MARGIN): boolean => {
      const b = decorBoundsAtY(worldY)
      const x = Math.max(b.minX, Math.min(b.maxX, worldX))
      if (intersectsTunnel(x, worldY, r, path, surfY, tunnelMargin)) return false
      for (const rp of roadOccupancy) {
        if (Math.hypot(x - rp.x, worldY - rp.y) < r + rp.r + TILE * 0.08) return false
      }
      for (const c of preCaveRects) {
        if (Math.abs(x - c.cx) < CAVE_RHW + r && Math.abs(worldY - c.cy) < CAVE_RHH + r) return false
      }
      const minD = r + decorClearance
      if (_pgHit(x, worldY, minD)) return false
      _pgAdd(x, worldY, r)
      objects.push({ x, y: worldY, w: sz, h: sz, kind: 'decor', decorVisual: type })
      return true
    }

    const baseY =
      yRow + (rng(yRow ^ 0xCAB0 ^ ty, worldSeed) - 0.5) * SPAWN_INTERVAL * 0.38
    const tunX = tunnelXAtWorldY(path, baseY)
    const sides = rng(yRow ^ 0x1234, worldSeed) < 0.5 ? ([-1, 1] as const) : ([1, -1] as const)

    // У визуального туннеля: часть предметов в 1–2px от «стенки» выкопа (не от широкой капсулы TUNNEL_R).
    const vm = DECOR_VISUAL_TUNNEL_MARGIN
    let placedAny = false
    for (let i = 0; i < 28; i++) {
      for (const side of sides) {
        const u = rng(yRow ^ 0x4E11 ^ i * 73 ^ ty, worldSeed)
        const closePack = rng(yRow ^ 0x4A17 ^ i * 41 ^ ty, worldSeed) < 0.62
        const gap = closePack ? 1 + u : 2 + u * 6
        const dtPx = vm + r + gap
        const jLat =
          (rng(yRow ^ 0x5EED + i * 97 + side * 17 + ty, worldSeed) - 0.5) * 3
        const jY =
          (rng(yRow ^ 0x71EE + i * 31 + side * 13, worldSeed) - 0.5) * SPAWN_INTERVAL * 0.06
        const x = tunX + side * dtPx + jLat
        if (tryPlace(x, baseY + jY, vm)) {
          placedAny = true
          break
        }
      }
      if (placedAny) break
    }

    // Левый и правый фланги от оси траектории: без этого при успехе «у стенки туннеля»
    // срабатывает ранний return ниже и половина полосы по X остаётся пустой.
    const bwLane = decorBoundsAtY(baseY)
    const txLane = tunnelXAtWorldY(path, baseY)
    const flankGapCore = vm + r + TILE * 0.92
    const tryHalfBandSpan = (
      edgeMin: number,
      edgeMax: number,
      yW: number,
    ): boolean => {
      if (!(edgeMax > edgeMin + Math.max(TILE * 0.38, r * 1.2))) return false
      for (let fq = 0; fq < 22; fq++) {
        const u = rng(yRow ^ 0xFA11 ^ fq * 79 ^ ty, worldSeed)
        const xx = edgeMin + u * (edgeMax - edgeMin)
        const jY =
          (rng(yRow ^ 0xFA22 ^ fq ^ ty, worldSeed) - 0.5) * SPAWN_INTERVAL * 0.34
        if (tryPlace(xx, yW + jY, vm)) return true
      }
      return false
    }
    const leftEdgeMax = Math.min(txLane - flankGapCore, bwLane.maxX - r - 6)
    const rightEdgeMin = Math.max(txLane + flankGapCore, bwLane.minX + r + 6)
    if (tryHalfBandSpan(bwLane.minX, leftEdgeMax, baseY)) placedAny = true
    if (tryHalfBandSpan(rightEdgeMin, bwLane.maxX, baseY)) placedAny = true

    // Уже есть предмет около коридора / на флангах — второй блок не нужен (он дублирует площади).
    if (placedAny) return

    // Затем заполняем обе половины ширины (правая и левая), чтобы не было пустоты справа.
    const bw = decorBoundsAtY(baseY)
    const midX = bw.midX
    const halfOrder: Array<'right' | 'left'> =
      rng(yRow ^ 0xA11F ^ ty, worldSeed) < 0.5 ? ['right', 'left'] : ['left', 'right']

    for (const half of halfOrder) {
      const minX = half === 'right' ? midX : bw.minX
      const maxX = half === 'right' ? bw.maxX : midX
      for (let i = 0; i < 12; i++) {
        const u = rng(yRow ^ 0x3111 ^ i * 73 ^ ty ^ (half === 'right' ? 0x51 : 0x19), worldSeed)
        const xWide = minX + u * (maxX - minX)
        const jY =
          (rng(yRow ^ 0x3222 ^ i * 29 ^ ty ^ (half === 'right' ? 0x23 : 0x47), worldSeed) - 0.5) * SPAWN_INTERVAL * 0.48
        if (tryPlace(xWide, baseY + jY)) {
          placedAny = true
          break
        }
      }
    }

    const minOffV = vm + r + 2
    const maxOffV = minOffV + TILE * 0.22
    for (let k = 0; k < 18; k++) {
      const wy =
        yRow + (rng(yRow ^ 0x41AA + k * 31 + ty, worldSeed) - 0.5) * SPAWN_INTERVAL * 0.92
      const tx = tunnelXAtWorldY(path, wy)
      const by = decorBoundsAtY(wy)
      const u = rng(yRow ^ 0x51AA + k * 37, worldSeed)
      const v = rng(yRow ^ 0x61AA + k * 41, worldSeed)
      const side = v < 0.5 ? -1 : 1
      const off = minOffV + u * (maxOffV - minOffV)
      const jLat = (rng(yRow ^ 0x71AA + k * 43, worldSeed) - 0.5) * TILE * 0.35
      const x = Math.max(by.minX, Math.min(by.maxX, tx + side * off + jLat))
      if (tryPlace(x, wy, vm)) {
        placedAny = true
        break
      }
    }

    if (!placedAny) {
      const bw = decorBoundsAtY(baseY)
      const u = rng(yRow ^ 0x8BAD ^ ty, worldSeed)
      const xWide = bw.minX + u * (bw.maxX - bw.minX)
      tryPlace(xWide, baseY)
    }
  }

  // ── Предвычисление позиций пещер для исключения декора внутри/около них ──────
  // Должно выполняться до main decor loop — иначе tryPlace не знает о пещерах
  // и ставит декор прямо внутри cave rect, блокируя ring items через _pgHit.
  const CAVE_RHW = TILE * 2.15
  const CAVE_RHH = TILE * 1.15
  const preCaveRects: Array<{ cx: number; cy: number }> = []
  {
    let _cs = worldSeed ^ 0xCAFE1234
    let _cY = surfY + TILE * 3
    while (_cY < terminalY + TILE * 8) {
      const _df = Math.max(0.5, Math.min(2, (_cY - surfY) / 2000))
      _cY += TILE * (15 + 5 * _df)
      _cs = (Math.imul(1664525, _cs) + 1013904223) >>> 0
      const _ls = _cs
      const _cx1 = tunnelXAtWorldY(path, _cY) + ((_ls & 0xFF) / 0xFF - 0.5) * TILE * 12
      const _cr1 = TILE * (3 + (_ls & 0x3))
      if (!intersectsTunnel(_cx1, _cY, _cr1, path, surfY, CAVE_MARGIN)) {
        preCaveRects.push({ cx: _cx1, cy: _cY })
      }
      const _ls2 = (Math.imul(69069, _ls) + 1) >>> 0
      if ((_ls2 & 0xF) < 5) {
        const _cx2 = _cx1 + ((_ls2 & 0xFF) / 0xFF - 0.5) * TILE * 8
        const _cy2 = _cY + TILE * (4 + (_ls2 & 0x7))
        const _cr2 = TILE * (2 + (_ls2 & 0x2))
        if (!intersectsTunnel(_cx2, _cy2, _cr2, path, surfY, CAVE_MARGIN)) {
          preCaveRects.push({ cx: _cx2, cy: _cy2 })
        }
      }
    }
  }

  let dy = surfY + SPAWN_INTERVAL * (0.42 + rng(surfY ^ 0x51EC, worldSeed) * 0.86)
  let decorStepIdx = 0
  while (dy <= terminalY + TILE * 12) {
    const rv = rng(Math.floor(dy) ^ decorStepIdx * 0x9E37, worldSeed)
    if (rv < Math.max(0.22, GameConfig.spawn.spawnChance * 0.84)) {
      // Чуть плотнее ряды, min-дистанция по-прежнему decorClearance.
      const countRoll = rng(Math.floor(dy) ^ 0x77AA ^ decorStepIdx * 0x1F1F, worldSeed)
      const perRow = countRoll < 0.28 ? 4 : countRoll < 0.74 ? 3 : 2
      for (let n = 0; n < perRow; n++) {
        const rowShift = (n - (perRow - 1) / 2) * TILE * (0.34 + rng(Math.floor(dy) ^ n * 0x2D2D, worldSeed) * 0.3)
        const yTry = dy + rowShift
        tryDecor(pickDecorType(yTry + n, rng(yTry ^ 0xABC ^ n * 0x55, worldSeed)), yTry)
      }

      if (rng(dy ^ 0xBEEF, worldSeed) < Math.min(0.9, GameConfig.spawn.doubleChance * 0.92)) {
        const d2 = TILE * (0.38 + rng(dy ^ 0xF00D, worldSeed) * 0.55)
        tryDecor(pickDecorType(dy + 11, rng(dy ^ 0xF00D, worldSeed)), dy + d2)
      }
      if (GameConfig.spawn.decorExtraChance > 0 && rng(dy ^ 0xC001, worldSeed) < Math.min(0.82, GameConfig.spawn.decorExtraChance * 0.9)) {
        const d3 = TILE * (0.82 + rng(dy ^ 0xD00D, worldSeed) * 0.9)
        tryDecor(pickDecorType(dy + 17, rng(dy ^ 0xD00D, worldSeed)), dy + d3)
      }
    }
    const stepMul = 0.88 + rng(Math.floor(dy * 3) ^ decorStepIdx * 0x85EB, worldSeed) * 1.05
    dy += SPAWN_INTERVAL * stepMul
    decorStepIdx++
  }

  // Доп. декоративные "обманки" рядом с реальными road-точками маршрута.
  // Ставим после фонового декора, чтобы игрок чаще видел предметы "почти на линии движения".
  for (let i = 0; i < roadPoints.length; i++) {
    const rp = roadPoints[i]
    if (!rp || rp.terminal) continue
    const anchorY = rp.worldY + (rng((rp.worldY | 0) ^ 0xAC11 ^ i * 97, worldSeed) - 0.5) * TILE * 0.45
    tryDecor(pickDecorType(anchorY, rng((anchorY | 0) ^ 0xD991 ^ i * 13, worldSeed)), anchorY)
    if (rng((rp.worldY | 0) ^ 0xB731 ^ i * 31, worldSeed) < 0.5) {
      const anchorY2 = anchorY + (rng((rp.worldY | 0) ^ 0xC219 ^ i * 61, worldSeed) - 0.5) * TILE * 0.9
      tryDecor(pickDecorType(anchorY2 + 1, rng((anchorY2 | 0) ^ 0xE221 ^ i * 19, worldSeed)), anchorY2)
    }
  }

  // Декор вдоль туннеля между соседними road-точками (и от поверхности до первой цели).
  const segCfg = GameConfig.spawn.pathSegmentDecor
  const sortedRoad = [...roadPoints].sort((a, b) => a.worldY - b.worldY)
  const segMargin = TILE * segCfg.endMarginTiles
  const minSpan = TILE * segCfg.minSpanTiles
  const stepLo = Math.min(segCfg.stepTilesMin, segCfg.stepTilesMax)
  const stepHi = Math.max(segCfg.stepTilesMin, segCfg.stepTilesMax)
  const stepSpan = Math.max(0, stepHi - stepLo)

  const placeDecorAlongSegment = (yA: number, yB: number, segKey: number) => {
    let lo = Math.min(yA, yB) + segMargin
    let hi = Math.max(yA, yB) - segMargin
    if (hi - lo < minSpan) return
    let y = lo
    let stepIdx = 0
    while (y < hi) {
      const roll = rng(Math.floor(y) ^ segKey * 0x9E37 ^ stepIdx * 0x85EB, worldSeed)
      if (roll < segCfg.spawnChance) {
        const jitter =
          (rng(stepIdx ^ segKey ^ 0x4A39 ^ Math.floor(y), worldSeed) - 0.5) * TILE * 0.22
        const decoY = y + jitter
        const ty = pickPathSegmentDecorType(
          decoY,
          rng(Math.floor(decoY) ^ segKey * 0xC001 ^ stepIdx * 0x2D2D, worldSeed),
        )
        tryDecor(ty, decoY)
      }
      const stepT = stepLo + rng(stepIdx ^ segKey ^ 0x7B7F, worldSeed) * stepSpan
      y += TILE * stepT
      stepIdx++
    }
  }

  if (sortedRoad.length > 0) {
    placeDecorAlongSegment(surfY + TILE * 1.05, sortedRoad[0]!.worldY, -0x1000)
  }
  for (let i = 0; i < sortedRoad.length - 1; i++) {
    placeDecorAlongSegment(sortedRoad[i]!.worldY, sortedRoad[i + 1]!.worldY, i)
  }

  // ── Контроль наполненности по полю видимости вдоль каждой точки маршрута ───
  // Проверяем обе стороны от оси пути и добрасываем декор, если в "экранной" полосе пусто.
  const ensureDecorCoverageAtPathPoint = (pt: PathPoint, idx: number): void => {
    if (pt.y < surfY + TILE * 0.35 || pt.y > terminalY + TILE * 7.5) return
    const bounds = decorBoundsAtY(pt.y)
    const spanW = bounds.maxX - bounds.minX
    if (spanW < TILE * 1.2) return

    const viewW = viewportWidthPx && viewportWidthPx > 0 ? viewportWidthPx : spanW * 0.72
    const halfView = Math.max(TILE * 2.4, Math.min(spanW * 0.5, viewW * 0.58))
    const yBand = TILE * 1.05
    const axisGap = DECOR_VISUAL_TUNNEL_MARGIN + TILE * 0.62

    const leftMin = Math.max(bounds.minX, pt.x - halfView)
    const leftMax = Math.min(bounds.maxX, pt.x - axisGap)
    const rightMin = Math.max(bounds.minX, pt.x + axisGap)
    const rightMax = Math.min(bounds.maxX, pt.x + halfView)

    const targetPerSide = viewW > TILE * 9 ? 2 : 1
    const countInBand = (xMin: number, xMax: number): number => {
      if (xMax <= xMin) return 0
      let count = 0
      for (const o of objects) {
        if (o.kind !== 'decor') continue
        if (Math.abs(o.y - pt.y) > yBand) continue
        if (o.x >= xMin && o.x <= xMax) count++
      }
      return count
    }

    const fillSide = (xMin: number, xMax: number, sideKey: number): void => {
      if (xMax <= xMin + TILE * 0.3) return
      let have = countInBand(xMin, xMax)
      if (have >= targetPerSide) return
      const need = targetPerSide - have
      const attempts = need * 16
      for (let a = 0; a < attempts && have < targetPerSide; a++) {
        const u = rng((idx + 1) * 0x9E37 ^ sideKey ^ a * 71, worldSeed)
        const yJ = (rng((idx + 1) * 0x85EB ^ sideKey ^ a * 29, worldSeed) - 0.5) * TILE * 1.3
        const x = xMin + u * (xMax - xMin)
        const y = pt.y + yJ
        const t = pickPathSegmentDecorType(
          y + sideKey * 0.1,
          rng(Math.floor(y) ^ sideKey ^ a * 0x2D2D, worldSeed),
        )
        if (tryPlaceDecorForced(t, x, y, DECOR_VISUAL_TUNNEL_MARGIN)) have++
      }
    }

    fillSide(leftMin, leftMax, 0x41A3)
    fillSide(rightMin, rightMax, 0x72F1)
  }

  for (let i = 0; i < path.length; i++) {
    const pt = path[i]
    if (!pt) continue
    ensureDecorCoverageAtPathPoint(pt, i)
  }

  // ── Лава (только вне туннеля) ─────────────────────────────────────────────
  for (const lv of lavaSpots) {
    objects.push({ x: lv.x, y: lv.y, w: lv.w, h: lv.h, kind: 'lava' })
  }

  // ── Пещеры (только вне туннеля) ───────────────────────────────────────────
  // CAVE_RHW / CAVE_RHH определены выше (pre-compute block)
  let caveSeed  = worldSeed ^ 0xCAFE1234
  let lastCaveY = surfY + TILE * 3
  while (lastCaveY < terminalY + TILE * 8) {
    const df       = Math.max(0.5, Math.min(2, (lastCaveY - surfY) / 2000))
    lastCaveY     += TILE * (15 + 5 * df)
    caveSeed = (Math.imul(1664525, caveSeed) + 1013904223) >>> 0
    const ls  = caveSeed
    const tunX1 = tunnelXAtWorldY(path, lastCaveY)
    const cx1 = tunX1 + ((ls & 0xFF) / 0xFF - 0.5) * TILE * 12
    const cr1 = TILE * (3 + (ls & 0x3))
    if (!intersectsTunnel(cx1, lastCaveY, cr1, path, surfY, CAVE_MARGIN)) {
      objects.push({ x: cx1, y: lastCaveY, w: cr1 * 2 + TILE * 3, h: cr1 * 2 + TILE * 3, kind: 'cave' })
    }
    const ls2 = (Math.imul(69069, ls) + 1) >>> 0
    if ((ls2 & 0xF) < 5) {
      const cx2 = cx1 + ((ls2 & 0xFF) / 0xFF - 0.5) * TILE * 8
      const cy2 = lastCaveY + TILE * (4 + (ls2 & 0x7))
      const cr2 = TILE * (2 + (ls2 & 0x2))
      if (!intersectsTunnel(cx2, cy2, cr2, path, surfY, CAVE_MARGIN)) {
        objects.push({ x: cx2, y: cy2, w: cr2 * 2 + TILE * 3, h: cr2 * 2 + TILE * 3, kind: 'cave' })
      }
    }
  }

  return objects
}

// ─── 5. Главный entry point ───────────────────────────────────────────────────

export function buildRoundPath(
  worldSeed: number,
  surfY:     number,
  ppm:       number,
  events:    RoundEvent[],
  viewportWidthPx?: number,
): FullPathResult {
  const roadEventsOrdered = events.filter(ev => ev.type !== 'LAVA')
  const roadEvents = roadEventsOrdered.map(ev => ({
    type:     ev.type,
    worldY:   surfY + ev.depth * ppm,
    terminal: ev.type === 'HOME',
  }))

  const deepestY  = roadEvents.reduce((m, r) => Math.max(m, r.worldY), surfY)
  const homeEv    = roadEvents.find(r => r.terminal)
  const isLoss    = events.some(ev => ev.type === 'LAVA')
  /** Ниже последнего предмета LOSS добавляются ghost-точки (до ~6 TILE); иначе buildTunnel обрежет путь на HOME/ deepest. */
  const terminalY = Math.max(
    homeEv?.worldY ?? (deepestY + TILE * 10),
    isLoss ? deepestY + TILE * 8 : surfY,
  )

  const _wt0 = performance.now()

  // Pass 1: путь без road items (случайное блуждание)
  const roughPath  = buildTunnel(surfY, terminalY, worldSeed, [], isLoss)
  const _wt1 = performance.now()

  // Pass 2: road items на грубом пути
  const roughRoad = placeRoadItems(roadEvents, roughPath, surfY)

  // Pass 2b: ложные цели (петли маршрута) + подвод к лаве для LOSS
  const ghostTargets = buildGhostWaypoints(roughRoad, worldSeed, isLoss)
  const tunnelTargets = [...roughRoad, ...ghostTargets].sort((a, b) => a.worldY - b.worldY)
  const _wt2 = performance.now()

  // Pass 3: финальный туннель через реальные + призрачные цели
  const path = buildTunnel(surfY, terminalY, worldSeed, tunnelTargets, isLoss)
  const _wt3 = performance.now()

  // Pass 4: road items точно на финальном туннеле + на оси туннеля (проекция на полилинию)
  let roadPoints = placeRoadItems(roadEvents, path, surfY)
  roadPoints = snapRoadPointsOntoTunnelAxis(roadPoints, path)
  for (const rp of roadPoints) {
    const d = distancePointToTunnelPolyline(rp.worldX, rp.worldY, path)
    if (d > 0.5 || !roadItemTouchesTunnelAxis(rp.worldX, rp.worldY, path, rp.type)) {
      console.warn(`[WorldMap] road ${rp.type}: dist до оси=${d.toFixed(2)}px`)
    }
  }
  const _wt4 = performance.now()

  // Pass 5: объекты вне туннеля (капсульная проверка)
  const obstacles  = placeObstacles(path, surfY, terminalY, worldSeed, roadPoints, viewportWidthPx)
  const _wt5 = performance.now()
  console.table({
    'P1 buildTunnel rough':    { ms: (_wt1-_wt0).toFixed(1), pts: roughPath.length },
    'P2 roadItems+ghost':      { ms: (_wt2-_wt1).toFixed(1) },
    'P3 buildTunnel final':    { ms: (_wt3-_wt2).toFixed(1), pts: path.length },
    'P4 snapRoadPoints':       { ms: (_wt4-_wt3).toFixed(1) },
    'P5 placeObstacles':       { ms: (_wt5-_wt4).toFixed(1) },
    '── terminalY (px)':       { ms: terminalY.toFixed(0) },
  })

  // Waypoints для GameRenderer (только X)
  const waypoints  = path.map(p => p.x)

  // Терминальная пещера для LOSS — центр у конца полилинии туннеля (а не у последнего предмета),
  // иначе пещера/лава оказываются в стороне от фактического выхода коридора.
  // Смещение по X: от −hw до +hw, чтобы персонаж попадал в лаву не только по центру сверху,
  // а иногда с края, угла или сбоку.
  const pathLast = path.length > 0 ? path[path.length - 1]! : null
  // Cave center = pathLast.x ± caveHw (пещера строго сбоку от позиции персонажа).
  // Знак совпадает с lateralOff из buildGhostWaypoints (тот же seed ^ 0x1055CAFE, rng(7)).
  const _seedL    = (worldSeed ^ 0x1055CAFE) >>> 0
  const _caveHw   = TILE * 2.15
  const _caveSign = rng(7, _seedL) >= 0.5 ? 1 : -1
  const terminalCave = isLoss && pathLast
    ? { x: pathLast.x + _caveSign * _caveHw, y: pathLast.y, seed: (worldSeed ^ 0xDEAD1234) >>> 0 }
    : null

  const dc = obstacles.filter(o => o.kind === 'decor').length
  const lv = obstacles.filter(o => o.kind === 'lava').length
  const cv = obstacles.filter(o => o.kind === 'cave').length
  console.log(`[WorldMap] туннель R=${TUNNEL_R}px | ${path.length} wp | декор: ${dc}, лава: ${lv}, пещеры: ${cv}${terminalCave ? ' | 🔥 терм. пещера' : ''}`)
  console.log(`[WorldMap] road: ${roadPoints.map(r => `${r.type}@(${r.worldX},${r.worldY.toFixed(0)})`).join(' → ')}`)

  return { waypoints, pathPoints: path, roadPoints, roadEventsOrdered, obstacles, terminalCave }
}

// Алиасы для обратной совместимости
export { buildRoundPath as buildRoundPathV2, buildRoundPath as buildRoundPathV3 }

// ─── Экспорты для Tileworld ───────────────────────────────────────────────────
export { intersectsTunnel as inCorridor }
export type { PathPoint as Waypoint }