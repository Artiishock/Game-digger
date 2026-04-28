import React, { useState } from 'react'
import { useGameStore } from '../../store/gameStore'
import { gameEngine } from '../../game/GameEngine'
import { gameAudio } from '../../audio/GameAudio'
import '../ui.css'

export const DigButton: React.FC = () => {
  const phase      = useGameStore(s => s.phase)
  const autoplay   = useGameStore(s => s.autoplay)
  const setAP      = useGameStore(s => s.setAutoplayOpen)
  const isAPOpen   = useGameStore(s => s.autoplayOpen)

  const [collapsed, setCollapsed] = useState(false)

  const canDig       = phase === 'IDLE' || phase === 'WIN' || phase === 'LOSE'
  const isRunning    = phase === 'RUNNING' || phase === 'BETTING'
  const isAutoActive = autoplay.active

  const handleSpinClick = () => {
    gameAudio.unlock()
    gameAudio.playUiClick()
    if (isAutoActive)   gameEngine.stopAutoplay()
    else if (canDig)    gameEngine.startRound()
  }

  // Клик по стрелке — показать/скрыть кнопку
  const handleArrowClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    gameAudio.playUiClick()
    setCollapsed(v => !v)
  }

  // Клик по badge — открыть/закрыть autoplay modal
  const handleBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    gameAudio.playUiClick()
    setAP(!isAPOpen)
  }

  const iconColor = isAutoActive
    ? '#ffaa88'
    : isRunning && !isAutoActive
    ? 'rgba(255,255,255,0.25)'
    : '#FFB830'

  const btnClass = [
    'ui-spin-btn',
    isAutoActive               ? 'ui-spin-btn--auto'      : '',
    isRunning && !isAutoActive ? 'ui-spin-btn--running'   : '',
    collapsed                  ? 'ui-spin-btn--collapsed' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      className={btnClass}
      onClick={handleSpinClick}
      disabled={isRunning && !isAutoActive}
    >
      {/* Стрелка — toggles collapsed, всегда слева */}
      <div
        className="ui-spin-arrow"
        onClick={handleArrowClick}
      />

      <svg className="ui-spin-icon" width="52" height="52" viewBox="0 0 52 52" fill="none">
        <path
          d="M44 26C44 35.941 35.941 44 26 44C16.059 44 8 35.941 8 26C8 16.059 16.059 8 26 8C32 8 37.3 10.9 40.7 15.4"
          stroke={iconColor} strokeWidth="4" strokeLinecap="round"
        />
        <path d="M38 8L42 16L34 16Z" fill={iconColor} />
      </svg>

      {/* Badge — открывает autoplay modal */}
      <div
        className={`ui-spin-badge ${isAutoActive ? 'ui-spin-badge--active' : ''}`}
        onClick={handleBadgeClick}
      >
        {isAutoActive
          ? `STOP ${autoplay.remainingRounds}`
          : 'AUTOPLAY'
        }
      </div>
    </button>
  )
}