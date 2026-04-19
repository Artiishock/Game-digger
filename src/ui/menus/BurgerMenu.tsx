import React from 'react'
import { useGameStore } from '../../store/gameStore'
import { SettingsPanel } from './SettingsPanel'
import { InfoPanel, ReplayPanel } from './InfoAndReplay'
import '../ui.css'

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
    <div className="ui-overlay" onClick={() => setOpen(false)}>
      <div className="ui-modal" onClick={e => e.stopPropagation()}>

        <div className="ui-modal-header">
          <span className="ui-modal-title">⛏ DEEP RUSH</span>
          <button className="ui-modal-close" onClick={() => setOpen(false)}>✕</button>
        </div>

        <div className="ui-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`ui-tab ${tab === t.id ? 'ui-tab--active' : ''}`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="ui-modal-divider" />

        <div className="ui-modal-body">
          {tab === 'settings' && <SettingsPanel />}
          {tab === 'info'     && <InfoPanel />}
          {tab === 'replay'   && <ReplayPanel />}
        </div>

        {phase === 'RUNNING' && (
          <div className="ui-modal-footer">
            Игра приостановлена пока открыто меню
          </div>
        )}
      </div>
    </div>
  )
}
