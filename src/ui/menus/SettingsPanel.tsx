import React from 'react'
import { useGameStore } from '../../store/gameStore'

export const SettingsPanel: React.FC = () => {
  const settings = useGameStore(s => s.settings)
  const upd      = useGameStore(s => s.updateSettings)

  const reset = () => upd({ digBtnSize: 1, digBtnOpacity: 1, digBtnX: 0.88, digBtnY: 0.75 })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* High quality */}
      <Row label="ВЫСОКОЕ КАЧЕСТВО">
        <Toggle checked={settings.highQuality} onChange={v => upd({ highQuality: v })} />
      </Row>

      {/* SFX volume */}
      <Row label="ЗВУКОВЫЕ ЭФФЕКТЫ">
        <Slider value={settings.sfxVolume} onChange={v => upd({ sfxVolume: v })} />
      </Row>

      {/* Music volume */}
      <Row label="МУЗЫКА">
        <Slider value={settings.musicVolume} onChange={v => upd({ musicVolume: v })} />
      </Row>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.07)' }} />

      {/* DIG button settings */}
      <Row label='РАЗМЕР КНОПКИ "DIG"'>
        <Slider value={(settings.digBtnSize - 0.5) / 1.0} onChange={v => upd({ digBtnSize: 0.5 + v })} />
      </Row>

      <Row label='ПРОЗРАЧНОСТЬ КНОПКИ "DIG"'>
        <Slider value={settings.digBtnOpacity} onChange={v => upd({ digBtnOpacity: v })} />
      </Row>

      <button onClick={reset} style={{
        padding: '10px 0', borderRadius: 10,
        border: '1.5px solid rgba(255,184,48,0.3)',
        background: 'transparent', color: '#FFB830',
        fontSize: 12, fontWeight: 700, letterSpacing: '.12em',
        textTransform: 'uppercase', cursor: 'pointer',
      }}>
        СБРОСИТЬ КНОПКУ DIG
      </button>

      <div style={{ fontSize: 11, color: 'rgba(240,230,211,0.35)', lineHeight: 1.5 }}>
        Кнопку DIG можно перетаскивать прямо на игровом экране.
      </div>
    </div>
  )
}

const Row: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <span style={{ fontSize: 10, letterSpacing: '.15em', textTransform: 'uppercase', color: 'rgba(240,230,211,0.45)', fontWeight: 600 }}>
      {label}
    </span>
    {children}
  </div>
)

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <div
    onClick={() => onChange(!checked)}
    style={{
      width: 44, height: 24, borderRadius: 12, cursor: 'pointer', position: 'relative',
      background: checked ? 'rgba(255,184,48,0.4)' : 'rgba(255,255,255,0.1)',
      border: `1.5px solid ${checked ? '#FFB830' : 'rgba(255,255,255,0.2)'}`,
      transition: 'all 0.2s',
    }}
  >
    <div style={{
      position: 'absolute', top: 2,
      left: checked ? 22 : 2,
      width: 16, height: 16, borderRadius: '50%',
      background: checked ? '#FFB830' : 'rgba(255,255,255,0.4)',
      transition: 'left 0.2s',
    }} />
  </div>
)

const Slider: React.FC<{ value: number; onChange: (v: number) => void }> = ({ value, onChange }) => (
  <input
    type="range" min={0} max={1} step={0.01}
    value={value}
    onChange={e => onChange(parseFloat(e.target.value))}
    style={{
      width: '100%', accentColor: '#FFB830',
      height: 4, cursor: 'pointer', appearance: 'auto',
    }}
  />
)
