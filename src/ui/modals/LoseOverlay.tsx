import React, { useEffect, useRef } from 'react'
import { useGameStore } from '../../store/gameStore'
import '../ui.css'

export const LoseOverlay: React.FC = () => {
  const phase    = useGameStore(s => s.phase)
  const autoplay = useGameStore(s => s.autoplay)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = phase === 'LOSE'

  const dismiss = () => useGameStore.getState().setPhase('IDLE')

  useEffect(() => {
    if (!show) return
    const delay = autoplay.active ? 800 : 2500
    timerRef.current = setTimeout(dismiss, delay)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [show, autoplay.active])

  useEffect(() => {
    if (!show || autoplay.active) return
    const onKey = () => dismiss()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, autoplay.active])

  if (!show) return null

  return (
    <div
      className="ui-lose"
      onClick={!autoplay.active ? dismiss : undefined}
    >
      <div className="ui-lose-inner">
        <div className="ui-lose-title">ПРОИГРЫШ</div>
        {!autoplay.active && (
          <div className="ui-lose-hint">Нажмите в любое место, чтобы продолжить</div>
        )}
      </div>
    </div>
  )
}
