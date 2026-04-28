import React, { useState } from 'react'
import { useGameStore } from '../../store/gameStore'
import { gameEngine } from '../../game/GameEngine'
import { gameAudio } from '../../audio/GameAudio'
import '../ui.css'

const PRESET_ROUNDS = [10, 25, 50, 100, 250, 500, 750, 1000]

export const AutoplayModal: React.FC = () => {
  const isOpen   = useGameStore(s => s.autoplayOpen)
  const setOpen  = useGameStore(s => s.setAutoplayOpen)
  const autoplay = useGameStore(s => s.autoplay)
  const phase    = useGameStore(s => s.phase)

  const [rounds,       setRounds]       = useState(autoplay.totalRounds)
  const [customRounds, setCustomRounds] = useState('')
  const [stopAnyWin,   setStopAnyWin]   = useState(false)
  const [stopWinOver,  setStopWinOver]  = useState('')
  const [stopBalUp,    setStopBalUp]    = useState('')
  const [stopBalDown,  setStopBalDown]  = useState('')

  if (!isOpen) return null

  const canStart  = phase === 'IDLE' || phase === 'WIN' || phase === 'LOSE'

  const handleStart = () => {
    const r = customRounds ? parseInt(customRounds) : rounds
    if (!r || r < 1) return
    gameAudio.playUiClick()
    setOpen(false)
    gameEngine.startAutoplay({
      totalRounds:              r,
      stopOnAnyWin:             stopAnyWin,
      stopIfSingleWinExceeds:   stopWinOver  ? parseFloat(stopWinOver)  : null,
      stopIfBalanceIncreasesBy: stopBalUp    ? parseFloat(stopBalUp)    : null,
      stopIfBalanceDecreasesBy: stopBalDown  ? parseFloat(stopBalDown)  : null,
    })
  }

  return (
    <div className="ui-overlay" onClick={() => { gameAudio.playUiClick(); setOpen(false) }}>
      <div className="ui-modal ui-modal--sm" onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span className="ui-ap-title">АВТОСПИН</span>
          <button className="ui-modal-close" onClick={() => { gameAudio.playUiClick(); setOpen(false) }}>✕</button>
        </div>

        {/* Round presets */}
        <div className="ui-ap-section">
          <div className="ui-ap-section-label">КОЛИЧЕСТВО РАУНДОВ</div>
          <div className="ui-pills">
            {PRESET_ROUNDS.map(r => (
              <button
                key={r}
                onClick={() => { gameAudio.playUiClick(); setRounds(r); setCustomRounds('') }}
                className={`ui-pill ${rounds === r && !customRounds ? 'ui-pill--active' : ''}`}
              >{r}</button>
            ))}
            <button
              onClick={() => { gameAudio.playUiClick(); setRounds(0); setCustomRounds('') }}
              className={`ui-pill ${rounds === 0 && !customRounds ? 'ui-pill--active' : ''}`}
            >∞</button>
          </div>
          <input
            className="ui-ap-input"
            placeholder="Своё число…"
            value={customRounds}
            onChange={e => setCustomRounds(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        {/* Stop conditions */}
        <div className="ui-ap-section">
          <div className="ui-ap-section-label">УСЛОВИЯ ОСТАНОВКИ</div>
          <div className="ui-stop-conditions">
            <CheckRow label="При любом выигрыше"    checked={stopAnyWin}  onChange={setStopAnyWin} />
            <InputRow label="Если выигрыш превышает" value={stopWinOver}  onChange={setStopWinOver}  placeholder="сумма $" />
            <InputRow label="Если баланс вырос на"   value={stopBalUp}    onChange={setStopBalUp}    placeholder="сумма $" />
            <InputRow label="Если баланс упал на"    value={stopBalDown}  onChange={setStopBalDown}  placeholder="сумма $" />
          </div>
        </div>

        <button className="ui-ap-start-btn" onClick={handleStart} disabled={!canStart}>
          ЗАПУСТИТЬ АВТОСПИН
        </button>
      </div>
    </div>
  )
}

const CheckRow: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="ui-check-row">
    <div className={`ui-checkbox ${checked ? 'ui-checkbox--checked' : ''}`} onClick={() => { gameAudio.playUiClick(); onChange(!checked) }}>
      {checked && <span className="ui-checkbox-tick">✓</span>}
    </div>
    {label}
  </label>
)

const InputRow: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder: string }> = ({ label, value, onChange, placeholder }) => (
  <div className="ui-input-row">
    <span className="ui-input-row-label">{label}</span>
    <input
      className="ui-input-row-field"
      value={value}
      onChange={e => onChange(e.target.value.replace(/[^\d.]/g, ''))}
      placeholder={placeholder}
    />
  </div>
)
