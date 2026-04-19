import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useGameStore, type SpeedMode } from '../../store/gameStore'
import { formatMoney, toDisplay } from '../../rgs/client'
import '../ui.css'

// ── Логика прогрессивных шагов ставки (из BottomControlBar) ──────────────────
const STEP_MAP = [
  { upTo: 2, step: 1  },
  { upTo: 3, step: 3  },
  { upTo: 5, step: 5  },
  { upTo: 8, step: 10 },
  { upTo: 9, step: 20 },
  { upTo: Infinity, step: 25 },
]
function getStep(pressCount: number): number {
  return STEP_MAP.find(s => pressCount <= s.upTo)?.step ?? 25
}

// ── Скорости ─────────────────────────────────────────────────────────────────
const SPEEDS: { mode: SpeedMode; label: string }[] = [
  { mode: 0.75, label: 'x0.75' },
  { mode: 1,    label: 'x1'    },
  { mode: 2,    label: 'x2'    },
  { mode: 5,    label: 'x5'    },
]

// ── Иконка черепахи ───────────────────────────────────────────────────────────
const TurtleSVG: React.FC<{ active: boolean }> = ({ active }) => {
  const c = active ? 'rgba(255,184,48,0.7)' : 'rgba(200,200,200,0.45)'
  const f = active ? 'rgba(255,184,48,0.4)' : 'rgba(160,160,160,0.35)'
  const e = active ? '#FFB830' : 'rgba(200,200,200,0.55)'
  return (
    <svg width="28" height="22" viewBox="0 0 36 28" fill="none">
      <ellipse cx="19" cy="14" rx="10" ry="8" fill={c}/>
      <circle  cx="19" cy="14" r="6"          fill={f}/>
      <ellipse cx="8"  cy="14" rx="4" ry="3"  fill={c}/>
      <circle  cx="6"  cy="13" r="1.5"        fill={e}/>
      <line x1="13" y1="20" x2="11" y2="26" stroke={c} strokeWidth="2" strokeLinecap="round"/>
      <line x1="19" y1="22" x2="18" y2="27" stroke={c} strokeWidth="2" strokeLinecap="round"/>
      <line x1="25" y1="20" x2="27" y2="26" stroke={c} strokeWidth="2" strokeLinecap="round"/>
      <line x1="13" y1="8"  x2="11" y2="3"  stroke={c} strokeWidth="2" strokeLinecap="round"/>
      <line x1="25" y1="8"  x2="27" y2="3"  stroke={c} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

// ── Основной компонент ────────────────────────────────────────────────────────
export const Hud: React.FC = () => {
  const balance  = useGameStore(s => s.balance)
  const bet      = useGameStore(s => s.bet)
  const currency = useGameStore(s => s.currency)
  const speed    = useGameStore(s => s.speed)
  const setSpeed = useGameStore(s => s.setSpeed)
  const config   = useGameStore(s => s.config)
  const phase    = useGameStore(s => s.phase)
  const setBet   = useGameStore(s => s.setBet)

  const turboDisabled = !!config?.jurisdiction.disabledTurbo
  const betDisabled   = phase === 'RUNNING' || phase === 'BETTING' || phase === 'BOOT'
  const levels        = config?.betLevels.map(toDisplay) ?? [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100]
  const minBet        = levels[0]  ?? 0.1
  const maxBet        = levels[levels.length - 1] ?? 1000

  // ── Bet modal state ───────────────────────────────────────────────────────
  const [showBetModal, setShowBetModal] = useState(false)
  const [betValue,     setBetValue]     = useState(bet)
  const [coinValue,    setCoinValue]    = useState(1)
  const [pressCount,   setPressCount]   = useState(0)
  const betModalRef = useRef<HTMLDivElement>(null)
  const betBtnsRef  = useRef<HTMLDivElement>(null)

  // Синхронизация betValue при открытии модала
  useEffect(() => {
    if (showBetModal) setBetValue(bet)
  }, [bet, showBetModal])

  // Закрытие по клику вне
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (!showBetModal) return
      const insidePanel = betModalRef.current?.contains(target)
      const insideBtns  = betBtnsRef.current?.contains(target)
      if (!insidePanel && !insideBtns) {
        setShowBetModal(false)
        setPressCount(0)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showBetModal])

  // ── Кнопки + / − ─────────────────────────────────────────────────────────
  const handlePlus = () => {
    if (betDisabled) return
    const nextPress = pressCount + 1
    const step      = getStep(nextPress)
    const target    = bet + step
    // Находим первый уровень >= target
    const nextLevel = levels.find(l => l >= target) ?? levels[levels.length - 1]
    if (nextLevel === bet) { setPressCount(0); return }
    setPressCount(nextPress)
    setBet(nextLevel)
    setBetValue(nextLevel)
    if (!showBetModal) { setCoinValue(1); setShowBetModal(true) }
  }

  const handleMinus = () => {
    if (betDisabled) return
    setPressCount(0)
    const idx = levels.findIndex(l => l >= bet)
    const prev = idx > 0 ? levels[idx - 1] : levels[0]
    setBet(prev)
    setBetValue(prev)
    if (!showBetModal) { setCoinValue(1); setShowBetModal(true) }
  }

  // ── Обработчики модала ────────────────────────────────────────────────────
  const handleModalBetChange = (val: number) => {
    const clamped = Math.max(minBet, Math.min(maxBet, val))
    // Snap к ближайшему уровню
    const snapped = levels.reduce((prev, curr) =>
      Math.abs(curr - clamped) < Math.abs(prev - clamped) ? curr : prev
    )
    setBetValue(snapped)
    setBet(snapped)
    setPressCount(0)
  }

  const handleModalCoinChange = (val: number) => {
    setCoinValue(Math.max(1, Math.min(100, Math.round(val))))
    setPressCount(0)
  }

  const handleBetMax = () => {
    setBet(maxBet)
    setBetValue(maxBet)
    setCoinValue(1)
    setPressCount(0)
  }

  const totalBet = betValue * coinValue

  // ── Bet modal JSX ─────────────────────────────────────────────────────────
  const betModal = showBetModal ? (
    <div className="bet-modal-panel" ref={betModalRef}>
      <div className="bet-modal__header">
        <span className="bet-modal__title">BET MULTIPLIER {betValue}×</span>
        <button
          className="bet-modal__close"
          onClick={() => { setShowBetModal(false); setPressCount(0) }}
        >×</button>
      </div>
      <div className="bet-modal__body">

        <div className="bet-modal__section">
          <span className="bet-modal__label">BET</span>
          <div className="bet-modal__control">
            <input
              type="range" className="bet-modal__slider"
              min={minBet} max={maxBet} step={0.01} value={betValue}
              onChange={e => handleModalBetChange(Number(e.target.value))}
            />
            <input
              type="number" className="bet-modal__input"
              min={minBet} max={maxBet} value={betValue}
              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) handleModalBetChange(v) }}
            />
          </div>
        </div>

        <div className="bet-modal__section">
          <span className="bet-modal__label">COIN VALUE</span>
          <div className="bet-modal__control">
            <input
              type="range" className="bet-modal__slider"
              min={1} max={100} step={1} value={coinValue}
              onChange={e => handleModalCoinChange(Number(e.target.value))}
            />
            <input
              type="number" className="bet-modal__input"
              min={1} max={100} value={coinValue}
              onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v)) handleModalCoinChange(v) }}
            />
          </div>
        </div>

        <div className="bet-modal__section bet-modal__section--total">
          <span className="bet-modal__label">TOTAL BET</span>
          <span className="bet-modal__total-value">${totalBet.toFixed(2)}</span>
        </div>

        <button className="bet-modal__max-btn" onClick={handleBetMax}>BET MAX</button>
      </div>
    </div>
  ) : null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="ui-hud">

      {/* CREDIT */}
      <div className="ui-credit">
        <span className="ui-credit-label">CREDIT</span>
        <span className="ui-credit-value">{formatMoney(balance, currency)}</span>
      </div>

      {/* SPEED BUTTONS */}
      <div className="ui-speed-group">
        {SPEEDS.map(({ mode, label }) => {
          const disabled = mode > 1 && turboDisabled
          const active   = speed === mode
          return (
            <button
              key={mode}
              onClick={() => !disabled && setSpeed(mode)}
              disabled={disabled}
              className={`ui-speed-btn ${active ? 'ui-speed-btn--active' : ''}`}
            >
              <TurtleSVG active={active} />
              <span className="ui-speed-label">{label}</span>
            </button>
          )
        })}
      </div>

      {/* TOTAL BET + модальное окно */}
      <div className="ui-bet-block" ref={betBtnsRef}>
        {betModal}
        <span className="ui-bet-label">TOTAL BET</span>
        <div className="ui-bet-controls">
          <button
            className="ui-bet-adj"
            onClick={handleMinus}
            disabled={betDisabled || bet <= minBet}
          >−</button>
          <span className="ui-bet-amount">{bet.toFixed(2)}</span>
          <button
            className="ui-bet-adj"
            onClick={handlePlus}
            disabled={betDisabled || bet >= maxBet}
          >+</button>
        </div>
      </div>

    </div>
  )
}