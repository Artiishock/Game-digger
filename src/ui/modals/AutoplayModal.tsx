import React, { useState } from 'react'
import { useGameStore } from '../../store/gameStore'
import { gameEngine } from '../../game/GameEngine'

const PRESET_ROUNDS = [10, 25, 50, 100, 250, 500, 750, 1000]

export const AutoplayModal: React.FC = () => {
  const isOpen    = useGameStore(s => s.autoplayOpen)
  const setOpen   = useGameStore(s => s.setAutoplayOpen)
  const autoplay  = useGameStore(s => s.autoplay)
  const phase     = useGameStore(s => s.phase)

  const [rounds,       setRounds]       = useState(autoplay.totalRounds)
  const [customRounds, setCustomRounds] = useState('')
  const [stopAnyWin,   setStopAnyWin]   = useState(false)
  const [stopWinOver,  setStopWinOver]  = useState('')
  const [stopBalUp,    setStopBalUp]    = useState('')
  const [stopBalDown,  setStopBalDown]  = useState('')

  if (!isOpen) return null

  const canStart = phase === 'IDLE' || phase === 'WIN' || phase === 'LOSE'

  const handleStart = () => {
    const r = customRounds ? parseInt(customRounds) : rounds
    if (!r || r < 1) return
    setOpen(false)
    gameEngine.startAutoplay({
      totalRounds:              r,
      stopOnAnyWin:             stopAnyWin,
      stopIfSingleWinExceeds:   stopWinOver   ? parseFloat(stopWinOver)  : null,
      stopIfBalanceIncreasesBy: stopBalUp     ? parseFloat(stopBalUp)    : null,
      stopIfBalanceDecreasesBy: stopBalDown   ? parseFloat(stopBalDown)  : null,
    })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={() => setOpen(false)}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'linear-gradient(160deg, #1e0f08, #140a04)',
        border: '1px solid rgba(255,184,48,0.2)',
        borderRadius: 20, padding: 28, width: 360, maxWidth: '92vw',
        color: '#F0E6D3',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: 26, letterSpacing: '.06em', color: '#FFB830' }}>АВТОСПИН</span>
          <button onClick={() => setOpen(false)} style={closeBtnStyle}>✕</button>
        </div>

        {/* Round presets */}
        <div style={{ marginBottom: 18 }}>
          <Label>КОЛИЧЕСТВО РАУНДОВ</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {PRESET_ROUNDS.map(r => (
              <button key={r} onClick={() => { setRounds(r); setCustomRounds('') }}
                style={pillStyle(rounds === r && !customRounds)}>
                {r}
              </button>
            ))}
            <button onClick={() => { setRounds(0); setCustomRounds('') }}
              style={pillStyle(rounds === 0 && !customRounds)}>∞</button>
          </div>
          <input
            placeholder="Своё число…"
            value={customRounds}
            onChange={e => setCustomRounds(e.target.value.replace(/\D/g, ''))}
            style={inputStyle}
          />
        </div>

        {/* Stop conditions */}
        <div style={{ marginBottom: 20 }}>
          <Label>УСЛОВИЯ ОСТАНОВКИ</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            <CheckRow label="При любом выигрыше" checked={stopAnyWin} onChange={setStopAnyWin} />
            <InputRow label="Если выигрыш превышает" value={stopWinOver}  onChange={setStopWinOver}  placeholder="сумма $" />
            <InputRow label="Если баланс вырос на"   value={stopBalUp}    onChange={setStopBalUp}    placeholder="сумма $" />
            <InputRow label="Если баланс упал на"     value={stopBalDown}  onChange={setStopBalDown}  placeholder="сумма $" />
          </div>
        </div>

        <button
          onClick={handleStart}
          disabled={!canStart}
          style={{
            width: '100%', padding: '13px 0',
            background: canStart ? 'linear-gradient(135deg, #FFD060, #cc7700)' : '#333',
            border: 'none', borderRadius: 12,
            color: canStart ? '#1a0800' : '#666',
            fontSize: 15, fontWeight: 900, letterSpacing: '.06em', cursor: canStart ? 'pointer' : 'not-allowed',
          }}
        >
          ЗАПУСТИТЬ АВТОСПИН
        </button>
      </div>
    </div>
  )
}

const Label: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(240,230,211,0.45)', fontWeight: 600 }}>
    {children}
  </div>
)

const CheckRow: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'rgba(240,230,211,0.7)' }}>
    <div onClick={() => onChange(!checked)} style={{
      width: 20, height: 20, borderRadius: 6,
      border: `2px solid ${checked ? '#FFB830' : 'rgba(255,255,255,0.2)'}`,
      background: checked ? 'rgba(255,184,48,0.2)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      {checked && <span style={{ color: '#FFB830', fontSize: 12, lineHeight: 1 }}>✓</span>}
    </div>
    {label}
  </label>
)

const InputRow: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder: string }> = ({ label, value, onChange, placeholder }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
    <span style={{ fontSize: 12, color: 'rgba(240,230,211,0.6)', flex: 1 }}>{label}</span>
    <input
      value={value}
      onChange={e => onChange(e.target.value.replace(/[^\d.]/g, ''))}
      placeholder={placeholder}
      style={{ ...inputStyle, width: 100, marginTop: 0, padding: '5px 10px' }}
    />
  </div>
)

const pillStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 12px', borderRadius: 16, fontSize: 13, fontWeight: 700,
  border: `1.5px solid ${active ? '#FFB830' : 'rgba(255,255,255,0.15)'}`,
  background: active ? 'rgba(255,184,48,0.18)' : 'transparent',
  color: active ? '#FFB830' : 'rgba(240,230,211,0.6)',
  cursor: 'pointer',
})

const inputStyle: React.CSSProperties = {
  marginTop: 8, width: '100%', background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
  padding: '7px 12px', color: '#F0E6D3', fontSize: 13, outline: 'none',
}

const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'rgba(240,230,211,0.5)',
  fontSize: 18, cursor: 'pointer', padding: 4,
}
