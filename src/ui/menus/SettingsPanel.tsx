import React, { useRef } from 'react'
import { useGameStore } from '../../store/gameStore'
import { gameAudio } from '../../audio/GameAudio'
import '../ui.css'

export const SettingsPanel: React.FC = () => {
  const settings = useGameStore(s => s.settings)
  const upd      = useGameStore(s => s.updateSettings)

  return (
    <div className="sys-settings">
      <div className="sys-settings-section">
        <div className="sys-settings-toggle-item">
          <div>
            <div className="sys-settings-toggle-title"> MUSIC</div>
            <div className="sys-settings-toggle-desc">Turn off/on  music</div>
          </div>
          <SysToggle
            checked={settings.musicEnabled}
            onChange={v => upd({ musicEnabled: v })}
          />
        </div>

        <div className="sys-settings-slider-row">
          <span className="sys-settings-slider-icon"><img src="/ui/sound_icon.svg" alt="" className="sys-settings-slider-icon" /></span>
          <SysSlider
            value={settings.sfxVolume}
            onChange={v => upd({ sfxVolume: v })}
          />
          <span className="sys-settings-slider-val">
            {Math.round(settings.sfxVolume * 100)}
          </span>
        </div>

        <div className="sys-settings-slider-row">
          <span className="sys-settings-slider-icon"><img src="/ui/music-icon.svg" alt="" className="sys-settings-slider-icon" /></span>
          <SysSlider
            value={settings.musicVolume}
            onChange={v => upd({ musicVolume: v })}
          />
          <span className="sys-settings-slider-val">
            {Math.round(settings.musicVolume * 100)}
          </span>
        </div>
      </div>

      <div className="sys-settings-section">
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

        <div className="sys-settings-toggle-item">
          <div>
            <div className="sys-settings-toggle-title">ENABLE SPACE</div>
            <div className="sys-settings-toggle-desc">Press space bar to spin</div>
          </div>
          <SysToggle
            checked={settings.spaceEnabled}
            onChange={v => upd({ spaceEnabled: v })}
          />
        </div>
      </div>
    </div>
  )
}

/* ── Sub-components ──────────────────────────────────────────────────────── */

const Checkbox: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <div
    className={`sys-checkbox ${checked ? 'sys-checkbox--on' : ''}`}
    onClick={() => { gameAudio.playUiClick(); onChange(!checked) }}
  />
)

const SysToggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <div
    className={`sys-toggle ${checked ? 'sys-toggle--on' : ''}`}
    onClick={() => { gameAudio.playUiClick(); onChange(!checked) }}
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
    gameAudio.playUiSlide()
    onChange(ratio)
  }

  return (
    <div className="sys-slider-track" ref={trackRef} onClick={handleClick}>
      <div className="sys-slider-fill" style={{ width: `${value * 100}%` }} />
      <div className="sys-slider-thumb" style={{ left: `${value * 100}%` }} />
    </div>
  )
}