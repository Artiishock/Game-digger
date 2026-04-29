import React from "react";
import { useGameStore } from "../../store/gameStore";
import { gameEngine } from "../../game/GameEngine";
import { gameAudio } from "../../audio/GameAudio";
import "../ui.css";

export const DigButton: React.FC = () => {
  const phase = useGameStore((s) => s.phase);
  const autoplay = useGameStore((s) => s.autoplay);
  const setAP = useGameStore((s) => s.setAutoplayOpen);
  const isAPOpen = useGameStore((s) => s.autoplayOpen);

  const canDig = phase === "IDLE" || phase === "WIN" || phase === "LOSE";
  const isRunning = phase === "RUNNING" || phase === "BETTING";
  const isAutoActive = autoplay.active;

  const handleSpinClick = () => {
    gameAudio.unlock();

    if (isAutoActive) gameEngine.stopAutoplay();
    else if (canDig) gameEngine.startRound();
  };

  const handleAutospinClick = () => {
    setAP(!isAPOpen);
  };

  return (
    <div className="ui-spin-control">
      <button
        className="ui-autospin-btn"
        onClick={handleAutospinClick}
        type="button"
      >
        <span className="ui-autospin-btn-icon" aria-hidden="true">
          <img src="/ui/autoplay_icon.svg" alt="Autospin" />
        </span>
      </button>
      
      <button
        className="ui-spin-btn"
        onClick={handleSpinClick}
        disabled={isRunning && !isAutoActive}
        type="button"
      >
        <span className="ui-spin-btn-icon" aria-hidden="true">
          <img src="/ui/spin_icon.svg" alt="Spin" />
        </span>
      </button>
    </div>
  );
};
