import React, { useCallback } from 'react'
import { useGameStore } from '../../store/gameStore'
import { T } from '../../i18n/t'
import { toDisplay } from '../../rgs/client'

export const BetControls: React.FC = () => {
  const bet       = useGameStore(s => s.bet)
  const setBet    = useGameStore(s => s.setBet)
  const config    = useGameStore(s => s.config)
  const currency  = useGameStore(s => s.currency)
  const phase     = useGameStore(s => s.phase)

  const disabled = phase === 'RUNNING' || phase === 'BETTING' || phase === 'BOOT'

  const levels = config?.betLevels.map(toDisplay) ?? [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100]

  const decrease = useCallback(() => {
    const idx = levels.findIndex(l => l >= bet)
    const prev = idx > 0 ? levels[idx - 1] : levels[0]
    setBet(prev)
  }, [bet, levels, setBet])

  const increase = useCallback(() => {
    let idx = -1
    for (let i = levels.length - 1; i >= 0; i--) {
      if (levels[i] <= bet) {
        idx = i
        break
      }
    }
    const next = idx < levels.length - 1 ? levels[idx + 1] : levels[levels.length - 1]
    setBet(next)
  }, [bet, levels, setBet])

  return (
    <div style={{
      position: 'absolute', bottom: 72, left: 10,
      display: 'flex', alignItems: 'center', gap: 6,
      zIndex: 50,
    }}>
      <button
        onClick={decrease}
        disabled={disabled || bet <= (levels[0] ?? 0.1)}
        style={btnStyle(disabled)}
      >−</button>

      <div style={{
        background: 'rgba(10,5,2,0.88)', borderRadius: 20,
        padding: '6px 14px', border: '1px solid rgba(255,184,48,0.2)',
        backdropFilter: 'blur(6px)', minWidth: 80, textAlign: 'center',
      }}>
        <div style={{ fontSize: 9, color: 'rgba(240,230,211,0.4)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{T('bet')}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#FFB830', fontVariantNumeric: 'tabular-nums' }}>
          {bet.toFixed(2)} <span style={{ fontSize: 10, color: 'rgba(240,230,211,0.5)' }}>{currency}</span>
        </div>
      </div>

      <button
        onClick={increase}
        disabled={disabled || bet >= (levels[levels.length - 1] ?? 1000)}
        style={btnStyle(disabled)}
      >+</button>
    </div>
  )
}

function btnStyle(disabled: boolean) {
  return {
    width: 32, height: 32, borderRadius: '50%',
    border: '1.5px solid rgba(255,184,48,0.3)',
    background: 'rgba(15,8,3,0.85)',
    color: '#FFB830', fontSize: 18, cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: disabled ? 0.4 : 1, fontWeight: 700, lineHeight: 1,
  } as React.CSSProperties
}
