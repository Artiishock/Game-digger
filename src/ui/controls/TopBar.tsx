import React from "react";
import { useGameStore } from "../../store/gameStore";
import "../ui.css";

export const TopBar: React.FC = () => {
  const settings = useGameStore((s) => s.settings);
  const upd = useGameStore((s) => s.updateSettings);
  const setMenu = useGameStore((s) => s.setMenuOpen);
  const setTab = useGameStore((s) => s.setMenuTab);
  const phase = useGameStore((s) => s.phase);
  const lastWin = useGameStore((s) => s.lastWin);
  const currency = useGameStore((s) => s.currency);
  const stats = useGameStore((s) => s.stats);

  const openTab = (tab: "info" | "settings") => {
    setTab(tab);
    setMenu(true);
  };

  return (
    <>
      {/* Logo */}
      <div className="ui-logo-zone">Logo zone</div>
      {/* WIN — в RUNNING показываем живой множитель (как растёт с монетами); после раунда — сумма выигрыша */}
      <div className="ui-win-zone">
        <span className="ui-win-label">WIN </span>
        <span className="ui-win-amount">
          {phase === "RUNNING"
            ? `×${stats.multiplier.toFixed(2)}`
            : lastWin > 0
              ? `${lastWin.toFixed(2)} ${currency}`
              : `0.00 ${currency}`}
        </span>
      </div>

      {/* Top-right */}
      <div className="ui-topright">
        <div className="ui-icon-btns">
          <button
            className={`ui-icon-btn ${settings.soundEnabled ? "ui-icon-btn--active" : ""}`}
            onClick={() => upd({ soundEnabled: !settings.soundEnabled })}
            title={settings.soundEnabled ? "Mute" : "Unmute"}
          >
            {settings.soundEnabled ? (
              <span>
                <img className="ui-icon" src="/ui/sound_icon.svg" alt="sound" />
              </span>
            ) : (
              <span>
                <img className="ui-icon" src="/ui/sound.svg" alt="sound" />
              </span>
            )}
          </button>
          <button
            className="ui-icon-btn"
            onClick={() => openTab("info")}
            title="Info"
          >
            <span className="ui-icon-info">
              i
            </span>
          </button>
          <button
            className="ui-icon-btn"
            onClick={() => openTab("settings")}
            title="Settings"
          >
            <span>
              <img className="ui-icon" src="/ui/settings_icon.svg" alt="settings" />
            </span>
          </button>
        </div>

        <div className="ui-depth-block ui-depth-block--desktop">
          <div className="ui-depth-row">
            <span className="ui-depth-label">DISTANCE</span>
            <span className="ui-depth-value">
              {stats.distance.toFixed(1)} m
            </span>
          </div>
          <div className="ui-depth-row">
            <span className="ui-depth-label">DEPTH</span>
            <span className="ui-depth-value">{stats.depth.toFixed(1)} m</span>
          </div>
        </div>
      </div>
    </>
  );
};
