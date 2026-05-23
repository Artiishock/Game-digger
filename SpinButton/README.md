# SpinButton — портируемый компонент

Полностью самодостаточный компонент кнопки Spin.  
**Один файл, нулевые зависимости кроме React.**  
Все ассеты (PNG-фоны, SVG-иконки, CSS) встроены inline.

---

## Установка

Скопируй **один файл** `SpinButton.tsx` в свой проект.

Требования:
- React ≥ 17
- TypeScript (или убери типы — компонент несложный)

---

## Использование

```tsx
import { SpinButton } from "./SpinButton";

// Неуправляемый режим — кнопка сама переключается
<SpinButton />

// С колбэком
<SpinButton onSpin={(isPushed) => console.log("pushed:", isPushed)} />

// Управляемый режим — state снаружи
const [pushed, setPushed] = useState(false);
<SpinButton pushed={pushed} onSpin={(next) => setPushed(next)} />
```

---

## Props

| Prop | Тип | По умолчанию | Описание |
|------|-----|--------------|----------|
| `pushed` | `boolean` | — | Если передан — управляемый режим |
| `onSpin` | `(next: boolean) => void` | — | Колбэк при нажатии |
| `className` | `string` | `""` | Дополнительный CSS-класс на обёртку |
| `style` | `CSSProperties` | — | Inline-стили на обёртку |

---

## Визуальные состояния

| Состояние | Фон | Иконка | Анимация |
|-----------|-----|--------|----------|
| **Idle** | `spin_bg.png` (встроен) | Play (белый магнит) | Hover: +360° за 0.55s, уход: −360° за 0.45s |
| **Pushed** | `spin_bg2.png` (встроен) | Stop (красный квадрат) | Play улетает (скукоживается + оборот), Stop влетает (вырастает + оборот) |
| **:active** | — | — | opacity 0.82 |

Анимации реализованы на SMIL (встроены в SVG), без JS-лупов и CSS keyframes.

---

## Размер

Кнопка адаптивная:
```
width / height = clamp(80px, 17.59vmin, 240px)
иконка         = clamp(67px, 14.72vmin, 200px)
```
