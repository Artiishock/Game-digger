import React from 'react'
import { useGameStore, type SpeedMode } from '../../store/gameStore'
import { formatMoney } from '../../rgs/client'

const SPEEDS: { mode: SpeedMode; emoji: string }[] = [
  { mode: 0.75, emoji: '🐢' },
  { mode: 1,    emoji: '🚶' },
  { mode: 2,    emoji: '🐇' },
  { mode: 5,    emoji: '⚡'  },
]

export const Hud: React.FC = () => {
  const stats    = useGameStore(s => s.stats)
  const balance  = useGameStore(s => s.balance)
  const lastWin  = useGameStore(s => s.lastWin)
  const bet      = useGameStore(s => s.bet)
  const currency = useGameStore(s => s.currency)
  const speed    = useGameStore(s => s.speed)
  const setSpeed = useGameStore(s => s.setSpeed)
  const config   = useGameStore(s => s.config)

  const turboDisabled = !!config?.jurisdiction.disabledTurbo

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '0 10px 10px', zIndex: 50, pointerEvents: 'none',
    }}>

      {/* Stats block */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        background: 'rgba(10,5,2,0.88)', borderRadius: 28,
        padding: '8px 18px', border: '1px solid rgba(255,184,48,0.18)',
        backdropFilter: 'blur(8px)', flexShrink: 0,
      }}>
        {[
          { label: 'ГЛУБИНА',    value: `${stats.depth.toFixed(1)}м`      },
          { label: 'РАССТОЯНИЕ', value: `${stats.distance.toFixed(1)}м`   },
          { label: 'МНОЖИТЕЛЬ',  value: `×${stats.multiplier.toFixed(2)}`, gold: true },
        ].map((item, i) => (
          <React.Fragment key={item.label}>
            {i > 0 && <div style={{ width: 1, height: 24, background: 'rgba(255,184,48,0.12)' }} />}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(240,230,211,0.45)', fontWeight: 600 }}>
                {item.label}
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: item.gold ? '#FFB830' : '#F0E6D3', fontVariantNumeric: 'tabular-nums' }}>
                {item.value}
              </span>
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* Speed buttons */}
      <div style={{ display: 'flex', gap: 4, pointerEvents: 'all', flexShrink: 0 }}>
        {SPEEDS.map(({ mode, emoji }) => {
          const disabled = mode > 1 && turboDisabled
          const active   = speed === mode
          return (
            <button
              key={mode}
              onClick={() => !disabled && setSpeed(mode)}
              disabled={disabled}
              style={{
                width: 42, height: 42, borderRadius: '50%',
                border: `2px solid ${active ? '#FFB830' : 'rgba(255,255,255,0.15)'}`,
                background: active ? 'rgba(255,184,48,0.18)' : 'rgba(15,8,3,0.82)',
                color: '#fff', fontSize: 19, cursor: disabled ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s', pointerEvents: 'all',
                opacity: disabled ? 0.35 : 1,
                boxShadow: active ? '0 0 12px rgba(255,184,48,0.3)' : 'none',
              }}
            >{emoji}</button>
          )
        })}
      </div>

      {/* Finance block */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(8,4,2,0.9)', borderRadius: 28,
        padding: '8px 20px', border: '1px solid rgba(255,255,255,0.06)',
        backdropFilter: 'blur(8px)', minWidth: 0,
      }}>
        <FinItem label="БАЛАНС" value={formatMoney(balance, currency)} />
        <div style={{ textAlign: 'center' }}>
          {lastWin > 0
            ? <><span style={{ fontSize: 11, color: 'rgba(240,230,211,0.5)' }}>Последний выигрыш: </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#FFB830' }}>{lastWin.toFixed(2)} {currency}</span></>
            : <span style={{ fontSize: 12, color: 'rgba(240,230,211,0.3)', letterSpacing: '0.08em' }}>DEEP RUSH</span>
          }
        </div>
        <FinItem label="СТАВКА" value={`${bet.toFixed(2)} ${currency}`} align="right" />
      </div>
    </div>
  )
}

const FinItem: React.FC<{ label: string; value: string; align?: string }> = ({ label, value, align }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: (align as any) ?? 'left' }}>
    <span style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(240,230,211,0.4)', fontWeight: 600 }}>
      {label}
    </span>
    <span style={{ fontSize: 13, fontWeight: 700, color: '#F0E6D3', fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </span>
  </div>
)
