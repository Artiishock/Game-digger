import React from 'react'
import { useGameStore } from '../../store/gameStore'

export const TopBar: React.FC = () => {
  const settings  = useGameStore(s => s.settings)
  const upd       = useGameStore(s => s.updateSettings)
  const setMenu   = useGameStore(s => s.setMenuOpen)
  const menuOpen  = useGameStore(s => s.menuOpen)

  return (
    <div style={{
      position: 'absolute', top: 10, right: 12,
      display: 'flex', gap: 8, zIndex: 70,
    }}>
      {/* Sound toggle */}
      <button
        onClick={() => upd({ soundEnabled: !settings.soundEnabled })}
        style={topBtnStyle}
        title={settings.soundEnabled ? 'Выключить звук' : 'Включить звук'}
      >
        {settings.soundEnabled ? '🔊' : '🔇'}
      </button>

      {/* Burger */}
      <button
        onClick={() => setMenu(!menuOpen)}
        style={{ ...topBtnStyle, background: menuOpen ? 'rgba(255,184,48,0.2)' : 'rgba(15,8,3,0.82)' }}
        title="Меню"
      >
        ☰
      </button>
    </div>
  )
}

const topBtnStyle: React.CSSProperties = {
  width: 40, height: 40, borderRadius: 10,
  border: '1.5px solid rgba(255,255,255,0.14)',
  background: 'rgba(15,8,3,0.82)',
  color: '#F0E6D3', fontSize: 17, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  backdropFilter: 'blur(6px)',
  transition: 'background 0.15s',
}
