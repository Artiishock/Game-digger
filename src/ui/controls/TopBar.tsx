import React, { useState } from "react";
import { useGameStore } from "../../store/gameStore";
import { t, T } from "../../i18n/t";
import { resolvePublicUrl } from "../../utils/publicUrl";
import "../ui.css";

export const TopBar: React.FC = () => {
  const [logoSrc, setLogoSrc] = useState(resolvePublicUrl("rules/banner.png"));
  const settings = useGameStore((s) => s.settings);
  const toggleMasterSound = useGameStore((s) => s.toggleMasterSound);
  const setMenu = useGameStore((s) => s.setMenuOpen);
  const setTab = useGameStore((s) => s.setMenuTab);
  const phase = useGameStore((s) => s.phase);
  const lastWin = useGameStore((s) => s.lastWin);
  const currency = useGameStore((s) => s.currency);
  const stats = useGameStore((s) => s.stats);
  const lastRoundStats = useGameStore((s) => s.lastRoundStats);
  const replayMode = useGameStore((s) => s.replayMode);
  const replayBetAmount = useGameStore((s) => s.replayBetAmount);
  const replayRoundID = useGameStore((s) => s.roundID);
  const logoDimmed = phase === "RUNNING" || phase === "BETTING";
  const depthHudLive = phase === "RUNNING";
  const depthHudDistance = depthHudLive ? stats.distance : lastRoundStats.distance;
  const depthHudDepth = depthHudLive ? stats.depth : lastRoundStats.depth;

  const openTab = (tab: "info" | "settings") => {
    setTab(tab);
    setMenu(true);
  };

  return (
    <>
      {/* Replay recording badge */}
      {replayMode && (
        <div className="ui-replay-badge">
          <span className="ui-replay-dot" />
          <span className="ui-replay-label">REPLAY</span>
          {replayRoundID && (
            <span className="ui-replay-bet">ID: {replayRoundID}</span>
          )}
          {replayBetAmount > 0 && (
            <span className="ui-replay-bet">
              {replayBetAmount.toFixed(2)} {currency}
            </span>
          )}
        </div>
      )}

      {/* Logo */}
      <div
        className={`ui-logo-zone${logoDimmed ? " ui-logo-zone--gameplay" : ""}`}
      >
        <img
          src={logoSrc}
          alt=""
          onError={() => setLogoSrc(resolvePublicUrl("rules/logo_magnetic.svg"))}
        />
      </div>
      {/* В раунде — «Множитель»; после победы — «Последний выигрыш»; иначе — WIN */}
      <div className="ui-win-zone">
        <span className="ui-win-label">
          {phase === "RUNNING" || phase === "BETTING"
            ? `${T("multiplier")} `
            : phase === "WIN" || lastWin > 0
              ? `${T("last win")} `
              : `${T("win label")} `}
        </span>
        <span className="ui-win-amount">
          {phase === "RUNNING" || phase === "BETTING"
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
            onClick={() => toggleMasterSound()}
            title={settings.soundEnabled ? t('mute') : t('unmute')}
          >
            {settings.soundEnabled ? (
              <span>
                <img className="ui-icon" src={resolvePublicUrl("ui/sound_icon.svg")} alt="sound" />
              </span>
            ) : (
              <span>
                <img className="ui-icon" src={resolvePublicUrl("ui/sound_icon_disabled.svg")} alt="sound" />
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
              <img className="ui-icon" src={resolvePublicUrl("ui/settings_icon.svg")} alt="settings" />
            </span>
          </button>
        </div>

        {settings.showDepthHud && (
          <div className="ui-depth-block ui-depth-block--desktop">
            <div className="ui-depth-row">
              <span className="ui-depth-label">
                {depthHudLive ? T('distance') : T('last distance')}
              </span>
              <span className="ui-depth-value">
                {depthHudDistance.toFixed(1)} m
              </span>
            </div>
            <div className="ui-depth-row">
              <span className="ui-depth-label">
                {depthHudLive ? T('depth') : T('last depth')}
              </span>
              <span className="ui-depth-value">{depthHudDepth.toFixed(1)} m</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
