import React, { useEffect, useRef, useState } from "react";
import { useGameStore } from "../../store/gameStore";
import { gameEngine } from "../../game/GameEngine";
import { gameAudio } from "../../audio/GameAudio";
import { resolvePublicUrl } from "../../utils/publicUrl";
import { isReplayMode } from "../../rgs/client";
import { T } from "../../i18n/t";
import { useVolatilityControl } from "../volatilityControl";
import "../ui.css";

/** У inline SVG убираем &lt;title&gt; — иначе браузер показывает служебную подсказку из файла. */
function sanitizeSpinSvgMarkup(markup: string): string {
  return markup.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "");
}

const svgCache = new Map<string, string>();
/** URL, которые уже не загрузились — не повторять fetch при каждом BETTING/RUNNING. */
const svgFetchMiss = new Set<string>();

const loadSvg = async (url: string): Promise<string | null> => {
  if (svgFetchMiss.has(url)) return null;
  const cached = svgCache.get(url);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      svgFetchMiss.add(url);
      return null;
    }
    const text = sanitizeSpinSvgMarkup(await res.text());
    svgCache.set(url, text);
    return text;
  } catch {
    svgFetchMiss.add(url);
    return null;
  }
};

export const DigButton: React.FC = () => {
  const phase = useGameStore((s) => s.phase);
  const autoplay = useGameStore((s) => s.autoplay);
  const setAP = useGameStore((s) => s.setAutoplayOpen);
  const isAPOpen = useGameStore((s) => s.autoplayOpen);
  const spaceEnabled = useGameStore((s) => s.settings.spaceEnabled);

  // Волатильность — та же логика, что у sys-seg (клик переключает уровень).
  const {
    label: volatilityLabel,
    disabled: volatilityDisabled,
    cycle: cycleVolatility,
  } = useVolatilityControl();

  /** Touchend + preventDefault глушит synthetic click; если он всё же приходит — один раз пропускаем. */
  const ignoreNextSpinClick = useRef(false);
  const clearIgnoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canDig = phase === "IDLE" || phase === "WIN" || phase === "LOSE";
  const isRunning = phase === "RUNNING" || phase === "BETTING";
  const isRoundPlay = phase === "RUNNING";
  const isAutoActive = autoplay.active;

  const spinPushed = isRunning || isAutoActive;
  const autoPushed = isAutoActive;

  // Обычный спин (без автоспина): кнопка Auto задизейблена
  const autoDisabled = isRunning && !isAutoActive;

  const iconRef = useRef<HTMLSpanElement>(null);
  const [iconMarkup, setIconMarkup] = useState<string>("");
  const iconUrl = spinPushed
    ? resolvePublicUrl("ui/spin_icon_push.svg")
    : resolvePublicUrl("ui/spin_icon.svg");

  const autoIconRef = useRef<HTMLSpanElement>(null);
  const [autoIconMarkup, setAutoIconMarkup] = useState<string>("");
  const autoIconUrl = autoPushed
    ? resolvePublicUrl("ui/autoplay_icon_push.svg")
    : resolvePublicUrl("ui/autoplay_icon.svg");

  useEffect(() => {
    let cancelled = false;
    loadSvg(iconUrl).then((markup) => {
      if (!cancelled && markup != null) setIconMarkup(markup);
    });
    return () => {
      cancelled = true;
    };
  }, [iconUrl]);

  useEffect(() => {
    let cancelled = false;
    loadSvg(autoIconUrl).then((markup) => {
      if (!cancelled && markup != null) setAutoIconMarkup(markup);
    });
    return () => {
      cancelled = true;
    };
  }, [autoIconUrl]);

  // Тот же триггер SMIL-анимации — для иконки автоспина при активации
  useEffect(() => {
    if (!autoIconMarkup || !autoIconRef.current) return;
    if (!autoPushed) return;
    const span = autoIconRef.current;
    if (!span.querySelector("#clickArea")) return;
    span.innerHTML = autoIconMarkup;
    const raf = requestAnimationFrame(() => {
      const animations = span.querySelectorAll<SVGAnimationElement>(
        "animate, animateTransform, set"
      );
      animations.forEach((el) => {
        if (typeof el.beginElementAt !== "function") return;
        const beginAttr = el.getAttribute("begin") ?? "";
        const offset = parseFloat(beginAttr.match(/\+(\d+(?:\.\d+)?)s/)?.[1] ?? "0");
        el.beginElementAt(offset);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [autoIconMarkup, autoPushed]);

  useEffect(() => {
    if (!iconMarkup || !iconRef.current) return;
    if (!spinPushed) return;
    const span = iconRef.current;
    if (!span.querySelector("#clickArea")) return;
    // Re-inject to reset frozen SMIL fill="freeze" state
    span.innerHTML = iconMarkup;
    // rAF: give WebKit one paint frame to initialize new SMIL timelines
    const raf = requestAnimationFrame(() => {
      const animations = span.querySelectorAll<SVGAnimationElement>(
        "animate, animateTransform, set"
      );
      animations.forEach((el) => {
        if (typeof el.beginElementAt !== "function") return;
        const beginAttr = el.getAttribute("begin") ?? "";
        const offset = parseFloat(beginAttr.match(/\+(\d+(?:\.\d+)?)s/)?.[1] ?? "0");
        el.beginElementAt(offset);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [iconMarkup, spinPushed]);

  const runSpinAction = async () => {
    gameAudio.unlock();

    const phaseNow = useGameStore.getState().phase;
    if (phaseNow === "BETTING") return;

    if (isRoundPlay) {
      await gameEngine.instantFinishRound();
      return;
    }
    // Во время автоспина между раундами (IDLE/WIN/LOSE) — не перебиваем автоспин вручным стартом
    if (canDig && !isAutoActive) {
      gameAudio.playStartGame();
      await gameEngine.startRound();
    }
  };

  const handleSpinTouchEnd = (e: React.TouchEvent<HTMLButtonElement>) => {
    if (e.cancelable) e.preventDefault();
    e.currentTarget.blur();
    ignoreNextSpinClick.current = true;
    if (clearIgnoreTimer.current) clearTimeout(clearIgnoreTimer.current);
    clearIgnoreTimer.current = setTimeout(() => {
      clearIgnoreTimer.current = null;
      ignoreNextSpinClick.current = false;
    }, 140);
    void runSpinAction();
  };

  const handleSpinClick = () => {
    if (ignoreNextSpinClick.current) {
      ignoreNextSpinClick.current = false;
      return;
    }
    void runSpinAction();
  };

  const handleSpinClickRef = useRef(runSpinAction);
  useEffect(() => { handleSpinClickRef.current = runSpinAction; });

  useEffect(() => {
    if (!spaceEnabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      e.preventDefault();
      handleSpinClickRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [spaceEnabled]);

  useEffect(() => () => {
    if (clearIgnoreTimer.current) clearTimeout(clearIgnoreTimer.current);
  }, []);

  const handleAutospinClick = () => {
    if (isAutoActive) {
      gameEngine.stopAutoplay();
      return;
    }
    setAP(!isAPOpen);
  };

  const spinHint = isRoundPlay ? T("spin rewind") : T("spin start");

  return (
    <div className="ui-spin-control">
      <button
        className={`ui-autospin-btn${autoPushed ? " ui-autospin-btn--active" : ""}${autoDisabled ? " ui-autospin-btn--disabled" : ""}`}
        onClick={handleAutospinClick}
        disabled={autoDisabled}
        type="button"
      >
        <span
          ref={autoIconRef}
          className="ui-autospin-btn-icon"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: autoIconMarkup }}
        />
        {autoPushed && (
          <span className="ui-autospin-counter" aria-live="polite">
            {autoplay.infinite ? "∞" : autoplay.remainingRounds}
          </span>
        )}
      </button>

      <button
        className={`ui-spin-btn${spinPushed ? " ui-spin-btn--active" : ""}`}
        onTouchEnd={handleSpinTouchEnd}
        onClick={handleSpinClick}
        type="button"
        title={spinHint}
        aria-label={spinHint}
        aria-busy={phase === "BETTING"}
      >
        <span
          ref={iconRef}
          className="ui-spin-btn-icon"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: iconMarkup }}
        />
      </button>

      {/* VOLATILITY — показывается под кнопкой спина только в адаптиве ≤1350 / portrait
         (на десктопе живёт в .ui-credit-col над балансом). Скрыта в replay.
         Клик переключает уровень — та же логика, что у sys-seg. */}
      {!isReplayMode() && (
        <button
          type="button"
          className={`ui-spin-volatility${volatilityDisabled ? " ui-spin-volatility--disabled" : ""}`}
          onClick={cycleVolatility}
          disabled={volatilityDisabled}
          aria-label={`${T("volatility")}: ${volatilityLabel}`}
        >
          <span className="ui-spin-volatility-value">{volatilityLabel}</span>
        </button>
      )}
    </div>
  );
};
