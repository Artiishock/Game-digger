# ⛏ Deep Rush

> CRUSH-механика казуальная казино игра. React + PixiJS. Интеграция Stake Engine.

## Стэк

| Технология | Версия | Роль |
|-----------|--------|------|
| React     | 18     | UI и компоненты |
| PixiJS    | 7      | Игровой рендеринг (WebGL/Canvas) |
| Zustand   | 4      | Глобальный state |
| Vite      | 5      | Сборка (base: "./") |
| TypeScript| 5      | Типизация |

## Структура проекта

```
src/
├── rgs/
│   ├── client.ts       # Stake Engine RGS API (authenticate/play/end-round)
│   └── demo.ts         # FUN/demo симулятор — работает без rgs_url
├── store/
│   └── gameStore.ts    # Zustand store (фаза, баланс, ставка, autoplay, настройки)
├── game/
│   ├── GameEngine.ts   # Оркестратор раундов, autoplay, обработка ошибок RGS
│   ├── GameRenderer.ts # PixiJS рендерер (мир, объекты, персонаж, частицы)
│   └── GameCanvas.tsx  # React обёртка над GameRenderer
├── ui/
│   ├── hud/Hud.tsx                    # Глубина / расстояние / множитель / финансы
│   ├── controls/
│   │   ├── BetControls.tsx            # Кнопки изменения ставки
│   │   ├── DigButton.tsx              # Кнопка DIG (перетаскиваемая) + A автоспин
│   │   └── TopBar.tsx                 # Звук + бургер
│   ├── modals/
│   │   ├── ResultOverlay.tsx          # WIN / LOSE экран
│   │   ├── AutoplayModal.tsx          # Настройка автоспина
│   │   └── ErrorScreen.tsx            # RGS ошибки
│   └── menus/
│       ├── BurgerMenu.tsx             # Бургер-меню (3 вкладки)
│       ├── SettingsPanel.tsx          # Качество / громкость / кнопка DIG
│       └── InfoAndReplay.tsx          # Правила игры + история ставок
├── hooks/
│   └── useWindowSize.ts
├── App.tsx
└── main.tsx
```

## Быстрый старт

```bash
npm install
npm run dev
```

## Игровые объекты

| Объект    | Эффект |
|-----------|--------|
| 🪙 Coin   | +N к ставке |
| ⛏ Gold   | ×3/сек пока разрушается |
| 💎 Diamond| Мгновенный ×X multiplier |
| 💣 Bomb   | Делит выигрыш ÷2 |
| 🪨 Stone  | -5%/сек пока разрушается |
| 🌋 Lava   | Поражение, ставка сгорает |
| 🛏 Home   | Победа, выигрыш сохраняется |

## Деплой на Stake Engine

См. **[DEPLOY.md](./DEPLOY.md)**

## Переменные окружения

Не требуются — все параметры приходят через URL query string от Stake Engine:
- `?sessionID=` — ID сессии игрока
- `?rgs_url=`   — URL RGS бэкенда
- `?lang=`      — язык (ISO 639-1)
- `?device=`    — mobile / desktop
