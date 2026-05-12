import React, { useEffect, useRef, useState } from 'react'
import { t, T } from '../../i18n/t'
import { useGameStore, type SettingsState } from '../../store/gameStore'
import { gameAudio } from '../../audio/GameAudio'
import { resolvePublicUrl } from '../../utils/publicUrl'
import '../ui.css'

export const SettingsPanel: React.FC = () => {
  const settings = useGameStore(s => s.settings)
  const upd      = useGameStore(s => s.updateSettings)
  const toggleMasterSound = useGameStore(s => s.toggleMasterSound)

  const setSfxVol = (v: number) => {
    const s = useGameStore.getState().settings
    const patch: Partial<SettingsState> = { sfxVolume: v }
    if (!s.soundEnabled && v > 0) {
      patch.soundEnabled = true
      patch.muteVolumeSnapshot = null
    }
    upd(patch)
  }

  const setMusicVol = (v: number) => {
    const s = useGameStore.getState().settings
    const patch: Partial<SettingsState> = { musicVolume: v }
    if (!s.soundEnabled && v > 0) {
      patch.soundEnabled = true
      patch.muteVolumeSnapshot = null
    }
    upd(patch)
  }

  return (
    <div className="sys-settings">
      <div className="sys-settings-section">
        <div className="sys-settings-toggle-item">
          <div>
            <div className="sys-settings-toggle-title">{T('music')}</div>
            <div className="sys-settings-toggle-desc">{t('music desc')}</div>
          </div>
          <SysToggle
            checked={settings.soundEnabled}
            onChange={() => toggleMasterSound()}
          />
        </div>

        <div className="sys-settings-slider-row">
          <span className="sys-settings-slider-icon"><img src={resolvePublicUrl("ui/sound_icon.svg")} alt="" className="sys-settings-slider-icon" /></span>
          <SysSlider
            value={settings.sfxVolume}
            onChange={setSfxVol}
          />
          <span className="sys-settings-slider-val">
            {Math.round(settings.sfxVolume * 100)}
          </span>
        </div>

        <div className="sys-settings-slider-row">
          <span className="sys-settings-slider-icon"><img src={resolvePublicUrl("ui/music-icon.svg")} alt="" className="sys-settings-slider-icon" /></span>
          <SysSlider
            value={settings.musicVolume}
            onChange={setMusicVol}
          />
          <span className="sys-settings-slider-val">
            {Math.round(settings.musicVolume * 100)}
          </span>
        </div>
      </div>

      <div className="sys-settings-section">
        <div className="sys-settings-toggle-item">
          <div>
            <div className="sys-settings-toggle-title">{T('battery saver')}</div>
            <div className="sys-settings-toggle-desc">
              {t('battery saver desc')}
            </div>
          </div>
          <SysToggle
            checked={!!settings.batterySaver}
            onChange={v => upd({ batterySaver: v } as any)}
          />
        </div>

        <div className="sys-settings-toggle-item">
          <div>
            <div className="sys-settings-toggle-title">{T('depth hud')}</div>
            <div className="sys-settings-toggle-desc">
              {t('depth hud desc')}
            </div>
          </div>
          <SysToggle
            checked={!!settings.showDepthHud}
            onChange={v => upd({ showDepthHud: v })}
          />
        </div>

        <div className="sys-settings-toggle-item">
          <div>
            <div className="sys-settings-toggle-title">{T('enable space')}</div>
            <div className="sys-settings-toggle-desc">{t('enable space desc')}</div>
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
  const [isDragging, setIsDragging] = useState(false)
  const [localValue, setLocalValue] = useState(value)
  const isDraggingRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const latestValueRef = useRef(value)

  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(value)
      latestValueRef.current = value
    }
  }, [value])

  const getValueFromClientX = (clientX: number) => {
    if (!trackRef.current) return latestValueRef.current

    const rect = trackRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  const commitValue = (nextValue: number) => {
    latestValueRef.current = nextValue
    setLocalValue(nextValue)

    if (rafRef.current !== null) return

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      onChange(latestValueRef.current)
    })
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()

    trackRef.current?.setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    setIsDragging(true)

    gameAudio.playUiSlide()
    commitValue(getValueFromClientX(e.clientX))
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    commitValue(getValueFromClientX(e.clientX))
  }

  const stopDragging = (e: React.PointerEvent<HTMLDivElement>) => {
    if (trackRef.current?.hasPointerCapture(e.pointerId)) {
      trackRef.current.releasePointerCapture(e.pointerId)
    }

    isDraggingRef.current = false
    setIsDragging(false)
    onChange(latestValueRef.current)
  }

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  const displayValue = isDragging ? localValue : value

  return (
    <div
      className={`sys-slider-track ${isDragging ? 'sys-slider-track--dragging' : ''}`}
      ref={trackRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
    >
      <div className="sys-slider-fill" style={{ width: `${displayValue * 100}%` }} />
      <div className="sys-slider-thumb" style={{ left: `${displayValue * 100}%` }} />
    </div>
  )
}
