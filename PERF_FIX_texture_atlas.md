# Перф-фикс: texture atlas (батчинг draw-call'ов)

> **Профит:** геймплейный FPS **27 → ~60**. Самый высокоприоритетный перф-фикс —
> игрок видит просадку каждую секунду каждого раунда.

---

## 1. Проблема (замерено)

`metrics.json`, десктоп Mac, dev-сборка:

| Метрика | Idle | Геймплей | Норма для 2D |
|---|---|---|---|
| FPS | 60 | **25–30** | 60 |
| draws/кадр | ~35 | **130–160** | < 20 |
| texBinds/кадр | ~63 | **280–336** | единицы |
| **binds/draws** | 1.8 | **~2.2** | ~1 |

CPU при этом простаивает на 92% (см. `PERF_TRACE_REPORT.md`). Упор — **в GPU-стейт**,
а не в логику.

---

## 2. Корень: каждый спрайт — отдельная `BaseTexture` → разрыв батча

PixiJS батчит спрайты в один draw call, только если они делят одну `BaseTexture`.
Сейчас 24 PNG грузятся **каждый в свою текстуру** и кладутся в `Map<string, Texture>`:

- **Карта ассетов:** [`gameAssets.ts:11–34`](src/game/gameAssets.ts#L11) — 24 пути `./assets/*.png`.
- **Загрузка по одному файлу:** [`GameRenderer._loadTextures` :2751–2802](src/game/GameRenderer.ts#L2751) —
  цикл `Assets.load(url)` → `this._textures.set(key, tex)`. **18 отдельных `BaseTexture`.**
- **Создание спрайтов из них:**
  - предметы (COIN/GOLD/DIAMOND/BOMB/STONE): [`_drawPickup` :2822–2834](src/game/GameRenderer.ts#L2822)
  - дом: [`_drawHome` :2804–2811](src/game/GameRenderer.ts#L2804)
  - облака/деревья/rock/forest/bg: [:1922](src/game/GameRenderer.ts#L1922), [:1975](src/game/GameRenderer.ts#L1975), [:1991](src/game/GameRenderer.ts#L1991), [:2071](src/game/GameRenderer.ts#L2071), [:2148](src/game/GameRenderer.ts#L2148), [:2807](src/game/GameRenderer.ts#L2807), [:2831](src/game/GameRenderer.ts#L2831)

Когда на экране одновременно монета, золото, камень, бомба, облака и деревья — это
6+ разных текстур, переплетённых по z-order. Pixi не может их сбатчить → разрыв на
каждой смене текстуры → 130+ draw call и 300+ binds. `binds/draws ≈ 2.2` — прямая
подпись texture thrashing.

---

## 3. Что атласить, а что НЕТ

### ✅ В атлас (мелкие дискретные спрайты — главный профит)
`coin, gold, gem, bomb, stone, home, rock, cloud1–6, tree1–3` — все из
[`gameAssets.ts:13–33`](src/game/gameAssets.ts#L13), кроме крупных ниже.

### ❌ НЕ атласить (оставить отдельными текстурами)
- **`bg` (4K), `forest`, `lavaTex`** — большие, рисуются `TilingSprite`'ом
  ([:1893](src/game/GameRenderer.ts#L1893), [:2022](src/game/GameRenderer.ts#L2022)),
  и так по 1 draw call каждый; в атлас не влезут и не нужны.
- **`grass`, `earth1–3`** ([`Tileworld.ts:608–612`](src/game/Tileworld.ts#L608)) —
  уже запекаются в `RenderTexture` на чанк ([`_bakeToRenderTexture` :595](src/game/Tileworld.ts#L595)),
  на per-frame draws почти не влияют. Можно оставить как есть.
- **Spine** (`DeepRush_Items`, hero) — уже атлас, своя система, отдельные draw call'ы.

> После атласа дискретных спрайтов «вертикаль» z-order перестанет рваться на предметах
> и декоре — это и есть основной выигрыш.

---

## 4. Реализация (минимальные изменения)

### Шаг 1. Собрать атлас

Вариант с `@assetpack/core` (CLI, без GUI). Положить исходники в
`raw-assets/game/{coin,gold,...}.png`, на выходе — `public/assets/game_atlas.{json,webp}`.

```bash
npm i -D @assetpack/core
```
`.assetpack.js`:
```js
import { pixiPipes } from '@assetpack/core/pixi'
export default {
  entry: './raw-assets', output: './public/assets',
  pipes: pixiPipes({ texturePacker: { texturePacker: { removeFileExtension: true } } }),
}
```
> Совмести с фиксом тяжёлых ассетов: на выходе сразу **WebP** (см. отдельную задачу
> по весу 35 МБ). TexturePacker GUI — альтернатива, формат экспорта «PixiJS».

Кадры в атласе называются по ключу: `coin`, `gold`, `gem`, `bomb`, `stone`, `home`,
`rock`, `cloud1`…`tree3`.

### Шаг 2. Загрузить спрайтшит один раз

В [`gameAssets.ts`](src/game/gameAssets.ts) добавить путь и предзагрузку в
`preloadStartupAssets` ([:~90](src/game/gameAssets.ts#L90)):
```ts
export const GAME_ATLAS = './assets/game_atlas.json'
// внутри preloadStartupAssets, рядом с остальными Assets.load:
await Assets.load(GAME_ATLAS)   // вернёт PIXI.Spritesheet, кэшируется
```

### Шаг 3. Тянуть кадры из атласа вместо пофайловой загрузки

Заменить цикл в [`_loadTextures` :2754–2785](src/game/GameRenderer.ts#L2754):
```ts
const sheet = await Assets.load<PIXI.Spritesheet>(GAME_ATLAS)
const fromAtlas = ['coin','gold','gem','bomb','stone','home','rock',
  'cloud1','cloud2','cloud3','cloud4','cloud5','cloud6','tree1','tree2','tree3']
for (const key of fromAtlas) {
  const tex = sheet.textures[key]
  if (tex) this._textures.set(key === 'gem' ? 'diamond' : key, tex)
}
// bg / forest / lava — грузим по-старому, отдельными Assets.load (НЕ в атлас)
```
> ⚠️ Сохранить текущие ключи Map: `gem` → кладётся под `'diamond'`
> (см. typeMap в [`_drawPickup` :2823](src/game/GameRenderer.ts#L2823)), `bomb` → `'bomba'`,
> `stone` → `'stoun'`. Иначе `_drawPickup`/`_drawHome` не найдут текстуру.

### Шаг 4. Код создания спрайтов НЕ трогать

`_drawPickup`/`_drawHome`/облака читают `this._textures.get(key)`. Раз ключи Map те же,
а кадры теперь из общей `BaseTexture` атласа — `new PIXI.Sprite(...)` остаётся как есть,
но Pixi начнёт их батчить автоматически.

---

## 5. Вторичные выигрыши (после основного)

- **`PIXI.Text` всплывашки множителя** ([`_floatText` :3214/:4246](src/game/GameRenderer.ts#L3214)) —
  каждый `Text` создаёт свою текстуру → разрыв батча. Уже есть `_floatTextPool`
  ([:1385](src/game/GameRenderer.ts#L1385)) — убедиться, что переиспользуются, а не
  плодятся. Альтернатива — BitmapText из атласного шрифта.
- **Маски/RT чанков** ([`Tileworld` :992](src/game/Tileworld.ts#L992)) — каждый чанк со
  своей `RenderTexture`/маской = свой bind. Это отдельная тема (атласом не лечится),
  трогать только если после шага 4 draws всё ещё высоки.

---

## 6. Проверка

1. Перезапустить игру, прогнать сниппет метрик из обсуждения (хук WebGL → `metrics.json`).
2. Поиграть раунд, скачать `__stopMetrics()`.
3. **Ожидаемо:** `drawsPerFrame` 130 → **< 25**, `texBindsPerFrame` 300 → **единицы-десятки**,
   `fps` 27 → **~60**.
4. Снять Spector.js-капчу одного кадра — предметы и декор должны идти **одним батчем**.

---

## 7. Критерии приёмки

- [ ] `game_atlas.{json,webp}` собирается из исходников (не руками).
- [ ] `_loadTextures` тянет мелкие спрайты из атласа; `bg/forest/lava` — по-прежнему отдельно.
- [ ] Ключи `this._textures` Map не изменились (`diamond/bomba/stoun`).
- [ ] `drawsPerFrame` в геймплее < 25; `fps` ≥ 55 на десктопе.
- [ ] Визуально идентично (предметы/облака/деревья на местах).

---

## 8. Сводка ссылок

| Что | Файл:строка |
|---|---|
| Карта 24 PNG | [gameAssets.ts:11–34](src/game/gameAssets.ts#L11) |
| Предзагрузка | [gameAssets.ts preloadStartupAssets](src/game/gameAssets.ts#L90) |
| Пофайловая загрузка текстур (заменить) | [GameRenderer.ts:2751–2802](src/game/GameRenderer.ts#L2751) |
| Спрайты предметов | [GameRenderer.ts:2822](src/game/GameRenderer.ts#L2822) |
| Спрайт дома | [GameRenderer.ts:2804](src/game/GameRenderer.ts#L2804) |
| Облака/деревья/rock | [GameRenderer.ts:2807](src/game/GameRenderer.ts#L2807), [:2831](src/game/GameRenderer.ts#L2831), [:1991](src/game/GameRenderer.ts#L1991) |
| bg/forest TilingSprite (НЕ атлас) | [GameRenderer.ts:1893](src/game/GameRenderer.ts#L1893), [:2022](src/game/GameRenderer.ts#L2022) |
| Земля/чанки (уже RenderTexture) | [Tileworld.ts:595](src/game/Tileworld.ts#L595), [:608](src/game/Tileworld.ts#L608) |
| Text-всплывашки (вторично) | [GameRenderer.ts:3214](src/game/GameRenderer.ts#L3214) |
