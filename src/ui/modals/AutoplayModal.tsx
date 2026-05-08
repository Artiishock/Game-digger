import React, { useState } from "react";
import { t, T } from "../../i18n/t";
import { useGameStore } from "../../store/gameStore";
import { gameEngine } from "../../game/GameEngine";
import "../ui.css";
import { NumericKeyboard } from "./NumericKeyboard";

const PRESET_ROUNDS = [10, 25, 50, 100, 250, 500, 750, 1000];

type KeyboardInputId = "customRounds" | "stopWinOver" | "stopBalUp" | "stopBalDown";

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
  const [activeInput, setActiveInput] = useState<KeyboardInputId | null>(null);

  if (!isOpen) return null;

  const canStart = phase === "IDLE" || phase === "WIN" || phase === "LOSE";
  const hasCustomRounds = customRounds.trim().length > 0;

  const stopEvent = (
    event: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const nativeEvent = event.nativeEvent as Event & {
      stopImmediatePropagation?: () => void;
    };

    nativeEvent.stopImmediatePropagation?.();
  };

  const closeKeyboard = (event: React.MouseEvent<HTMLDivElement>) => {
    stopEvent(event);

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    setActiveInput(null);
  };

  const handleKeyboardDigit = (digit: string) => {
    if (!activeInput) return;

    updateKeyboardValue(activeInput, (value) => `${value}${digit}`);
  };

  const handleKeyboardBackspace = () => {
    if (!activeInput) return;

    updateKeyboardValue(activeInput, (value) => value.slice(0, -1));
  };

  const handleKeyboardDecimal = () => {
    if (!activeInput || activeInput === "customRounds") return;

    updateKeyboardValue(activeInput, (value) =>
      value.includes(".") ? value : `${value}.`
    );
  };

  const updateKeyboardValue = (
    inputId: KeyboardInputId,
    updater: (value: string) => string
  ) => {
    if (inputId === "customRounds") {
      setRounds(0);
      setCustomRounds((value) => updater(value).replace(/\D/g, ""));
      return;
    }

    const sanitizeDecimal = (value: string) => {
      const normalized = value.replace(/[^\d.]/g, "");
      const [integerPart, ...decimalParts] = normalized.split(".");
      return decimalParts.length
        ? `${integerPart}.${decimalParts.join("")}`
        : integerPart;
    };

    const setters: Record<
      Exclude<KeyboardInputId, "customRounds">,
      React.Dispatch<React.SetStateAction<string>>
    > = {
      stopWinOver: setStopWinOver,
      stopBalUp: setStopBalUp,
      stopBalDown: setStopBalDown,
    };

    setters[inputId]((value) => sanitizeDecimal(updater(value)));
  };

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

      {activeInput && (
        <div
          className="ui-keyboard-focus-dim"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={closeKeyboard}
        />
      )}

      <div
        className={`ui-modal ui-modal--sm ${
          activeInput ? "ui-modal--keyboard-active" : ""
        }`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ui-ap-section ui-ap-section--autoplay">
          <div className="ui-ap-section-label">{T('play feature')}</div>

          <div className="ui-pills">
            {PRESET_ROUNDS.map((r) => (
              <button
                key={r}
                onClick={() => {
                  setRounds(r);
                  setCustomRounds("");
                }}
                className={`ui-pill ${
                  rounds === r && !customRounds ? "ui-pill--active" : ""
                }`}
              >
                <span className="ui-pill-label">{r}</span>
              </button>
            ))}

            <button
              onClick={() => {
                setRounds(0);
                setCustomRounds("");
              }}
              className={`ui-pill ${
                rounds === 0 && !customRounds ? "ui-pill--active" : ""
              }`}
            >
              <span className="ui-pill-label">∞</span>
            </button>
          </div>

          <div className="ui-ap-custom">
            <div className="ui-ap-custom-label">{t('custom number of plays')}</div>

            <div className="ui-ap-custom-row">
              <div
                className={`ui-keyboard-anchor ${
                  activeInput === "customRounds"
                    ? "ui-keyboard-anchor--active"
                    : ""
                }`}
              >
                <input
                  className="ui-ap-input"
                  placeholder=""
                  value={customRounds}
                  onFocus={() => setActiveInput("customRounds")}
                  onClick={() => setActiveInput("customRounds")}
                  onChange={(e) => {
                    setRounds(0);
                    setCustomRounds(e.target.value.replace(/\D/g, ""));
                  }}
                />

                {activeInput === "customRounds" && (
                  <NumericKeyboard
                    allowDecimal={false}
                    onDigit={handleKeyboardDigit}
                    onBackspace={handleKeyboardBackspace}
                    onDecimal={handleKeyboardDecimal}
                    onSubmit={() => setActiveInput(null)}
                  />
                )}
              </div>

              <button
                className={`ui-ap-start-btn ${
                  !hasCustomRounds ? "ui-ap-start-btn--hidden" : ""
                }`}
                onClick={handleStart}
                disabled={!canStart || !hasCustomRounds}
                aria-hidden={!hasCustomRounds}
                tabIndex={hasCustomRounds ? 0 : -1}
              ></button>
            </div>
          </div>
        </div>

        <div className="ui-ap-section ui-ap-section--stop">
          <div className="ui-ap-section-label">{T('stop conditions')}</div>

          <div className="ui-stop-conditions">
            <CheckRow
              label={t('on any win')}
              checked={stopAnyWin}
              onChange={setStopAnyWin}
            />

            <InputRow
              label={t('if single win exceeds')}
              checked={stopWinOverActive}
              onCheckChange={setStopWinOverActive}
              value={stopWinOver}
              onChange={setStopWinOver}
              placeholder=""
              inputId="stopWinOver"
              activeInput={activeInput}
              onFocusInput={setActiveInput}
              onKeyboardDigit={handleKeyboardDigit}
              onKeyboardBackspace={handleKeyboardBackspace}
              onKeyboardDecimal={handleKeyboardDecimal}
              onKeyboardSubmit={() => setActiveInput(null)}
            />

            <InputRow
              label={t('if balance increases by')}
              checked={stopBalUpActive}
              onCheckChange={setStopBalUpActive}
              value={stopBalUp}
              onChange={setStopBalUp}
              placeholder=""
              inputId="stopBalUp"
              activeInput={activeInput}
              onFocusInput={setActiveInput}
              onKeyboardDigit={handleKeyboardDigit}
              onKeyboardBackspace={handleKeyboardBackspace}
              onKeyboardDecimal={handleKeyboardDecimal}
              onKeyboardSubmit={() => setActiveInput(null)}
            />

            <InputRow
              label={t('if balance decreases by')}
              checked={stopBalDownActive}
              onCheckChange={setStopBalDownActive}
              value={stopBalDown}
              onChange={setStopBalDown}
              placeholder=""
              inputId="stopBalDown"
              activeInput={activeInput}
              onFocusInput={setActiveInput}
              onKeyboardDigit={handleKeyboardDigit}
              onKeyboardBackspace={handleKeyboardBackspace}
              onKeyboardDecimal={handleKeyboardDecimal}
              onKeyboardSubmit={() => setActiveInput(null)}
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
  inputId: Exclude<KeyboardInputId, "customRounds">;
  activeInput: KeyboardInputId | null;
  onFocusInput: (inputId: KeyboardInputId) => void;
  onKeyboardDigit: (digit: string) => void;
  onKeyboardBackspace: () => void;
  onKeyboardDecimal: () => void;
  onKeyboardSubmit: () => void;
}> = ({
  label,
  checked,
  onCheckChange,
  value,
  onChange,
  placeholder,
  inputId,
  activeInput,
  onFocusInput,
  onKeyboardDigit,
  onKeyboardBackspace,
  onKeyboardDecimal,
  onKeyboardSubmit,
}) => (
  <div className="ui-input-row">
    <div
      className={`ui-checkbox ${checked ? "ui-checkbox--checked" : ""}`}
      onClick={() => onCheckChange(!checked)}
    >
      {checked && <span className="ui-checkbox-tick"></span>}
    </div>

    <span className="ui-input-row-label">{label}</span>

    <div
      className={`ui-input-row-field-wrap ui-keyboard-anchor ${
        activeInput === inputId ? "ui-keyboard-anchor--active" : ""
      }`}
    >
      <input
        className="ui-input-row-field"
        value={value}
        onFocus={() => onFocusInput(inputId)}
        onClick={() => onFocusInput(inputId)}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        placeholder={placeholder}
      />

      {activeInput === inputId && (
        <NumericKeyboard
          onDigit={onKeyboardDigit}
          onBackspace={onKeyboardBackspace}
          onDecimal={onKeyboardDecimal}
          onSubmit={onKeyboardSubmit}
        />
      )}
    </div>
  </div>
);