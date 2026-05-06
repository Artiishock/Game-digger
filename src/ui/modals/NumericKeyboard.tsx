import React from "react";

type NumericKeyboardProps = {
  allowDecimal?: boolean;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onDecimal: () => void;
  onSubmit: () => void;
};

const FIRST_ROW = ["1", "2", "3", "4", "5"];
const SECOND_ROW = ["6", "7", "8", "9", "0"];

export const NumericKeyboard: React.FC<NumericKeyboardProps> = ({
  allowDecimal = true,
  onDigit,
  onBackspace,
  onDecimal,
  onSubmit,
}) => {
  const stopEvent = (
    event:
      | React.PointerEvent<HTMLElement>
      | React.MouseEvent<HTMLElement>
      | React.TouchEvent<HTMLElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const nativeEvent = event.nativeEvent as Event & {
      stopImmediatePropagation?: () => void;
    };

    nativeEvent.stopImmediatePropagation?.();
  };

  const handleButtonClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: () => void
  ) => {
    stopEvent(event);
    action();
  };

  return (
    <div
      className="ui-num-keyboard"
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onTouchStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <div className="ui-num-keyboard__digits" aria-label="Numeric keyboard">
        <div className="ui-num-keyboard__digit-row">
          {FIRST_ROW.map((digit) => (
            <button
              key={digit}
              type="button"
              className="ui-num-keyboard__btn ui-num-keyboard__btn--digit"
              onClick={(event) => handleButtonClick(event, () => onDigit(digit))}
            >
              {digit}
            </button>
          ))}
        </div>

        <div className="ui-num-keyboard__digit-row">
          {SECOND_ROW.map((digit) => (
            <button
              key={digit}
              type="button"
              className="ui-num-keyboard__btn ui-num-keyboard__btn--digit"
              onClick={(event) => handleButtonClick(event, () => onDigit(digit))}
            >
              {digit}
            </button>
          ))}
        </div>
      </div>

      <div className="ui-num-keyboard__tools">
        <button
          type="button"
          className="ui-num-keyboard__btn ui-num-keyboard__btn--icon"
          onClick={(event) => handleButtonClick(event, onBackspace)}
          aria-label="Backspace"
        >
          <img src="/ui/backspace_icon.svg" alt="" />
        </button>

        <button
          type="button"
          className="ui-num-keyboard__btn ui-num-keyboard__btn--digit"
          onClick={(event) => {
            if (!allowDecimal) {
              stopEvent(event);
              return;
            }

            handleButtonClick(event, onDecimal);
          }}
          aria-disabled={!allowDecimal}
          aria-label="Decimal separator"
        >
          .
        </button>
      </div>

      <div className="ui-num-keyboard__confirm">
        <button
          type="button"
          className="ui-num-keyboard__btn ui-num-keyboard__btn--confirm"
          onClick={(event) => handleButtonClick(event, onSubmit)}
          aria-label="Confirm input"
        >
          <img src="/ui/сheck_icon.svg" alt="" />
        </button>
      </div>
    </div>
  );
};