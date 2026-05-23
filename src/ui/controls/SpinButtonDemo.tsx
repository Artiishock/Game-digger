/**
 * SpinButtonDemo — изолированная демонстрация кнопки Spin.
 * Без игрового движка, без store. Только визуал: hover + click.
 *
 * Состояния кнопки:
 *   idle   → spin_icon.svg  + spin_bg.png   (SMIL hover внутри SVG)
 *   pushed → spin_icon_push.svg + spin_bg2.png (SMIL play→stop при монтировании)
 */

import React, { useEffect, useRef, useState } from "react";
import { resolvePublicUrl } from "../../utils/publicUrl";
import "./SpinButtonDemo.css";

// ── SVG-кэш ────────────────────────────────────────────────────────────────

const svgCache = new Map<string, string>();

const loadSvg = async (url: string): Promise<string | null> => {
  const cached = svgCache.get(url);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    svgCache.set(url, text);
    return text;
  } catch {
    return null;
  }
};

// ── Компонент ──────────────────────────────────────────────────────────────

export const SpinButtonDemo: React.FC = () => {
  /** true = кнопка «нажата» (показывает Stop + фон spin_bg2) */
  const [pushed, setPushed] = useState(false);

  const iconRef = useRef<HTMLSpanElement>(null);
  const [iconMarkup, setIconMarkup] = useState("");

  // URL иконки зависит от состояния
  const iconUrl = pushed
    ? resolvePublicUrl("ui/spin_icon_push.svg")
    : resolvePublicUrl("ui/spin_icon.svg");

  // ── Загрузка SVG-разметки ─────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    loadSvg(iconUrl).then((markup) => {
      if (!cancelled && markup != null) setIconMarkup(markup);
    });
    return () => { cancelled = true; };
  }, [iconUrl]);

  // ── Запуск SMIL-анимаций при переходе в pushed ────────────────────────
  //
  // spin_icon_push.svg содержит play→stop SMIL-анимации с begin="clickArea.click".
  // Поскольку click уже случился в React, мы запускаем их вручную через beginElementAt().

  useEffect(() => {
    if (!iconMarkup || !iconRef.current || !pushed) return;

    const span = iconRef.current;

    // Убеждаемся что это именно push-иконка (содержит #clickArea)
    if (!span.querySelector("#clickArea")) return;

    // Переинжектируем HTML чтобы сбросить замороженные SMIL-таймлайны
    span.innerHTML = iconMarkup;

    // rAF: даём WebKit один кадр на инициализацию новых SMIL-деревьев
    const raf = requestAnimationFrame(() => {
      const animations = span.querySelectorAll<SVGAnimationElement>(
        "animate, animateTransform, set"
      );
      animations.forEach((el) => {
        if (typeof el.beginElementAt !== "function") return;
        // Сохраняем задержки вида begin="clickArea.click+0.06s"
        const beginAttr = el.getAttribute("begin") ?? "";
        const offset = parseFloat(
          beginAttr.match(/\+(\d+(?:\.\d+)?)s/)?.[1] ?? "0"
        );
        el.beginElementAt(offset);
      });
    });

    return () => cancelAnimationFrame(raf);
  }, [iconMarkup, pushed]);

  // ── Touch: preventDefault глушит синтетический click ─────────────────

  const ignoreNextClick = useRef(false);
  const clearIgnoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchEnd = (e: React.TouchEvent<HTMLButtonElement>) => {
    if (e.cancelable) e.preventDefault();
    e.currentTarget.blur();
    ignoreNextClick.current = true;
    if (clearIgnoreTimer.current) clearTimeout(clearIgnoreTimer.current);
    clearIgnoreTimer.current = setTimeout(() => {
      clearIgnoreTimer.current = null;
      ignoreNextClick.current = false;
    }, 140);
    toggle();
  };

  const handleClick = () => {
    if (ignoreNextClick.current) {
      ignoreNextClick.current = false;
      return;
    }
    toggle();
  };

  useEffect(() => () => {
    if (clearIgnoreTimer.current) clearTimeout(clearIgnoreTimer.current);
  }, []);

  // ── Логика переключения ───────────────────────────────────────────────

  const toggle = () => setPushed((prev) => !prev);

  // ── Рендер ────────────────────────────────────────────────────────────

  return (
    <div className="spin-demo">
      <button
        className={`spin-demo__btn${pushed ? " spin-demo__btn--active" : ""}`}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
        type="button"
        aria-pressed={pushed}
      >
        <span
          ref={iconRef}
          className="spin-demo__icon"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: iconMarkup }}
        />
      </button>

      <p className="spin-demo__label">
        {pushed ? "нажата (Stop)" : "idle (Play)"}
      </p>
    </div>
  );
};
