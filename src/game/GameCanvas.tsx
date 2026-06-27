import React, { useEffect, useRef } from 'react'
import { useErrorBoundary } from 'react-error-boundary'
import { GameRenderer } from './GameRenderer'
import { gameEngine } from './GameEngine'
import { useGameStore } from '../store/gameStore'

interface Props {
  width: number;
  height: number;
  onReady?: () => void;
}

export const GameCanvas: React.FC<Props> = ({ width, height, onReady }) => {
  const { showBoundary } = useErrorBoundary()
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<GameRenderer | null>(null)
  const startRafRef = useRef<number | null>(null)
  const onReadyRef  = useRef(onReady)
  const showBoundaryRef = useRef(showBoundary)
  const sizeRef = useRef({ width, height })

  const phase  = useGameStore(s => s.phase)
  const events = useGameStore(s => s.events)
  const speed  = useGameStore(s => s.speed)

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    showBoundaryRef.current = showBoundary
  }, [showBoundary])

  useEffect(() => {
    sizeRef.current = { width, height }
  }, [width, height])

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
      try {
        if (!canvasRef.current) return
        const { width: initialW, height: initialH } = sizeRef.current
        renderer = new GameRenderer(canvas, initialW, initialH, (error) => showBoundaryRef.current(error))
        rendererRef.current = renderer
        gameEngine.setRendererInstantFinish(async () => {
          if (!renderer) return
          await renderer.activateTurbo()
        })
        renderer.ready
          .then(() => {
            if (!destroyed) onReadyRef.current?.()
          })
          .catch(err => {
            console.error('[GameCanvas] renderer init failed:', err)
            if (!destroyed) showBoundaryRef.current(err)
          })
      } catch (err) {
        console.error('[GameCanvas] renderer create failed:', err)
        if (!destroyed) showBoundaryRef.current(err)
      }
    })

    return () => {
      destroyed = true
      cancelAnimationFrame(rafId)
      if (startRafRef.current !== null) {
        cancelAnimationFrame(startRafRef.current)
        startRafRef.current = null
      }
      try {
        renderer?.destroy()
      } catch (err) {
        console.error('[GameCanvas] renderer destroy failed:', err)
      } finally {
        renderer = null
        gameEngine.setRendererInstantFinish(null)
        rendererRef.current = null
      }
    }
  }, [])

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
      try {
        startRafRef.current = null
        performance.mark('dr-raf-fired')
        performance.measure('[DR] RUNNING→RAF (React repaint)', 'dr-phase-running', 'dr-raf-fired')
        rendererRef.current?.startRound(eventsSnap, speedSnap)
      } catch (err) {
        console.error('[GameCanvas] startRound failed:', err)
        showBoundary(err)
      }
    }

    if (isReplay) {
      // Two frames: first lets the menu/overlay repaint, second starts the round.
      startRafRef.current = requestAnimationFrame(() => {
        startRafRef.current = requestAnimationFrame(runStart)
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
  }, [phase, events, showBoundary]) // eslint-disable-line react-hooks/exhaustive-deps

  // Skip lava death cinematic on key / tap по игровому полю (не перехватываем UI — иначе гонки с кнопкой Spin на тач).
  useEffect(() => {
    const skip = () => {
      try {
        if (rendererRef.current?.skipLavaDeath()) gameEngine.markLavaDeathSkip()
      } catch (err) {
        console.error('[GameCanvas] skip lava death failed:', err)
        showBoundary(err)
      }
    }
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
  }, [showBoundary])

  // Resize
  useEffect(() => {
    if (rendererRef.current && width > 0 && height > 0) {
      try {
        rendererRef.current.resize(width, height)
      } catch (err) {
        console.error('[GameCanvas] resize failed:', err)
        showBoundary(err)
      }
    }
  }, [width, height, showBoundary])

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
