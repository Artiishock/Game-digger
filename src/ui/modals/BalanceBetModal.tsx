import React from "react";
import { resolvePublicUrl } from "../../utils/publicUrl";

const BALANCE_BET_OPTIONS = [
  "0.10",
  "0.20",
  "0.50",
  "1.00",
  "1.50",
  "2.00",
  "2.50",
  "5.00",
  "10.0",
  "100.0",
  "200.0",
  "350.0",
  "500.0",
  "750.0",
  "1000",
];

type BalanceBetModalProps = {
  onClose: () => void;
  onSelect: (value: number) => void;
};

export const BalanceBetModal: React.FC<BalanceBetModalProps> = ({
  onClose,
  onSelect,
}) => {
  return (
    <div className="balance-bet-modal-layer" onClick={onClose}>
      <div
        className="balance-bet-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="balance-bet-modal__header">
          <span className="balance-bet-modal__title">Balance (Fun)</span>
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
          {BALANCE_BET_OPTIONS.map((label) => (
            <button
              key={label}
              className="balance-bet-modal__cell"
              type="button"
              onClick={() => onSelect(Number(label))}
            >
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
