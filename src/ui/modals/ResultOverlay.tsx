import React, { useEffect, useMemo, useRef } from 'react'
import { useGameStore } from '../../store/gameStore'
import { gameAudio } from '../../audio/GameAudio'
import { resolveWinCelebrationOrFallback, type WinCelebrateKind } from '../winCelebration'
import { WinCelebrationSpine } from '../WinCelebrationSpine'
import '../ui.css'

export const ResultOverlay: React.FC = () => {
  const phase    = useGameStore(s => s.phase)
  const lastWin  = useGameStore(s => s.lastWin)
  const roundID  = useGameStore(s => s.roundID)
  const bet      = useGameStore(s => s.bet)
  const currency = useGameStore(s => s.currency)
  const autoplay = useGameStore(s => s.autoplay)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Экран поражения (ПРОВАЛ) убран — после LAVA сразу IDLE (см. App.tsx).
  const show = phase === 'WIN'

  const multiplier = useMemo(() => {
    if (!show || !(bet > 0) || lastWin <= 0) return 0
    return lastWin / bet
  }, [show, bet, lastWin])

  const celebrateKind: WinCelebrateKind | null =
    multiplier > 0 ? resolveWinCelebrationOrFallback(multiplier) : null

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

  const bgStyle = {
    background:
      'radial-gradient(ellipse at center, rgba(76,175,80,0.25) 0%, rgba(0,0,0,0.7) 70%)',
  }

  const winMultDisplay = lastWin > 0 && bet > 0 ? lastWin / bet : 0

  return (
    <div
      className="ui-result"
      style={bgStyle}
      onClick={dismissOverlayOnly}
    >
      {celebrateKind && (
        <div className="ui-result-celebrate" aria-hidden>
          <div className="ui-result-celebrate-inner">
            {/* Ключ раунда: каждый win — новый React-инстанс и полная перезагрузка Spine с нуля */}
            <WinCelebrationSpine key={`${roundID}-${celebrateKind}`} kind={celebrateKind} />
          </div>
        </div>
      )}

      {lastWin > 0 && (
        <div className="ui-result-win-info">
          <div className="ui-result-win-sub">Выигрыш</div>
          <div className="ui-result-win-amt">{lastWin.toFixed(2)} {currency}</div>
          <div className="ui-result-win-mult">×{winMultDisplay.toFixed(2)} от ставки</div>
        </div>
      )}

      {!autoplay.active && (
        <div className="ui-result-hint">Нажмите в любое место, чтобы закрыть · ⛏ DIG — новый раунд</div>
      )}
    </div>
  )
}
