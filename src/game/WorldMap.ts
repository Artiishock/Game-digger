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
    const last = roughRoad[roughRoad.length - 1]!
    const seedL = (worldSeed ^ 0x1055CAFE) >>> 0
    const xJ = Math.round(((rng(7, seedL) - 0.5) * TILE * 1.2) / ghostGrid) * ghostGrid
    const pullX = Math.max(X_MIN, Math.min(X_MAX, last.worldX + xJ))
    const ySteps = [1.4, 2.1, 2.8, 3.5, 4.2, 4.9, 5.6, 6.2]
    for (let k = 0; k < ySteps.length; k++) {
      ghosts.push({
        type:     GHOST_WAYPOINT_TYPE,
        worldX:   pullX,
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
): SafeObject[] {
  const objects:  SafeObject[] = []
  const SPAWN_INTERVAL = TILE * GameConfig.spawn.decorIntervalTiles
  const maxRow = Math.ceil((terminalY + TILE * 8) / TILE)

  // ── Предпросчёт лавовых точек (используются и для анти-спавна декора, и для итогового спавна лавы) ──
  const lavaSpots: Array<{ x: number; y: number; r: number; w: number; h: number }> = []
  for (let tr = 10; tr <= maxRow; tr++) {
    const wy = tr * TILE
    const depth = tr % 200
    const collectLava = (tc: number, scX: number, offX: number, scY: number, thresh: number, seed: number) => {
      const wx = tc * TILE
      if (caveNoise(tc * scX + offX, tr * scY, seed) <= thresh) return
      const lavaR = TILE * 0.8
      if (intersectsTunnel(wx, wy, lavaR, path, surfY, LAVA_MARGIN)) return
      lavaSpots.push({ x: wx, y: wy, r: lavaR, w: TILE * 2, h: TILE * 2 })
    }
    if (depth >= 35  && depth <= 88)  for (let tc = -16; tc <= 16; tc++) collectLava(tc, 1.25, 50, 0.78, 0.56, worldSeed ^ 0xFF00)
    if (depth >= 118 && depth <= 192) for (let tc = -16; tc <= 16; tc++) collectLava(tc, 1.08, 30, 0.88, 0.52, worldSeed ^ 0xFF11)
  }

  // ── Декорации ──────────────────────────────────────────────────────────────
  const placed: Array<{ x: number; y: number; r: number }> = []

  /** Минимум между центрами декора (чуть больше проплешин между объектами). */
  const decorClearance = TILE * 1.2
  /** Декор может появляться чуть шире игрового окна, чтобы не было пустых краёв. */
  const decorSpawnPadX = TILE * 1.4
  const decorSpawnMinX = X_MIN - decorSpawnPadX
  const decorSpawnMaxX = X_MAX + decorSpawnPadX

  const tryDecor = (type: EventType, yRow: number) => {
    const sz = type === 'HOME' ? DECOR_HOME_PLACE_SZ : (ITEM_SZ[type] ?? 60)
    // Для квадратного HOME используем описанную окружность, иначе углы дома
    // могут «въезжать» в коридор при круговой проверке intersectsTunnel.
    const r  = type === 'HOME' ? (sz * Math.SQRT1_2) : (sz / 2)
    const ty = type.charCodeAt(0) ?? 0

    const tryPlace = (worldX: number, worldY: number, tunnelMargin = DECOR_TUNNEL_PLACE_MARGIN): boolean => {
      const x = Math.max(decorSpawnMinX, Math.min(decorSpawnMaxX, worldX))
      if (intersectsTunnel(x, worldY, r, path, surfY, tunnelMargin)) return false
      // Не ставим декор в зонах будущей лавы.
      for (const lv of lavaSpots) {
        if (Math.hypot(x - lv.x, worldY - lv.y) < r + lv.r) return false
      }
      const minD = r + decorClearance
      for (const p of placed) {
        if (Math.hypot(x - p.x, worldY - p.y) < minD + p.r) return false
      }
      placed.push({ x, y: worldY, r })
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

    // Если удалось поставить у туннеля — не разбрасываем этот объект далеко.
    if (placedAny) return

    // Затем заполняем обе половины ширины (правая и левая), чтобы не было пустоты справа.
    const midX = (decorSpawnMinX + decorSpawnMaxX) * 0.5
    const halfOrder: Array<'right' | 'left'> =
      rng(yRow ^ 0xA11F ^ ty, worldSeed) < 0.5 ? ['right', 'left'] : ['left', 'right']

    for (const half of halfOrder) {
      const minX = half === 'right' ? midX : decorSpawnMinX
      const maxX = half === 'right' ? decorSpawnMaxX : midX
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
      const u = rng(yRow ^ 0x51AA + k * 37, worldSeed)
      const v = rng(yRow ^ 0x61AA + k * 41, worldSeed)
      const side = v < 0.5 ? -1 : 1
      const off = minOffV + u * (maxOffV - minOffV)
      const jLat = (rng(yRow ^ 0x71AA + k * 43, worldSeed) - 0.5) * TILE * 0.35
      const x = tx + side * off + jLat
      if (tryPlace(x, wy, vm)) {
        placedAny = true
        break
      }
    }

    if (!placedAny) {
      const u = rng(yRow ^ 0x8BAD ^ ty, worldSeed)
      const xWide = decorSpawnMinX + u * (decorSpawnMaxX - decorSpawnMinX)
      tryPlace(xWide, baseY)
    }
  }

  let dy = surfY + SPAWN_INTERVAL * (0.42 + rng(surfY ^ 0x51EC, worldSeed) * 0.86)
  let decorStepIdx = 0
  while (dy <= terminalY + TILE * 8) {
    const rv = rng(Math.floor(dy) ^ decorStepIdx * 0x9E37, worldSeed)
    if (rv < Math.max(0.22, GameConfig.spawn.spawnChance * 0.84)) {
      // Чуть плотнее ряды, min-дистанция по-прежнему decorClearance.
      const countRoll = rng(Math.floor(dy) ^ 0x77AA ^ decorStepIdx * 0x1F1F, worldSeed)
      const perRow = countRoll < 0.22 ? 3 : countRoll < 0.68 ? 2 : 1
      for (let n = 0; n < perRow; n++) {
        const rowShift = (n - (perRow - 1) / 2) * TILE * (0.34 + rng(Math.floor(dy) ^ n * 0x2D2D, worldSeed) * 0.3)
        const yTry = dy + rowShift
        tryDecor(pickDecorType(yTry + n, rng(yTry ^ 0xABC ^ n * 0x55, worldSeed)), yTry)
      }

      if (rng(dy ^ 0xBEEF, worldSeed) < Math.min(0.72, GameConfig.spawn.doubleChance * 0.78)) {
        const d2 = TILE * (0.38 + rng(dy ^ 0xF00D, worldSeed) * 0.55)
        tryDecor(pickDecorType(dy + 11, rng(dy ^ 0xF00D, worldSeed)), dy + d2)
      }
      if (GameConfig.spawn.decorExtraChance > 0 && rng(dy ^ 0xC001, worldSeed) < Math.min(0.55, GameConfig.spawn.decorExtraChance * 0.68)) {
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

  // ── Лава (только вне туннеля) ─────────────────────────────────────────────
  for (const lv of lavaSpots) {
    objects.push({ x: lv.x, y: lv.y, w: lv.w, h: lv.h, kind: 'lava' })
  }

  // ── Пещеры (только вне туннеля) ───────────────────────────────────────────
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
    if (!intersectsTunnel(cx1, lastCaveY, cr1, path, surfY, CAVE_MARGIN))
      objects.push({ x: cx1, y: lastCaveY, w: cr1 * 2 + TILE * 3, h: cr1 * 2 + TILE * 3, kind: 'cave' })
    const ls2 = (Math.imul(69069, ls) + 1) >>> 0
    if ((ls2 & 0xF) < 5) {
      const cx2 = cx1 + ((ls2 & 0xFF) / 0xFF - 0.5) * TILE * 8
      const cy2 = lastCaveY + TILE * (4 + (ls2 & 0x7))
      const cr2 = TILE * (2 + (ls2 & 0x2))
      if (!intersectsTunnel(cx2, cy2, cr2, path, surfY, CAVE_MARGIN))
        objects.push({ x: cx2, y: cy2, w: cr2 * 2 + TILE * 3, h: cr2 * 2 + TILE * 3, kind: 'cave' })
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

  // Pass 1: путь без road items (случайное блуждание)
  const roughPath  = buildTunnel(surfY, terminalY, worldSeed, [], isLoss)

  // Pass 2: road items на грубом пути
  const roughRoad = placeRoadItems(roadEvents, roughPath, surfY)

  // Pass 2b: ложные цели (петли маршрута) + подвод к лаве для LOSS
  const ghostTargets = buildGhostWaypoints(roughRoad, worldSeed, isLoss)
  const tunnelTargets = [...roughRoad, ...ghostTargets].sort((a, b) => a.worldY - b.worldY)

  // Pass 3: финальный туннель через реальные + призрачные цели
  const path = buildTunnel(surfY, terminalY, worldSeed, tunnelTargets, isLoss)

  // Pass 4: road items точно на финальном туннеле + на оси туннеля (проекция на полилинию)
  let roadPoints = placeRoadItems(roadEvents, path, surfY)
  roadPoints = snapRoadPointsOntoTunnelAxis(roadPoints, path)
  for (const rp of roadPoints) {
    const d = distancePointToTunnelPolyline(rp.worldX, rp.worldY, path)
    if (d > 0.5 || !roadItemTouchesTunnelAxis(rp.worldX, rp.worldY, path, rp.type)) {
      console.warn(`[WorldMap] road ${rp.type}: dist до оси=${d.toFixed(2)}px`)
    }
  }

  // Pass 5: объекты вне туннеля (капсульная проверка)
  const obstacles  = placeObstacles(path, surfY, terminalY, worldSeed, roadPoints)

  // Waypoints для GameRenderer (только X)
  const waypoints  = path.map(p => p.x)

  // Терминальная пещера для LOSS — центр у конца полилинии туннеля (а не у последнего предмета),
  // иначе пещера/лава оказываются в стороне от фактического выхода коридора.
  const pathLast = path.length > 0 ? path[path.length - 1]! : null
  const terminalCave = isLoss && pathLast
    ? { x: pathLast.x, y: pathLast.y + TILE * 2, seed: (worldSeed ^ 0xDEAD1234) >>> 0 }
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