import React, { useEffect, useRef } from 'react'
import { GameRenderer } from './GameRenderer'
import { useGameStore } from '../store/gameStore'

interface Props { width: number; height: number }

export const GameCanvas: React.FC<Props> = ({ width, height }) => {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<GameRenderer | null>(null)

  const phase  = useGameStore(s => s.phase)
  const events = useGameStore(s => s.events)
  const speed  = useGameStore(s => s.speed)

  // Mount / unmount
  // rAF delay: lets browser paint the canvas and attach a fresh WebGL context
  // before PIXI reads MAX_FRAGMENT_UNIFORM_VECTORS.
  // Also handles React StrictMode double-mount cleanly.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: GameRenderer | null = null
    const rafId = requestAnimationFrame(() => {
      if (!canvasRef.current) return
      try {
        renderer = new GameRenderer(canvas, width, height)
        rendererRef.current = renderer
      } catch (err) {
        console.error('[GameCanvas] renderer init failed:', err)
      }
    })

    return () => {
      cancelAnimationFrame(rafId)
      if (renderer) {
        renderer.destroy()
        renderer = null
      }
      rendererRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Start round when events arrive
  useEffect(() => {
    if (phase === 'RUNNING' && events.length > 0 && rendererRef.current) {
      rendererRef.current.startRound(events, speed)
    }
  }, [phase, events]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resize
  useEffect(() => {
    if (rendererRef.current && width > 0 && height > 0) {
      rendererRef.current.resize(width, height)
    }
  }, [width, height])

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block', position: 'absolute', inset: 0,
        width: '100%', height: '100%',
      }}
    />
  )
}