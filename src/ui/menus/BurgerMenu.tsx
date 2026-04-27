import React from 'react'
import { useGameStore } from '../../store/gameStore'
import { SettingsPanel } from './SettingsPanel'
import { InfoPanel, ReplayPanel } from './InfoAndReplay'
import '../ui.css'
import infoIcon from '/ui/info.svg'
import historyIcon from '/ui/history.svg'
import settingsIcon from '/ui/settings.svg'
import cross from '/ui/cross.svg'

type Tab = 'settings' | 'info' | 'replay'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'info',     label: 'INFORMATION', icon: infoIcon },
  { id: 'replay',   label: 'HISTORY',     icon: historyIcon },
  { id: 'settings', label: 'SETTINGS',    icon: settingsIcon },
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
          <span className="ui-modal-title">SYSTEM SETTINGS</span>
          <button className="ui-modal-close" onClick={() => setOpen(false)}><img src={cross} alt="Close" className="sys-settings-slider-icon" /></button>
        </div>

        <div className="ui-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`ui-tab ${tab === t.id ? 'ui-tab--active' : ''}`}
            >
              <img className="ui-tab-icon" src={t.icon} alt="" aria-hidden="true" />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

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
