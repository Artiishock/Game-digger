import React from 'react'
import { useGameStore } from '../../store/gameStore'
import { SettingsPanel } from './SettingsPanel'
import { InfoPanel, ReplayPanel } from './InfoAndReplay'

type Tab = 'settings' | 'info' | 'replay'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'settings', label: 'Настройки', icon: '⚙️' },
  { id: 'info',     label: 'Инфо',      icon: 'ℹ️' },
  { id: 'replay',   label: 'История',   icon: '📋' },
]

export const BurgerMenu: React.FC = () => {
  const isOpen  = useGameStore(s => s.menuOpen)
  const tab     = useGameStore(s => s.menuTab)
  const setOpen = useGameStore(s => s.setMenuOpen)
  const setTab  = useGameStore(s => s.setMenuTab)
  const phase   = useGameStore(s => s.phase)

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={() => setOpen(false)}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'linear-gradient(160deg, #1e0f08 0%, #120803 100%)',
          border: '1px solid rgba(255,184,48,0.18)',
          borderRadius: 20, width: 420, maxWidth: '94vw',
          maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          color: '#F0E6D3', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px 0',
        }}>
          <span style={{
            fontFamily: 'Bebas Neue, sans-serif',
            fontSize: 28, letterSpacing: '.06em', color: '#FFB830',
          }}>
            ⛏ DEEP RUSH
          </span>
          <button onClick={() => setOpen(false)} style={{
            background: 'none', border: 'none',
            color: 'rgba(240,230,211,0.5)', fontSize: 20, cursor: 'pointer', padding: 4,
          }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', padding: '14px 22px 0', gap: 6 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: '9px 0',
                borderRadius: '10px 10px 0 0',
                border: 'none', cursor: 'pointer',
                background: tab === t.id ? 'rgba(255,184,48,0.12)' : 'transparent',
                borderBottom: `2px solid ${tab === t.id ? '#FFB830' : 'transparent'}`,
                color: tab === t.id ? '#FFB830' : 'rgba(240,230,211,0.45)',
                fontSize: 12, fontWeight: 700,
                letterSpacing: '.06em', textTransform: 'uppercase',
                transition: 'all 0.15s',
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(255,184,48,0.1)', margin: '0 22px' }} />

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px 24px' }}>
          {tab === 'settings' && <SettingsPanel />}
          {tab === 'info'     && <InfoPanel />}
          {tab === 'replay'   && <ReplayPanel />}
        </div>

        {/* Footer */}
        {phase === 'RUNNING' && (
          <div style={{
            padding: '10px 22px', fontSize: 11,
            color: 'rgba(240,230,211,0.35)', textAlign: 'center',
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}>
            Игра приостановлена пока открыто меню
          </div>
        )}
      </div>
    </div>
  )
}
