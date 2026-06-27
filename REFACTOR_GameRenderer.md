# ТЗ: декомпозиция `GameRenderer.ts` (3378 строк)

> **Цель:** разбить бог-объект на модули с одной ответственностью, вынести доменную
> логику (множитель, исход раунда) в PIXI-независимый слой, который **можно покрыть
> тестами**, и закрыть класс багов с утечками введением единого слоя жизненного цикла
> визуалов.
>
> **Принцип миграции:** инкрементально, по одному модулю, без «большого взрыва».
> После каждого шага игра запускается и `npm run type-check` зелёный.

---

## 0. Что уже вынесено (не трогаем)

`TileWorld`, `LavaSimulation`, `SpineAnimator`, `WorldMap`, `ObjectSpawner`,
`GameConfig`, `gameAudio`, `gameStore`, `GameEngine`. Это хорошо. Проблема —
только то, что осталось внутри `GameRenderer`.

---

## 1. Целевая структура файлов

```
src/game/
  GameRenderer.ts            ← остаётся, но «тонкий»: только оркестрация + _tick
  render/
    SceneGraph.ts            ← PIXI-слои, маски, resize
    CameraController.ts      ← camX/camY, follow, parallax, диагностика
    SkyDecorSystem.ts        ← облака, лес, parallax неба
    TunnelRenderer.ts        ← туннель + arc-length хелперы
    LiveWinBadge.ts          ← canvas-бейдж выигрыша
    HeroCharacter.ts         ← встроенный класс «майнера» (сейчас строки ~400–630)
    fx/
      VisualPool.ts          ← ★ единый lifecycle: create + dispose всех визуалов
      FxSystem.ts            ← партиклы / float-тексты / collect-анимации
    debug/
      DebugOverlays.ts       ← scene-stats, chunk-debug, quality-report (dev-only)
  sim/
    RoundSimulation.ts       ← ★ ДОМЕН без PIXI: множитель, rgsQueue, исход (ТЕСТЫ)
    LavaDeathCinematic.ts    ← машина состояний death-сцены
```

★ = критичные модули, дающие максимум profit (тесты + закрытие багов).

---

## 2. Карта переезда: метод/поле → модуль

### 2.1 `RoundSimulation.ts` — ДОМЕН, без PIXI ⭐ приоритет 1

**Зачем:** сюда переезжает вся правда о раунде. Класс **не импортирует `pixi.js`** —
значит, тестируется в Node без WebGL. Здесь же чинится баг «выигрыш с клиента».

| Переезжает | Сейчас в GameRenderer |
|---|---|
| `multiplier`, `rgsQueue`, `rgsEvents`, `_waypoints`, `_ended`, `_promotedCount` | поля |
| `_onCollect` (только эффект-логика, без визуала/звука) | :3777 |
| `_applyEffect`, `_applyEventEffectForSimulation`, `_roundMultiplier` | методы |
| `_computeFullRoadOutcome` | метод |
| reconciliation `rgsQueue.findIndex/splice` по событиям | :3889 |
| `_logCollect`, `_logTerminal` | методы (или оставить хук-колбэком) |

**Контракт (примерно):**
```ts
class RoundSimulation {
  constructor(events: RoundEvent[], serverPayoutMultiplier: number) {}
  collect(ref: RgsEventRef): CollectResult   // мутирует множитель, возвращает эффект
  get displayMultiplier(): number            // ← привязан к серверу, не к анимации
  resolveOutcome(): { won: boolean; multiplier: number }
}
```
**Фикс бага №2 здесь:** `displayMultiplier`/итоговый выигрыш считается от
`serverPayoutMultiplier` (из `round.payoutMultiplier`), а анимация только
визуализирует. Матчинг по `type` заменить на матч строго по `rgsEventRef`.

**Тесты (первые, которых в проекте нет):**
- сумма эффектов = `payoutMultiplier` сервера;
- COIN/GOLD/DIAMOND/BOMB/STONE дают корректную op add/sub/mul/div;
- floor множителя не пробивается;
- терминал HOME/LAVA из очереди важнее визуального типа.

---

### 2.2 `VisualPool.ts` — единый lifecycle ⭐ приоритет 2 (закрывает течь)

**Зачем:** сейчас каждый тип объекта руками катает create/dispose, и `collect`-анимация
забыла `destroy()` → утечка (см. `MEMLEAK_FIX.md`). Один владелец жизненного цикла
делает течь структурно невозможной.

| Переезжает | Сейчас |
|---|---|
| `objects: SpawnedObj[]`, `_roadItems`, `_safeObjects` | поля |
| `_spawnExact`, `_spawnDecor`, `_attachMarker`, `_attachValueLabel` | :1123–1185 |
| `_disposeSpawnedVisual`, `safePixiDestroyDisplay` | :987, :353 |
| culling-фильтр `this.objects.filter(...)` | :837 |
| `_particlePool`, `_floatTextPool`, `_collectAnims` | поля |

**Требования:**
1. `acquire()/release(obj)` — единственные точки создания/уничтожения.
2. **`objects` компактится in-place (swap-pop), как партиклы** — убрать
   `this.objects = this.objects.filter(...)` (пер-кадровая реаллокация → GC-фризы).
3. `release()` всегда зовёт `removeChild` + `destroy()` (или возврат в пул).
   Это закрывает баг из `MEMLEAK_FIX.md` централизованно.

---

### 2.3 `FxSystem.ts`

| Переезжает | Сейчас |
|---|---|
| `particles`, `floatTexts`, `_collectAnims`, `_particleTexture` | поля |
| `_burst`, `_floatText`, `_animCollect` | :3214/:3246/:4282 |
| цикл апдейта партиклов/текстов/collect-анимаций | внутри `_pUpdate` :4291 |

Зависит от `VisualPool` (берёт/возвращает спрайты). Здесь же — **исправленная**
ветка завершения collect-анимации (через `pool.release`, а не `visible=false`).

---

### 2.4 `CameraController.ts`

| Переезжает | Сейчас |
|---|---|
| `camX`, `camY`, `_zoom`, `_prevScroll*`, `idleCamY` | поля |
| `_syncLayerScroll`, `_camFollowAlpha`, `_cameraPixelDiagnostics` | методы |
| `_syncSkyBgParallax`, `_syncForestToCamera` | методы (parallax зависит от камеры) |

---

### 2.5 `SkyDecorSystem.ts`

| Переезжает | Сейчас |
|---|---|
| `_skyCloudLayer`, `_cloudT/_cloudCount/_cloudSpawnTimer`, `_forestSprite/_forestMask` | поля |
| `_buildSky`, `_resizeSkyInPlace`, `_updateSkyDecor`, `_spawnCloud`, `_syncSurfaceScenery` | методы |

---

### 2.6 `TunnelRenderer.ts`

| Переезжает | Сейчас |
|---|---|
| `tunnelActive`, `_tunnelPath`, cum-lengths | поля |
| `_buildTunnel`, `_updateTunnel`, `_showTunnel`, `_hideTunnel`, `_rebuildTunnelCumLengths` | методы |
| top-level: `tunnelArcLengthAtWorldY`, `tunnelPathCumulativeLengths`, `pointOnTunnelAtArcLength`, `projectWorldXYToTunnelArcLength` | :211–302 |

---

### 2.7 `SceneGraph.ts`

| Переезжает | Сейчас |
|---|---|
| `worldBgLayer`, `worldChunkLayer`, `objectsLayer`, `skyLayer`, `minerLayer`, `_sceneryLayer` | поля |
| `_worldMask`, `_updateWorldMask` (уже мемоизирован — оставить как есть) | :метод |
| `_applyResize`, `_resizeRaf`, `_pendingResize*` | методы |

---

### 2.8 `LiveWinBadge.ts`

| Переезжает | Сейчас |
|---|---|
| `liveWinBadge`, `liveWinTitleText`, `liveWinAmountText`, `liveWinAmountCached`, fade-поля | поля |
| `_createLiveWinBadge`, `_updateLiveWinBadge`, `formatLiveWinAmount` | :метод/:345 |

---

### 2.9 `LavaDeathCinematic.ts`

| Переезжает | Сейчас |
|---|---|
| `_lavaDeathCinematic`, `_lossRound`, `_lossTerminalDescent`, `_lossLavaCenterX` | поля |
| `_tryStartLavaDeathCinematic`, `_tickLavaDeathCinematic`, `_cleanupLavaDeathCinematic` | методы |
| `_stepLossPitFall`, `_startLavaLossIdleGlideOrIdle`, `_tickLavaLossIdleGlide`, `_scheduleLavaLossResult` | методы |

---

### 2.10 `HeroCharacter.ts`

Встроенный класс «майнера» (строки ~400–630: `_spr/_spine/_setAnim/_setYOffset/
_resetStartCarveLatchPose/_readTrackedBoneWorldY` и т.д.) — **вынести в отдельный
файл целиком**. Сейчас в одном файле живут два класса, это первый и самый дешёвый шаг.

---

### 2.11 `DebugOverlays.ts` (dev-only)

| Переезжает | Сейчас |
|---|---|
| `collectPixiSceneStats`, `collectPixiSubtreeStats`, `collectPixiTopLayerStats` | :52–149 |
| `_renderQualityReport`, `_installRenderQualityDebug`, `_installChunkDebug`, `_updateChunkDebugOverlay` | методы |
| `_debugCountPixiChildren`, `_debugCounters`, `_debugFramePayload` | методы |
| `_perfPushSceneSnapshot` (оставить тонкий вызов в `_tick`, тело — сюда) | :3678 |

Заворачивать в `if (import.meta.env.DEV)` на стороне оркестратора.

---

### 2.12 `GameRenderer.ts` (что остаётся)

Тонкий оркестратор:
- владеет `PIXI.Application`, `app.ticker`, `_boundTick`, canvas;
- в конструкторе создаёт и проводнику передаёт все модули выше;
- `_tick(dt)` — только делегирование: `camera.update()`, `sky.update()`,
  `tunnel.update()`, `fx.update()`, `sim` дергается из `_onCollect`-хука и т.д.;
- `_installPageVisibilityPowerSave`, `_syncTickerPowerSave` — оставить здесь
  (это системный уровень тикера);
- движение персонажа (`charX/charY/_velX/_velY/_speedMult/_applyRepulse`) — либо
  тонкий `MovementController`, либо пока оставить в оркестраторе (низкий приоритет).

**Цель по объёму:** оркестратор ≤ ~400 строк, каждый модуль ≤ ~300–500.

---

## 3. Швы и взаимодействие

- Модули общаются через **явные интерфейсы**, не через залезание в чужие поля.
  Камера отдаёт `getCamera(): {x,y}`; туннель/спавн/fx получают камеру параметром.
- **store трогает только оркестратор** (и `RoundSimulation` через колбэк), а не
  каждый модуль. Сейчас `useGameStore.getState().updateStats` зовётся из глубины
  тика — убрать; пусть `RoundSimulation`/оркестратор шлёт наружу события, а
  подписку на store throttle-ит до ~10–15 Гц (см. п. про 60-Гц ре-рендер).
- `RoundSimulation` **ничего не знает** про PIXI/звук — выдаёт результат, а
  визуал/звук дергает оркестратор по результату.

---

## 4. Порядок миграции (безопасный, по возрастанию риска)

1. **`HeroCharacter.ts`** — вынести второй класс. Чисто механически, риск ~0.
2. **`DebugOverlays.ts`** — dev-only, на прод не влияет.
3. **`TunnelRenderer.ts`** + top-level arc-length функции.
4. **`SkyDecorSystem.ts`**, **`CameraController.ts`**, **`SceneGraph.ts`**, **`LiveWinBadge.ts`** — независимые view-куски.
5. **`VisualPool.ts` + `FxSystem.ts`** — здесь же чиним течь централизованно.
6. **`LavaDeathCinematic.ts`**.
7. **`RoundSimulation.ts`** — последним и аккуратно: сюда переезжает логика денег,
   тут же пишем первые юнит-тесты и чиним привязку к `payoutMultiplier`.

---

## 5. Критерии приёмки

- [ ] `GameRenderer.ts` ≤ ~400 строк; ни один модуль > ~500.
- [ ] `RoundSimulation.ts` **не импортирует** `pixi.js` (проверяется грепом).
- [ ] Есть юнит-тесты на `RoundSimulation`: множитель = серверный `payoutMultiplier`.
- [ ] Создание/уничтожение визуалов идёт **только** через `VisualPool`
      (греп: нет `.destroy()` и `new PIXI.*` визуалов вне пула).
- [ ] `this.objects` компактится in-place, без `= this.objects.filter(...)` в горячем пути.
- [ ] Запись в store из тика — throttle, не каждый кадр.
- [ ] `npm run type-check` зелёный после каждого шага; визуально игра идентична.

---

## 6. Что это даёт

| Сейчас | После |
|---|---|
| 1 файл, 3378 строк, 2 класса | ~12 модулей по одной ответственности |
| Деньги считаются в недрах рендера | Доменный слой с тестами, привязка к серверу |
| Течь визуалов структурно возможна | Единый lifecycle, течь невозможна by design |
| Пер-кадровые `filter` → GC-фризы | In-place компакция как у партиклов |
| Тесты невозможны (нужен WebGL) | Домен тестируется в Node |
| Двое не могут работать в файле | Параллельная работа по модулям |
