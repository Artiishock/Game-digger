/**
 * GameConfig — единственное место где настраивается баланс игры.
 *
 * Математик может менять любые значения здесь и не трогать остальной код.
 * Все числа прокомментированы с указанием единиц измерения и эффекта.
 */

/** Пикселей на тайл — те же значения, что `TILE` в Tileworld.ts и WorldMap.ts. */
const TILE_PX = 120

/**
 * Большая сторона PNG героя в пикселях мира (масштаб спрайта в GameRenderer).
 * Ширина выкопа поперёк копания = эта величина (полуось `ellipseRadiusXPx` = половина).
 */
export const HERO_MAX_SIDE_PX = TILE_PX * 1.1

/** Доля полуоси Y от maxSide: прежнее соотношение 34/132 при maxSide = TILE×1.1. */
const TUNNEL_SCRATCH_RY_FRAC_OF_MAX_SIDE = 34 / 132

export const GameConfig = {
  items: {
    COIN: {
      addValues: [1, 2, 5, 10] as number[], // прибавка к множителю, выбирается случайно
    },
    DIAMOND: {
      multValues: [2, 3, 4, 5] as number[], // умножение множителя, выбирается случайно
    },
    BOMB: {
      divisor: 2,     // на сколько делится множитель (2 = делит пополам)
    },
    STONE: {
      subValues: [1, 2, 3, 4] as number[],  // вычитание из множителя, выбирается случайно
      durationMin: 3, // только если у ивента нет эффекта (редкий fallback): не sN-токены
      durationMax: 5,
    },
    GOLD: {
      addValues: [1, 2, 3, 4] as number[],  // прибавка к множителю; с RGS: пауза = tier × 0.5 с
      durationMin: 3,
      durationMax: 5,
    },
    HOME: {
      hitW: 200,  // ширина хитбокса кровати (px) — независимо от размера текстуры
      hitH: 180,  // высота хитбокса кровати (px)
    },
  },

  // ─── Ограничения множителя ───────────────────────────────────────────────────
  multiplier: {
    floor: 0,     // минимально возможный множитель (никогда не падает ниже)
  },

  // ─── Масштаб пропов (Spine) ──────────────────────────────────────────────────
  // Меняйте, чтобы увеличить/уменьшить визуальный размер предметов.
  // Ориентир: 0.25 ≈ 125 px. Подбирайте на глаз, запустив раунд.
  itemScale: {
    COIN:    0.2,
    DIAMOND: 0.2,
    BOMB:    0.2,
    GOLD:    0.08,
    STONE:   0.08,
  } as Record<string, number>,

  // ─── Подпись значения на пропе (+N / ×N над монетой и алмазом) ──────────────
  valueLabel: {
    /** Имя шрифта (CSS font-family). */
    fontFamily:     'Arial, sans-serif',
    /** Толщина шрифта: 'normal' | 'bold' | '900' и т.д. */
    fontWeight:     '900' as string,
    /** Поворот текста в градусах (отрицательное = против часовой). */
    rotationDeg:    10,
    /** Смещение подписи от центра пропа, в долях от max(width,height). Y вниз положительный. */
    offsetXFactor:  0.2,
    offsetYFactor:  0.35,
    /** Толщина обводки текста (в пикселях). */
    strokeThickness: 2,
    /** Цвет обводки (0xRRGGBB). */
    strokeColor:    0x000000,
    /** Тень текста (Drop shadow). */
    shadow: {
      enabled:  true,
      color:    0x000000,
      offsetX:  0,   // смещение тени по X (px)
      offsetY:  2,   // смещение тени по Y (px)
      blur:     0,   // размытие тени (px)
      alpha:    1,   // прозрачность тени (0–1)
    },
    /**
     * Индивидуальный стиль для каждого значения.
     * Ключ — строка `${TYPE}:${value}`. Значение — размер шрифта в px и цвет.
     */
    tiers: {
      'COIN:1':     { fontSize: 26, color: 0xD9D9D9 },
      'COIN:2':     { fontSize: 32, color: 0xD9D9D9 },
      'COIN:5':     { fontSize: 40, color: 0xA2F9FF },
      'COIN:10':    { fontSize: 40, color: 0xFFC300 },
      'DIAMOND:2':  { fontSize: 26, color: 0xD9D9D9 },
      'DIAMOND:3':  { fontSize: 32, color: 0xD9D9D9 },
      'DIAMOND:4':  { fontSize: 40, color: 0xA2F9FF },
      'DIAMOND:5':  { fontSize: 40, color: 0xFFC300 },
    } as Record<string, { fontSize: number; color: number }>,
    /** Фоллбэк-стиль, если значения нет в `tiers`. */
    fallback: { fontSize: 36, color: 0xFFFFFF },
  },

  // ─── Спавн предметов ─────────────────────────────────────────────────────────
  spawn: {
    /** Шаг пути WorldMap / интерполяция персонажа (должен совпадать с STEP_Y в WorldMap) */
    intervalTiles: 0.2,
    /** Плотнее ряды декора (только placeObstacles) */
    decorIntervalTiles: 0.24,
    spawnChance:     1, // вероятность что в точке спавна появится предмет (0–1)
    doubleChance:    0.88,  // повышено: чаще второй декор в кластере
    /** Доп. попытка декора между основными рядами (0–1) */
    decorExtraChance: 0.9,

    /**
     * Декор вдоль оси туннеля между соседними road-предметами (и от поверхности до первого).
     * Те же капсулы «вне коридора», без HOME — чтобы не путать с финишем.
     */
    pathSegmentDecor: {
      endMarginTiles: 0.52,
      minSpanTiles:   1.08,
      stepTilesMin:   0.36,
      stepTilesMax:   0.78,
      spawnChance:    1,
    },

    // Вероятности типов предметов (зависят от глубины)
    types: {
      coinBase:        0.25,  // базовый шанс монеты
      bombBase:        0.15,  // базовый шанс бомбы (растёт с глубиной)
      bombMax:         0.30,  // максимальный шанс бомбы на большой глубине
      bombDepthScale:  0.01,  // насколько быстро растёт шанс бомбы с глубиной
      stoneBase:       0.10,  // базовый шанс камня
      stoneMax:        0.20,  // максимальный шанс камня на большой глубине
      stoneDepthScale: 0.008, // насколько быстро растёт шанс камня с глубиной
      goldThreshold:     0.68,  // ниже — GOLD; затем узкий слот HOME-декор; остальное — DIAMOND
      /** Доля рандома после goldThreshold на декоративный HOME (не терминал RGS, без коллизии) */
      homeDecorChance: 0.028,
      // остаток до 1.0 → DIAMOND

      homeChance:      0.80,  // вероятность появления HOME в каждой точке его интервала (0–1)
      homeMinDepth:    30,    // минимальная глубина (в тайлах) до которой HOME не спавнится
      homeIntervalTiles: 20, // каждые N тайлов — отдельная проверка на появление HOME
    },
  },

  // ─── Движение персонажа ───────────────────────────────────────────────────────
  movement: {
    charSpeed:          600,    // спуск в туннеле (ниже — спокойнее, естественнее)
    idleSpeed:          70,    // скорость в режиме idle (пикс/сек)
    speedMultMin:       0.97,  // узкий диапазон — почти постоянная скорость спуска
    speedMultMax:       1.03,
    speedChangeMin:     2.0,   // реже переключать множитель (стабильнее ощущение)
    speedChangeMax:     5.0,
    speedLerpFactor:    1.4,   // мягче смена speedMult — меньше «деревянности»
    /** Сглаживание скорости вдоль дуги туннеля (больше — быстрее выходит на целевую) */
    arcSpeedLerp:       6.5,
    /** Сглаживание касательной для разворота спрайта */
    tangentSmooth:      11,
    /** Сглаживание следования по X к оси туннеля (чем больше — тем резче, меньше лаг) */
    tunnelXSmoothing:   24,
  },

  /**
   * Форма выкопа в TileWorld.scratchAt: овал в осях мира (не круг).
   * Полуось X = половина `HERO_MAX_SIDE_PX` — ширина коридора совпадает с шириной героя на экране.
   */
  tunnelScratch: {
    /** Полуось поперёк направления копания (= половина макс. стороны спрайта героя). */
    ellipseRadiusXPx: HERO_MAX_SIDE_PX * 0.3,
    /** Полуось вдоль направления копания (тоньше — меньше «капсула» ломает повороты). */
    ellipseRadiusYPx: HERO_MAX_SIDE_PX * TUNNEL_SCRATCH_RY_FRAC_OF_MAX_SIDE,
    /** Уменьшение обеих осей для тёмного слоя маски */
    darkInsetPx: 5,
    /** Шаг субсэмплов вдоль сегмента: доля от min(rx,ry); больше — реже точки, дешевле CPU на Mac. */
    segmentSpacingMul: 0.15,
    /** Вершин полигона овала (больше — глаже контур). Меньше — дешевле scratchAt. */
    ellipsePolySteps: 48,
  },

  // ─── Лава ────────────────────────────────────────────────────────────────────
  lava: {
    minDepthTiles: 2,   // ниже порог: ранние касания лавы больше не пропускаются
    /** Макс. декоративных лавовых пещер за раунд (процедурные + WorldMap); терминал LOSS не считается */
    maxDecorCaves: 22,
    /** Сколько пещер максимум создать за один кадр в _spawnCavesAhead (защита от подвисания) */
    maxCavesSpawnPerFrame: 2,
    /** Интервал процедурных пещер: TILE × (base + depthAdd × depthFactor); раньше было ~15+5× */
    proceduralCaveBaseTiles: 20,
    proceduralCaveDepthAdd:  6,
    /** Вторичная пещера рядом: срабатывает если (seed & 15) < threshold (из 16). Было 11 — слишком часто */
    secondaryCaveChance16: 4,
    /**
     * Маркеры WorldMap kind=lava: пещера только если (seed & mask) === 0.
     * mask=3 → ~1/4; было (seed&1) → половина.
     */
    worldLavaSpawnMask: 3,
    /**
     * Размер TilingSprite лавы (логические px). Было 4096² — тяжело по памяти и fill-rate на Retina;
     * 2560 достаточно при типичном viewport, позиция в `LavaSimulation` центрируется под камеру.
     */
    tilingWidthPx: 4096,
    tilingHeightPx: 4096,

    /** Скорость вылета вверх с анимацией die (px/с, игровое время). */
    deathAscentSpeedPx: 500,
    /** Запас, если декодированный `finish_lose.ogg` ещё недоступен — расчёт скорости вылета призрака. */
    finishLoseSfxDurationFallbackSec: 2.0,
    /** Макс. длительность подъёма (с) — дальше принудительно переключение на героя наверху. */
    deathAscentMaxSec: 14,
    /**
     * Множитель движения в сцене LAVA поражения: подъём, камера, тики частиц/анимаций.
     * 1 = как у основного геймплея; меньше 1 — чуть медленнее.
     */
    deathSceneMotionScale: 1.64,
    /**
     * После встречи с «земным» клоном: зацикленный idle, полёт вверх в небо.
     * Скорость (px/с, игр. время), мин. длина фазы (с), высота (px над точкой встречи), лимит (с).
     */
    heavenRiseSpeedPx:  32,
    heavenRiseMinSec:  1.35,
    heavenRiseHeightPx: 380,
    heavenRiseMaxSec:  7,
  },

  // ─── Тайминги завершения раунда ──────────────────────────────────────────────
  round: {
    winDelayMs:       800,   // задержка после HOME перед переходом в результат, мс
    loseDelayMs:      1000,  // задержка после LAVA перед переходом в результат, мс
    /** После проигрыша в лаве: плавное «выплывание» камеры к idle (сек), затем сборка idle-сцены. 0 — сразу _returnToIdle. */
    loseIdleGlideSec: 1,
    autoplayDelayMs:  1200,  // задержка между раундами в автоплее, мс
    /** Множитель «экран / глубина» для ppm — больше → дальше друг от друга символы по Y */
    depthSpreadScreenFactor: 2.6,
    /**
     * Пороги финального множителя (выплата/ставка) для Spine `public/animations/{bigwin|epicwin|megawin}/`.
     * Порядок уровней: big < mega < epic (числа по возрастанию).
     */
    bigWinExclusiveAboveMultiplier: 10,
    megaWinMinMultiplier: 50,
    epicWinMinMultiplier: 175,
  },

  // ─── Герой: калибровка (px; углы — радианы) ────────────────────────────────
  hero: {
    /**
     * Высота Spine-скелета при scale=1. Масштаб на экране: `HERO_MAX_SIDE_PX / spineRefHeightPx`.
     */
    spineRefHeightPx: 746,
    /**
     * Добавка к atan2(ny,nx) касательной туннеля: локальный +Y героя = «вперёд по копанию».
     */
    drillFacingOffsetRad: -Math.PI / 2,
    /**
     * Только визуал die в сцене LAVA (подъём): доп. угол Spine/спрайта, рад. Root не крутится — бейдж/пр. независимы.
     * π = 180°. Для смены ориентации смерти меняйте только это значение.
     */
    lavaDieExtraRotationRad: Math.PI/180 ,

    /**
     * До старта раунда и в idle (главный экран): `miner.root` от точки (idleX, surfY).
     * surfY — линия травы (= TILE), +Y вниз.
     */
    idle: {
      rootOffsetXPx: 0,
      rootOffsetYPx: 0,
      /** Смещение Spine/PNG внутри root, пока персонаж не копает */
      spriteOffsetYPx: -100,
    },

    /**
     * Во время копания: к (charX, charY) добавляются смещения вдоль/поперёк касательной
     * и `tunnelWorldOffset*`. Логика знака `tunnelOffsetAcrossPx` при tx < 0 — в GameRenderer.
     */
    dig: {
      tunnelOffsetAlongPx: 40,
      tunnelOffsetAcrossPx: 4,
      tunnelWorldOffsetXPx: 0,
      tunnelWorldOffsetYPx: -30,
      /** Смещение Spine/PNG внутри root при активном бурении */
      spriteOffsetYPx: 24,
    },
  },

  /**
   * Логический размер видимой области мира (px) для расчёта окна чанков в TileWorld.
   * По ним считаются colMin/colMax/rowMin/rowMax и подложка туннеля — число чанков и
   * тайлов земли в активной зоне не «плавает» от фактического размера canvas.
   * Игровой canvas по-прежнему может быть другим (масштаб); камера/рендер используют this.W/this.H.
   * Для idle-меню см. вызов `tileWorld.update(..., { w, h })` — отдельный временный viewport.
   */
  viewportChunks: {
    widthPx:  1920,
    heightPx: 1080,
  },

  /**
   * Снижение фоновой нагрузки: лимит FPS в меню и пауза Pixi ticker при скрытой вкладке.
   */
  performance: {
    /** Главный экран (idle): верхний предел FPS тикера (0 = без лимита). */
    idleMenuMaxFps: 24,
    /** Остановка `app.ticker` при `document.visibilityState === 'hidden'`. */
    pauseTickerWhenPageHidden: true,
    /**
     * Потолок `devicePixelRatio` для внутреннего разрешения Pixi (`resolution` / backing store).
     * 1.0 = рендер в логических пикселях, нет Retina-масштаба → ~56% меньше пикселей на Mac.
     * На старых MacBook Air / Intel Mac это критичная экономия GPU.
     */
    maxDevicePixelRatio: 2.0,

    /** Сколько чанков из буферной очереди собирать за один кадр (меньше — ровнее FPS, дольше «догруз»). */
    tileWorldChunkBuildsPerFrame: 1,

    /** Верхний предел одновременных круглых частиц `_burst` (остальные отбрасываются). */
    particleMax: 120,
    /** Число частиц при сборе пропа (не HOME). */
    burstCollectParticles: 5,
    burstHomeParticles: 12,
    burstLavaHitParticles: 6,
    burstGoldBreakParticles: 1,
    burstGoldCollectParticles: 4,
    /**
     * WebGL multisampling (antialias). На встроенных GPU (MacBook Air, старые Intel) даёт заметную цену кадра;
     * на дискретных Windows часто почти бесплатно — при необходимости поставьте true.
     */
    webglAntialias: true,
  },

  // ─── Коллизии ────────────────────────────────────────────────────────────────
  collision: {
    radiusTiles: 0.25,   // радиус хитбокса персонажа (в тайлах)
  },

  // ─── Отталкивание объектов ────────────────────────────────────────────────
  // radius:   расстояние (px) на котором начинается отталкивание (0 = выключено)
  // strength: сила импульса (px/sec), добавляется к _velX персонажа
  // ─── Отталкивание после сбора ────────────────────────────────────────────
  // Срабатывает в момент коллизии (сбора) — не раньше.
  // strength:      сила импульса (px/sec), в ту же сторону откуда подошёл персонаж
  // freezeDurSec:  секунды заморозки X-движения к вейпоинту после толчка
  repulsion: {
    COIN:    { strength: 180,  freezeDurSec: 0.25 },
    DIAMOND: { strength: 200,  freezeDurSec: 0.25 },
    GOLD:    { strength: 180,  freezeDurSec: 0.30 },
    BOMB:    { strength: 380,  freezeDurSec: 0.40 },
    STONE:   { strength: 220,  freezeDurSec: 0.35 },
    HOME:    { strength:   0,  freezeDurSec: 0    },
    LAVA:    { strength:   0,  freezeDurSec: 0    },
  } as Record<string, { strength: number; freezeDurSec: number }>,

} // as const убран — некоторые конфигурации Vite не распознают экспорт с as const

/** Единый потолок DPR для Pixi / Spine‑оверлеев (см. `GameConfig.performance.maxDevicePixelRatio`). */
export function effectiveDevicePixelRatio(): number {
  const cap = GameConfig.performance.maxDevicePixelRatio
  return Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, cap)
}