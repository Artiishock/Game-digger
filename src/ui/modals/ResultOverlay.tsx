import React, { useEffect, useRef } from 'react'
import { useGameStore } from '../../store/gameStore'
import { gameEngine } from '../../game/GameEngine'

export const ResultOverlay: React.FC = () => {
  const phase   = useGameStore(s => s.phase)
  const lastWin = useGameStore(s => s.lastWin)
  const bet     = useGameStore(s => s.bet)
  const currency = useGameStore(s => s.currency)
  const autoplay = useGameStore(s => s.autoplay)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isWin  = phase === 'WIN'
  const isLose = phase === 'LOSE'
  const show   = isWin || isLose

  // Auto-dismiss after 2.5s if autoplay active
  useEffect(() => {
    if (show && autoplay.active) {
      timerRef.current = setTimeout(() => {
        useGameStore.getState().setPhase('IDLE')
      }, 1200)
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [show, autoplay.active])

  if (!show) return null

  const multiplier = lastWin > 0 ? (lastWin / bet) : 0

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 100,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: isWin
        ? 'radial-gradient(ellipse at center, rgba(76,175,80,0.25) 0%, rgba(0,0,0,0.7) 70%)'
        : 'radial-gradient(ellipse at center, rgba(255,69,0,0.25) 0%, rgba(0,0,0,0.75) 70%)',
      animation: 'fadeIn 0.4s ease',
      pointerEvents: 'none',
    }}>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:scale(0.92)}to{opacity:1;transform:scale(1)}} @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}`}</style>

      {/* Big emoji */}
      <div style={{ fontSize: 72, lineHeight: 1, marginBottom: 12, animation: 'pulse 1.2s ease infinite' }}>
        {isWin ? '🛏️' : '🌋'}
      </div>

      {/* Result text */}
      <div style={{
        fontFamily: 'Bebas Neue, sans-serif',
        fontSize: 'clamp(40px, 10vw, 80px)',
        color: isWin ? '#7CFC00' : '#FF4500',
        letterSpacing: '.06em',
        textShadow: isWin ? '0 0 40px rgba(124,252,0,0.5)' : '0 0 40px rgba(255,69,0,0.5)',
        lineHeight: 1,
      }}>
        {isWin ? 'ПОБЕДА!' : 'ПРОВАЛ!'}
      </div>

      {isWin && lastWin > 0 && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'rgba(240,230,211,0.5)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Выигрыш</div>
          <div style={{
            fontSize: 'clamp(28px, 6vw, 52px)',
            fontFamily: 'Bebas Neue, sans-serif',
            color: '#FFB830', letterSpacing: '.04em',
            textShadow: '0 0 30px rgba(255,184,48,0.4)',
          }}>
            {lastWin.toFixed(2)} {currency}
          </div>
          <div style={{ fontSize: 15, color: 'rgba(240,230,211,0.6)', marginTop: 4 }}>
            ×{multiplier.toFixed(2)} от ставки
          </div>
        </div>
      )}

      {isLose && (
        <div style={{ marginTop: 12, fontSize: 14, color: 'rgba(240,230,211,0.5)' }}>
          Ставка {bet.toFixed(2)} {currency} сгорела
        </div>
      )}

      {/* Play again hint */}
      {!autoplay.active && (
        <div style={{
          marginTop: 28, fontSize: 12, color: 'rgba(240,230,211,0.35)',
          letterSpacing: '.1em', textTransform: 'uppercase', pointerEvents: 'none',
          animation: 'pulse 2s ease infinite',
        }}>
          Нажмите ⛏ DIG чтобы продолжить
        </div>
      )}
    </div>
  )
}
