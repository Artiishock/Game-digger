import React, { useEffect, useRef, useState } from "react";
import { useGameStore } from "../../store/gameStore";
import { gameEngine } from "../../game/GameEngine";
import { gameAudio } from "../../audio/GameAudio";
import "../ui.css";

const svgCache = new Map<string, string>();

const loadSvg = async (url: string): Promise<string> => {
  const cached = svgCache.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  const text = await res.text();
  svgCache.set(url, text);
  return text;
};

export const DigButton: React.FC = () => {
  const phase = useGameStore((s) => s.phase);
  const autoplay = useGameStore((s) => s.autoplay);
  const setAP = useGameStore((s) => s.setAutoplayOpen);
  const isAPOpen = useGameStore((s) => s.autoplayOpen);
  const spaceEnabled = useGameStore((s) => s.settings.spaceEnabled);

  const canDig = phase === "IDLE" || phase === "WIN" || phase === "LOSE";
  const isRunning = phase === "RUNNING" || phase === "BETTING";
  const isAutoActive = autoplay.active;

  const spinPushed = isRunning || isAutoActive;
  const autoPushed = isAutoActive;

  const iconRef = useRef<HTMLSpanElement>(null);
  const [iconMarkup, setIconMarkup] = useState<string>("");
  const iconUrl = spinPushed ? "/ui/spin_icon_push.svg" : "/ui/spin_icon.svg";

  const autoIconRef = useRef<HTMLSpanElement>(null);
  const [autoIconMarkup, setAutoIconMarkup] = useState<string>("");
  const autoIconUrl = autoPushed
    ? "/ui/autoplay_icon_push.svg"
    : "/ui/autoplay_icon.svg";

  useEffect(() => {
    let cancelled = false;
    loadSvg(iconUrl).then((markup) => {
      if (!cancelled) setIconMarkup(markup);
    });
    return () => {
      cancelled = true;
    };
  }, [iconUrl]);

  useEffect(() => {
    let cancelled = false;
    loadSvg(autoIconUrl).then((markup) => {
      if (!cancelled) setAutoIconMarkup(markup);
    });
    return () => {
      cancelled = true;
    };
  }, [autoIconUrl]);

  useEffect(() => {
    if (!iconMarkup || !iconRef.current) return;
    if (!spinPushed) return;
    const clickArea = iconRef.current.querySelector("#clickArea");
    if (!clickArea) return;
    clickArea.dispatchEvent(
      new MouseEvent("click", { bubbles: false, cancelable: true })
    );
  }, [iconMarkup, spinPushed]);

  useEffect(() => {
    console.log(isAutoActive);
  }, [isAutoActive]);

  const handleSpinClick = () => {
    gameAudio.unlock();

    if (isAutoActive) gameEngine.stopAutoplay();
    else if (canDig) gameEngine.startRound();
  };

  const handleSpinClickRef = useRef(handleSpinClick);
  useEffect(() => { handleSpinClickRef.current = handleSpinClick; });

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

  const handleAutospinClick = () => {
    setAP(!isAPOpen);
  };


  return (
    <div className="ui-spin-control">
      <button
        className={`ui-autospin-btn${autoPushed ? " ui-autospin-btn--active" : ""}`}
        onClick={handleAutospinClick}
        type="button"
      >
        <span
          ref={autoIconRef}
          className="ui-autospin-btn-icon"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: autoIconMarkup }}
        />
      </button>

      <button
        className={`ui-spin-btn${spinPushed ? " ui-spin-btn--active" : ""}`}
        onClick={handleSpinClick}
        disabled={isRunning && !isAutoActive}
        type="button"
      >
        <span
          ref={iconRef}
          className="ui-spin-btn-icon"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: iconMarkup }}
        />
        {isAutoActive && (
          <span className="ui-spin-btn-counter">
            {autoplay.remainingRounds}
          </span>
        )}
      </button>
    </div>
  );
};
