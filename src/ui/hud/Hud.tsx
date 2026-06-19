import React, { useState, useEffect, useRef } from "react";
import { useGameStore, type SpeedMode } from "../../store/gameStore";
import { formatMoney, toDisplay, isReplayMode, type RgsConfig } from "../../rgs/client";
import { resolvePublicUrl } from "../../utils/publicUrl";
import "../ui.css";
import { T } from "../../i18n/t";
import { BalanceBetModal } from "../modals/BalanceBetModal";

// ── Генерация уровней ставок ──────────────────────────────────────────────────

/**
 * Следующий «красивый» уровень ставки по 1-2-5 прогрессии.
 * 0.10 → 0.20 → 0.50 → 1.00 → 2.00 → 5.00 → 10.00 → ...
 */
function nextBetLevel(v: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const next = n < 1.5 ? 2 * mag : n < 3.5 ? 5 * mag : 10 * mag;
  return Math.round(next * 1_000_000) / 1_000_000; // убираем float-мусор
}

/**
 * Строит список уровней ставок по 1-2-5 прогрессии в диапазоне [minD, maxD].
 * Используется только когда Stake не прислал betLevels.
 */
function generateBetLevels(minD: number, maxD: number): number[] {
  if (minD <= 0 || maxD <= 0 || minD > maxD) return minD > 0 ? [minD] : [];
  const result: number[] = [];
  let v = minD;
  while (v <= maxD + 1e-9) {
    result.push(Math.round(v * 100) / 100);
    if (v >= maxD) break;
    const nxt = nextBetLevel(v);
    v = nxt > maxD ? maxD : nxt;
  }
  return [...new Set(result)];
}

/**
 * Возвращает display-уровни ставок из конфига.
 *
 * Stake присылает betLevels, но они могут покрывать только часть диапазона
 * (например, только до $100, хотя maxBet = $1000). В таком случае используем
 * 1-2-5 генерацию, чтобы покрыть весь диапазон до maxBet.
 *
 * Если betLevels покрывают полный диапазон (V10/V11 могут иметь разные шаги) —
 * используем их как есть, сохраняя кастомные шаги Stake.
 */
function resolveBetLevels(config: RgsConfig): number[] {
  const minD = toDisplay(config.minBet);
  const maxD = toDisplay(config.maxBet);

  if (Array.isArray(config.betLevels) && config.betLevels.length > 1) {
    const provided = [...config.betLevels]
      .sort((a, b) => a - b)
      .map(toDisplay);
    const providedMax = provided[provided.length - 1];
    // Допуск 1% + фиксированный $0.01 — на случай float-погрешностей
    const tolerance = 0.01 * maxD + 0.01;

    if (Math.abs(providedMax - maxD) <= tolerance) {
      // Stake прислал полный диапазон — используем его шаги (V10/V11)
      return provided;
    }

    // Stake прислал сокращённый список (например, до $100 при maxBet=$1000):
    // сохраняем Stake-шаги как есть, затем достраиваем 1-2-5 от providedMax до maxD.
    const extension = generateBetLevels(providedMax, maxD)
      .filter((v) => v > providedMax + 0.001);
    return [...provided, ...extension];
  }

  return generateBetLevels(minD, maxD);
}

// ── Скорости ─────────────────────────────────────────────────────────────────
const SPEEDS: { mode: SpeedMode; label: string }[] = [
  { mode: 0.75, label: "x0.75" },
  { mode: 1, label: "x1" },
  { mode: 2, label: "x2" },
  { mode: 5, label: "x5" },
];

// ── Иконка черепахи ───────────────────────────────────────────────────────────
const TurtleSVG: React.FC<{ active: boolean }> = ({ active }) => {
  const c = active ? "rgba(255,184,48,0.7)" : "rgba(200,200,200,0.45)";
  const f = active ? "rgba(255,184,48,0.4)" : "rgba(160,160,160,0.35)";
  const e = active ? "#FFB830" : "rgba(200,200,200,0.55)";
  return (
    <svg width="28" height="22" viewBox="0 0 36 28" fill="none">
      <ellipse cx="19" cy="14" rx="10" ry="8" fill={c} />
      <circle cx="19" cy="14" r="6" fill={f} />
      <ellipse cx="8" cy="14" rx="4" ry="3" fill={c} />
      <circle cx="6" cy="13" r="1.5" fill={e} />
      <line
        x1="13"
        y1="20"
        x2="11"
        y2="26"
        stroke={c}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="19"
        y1="22"
        x2="18"
        y2="27"
        stroke={c}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="25"
        y1="20"
        x2="27"
        y2="26"
        stroke={c}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="13"
        y1="8"
        x2="11"
        y2="3"
        stroke={c}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="25"
        y1="8"
        x2="27"
        y2="3"
        stroke={c}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
};

// ── Основной компонент ────────────────────────────────────────────────────────
export const Hud: React.FC = () => {
  const balance = useGameStore((s) => s.balance);
  const bet = useGameStore((s) => s.bet);
  const currency = useGameStore((s) => s.currency);
  const speed = useGameStore((s) => s.speed);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const config = useGameStore((s) => s.config);
  const phase = useGameStore((s) => s.phase);
  const setBet = useGameStore((s) => s.setBet);

  const turboDisabled = !!config?.jurisdiction.disabledTurbo;
  const betDisabled =
    phase === "RUNNING" || phase === "BETTING" || phase === "BOOT";

  // Все уровни ставок из конфига, отфильтрованные по текущему балансу.
  // Адаптированы под валюту игрока: Stake присылает betLevels под каждую валюту.
  // Пересчитываются после каждого спина (balance меняется → re-render).
  const balanceDisplay = toDisplay(balance);
  const allLevels = config ? resolveBetLevels(config) : [];
  const levels = allLevels.filter((l) => l <= balanceDisplay);
  const minBet = levels.length > 0 ? levels[0] : 0;
  const maxBet = levels.length > 0 ? levels[levels.length - 1] : 0;

  // ── Balance bet modal state ───────────────────────────────────────────────
  const [showBetModal, setShowBetModal] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  // Закрытие по клику вне нижней группы управления
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!showBetModal) return;
      const target = e.target as Node;
      if (!groupRef.current?.contains(target)) {
        setShowBetModal(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showBetModal]);

  // ── Кнопки + / − ─────────────────────────────────────────────────────────
  const handlePlus = () => {
    if (betDisabled) return;
    const idx = levels.findIndex((level) => level > bet);
    setBet(idx >= 0 ? levels[idx] : maxBet);
  };

  const handleMinus = () => {
    if (betDisabled) return;
    let idx = -1;
    for (let i = levels.length - 1; i >= 0; i--) {
      if (levels[i] < bet) {
        idx = i;
        break;
      }
    }
    setBet(idx >= 0 ? levels[idx] : minBet);
  };

  const handleModalSelect = (value: number) => {
    if (betDisabled) return;
    setBet(value);
    setShowBetModal(false);
  };

  const SPEED_ICONS: Record<number, string> = {
    0.75: resolvePublicUrl("ui/speedmode_0.75.svg"),
    1: resolvePublicUrl("ui/speedmode_1.svg"),
    2: resolvePublicUrl("ui/speedmode_2.svg"),
    5: resolvePublicUrl("ui/speedmode_5.svg"),
  };

  const inReplay = isReplayMode()

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="ui-hud">
      {/* CREDIT — hidden in replay mode */}
      {!inReplay && (
        <div className="ui-credit">
          <span className="ui-credit-label">{T('balance')}</span>
          <span className="ui-credit-value">
            {formatMoney(balance, currency)}
          </span>
        </div>
      )}

      <div className="ui-group-wrapper" ref={groupRef}>
        {/* SPEED BUTTONS */}
        <div className="ui-speed-group">
          {SPEEDS.map(({ mode, label }) => {
            const disabled = mode > 1 && turboDisabled;
            const active = speed === mode;

            return (
              <button
                key={mode}
                onClick={() => !disabled && setSpeed(mode)}
                disabled={disabled}
                className={`ui-speed-btn ${active ? "ui-speed-btn--active" : ""}`}
              >
                <span
                  className="ui-speed-icon"
                  aria-hidden="true"
                  style={{
                    maskImage: `url("${SPEED_ICONS[mode]}")`,
                    WebkitMaskImage: `url("${SPEED_ICONS[mode]}")`,
                  }}
                />

                <span className="ui-speed-label">{label}</span>
              </button>
            );
          })}
        </div>

        {/* TOTAL BET + модальное окно — hidden in replay mode */}
        {!inReplay && showBetModal && (
          <BalanceBetModal
            levels={levels}
            currentBet={bet}
            onClose={() => setShowBetModal(false)}
            onSelect={handleModalSelect}
          />
        )}

        {!inReplay && (
          <div
            className="ui-bet-block"
            onClick={() => !betDisabled && setShowBetModal(true)}
          >
            <span className="ui-bet-label">{T('total play')}</span>
            <div className="ui-bet-controls">
              <button
                className="ui-bet-adj"
                onClick={(event) => { event.stopPropagation(); handleMinus(); }}
                disabled={betDisabled || bet <= minBet}
              >
                <span className="ui-bet-icon ui-bet-icon--minus" aria-hidden="true" />
              </button>
              <span className="ui-bet-amount">{bet.toFixed(2)}</span>
              <button
                className="ui-bet-adj"
                onClick={(event) => { event.stopPropagation(); handlePlus(); }}
                disabled={betDisabled || bet >= maxBet}
              >
                <span className="ui-bet-icon ui-bet-icon--plus" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
