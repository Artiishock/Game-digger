import React, { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../../store/gameStore'
import { gameAudio } from '../../audio/GameAudio'
import { resolveWinCelebration, resolveWinCelebrationOrFallback, type WinCelebrateKind } from '../winCelebration'
import { WinCelebrationSpine } from '../WinCelebrationSpine'
import '../ui.css'

function useCountUp(target: number, duration = 1500, skip = false): number {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (skip || target <= 0) { setValue(target <= 0 ? 0 : target); return }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3)
      setValue(target * ease)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else setValue(target)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration, skip])

  return value
}

export const ResultOverlay: React.FC = () => {
  const phase       = useGameStore(s => s.phase)
  const lastWin     = useGameStore(s => s.lastWin)
  const lastWinMult = useGameStore(s => s.lastWinMult)
  const roundID     = useGameStore(s => s.roundID)
  const currency    = useGameStore(s => s.currency)
  const autoplay    = useGameStore(s => s.autoplay)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [counterSkipped, setCounterSkipped] = useState(false)

  const show = phase === 'WIN'

  const animatedWin  = useCountUp(show ? lastWin     : 0, 2100, counterSkipped)
  const animatedMult = useCountUp(show ? lastWinMult : 0, 2100, counterSkipped)

  const celebrateKind: WinCelebrateKind | null =
    show && lastWinMult > 0 ? resolveWinCelebrationOrFallback(lastWinMult) : null

  useEffect(() => {
    if (!show) setCounterSkipped(false)
  }, [show])

  useEffect(() => {
    if (show && autoplay.active) {
      timerRef.current = setTimeout(() => {
        useGameStore.getState().setPhase('IDLE')
      }, 1200)
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [show, autoplay.active])

  useEffect(() => {
    if (!show) return
    const audioKind = lastWinMult > 0 ? resolveWinCelebration(lastWinMult) : null
    gameAudio.syncWinScreen(true, audioKind)
    const payTimer = setTimeout(() => gameAudio.stopWinPayLoop(), 2200)
    return () => {
      clearTimeout(payTimer)
      gameAudio.syncWinScreen(false, null)
    }
  }, [show, lastWinMult])

  const handleInteraction = () => {
    if (autoplay.active) return
    if (!counterSkipped) {
      setCounterSkipped(true)
      gameAudio.stopWinPayLoop()
    } else {
      gameAudio.stopWinPayLoop()
      gameAudio.unlock()
      useGameStore.getState().setPhase('IDLE')
    }
  }

  useEffect(() => {
    if (!show || autoplay.active) return
    const onKey = () => handleInteraction()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, autoplay.active, counterSkipped])

  if (!show) return null

  const dismissOverlayOnly = () => handleInteraction()

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
      {celebrateKind && (
        <div className="ui-result-celebrate" aria-hidden>
          <div className="ui-result-celebrate-inner">
            <WinCelebrationSpine key={`${roundID}-${celebrateKind}`} kind={celebrateKind} />
          </div>
        </div>
      )}

      {lastWin > 0 && (
        <div className="ui-result-win-info">
          <div className="ui-result-win-sub">Выигрыш</div>
          <div className="ui-result-win-amt">{animatedWin.toFixed(2)} {currency}</div>
          <div className="ui-result-win-mult">×{animatedMult.toFixed(2)} от ставки</div>
        </div>
      )}

      {!autoplay.active && (
        <div className="ui-result-hint">Нажмите в любое место, чтобы закрыть · ⛏ DIG – новый раунд</div>
      )}
    </div>
  )
}
