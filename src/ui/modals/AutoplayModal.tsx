import React, { useState } from "react";
import { useGameStore } from "../../store/gameStore";
import { gameEngine } from "../../game/GameEngine";
import "../ui.css";

const PRESET_ROUNDS = [10, 25, 50, 100, 250, 500, 750, 1000];

export const AutoplayModal: React.FC = () => {
  const isOpen = useGameStore((s) => s.autoplayOpen);
  const setOpen = useGameStore((s) => s.setAutoplayOpen);
  const autoplay = useGameStore((s) => s.autoplay);
  const phase = useGameStore((s) => s.phase);

  const [rounds, setRounds] = useState(autoplay.totalRounds);
  const [customRounds, setCustomRounds] = useState("");

  const [stopAnyWin, setStopAnyWin] = useState(false);
  const [stopWinOverActive, setStopWinOverActive] = useState(false);
  const [stopBalUpActive, setStopBalUpActive] = useState(false);
  const [stopBalDownActive, setStopBalDownActive] = useState(false);

  const [stopWinOver, setStopWinOver] = useState("");
  const [stopBalUp, setStopBalUp] = useState("");
  const [stopBalDown, setStopBalDown] = useState("");

  if (!isOpen) return null;

  const canStart = phase === "IDLE" || phase === "WIN" || phase === "LOSE";
  const hasCustomRounds = customRounds.trim().length > 0;

  const handleStart = () => {
    const r = customRounds ? parseInt(customRounds) : rounds;
    if (!r || r < 1) return;

    setOpen(false);

    gameEngine.startAutoplay({
      totalRounds: r,
      stopOnAnyWin: stopAnyWin,
      stopIfSingleWinExceeds:
        stopWinOverActive && stopWinOver ? parseFloat(stopWinOver) : null,
      stopIfBalanceIncreasesBy:
        stopBalUpActive && stopBalUp ? parseFloat(stopBalUp) : null,
      stopIfBalanceDecreasesBy:
        stopBalDownActive && stopBalDown ? parseFloat(stopBalDown) : null,
    });
  };

  return (
    <div className="ui-overlay" onClick={() => setOpen(false)}>
      <button
        className="ui-ap-close"
        onClick={() => setOpen(false)}
        aria-label="Close autoplay modal"
      />
      <div
        className="ui-modal ui-modal--sm"
        onClick={(e) => e.stopPropagation()}
      >

        <div className="ui-ap-section ui-ap-section--autoplay">
          <div className="ui-ap-section-label">AUTO PLAY</div>

          <div className="ui-pills">
            {PRESET_ROUNDS.map((r) => (
              <button
                key={r}
                onClick={() => {
                  setRounds(r);
                  setCustomRounds("");
                }}
                className={`ui-pill ${rounds === r && !customRounds ? "ui-pill--active" : ""}`}
              >
                <span className="ui-pill-label">{r}</span>
              </button>
            ))}

            <button
              onClick={() => {
                setRounds(0);
                setCustomRounds("");
              }}
              className={`ui-pill ${rounds === 0 && !customRounds ? "ui-pill--active" : ""}`}
            >
              <span className="ui-pill-label">∞</span>
            </button>
          </div>

          <div className="ui-ap-custom">
            <div className="ui-ap-custom-label">Custom number of rounds</div>

            <div className="ui-ap-custom-row">
              <input
                className="ui-ap-input"
                placeholder=""
                value={customRounds}
                onChange={(e) =>
                  setCustomRounds(e.target.value.replace(/\D/g, ""))
                }
              />

              <button
                className={`ui-ap-start-btn ${!hasCustomRounds ? "ui-ap-start-btn--hidden" : ""}`}
                onClick={handleStart}
                disabled={!canStart || !hasCustomRounds}
                aria-hidden={!hasCustomRounds}
                tabIndex={hasCustomRounds ? 0 : -1}
              ></button>
            </div>
          </div>
        </div>

        <div className="ui-ap-section ui-ap-section--stop">
          <div className="ui-ap-section-label">STOP CONDITIONS</div>

          <div className="ui-stop-conditions">
            <CheckRow
              label="One any way"
              checked={stopAnyWin}
              onChange={setStopAnyWin}
            />

            <InputRow
              label="If single win exceeds"
              checked={stopWinOverActive}
              onCheckChange={setStopWinOverActive}
              value={stopWinOver}
              onChange={setStopWinOver}
              placeholder=""
            />

            <InputRow
              label="If cash balance increases by"
              checked={stopBalUpActive}
              onCheckChange={setStopBalUpActive}
              value={stopBalUp}
              onChange={setStopBalUp}
              placeholder=""
            />

            <InputRow
              label="If cash balance decreases by"
              checked={stopBalDownActive}
              onCheckChange={setStopBalDownActive}
              value={stopBalDown}
              onChange={setStopBalDown}
              placeholder=""
            />
          </div>
        </div>
      </div>
    </div>
  );
};

const CheckRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <label className="ui-check-row">
    <div
      className={`ui-checkbox ${checked ? "ui-checkbox--checked" : ""}`}
      onClick={() => onChange(!checked)}
    >
      {checked && <span className="ui-checkbox-tick" />}
    </div>

    {label}
  </label>
);

const InputRow: React.FC<{
  label: string;
  checked: boolean;
  onCheckChange: (v: boolean) => void;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}> = ({ label, checked, onCheckChange, value, onChange, placeholder }) => (
  <div className="ui-input-row">
    <div
      className={`ui-checkbox ${checked ? "ui-checkbox--checked" : ""}`}
      onClick={() => onCheckChange(!checked)}
    >
      {checked && <span className="ui-checkbox-tick"></span>}
    </div>

    <span className="ui-input-row-label">{label}</span>

    <div className="ui-input-row-field-wrap">
      <input
        className="ui-input-row-field"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        placeholder={placeholder}
      />
    </div>
  </div>
);
