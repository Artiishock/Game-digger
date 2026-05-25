import React, { useEffect, useRef } from "react";
import { resolvePublicUrl } from "../../utils/publicUrl";

type BalanceBetModalProps = {
  /** Доступные уровни ставок (уже отфильтрованы по балансу). */
  levels: number[];
  /** Текущая ставка — для подсветки активного варианта. */
  currentBet: number;
  onClose: () => void;
  onSelect: (value: number) => void;
};

export const BalanceBetModal: React.FC<BalanceBetModalProps> = ({
  levels,
  currentBet,
  onClose,
  onSelect,
}) => {
  const activeRef = useRef<HTMLButtonElement>(null);

  // При открытии прокручиваем активный элемент в область видимости
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, []);

  return (
    <div className="balance-bet-modal-layer" onClick={onClose}>
      <div
        className="balance-bet-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="balance-bet-modal__header">
          <button
            className="balance-bet-modal__close"
            type="button"
            aria-label="Close balance bet modal"
            onClick={onClose}
          >
            <img src={resolvePublicUrl("ui/cross.svg")} alt="" />
          </button>
        </div>

        <div className="balance-bet-modal__grid">
          {levels.map((level) => {
            const isActive = Math.abs(level - currentBet) < 0.001;
            return (
              <button
                key={level}
                ref={isActive ? activeRef : undefined}
                className={`balance-bet-modal__cell${isActive ? " balance-bet-modal__cell--active" : ""}`}
                type="button"
                onClick={() => onSelect(level)}
              >
                <span>
                  {level % 1 === 0 ? level.toFixed(0) : level.toFixed(2)}
                </span>
              </button>
            );
          })}

          {levels.length === 0 && (
            <div className="balance-bet-modal__empty">—</div>
          )}
        </div>
      </div>
    </div>
  );
};
