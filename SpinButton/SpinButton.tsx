/**
 * SpinButton — полностью самодостаточный компонент.
 * Никаких внешних зависимостей, кроме React.
 *
 * ИСПОЛЬЗОВАНИЕ:
 *   import { SpinButton } from "./SpinButton/SpinButton";
 *   <SpinButton />                          // только кнопка
 *   <SpinButton onSpin={() => ...} />       // колбэк на нажатие
 *   <SpinButton pushed onSpin={() => ...} /> // управляемый режим (pushed снаружи)
 */

import React, { useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Фоновые PNG как base64 data URI (не нужны никакие файлы)
// ─────────────────────────────────────────────────────────────────────────────

const BG_IDLE =
  "data:image/png;base64,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";

const BG_PUSHED =
  "data:image/png;base64,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";

// ─────────────────────────────────────────────────────────────────────────────
// SVG-иконки как строки (встроены, никаких fetch не нужно)
// ─────────────────────────────────────────────────────────────────────────────

/** Idle: play-иконка со SMIL hover-анимацией (mouseover/mouseout → вращение) */
const SVG_IDLE = `<svg id="playHoverOneTurnStable" width="159" height="159" viewBox="0 0 159 159" fill="none" xmlns="http://www.w3.org/2000/svg">
  <title>Play icon stable one-turn hover animation</title>
  <g id="playIcon" pointer-events="none" transform="rotate(0 79.5 79.5)">
    <animateTransform
      id="rotateIn"
      attributeName="transform"
      type="rotate"
      begin="hitArea.mouseover"
      dur="0.55s"
      calcMode="spline"
      keySplines="0.5 0 0.8 0.2;0.2 0.85 0.2 1;0.25 0 0.2 1"
      values="0 79.5 79.5; -8 79.5 79.5; 365 79.5 79.5; 360 79.5 79.5"
      fill="freeze"
      restart="whenNotActive"
      keyTimes="0;0.12;0.9;1" />
    <animateTransform
      id="rotateOut"
      attributeName="transform"
      type="rotate"
      begin="hitArea.mouseout"
      dur="0.45s"
      calcMode="spline"
      keySplines="0.5 0 0.8 0.2;0.2 0.85 0.2 1;0.25 0 0.2 1"
      values="360 79.5 79.5; 368 79.5 79.5; -5 79.5 79.5; 0 79.5 79.5"
      fill="freeze"
      restart="whenNotActive"
      keyTimes="0;0.12;0.88;1" />
    <path fill-rule="evenodd" clip-rule="evenodd" d="M97.9272 107.369C102.263 108.127 106.967 108.747 112.032 109.222L101.861 129.544C96.791 129.388 91.9191 129.213 87.162 128.867L97.9272 107.369ZM29.5694 56.6737C36.2341 44.2489 44.0725 36.2385 58.421 32.2108C69.8327 29.0074 83.6686 30.7113 94.323 36.4907C97.3913 38.1551 100.232 39.9372 102.899 41.827L90.591 66.0945C78.2568 60.2491 68.8426 62.7133 63.3869 73.6076C56.5475 87.2666 64.0439 97.9722 84.4641 104.222L72.9924 127.131C66.0856 125.859 59.2468 123.86 52.1982 120.615C41.1884 115.546 31.5367 105.488 27.2655 94.4314C21.8949 80.5291 23.6129 69.4536 29.5694 56.6737Z" fill="#F2FDFF"/>
    <path d="M141.065 75.4797L96.8318 78.9099L118.148 37.4908L141.065 75.4797Z" fill="#F2FDFF"/>
  </g>
  <rect id="hitArea" width="159" height="159" fill="#FFFFFF" opacity="0" pointer-events="all"/>
</svg>`;

/** Pushed: play→stop анимация, запускается вручную через beginElementAt */
const SVG_PUSHED = `<svg id="playToStopOnce" width="159" height="159" viewBox="0 0 159 159" fill="none" xmlns="http://www.w3.org/2000/svg">
  <title>Play to Stop one-shot animation</title>
  <rect id="clickArea" x="0" y="0" width="159" height="159" fill="transparent" pointer-events="all">
    <set attributeName="pointer-events" begin="clickArea.click" to="none" fill="freeze" />
  </rect>
  <g id="stopIcon" opacity="0" pointer-events="none">
    <animate
      attributeName="opacity"
      begin="clickArea.click+0.06s"
      dur="0.21s"
      values="0;0;1"
      keyTimes="0;0.22;1"
      calcMode="spline"
      keySplines="0 0 1 1;0.2 0.8 0.2 1"
      fill="freeze" />
    <g transform="translate(79.5 79.5)">
      <animateTransform
        attributeName="transform"
        type="rotate"
        begin="clickArea.click"
        dur="0.40s"
        values="-82;4;0"
        keyTimes="0;0.72;1"
        calcMode="spline"
        keySplines="0.16 0.78 0.22 1;0.25 0 0.18 1"
        additive="sum"
        fill="freeze" />
      <g>
        <animateTransform
          attributeName="transform"
          type="scale"
          begin="clickArea.click+0.03s"
          dur="0.23s"
          values="0.28;1.015;1"
          keyTimes="0;0.74;1"
          calcMode="spline"
          keySplines="0.18 0.86 0.2 1;0.22 0 0.2 1"
          fill="freeze" />
        <g transform="translate(-59 -59)">
          <rect x="7.5" y="7.5" width="103" height="103" rx="17.5" fill="black" fill-opacity="0.35" stroke="#FF3F42" stroke-width="15" />
        </g>
      </g>
    </g>
  </g>
  <g id="playIcon" opacity="1" pointer-events="none">
    <animate
      attributeName="opacity"
      begin="clickArea.click"
      dur="0.23s"
      values="1;1;0"
      keyTimes="0;0.22;1"
      calcMode="spline"
      keySplines="0 0 1 1;0.24 0.78 0.18 1"
      fill="freeze" />
    <g transform="translate(79.5 79.5)">
      <animateTransform
        attributeName="transform"
        type="rotate"
        begin="clickArea.click"
        dur="0.40s"
        values="0;-17;360"
        keyTimes="0;0.11;1"
        calcMode="spline"
        keySplines="0.55 0 0.85 0.22;0.16 0.86 0.18 1"
        additive="sum"
        fill="freeze" />
      <g>
        <animateTransform
          attributeName="transform"
          type="scale"
          begin="clickArea.click"
          dur="0.21s"
          values="1;0.32"
          keyTimes="0;1"
          calcMode="spline"
          keySplines="0.22 0.9 0.18 1"
          fill="freeze" />
        <g transform="translate(-79.5 -79.5)">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M97.9272 107.369C102.263 108.127 106.967 108.747 112.032 109.222L101.861 129.544C96.791 129.388 91.9191 129.213 87.162 128.867L97.9272 107.369ZM29.5694 56.6737C36.2341 44.2489 44.0725 36.2385 58.421 32.2108C69.8327 29.0074 83.6686 30.7113 94.323 36.4907C97.3913 38.1551 100.232 39.9372 102.899 41.827L90.591 66.0945C78.2568 60.2491 68.8426 62.7133 63.3869 73.6076C56.5475 87.2666 64.0439 97.9722 84.4641 104.222L72.9924 127.131C66.0856 125.859 59.2468 123.86 52.1982 120.615C41.1884 115.546 31.5367 105.488 27.2655 94.4314C21.8949 80.5291 23.6129 69.4536 29.5694 56.6737Z" fill="#F2FDFF" />
          <path d="M141.065 75.4797L96.8318 78.9099L118.148 37.4908L141.065 75.4797Z" fill="#F2FDFF" />
        </g>
      </g>
    </g>
  </g>
</svg>`;

// ─────────────────────────────────────────────────────────────────────────────
// CSS как строка — инжектируется один раз в <head>
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
.spin-btn-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.spin-btn {
  width:  clamp(80px, 17.59vmin, 240px);
  height: clamp(80px, 17.59vmin, 240px);
  background-color: transparent;
  background-image: var(--spin-bg-idle);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  border: none;
  outline: none;
  box-shadow: none;
  padding: 0;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
  transition: opacity 0.15s;
}

.spin-btn--pushed {
  background-image: var(--spin-bg-pushed);
}

.spin-btn:active {
  opacity: 0.82;
}

.spin-btn__icon {
  width:  clamp(67px, 14.72vmin, 200px);
  height: clamp(67px, 14.72vmin, 200px);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  pointer-events: none;
}

.spin-btn__icon > svg {
  width: 95%;
  height: 95%;
  display: block;
  pointer-events: all;
}
`;

let cssInjected = false;
const injectCss = (bgIdle: string, bgPushed: string) => {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement("style");
  style.textContent =
    CSS +
    `:root{--spin-bg-idle:url("${bgIdle}");--spin-bg-pushed:url("${bgPushed}");}`;
  document.head.appendChild(style);
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface SpinButtonProps {
  /**
   * Управляемое состояние (нажата/не нажата).
   * Если не передан — кнопка сама управляет состоянием (uncontrolled).
   */
  pushed?: boolean;
  /** Вызывается при каждом нажатии */
  onSpin?: (nextPushed: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
}

// ─────────────────────────────────────────────────────────────────────────────
// Компонент
// ─────────────────────────────────────────────────────────────────────────────

export const SpinButton: React.FC<SpinButtonProps> = ({
  pushed: pushedProp,
  onSpin,
  className = "",
  style,
}) => {
  // Inject CSS + CSS vars once
  useEffect(() => { injectCss(BG_IDLE, BG_PUSHED); }, []);

  // Uncontrolled внутреннее состояние
  const [pushedInner, setPushedInner] = useState(false);
  const pushed = pushedProp !== undefined ? pushedProp : pushedInner;

  const iconRef = useRef<HTMLSpanElement>(null);

  // ── Выбор SVG-разметки ──────────────────────────────────────────────────
  const markup = pushed ? SVG_PUSHED : SVG_IDLE;

  // ── Запуск SMIL при переходе в pushed ───────────────────────────────────
  useEffect(() => {
    if (!pushed || !iconRef.current) return;
    const span = iconRef.current;
    if (!span.querySelector("#clickArea")) return;

    // Переинжект сбрасывает frozen fill="freeze" состояния
    span.innerHTML = markup;

    const raf = requestAnimationFrame(() => {
      const animations = span.querySelectorAll<SVGAnimationElement>(
        "animate, animateTransform, set"
      );
      animations.forEach((el) => {
        if (typeof el.beginElementAt !== "function") return;
        const beginAttr = el.getAttribute("begin") ?? "";
        const offset = parseFloat(
          beginAttr.match(/\+(\d+(?:\.\d+)?)s/)?.[1] ?? "0"
        );
        el.beginElementAt(offset);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [markup, pushed]);

  // ── Touch / Click защита от дублирования ─────────────────────────────────
  const ignoreNextClick = useRef(false);
  const clearIgnoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (clearIgnoreTimer.current) clearTimeout(clearIgnoreTimer.current);
  }, []);

  const fire = () => {
    const next = !pushed;
    if (pushedProp === undefined) setPushedInner(next);
    onSpin?.(next);
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLButtonElement>) => {
    if (e.cancelable) e.preventDefault();
    e.currentTarget.blur();
    ignoreNextClick.current = true;
    if (clearIgnoreTimer.current) clearTimeout(clearIgnoreTimer.current);
    clearIgnoreTimer.current = setTimeout(() => {
      clearIgnoreTimer.current = null;
      ignoreNextClick.current = false;
    }, 140);
    fire();
  };

  const handleClick = () => {
    if (ignoreNextClick.current) {
      ignoreNextClick.current = false;
      return;
    }
    fire();
  };

  // ── Рендер ────────────────────────────────────────────────────────────────
  return (
    <div className={`spin-btn-wrap ${className}`} style={style}>
      <button
        className={`spin-btn${pushed ? " spin-btn--pushed" : ""}`}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
        type="button"
        aria-pressed={pushed}
      >
        <span
          ref={iconRef}
          className="spin-btn__icon"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      </button>
    </div>
  );
};

export default SpinButton;
