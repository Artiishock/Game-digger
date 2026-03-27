import React, { useRef, useState, useCallback } from 'react'
import { useGameStore } from '../../store/gameStore'
import { gameEngine } from '../../game/GameEngine'

export const DigButton: React.FC = () => {
  const phase       = useGameStore(s => s.phase)
  const settings    = useGameStore(s => s.settings)
  const autoplay    = useGameStore(s => s.autoplay)
  const setAP       = useGameStore(s => s.setAutoplayOpen)
  const isAPOpen    = useGameStore(s => s.autoplayOpen)

  const [pos, setPos]           = useState({ x: settings.digBtnX, y: settings.digBtnY })
  const dragRef                 = useRef<{ startX: number; startY: number; btnX: number; btnY: number; moved: boolean } | null>(null)

  const canDig      = phase === 'IDLE' || phase === 'WIN' || phase === 'LOSE'
  const isRunning   = phase === 'RUNNING' || phase === 'BETTING'
  const isAutoActive = autoplay.active

  // ── Drag-to-reposition ────────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      btnX: pos.x, btnY: pos.y,
      moved: false,
    }
  }, [pos])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return
    const dx = (e.clientX - dragRef.current.startX) / window.innerWidth
    const dy = (e.clientY - dragRef.current.startY) / window.innerHeight
    // Only start dragging after 5px movement to avoid eating clicks
    if (Math.abs(e.clientX - dragRef.current.startX) > 5 ||
        Math.abs(e.clientY - dragRef.current.startY) > 5) {
      dragRef.current.moved = true
    }
    if (dragRef.current.moved) {
      const nx = Math.max(0.05, Math.min(0.93, dragRef.current.btnX + dx))
      const ny = Math.max(0.05, Math.min(0.88, dragRef.current.btnY + dy))
      setPos({ x: nx, y: ny })
    }
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const wasDrag = dragRef.current?.moved ?? false
    dragRef.current = null
    // If it was NOT a drag → treat as a click
    if (!wasDrag) {
      if (isAutoActive) {
        gameEngine.stopAutoplay()
      } else if (canDig) {
        gameEngine.startRound()
      }
    }
  }, [canDig, isAutoActive])

  const SIZE = settings.digBtnSize * 80

  const label = isAutoActive
    ? `СТОП\n${autoplay.remainingRounds}`
    : isRunning ? '...' : '⛏ DIG'

  const bgColor = isAutoActive
    ? 'radial-gradient(circle at 35% 35%, #ff6b35, #cc2200)'
    : isRunning
    ? 'radial-gradient(circle at 35% 35%, #555, #333)'
    : 'radial-gradient(circle at 35% 35%, #FFD060, #cc7700)'

  const borderColor = isAutoActive ? '#ff4400' : isRunning ? '#666' : '#FFB830'

  return (
    <>
      {/* ── DIG button ── */}
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: 'absolute',
          left: `${pos.x * 100}%`,
          top:  `${pos.y * 100}%`,
          transform: 'translate(-50%, -50%)',
          zIndex: 60,
          opacity: settings.digBtnOpacity,
          touchAction: 'none',
          width: SIZE, height: SIZE,
          borderRadius: '50%',
          background: bgColor,
          border: `3px solid ${borderColor}`,
          boxShadow: (!isRunning || isAutoActive)
            ? `0 4px 24px ${isAutoActive ? 'rgba(255,80,0,0.5)' : 'rgba(255,160,0,0.45)'}`
            : 'none',
          color: '#fff',
          fontSize: Math.max(11, SIZE * 0.16),
          fontWeight: 900,
          cursor: (isRunning && !isAutoActive) ? 'not-allowed' : 'grab',
          letterSpacing: '0.04em',
          whiteSpace: 'pre-line',
          lineHeight: 1.2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'inherit',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          transition: 'background 0.15s, border-color 0.15s',
        }}
      >
        {label}
      </button>

      {/* ── Autoplay A button ── */}
      <button
        onClick={() => setAP(!isAPOpen)}
        style={{
          position: 'absolute', right: 56, bottom: 72,
          width: 36, height: 36, borderRadius: '50%',
          border: `2px solid ${isAutoActive ? '#FFB830' : 'rgba(255,255,255,0.2)'}`,
          background: isAutoActive ? 'rgba(255,184,48,0.2)' : 'rgba(15,8,3,0.85)',
          color: isAutoActive ? '#FFB830' : 'rgba(240,230,211,0.7)',
          fontSize: 14, fontWeight: 800, cursor: 'pointer', zIndex: 60,
          boxShadow: isAutoActive ? '0 0 10px rgba(255,184,48,0.4)' : 'none',
        }}
      >A</button>
    </>
  )
}