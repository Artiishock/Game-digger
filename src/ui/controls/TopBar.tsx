import React from 'react'
import { useGameStore } from '../../store/gameStore'
import '../ui.css'

export const TopBar: React.FC = () => {
  const settings = useGameStore(s => s.settings)
  const upd      = useGameStore(s => s.updateSettings)
  const setMenu  = useGameStore(s => s.setMenuOpen)
  const setTab   = useGameStore(s => s.setMenuTab)
  const phase    = useGameStore(s => s.phase)
  const lastWin  = useGameStore(s => s.lastWin)
  const currency = useGameStore(s => s.currency)
  const stats    = useGameStore(s => s.stats)

  const openTab = (tab: 'info' | 'settings') => { setTab(tab); setMenu(true) }

  return (
    <>
      {/* Logo */}
      <div className="ui-logo-zone">Logo zone</div>

      {/* DISTANCE / DEPTH — мобильный: под логотипом слева; десктоп: скрыт (показывается в ui-topright) */}
      <div className="ui-depth-block ui-depth-block--topleft">
        <div className="ui-depth-row">
          <span className="ui-depth-label">DISTANCE</span>
          <span className="ui-depth-value">{stats.distance.toFixed(2)} m</span>
        </div>
        <div className="ui-depth-row">
          <span className="ui-depth-label">DEPTH</span>
          <span className="ui-depth-value">{stats.depth.toFixed(2)} m</span>
        </div>
      </div>

      {/* WIN — в RUNNING показываем живой множитель (как растёт с монетами); после раунда — сумма выигрыша */}
      <div className="ui-win-zone">
        <span className="ui-win-label">WIN </span>
        <span className="ui-win-amount">
          {phase === 'RUNNING'
            ? `×${stats.multiplier.toFixed(2)}`
            : lastWin > 0
              ? `${lastWin.toFixed(2)} ${currency}`
              : `0.00 ${currency}`}
        </span>
      </div>

      {/* Top-right */}
      <div className="ui-topright">
        <div className="ui-icon-btns">
          <button className="ui-icon-btn" onClick={() => openTab('info')} title="Info">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="rgba(240,230,211,0.7)" strokeWidth="1.5"/>
              <rect x="7" y="7" width="2" height="5" rx="1" fill="rgba(240,230,211,0.7)"/>
              <circle cx="8" cy="4.5" r="1" fill="rgba(240,230,211,0.7)"/>
            </svg>
          </button>
          <button className="ui-icon-btn" onClick={() => openTab('settings')} title="Settings">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2.5" stroke="rgba(240,230,211,0.7)" strokeWidth="1.5"/>
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
                stroke="rgba(240,230,211,0.7)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <button
            className={`ui-icon-btn ${settings.soundEnabled ? 'ui-icon-btn--active' : ''}`}
            onClick={() => upd({ soundEnabled: !settings.soundEnabled })}
            title={settings.soundEnabled ? 'Mute' : 'Unmute'}
          >
            {settings.soundEnabled
              ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 6H6L10 3V13L6 10H3V6Z" stroke="rgba(240,230,211,0.7)" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M12 5C13.3 6 13.3 10 12 11" stroke="rgba(240,230,211,0.7)" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              : <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 6H6L10 3V13L6 10H3V6Z" stroke="rgba(240,230,211,0.4)" strokeWidth="1.5" strokeLinejoin="round"/>
                  <line x1="12" y1="5" x2="15" y2="11" stroke="rgba(240,230,211,0.4)" strokeWidth="1.5" strokeLinecap="round"/>
                  <line x1="15" y1="5" x2="12" y2="11" stroke="rgba(240,230,211,0.4)" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
            }
          </button>
        </div>

        {/* Depth block — десктоп (скрыт на мобильном через CSS) */}
        <div className="ui-depth-block ui-depth-block--desktop">
          <div className="ui-depth-row">
            <span className="ui-depth-label">DEPTH</span>
            <span className="ui-depth-value">{stats.depth.toFixed(1)} m</span>
          </div>
          <div className="ui-depth-row">
            <span className="ui-depth-label">DIST</span>
            <span className="ui-depth-value">{stats.distance.toFixed(1)} m</span>
          </div>
        </div>
      </div>
    </>
  )
}