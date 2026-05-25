import React, { useEffect, useRef } from 'react'
import { GameRenderer } from './GameRenderer'
import { gameEngine } from './GameEngine'
import { useGameStore } from '../store/gameStore'

interface Props {
  width: number;
  height: number;
  onReady?: () => void;
}

export const GameCanvas: React.FC<Props> = ({ width, height, onReady }) => {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<GameRenderer | null>(null)
  const startRafRef = useRef<number | null>(null)
  const onReadyRef  = useRef(onReady)

  const phase  = useGameStore(s => s.phase)
  const events = useGameStore(s => s.events)
  const speed  = useGameStore(s => s.speed)

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  // Mount / unmount
  // rAF delay: lets browser paint the canvas and attach a fresh WebGL context
  // before PIXI reads MAX_FRAGMENT_UNIFORM_VECTORS.
  // Also handles React StrictMode double-mount cleanly.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let renderer: GameRenderer | null = null
    let destroyed = false
    const rafId = requestAnimationFrame(() => {
      if (!canvasRef.current) return
      renderer = new GameRenderer(canvas, width, height)
      rendererRef.current = renderer
      gameEngine.setRendererInstantFinish(async () => renderer!.activateTurbo())
      renderer.ready
        .then(() => {
          if (!destroyed) onReadyRef.current?.()
        })
        .catch(err => {
          console.error('[GameCanvas] renderer init failed:', err)
        })
    })

    return () => {
      destroyed = true
      cancelAnimationFrame(rafId)
      if (startRafRef.current !== null) {
        cancelAnimationFrame(startRafRef.current)
        startRafRef.current = null
      }
      if (renderer) {
        renderer.destroy()
        renderer = null
      }
      gameEngine.setRendererInstantFinish(null)
      rendererRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Start round when events arrive — deferred one rAF so the browser can paint
  // the BETTING→RUNNING UI transition before startRound() blocks the main thread.
  // Replay mode uses a double rAF: the first frame lets the menu close animation
  // paint, the second frame runs the heavy startRound so there's no visible freeze.
  useEffect(() => {
    if (phase !== 'RUNNING' || events.length === 0) return
    const eventsSnap = events
    const speedSnap  = speed
    // Read replayMode at effect time (not as a reactive dep) to decide rAF count.
    const isReplay = useGameStore.getState().replayMode

    const runStart = () => {
      startRafRef.current = null
      performance.mark('dr-raf-fired')
      performance.measure('[DR] RUNNING→RAF (React repaint)', 'dr-phase-running', 'dr-raf-fired')
      rendererRef.current?.startRound(eventsSnap, speedSnap)
    }

    if (isReplay) {
      // Two frames: first lets the menu/overlay repaint, second starts the round.
      startRafRef.current = requestAnimationFrame(() => {
        requestAnimationFrame(runStart)
      })
    } else {
      startRafRef.current = requestAnimationFrame(runStart)
    }

    return () => {
      if (startRafRef.current !== null) {
        cancelAnimationFrame(startRafRef.current)
        startRafRef.current = null
      }
    }
  }, [phase, events]) // eslint-disable-line react-hooks/exhaustive-deps

  // Skip lava death cinematic on key / tap по игровому полю (не перехватываем UI — иначе гонки с кнопкой Spin на тач).
  useEffect(() => {
    const skip = () => { if (rendererRef.current?.skipLavaDeath()) gameEngine.markLavaDeathSkip() }
    const onKey = () => skip()
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target
      if (t instanceof Element) {
        if (t.closest('button, a[href], [role="button"], .ui-spin-control, .ui-hud, .ui-topright, .ui-depth-block, .ui-menu-modal, .ui-overlay, .ui-result, input, select, textarea, label')) {
          return
        }
      }
      const c = canvasRef.current
      if (!c) return
      if (t !== c && !(t instanceof Node && c.contains(t))) return
      skip()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

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
        background: '#1A0E08',
      }}
    />
  )
}
