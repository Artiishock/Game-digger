import React, { useRef } from 'react'
import { useGameStore } from '../../store/gameStore'
import '../ui.css'

export const SettingsPanel: React.FC = () => {
  const settings = useGameStore(s => s.settings)
  const upd      = useGameStore(s => s.updateSettings)

  return (
    <div className="sys-settings">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="sys-settings-header">
        <h2 className="sys-settings-title">SYSTEM SETTING</h2>
      </div>

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="sys-settings-body">

        {/* Left column */}
        <div className="sys-settings-left">

          {/* High quality checkbox */}
          <div className="sys-settings-check-row">
            <Checkbox
              checked={settings.highQuality}
              onChange={v => upd({ highQuality: v })}
            />
            <span className="sys-settings-check-label">HIGH QUALITY</span>
          </div>

          {/* SFX Slider */}
          <div className="sys-settings-slider-row">
            <span className="sys-settings-slider-icon">🔊</span>
            <SysSlider
              value={settings.sfxVolume}
              onChange={v => upd({ sfxVolume: v })}
            />
            <span className="sys-settings-slider-val">
              {Math.round(settings.sfxVolume * 100)}
            </span>
          </div>

          {/* Music Slider */}
          <div className="sys-settings-slider-row">
            <span className="sys-settings-slider-icon">🎵</span>
            <SysSlider
              value={settings.musicVolume}
              onChange={v => upd({ musicVolume: v })}
            />
            <span className="sys-settings-slider-val">
              {Math.round(settings.musicVolume * 100)}
            </span>
          </div>
        </div>

        {/* Right column */}
        <div className="sys-settings-right">

          <div className="sys-settings-toggle-item">
            <div>
              <div className="sys-settings-toggle-title">BATTERY SAVER</div>
              <div className="sys-settings-toggle-desc">
                Save battery life by reducing animation speed
              </div>
            </div>
            <SysToggle
              checked={!!settings.batterySaver}
              onChange={v => upd({ batterySaver: v } as any)}
            />
          </div>

          <div className="sys-settings-toggle-item">
            <div>
              <div className="sys-settings-toggle-title">INTRO SCREEN</div>
              <div className="sys-settings-toggle-desc">
                Show the intro screen before starting the game
              </div>
            </div>
            <SysToggle
              checked={!!settings.introScreen}
              onChange={v => upd({ introScreen: v } as any)}
            />
          </div>

        </div>
      </div>
    </div>
  )
}

/* ── Sub-components ──────────────────────────────────────────────────────── */

const Checkbox: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <div
    className={`sys-checkbox ${checked ? 'sys-checkbox--on' : ''}`}
    onClick={() => onChange(!checked)}
  />
)

const SysToggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <div
    className={`sys-toggle ${checked ? 'sys-toggle--on' : ''}`}
    onClick={() => onChange(!checked)}
  >
    <div className="sys-toggle-knob" />
  </div>
)

const SysSlider: React.FC<{ value: number; onChange: (v: number) => void }> = ({ value, onChange }) => {
  const trackRef = useRef<HTMLDivElement>(null)

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onChange(ratio)
  }

  return (
    <div className="sys-slider-track" ref={trackRef} onClick={handleClick}>
      <div className="sys-slider-fill" style={{ width: `${value * 100}%` }} />
      <div className="sys-slider-thumb" style={{ left: `${value * 100}%` }} />
    </div>
  )
}