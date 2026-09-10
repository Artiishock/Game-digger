import { useGameStore, type VolatilityMode } from "../store/gameStore";
import { gameAudio } from "../audio/GameAudio";

/** Подписи уровней волатильности (как в sys-seg / SettingsPanel). */
export const VOLATILITY_LABELS: Record<VolatilityMode, string> = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
};

/** Порядок перебора одиночной кнопкой: low → medium → high → low. */
const VOLATILITY_ORDER: VolatilityMode[] = ["low", "medium", "high"];

/**
 * Та же логика, что у сегментного контрола `sys-seg` в настройках:
 * нельзя менять во время BETTING/RUNNING, клик проигрывает UI-звук и пишет в стор.
 * Отличие: HUD показывает один бокс, поэтому клик циклически перебирает уровни.
 */
export function useVolatilityControl() {
  const volatility = useGameStore((s) => s.volatility);
  const setVolatility = useGameStore((s) => s.setVolatility);
  const phase = useGameStore((s) => s.phase);

  const disabled = phase === "BETTING" || phase === "RUNNING";

  const cycle = () => {
    if (disabled) return;
    const idx = VOLATILITY_ORDER.indexOf(volatility);
    const next = VOLATILITY_ORDER[(idx + 1) % VOLATILITY_ORDER.length];
    gameAudio.playUiClick();
    setVolatility(next);
  };

  return { volatility, label: VOLATILITY_LABELS[volatility], disabled, cycle };
}
