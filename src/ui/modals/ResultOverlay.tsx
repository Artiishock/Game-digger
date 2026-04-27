import React, { useEffect, useRef } from 'react'
import { useGameStore } from '../../store/gameStore'
import { gameAudio } from '../../audio/GameAudio'
import '../ui.css'

export const ResultOverlay: React.FC = () => {
  const phase    = useGameStore(s => s.phase)
  const lastWin  = useGameStore(s => s.lastWin)
  const bet      = useGameStore(s => s.bet)
  const currency = useGameStore(s => s.currency)
  const autoplay = useGameStore(s => s.autoplay)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Экран поражения (ПРОВАЛ) убран — после LAVA сразу IDLE (см. App.tsx).
  const show = phase === 'WIN'

  useEffect(() => {
    if (show && autoplay.active) {
      timerRef.current = setTimeout(() => {
        useGameStore.getState().setPhase('IDLE')
      }, 1200)
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [show, autoplay.active])

  if (!show) return null

  const dismissOverlayOnly = () => {
    if (autoplay.active) return
    gameAudio.unlock()
    useGameStore.getState().setPhase('IDLE')
  }

  const multiplier = lastWin > 0 ? (lastWin / bet) : 0
  const bgStyle = {
    background:
      'radial-gradient(ellipse at center, rgba(76,175,80,0.25) 0%, rgba(0,0,0,0.7) 70%)',
  }

  return (
    <div
      className="ui-result"
      style={bgStyle}
      onClick={dismissOverlayOnly}
    >
      <div className="ui-result-emoji">🛏️</div>

      <div className="ui-result-title ui-result-title--win">ПОБЕДА!</div>

      {lastWin > 0 && (
        <div className="ui-result-win-info">
          <div className="ui-result-win-sub">Выигрыш</div>
          <div className="ui-result-win-amt">{lastWin.toFixed(2)} {currency}</div>
          <div className="ui-result-win-mult">×{multiplier.toFixed(2)} от ставки</div>
        </div>
      )}

      {!autoplay.active && (
        <div className="ui-result-hint">Нажмите в любое место, чтобы закрыть · ⛏ DIG — новый раунд</div>
      )}
    </div>
  )
}
