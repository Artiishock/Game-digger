import React from 'react'
import { useGameStore, type VolatilityMode } from '../../store/gameStore'

const OPTIONS: { mode: VolatilityMode; label: string; desc: string }[] = [
  { mode: 'low',    label: 'LOW',    desc: '42% win · safe' },
  { mode: 'medium', label: 'MEDIUM', desc: '30% win · balanced' },
  { mode: 'high',   label: 'HIGH',   desc: '15% win · big wins' },
]

export const VolatilitySelector: React.FC = () => {
  const volatility    = useGameStore(s => s.volatility)
  const setVolatility = useGameStore(s => s.setVolatility)
  const phase         = useGameStore(s => s.phase)

  const disabled = phase === 'BETTING' || phase === 'RUNNING'

  return (
    <div style={{
      display: 'flex',
      gap: 4,
      alignItems: 'center',
      opacity: disabled ? 0.4 : 1,
      pointerEvents: disabled ? 'none' : 'auto',
      transition: 'opacity 0.2s',
    }}>
      {OPTIONS.map(({ mode, label, desc }) => {
        const active = volatility === mode
        return (
          <button
            key={mode}
            title={desc}
            onClick={() => setVolatility(mode)}
            style={{
              height: 28,
              padding: '0 10px',
              borderRadius: 14,
              border: active
                ? '1.5px solid rgba(255,184,48,0.7)'
                : '1.5px solid rgba(255,184,48,0.2)',
              background: active
                ? 'rgba(255,184,48,0.18)'
                : 'rgba(0,0,0,0.6)',
              color: active ? '#FFB830' : 'rgba(240,230,211,0.45)',
              fontSize: 10,
              fontWeight: active ? 700 : 500,
              fontFamily: "'Barlow', sans-serif",
              letterSpacing: '0.08em',
              cursor: 'pointer',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
              lineHeight: 1,
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
