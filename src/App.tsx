import React, { useEffect, useRef, useState } from 'react'
import { GameCanvas }      from './game/GameCanvas'
import { Hud }             from './ui/hud/Hud'
import { DigButton }       from './ui/controls/DigButton'
import { TopBar }          from './ui/controls/TopBar'
import { ResultOverlay }   from './ui/modals/ResultOverlay'
import { AutoplayModal }   from './ui/modals/AutoplayModal'
import { BurgerMenu }      from './ui/menus/BurgerMenu'
import { ErrorScreen }     from './ui/modals/ErrorScreen'
import { useGameStore }    from './store/gameStore'
import { shallow }         from 'zustand/shallow'
import { gameAudio }       from './audio/GameAudio'
import { useWindowSize }   from './hooks/useWindowSize'
import { gameEngine }      from './game/GameEngine'
import { addReplayRound }  from './ui/menus/InfoAndReplay'
import { toDisplay, isReplayMode, getReplayParams, fetchReplay, isDemo, type ReplayParams } from './rgs/client'
import './ui/ui.css'

// Import Bebas Neue from Google Fonts
const fontLink = document.createElement('link')
fontLink.rel  = 'stylesheet'
fontLink.href = 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@300;400;600;700&display=swap'
document.head.appendChild(fontLink)

export const App: React.FC = () => {
  const { width, height } = useWindowSize()
  const phase    = useGameStore(s => s.phase)
  const settings = useGameStore(s => s.settings, shallow)
  const prevPhase = useRef<string>('')
  
  const [replayLoading, setReplayLoading] = useState(false)
  const [replayError, setReplayError] = useState<string | null>(null)
  const [replayReady, setReplayReady] = useState(false)

  // ── Bet Replay Mode ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isReplayMode()) return
    
    const loadReplay = async () => {
      setReplayLoading(true)
      try {
        const params = getReplayParams()
        if (!params) {
          setReplayError('Invalid replay parameters')
          return
        }
        
        // Fetch replay from RGS (or fail gracefully)
        const replayData = await fetchReplay(params)
        
        // Set the game store with replay data
        const store = useGameStore.getState()
        store.setEvents(replayData.state, `replay-${params.event}`)
        store.setPhase('IDLE')
        store.setBet(toDisplay(params.amount))
        
        // Calculate win amount from payout multiplier
        const win = params.amount * replayData.payoutMultiplier / 1000000
        store.setLastWin(win)
        
        setReplayReady(true)
      } catch (err) {
        console.error('[Replay] Failed to load:', err)
        setReplayError('Failed to load replay data')
      } finally {
        setReplayLoading(false)
      }
    }
    
    loadReplay()
  }, [])

  // ── Replay play button handler ───────────────────────────────────────────
  const handleReplayPlay = () => {
    const store = useGameStore.getState()
    if (store.events.length > 0) {
      store.setPhase('RUNNING')
    }
  }

  // ── Replay Play Again ─────────────────────────────────────────────────
  const handleReplayAgain = () => {
    setReplayReady(false)
    const store = useGameStore.getState()
    store.setPhase('IDLE')
    // Reload current event
    if (isReplayMode()) {
      const params = getReplayParams()
      if (params) {
        fetchReplay(params).then(data => {
          store.setEvents(data.state, `replay-${params.event}`)
          store.setPhase('IDLE')
          setReplayReady(true)
        })
      }
    }
  }

  // ── Normal boot (not replay mode) ────────────────────────────────────────
  useEffect(() => {
    if (!isReplayMode()) {
      gameEngine.boot()
    }
  }, [])

  useEffect(() => {
    gameAudio.syncPhase(phase)
  }, [phase])

  useEffect(() => {
    gameAudio.refreshFromStore()
  }, [settings])

  // ── Record round history for Bet Replay ─────────────────────────────────────
  useEffect(() => {
    const prev = prevPhase.current
    prevPhase.current = phase

    if ((phase === 'WIN' || phase === 'LOSE') && prev === 'RUNNING') {
      const store     = useGameStore.getState()
      const balAfterDisplay  = toDisplay(store.balance)
      const bet       = store.bet
      const win       = store.lastWin
      const profit    = win - bet

      addReplayRound({
        time:      new Date().toLocaleTimeString(),
        bet,
        win,
        profit,
        balBefore: balAfterDisplay - profit,
        balAfter:  balAfterDisplay,
        currency:  store.currency,
      })
    }
  }, [phase])

  // ── Error state ────────────────────────────────────────────────────────────────
  if (phase === 'ERROR' || replayError) return (
    <div style={{
      position: 'relative',
      width, height,
      overflow: 'hidden',
      background: '#1A0E08',
      fontFamily: "'Barlow', sans-serif",
    }}>
      <ErrorScreen />
    </div>
  )

  // ── Replay loading state ──────────────────────────────────────────────────
  if (isReplayMode() && replayLoading) return (
    <div style={{
      position: 'relative',
      width, height,
      overflow: 'hidden',
      background: '#1A0E08',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Barlow', sans-serif",
    }}>
      <div className="ui-boot">
        <div className="ui-boot-spinner" />
        <div className="ui-boot-title">Loading Replay...</div>
      </div>
    </div>
  )

  // ── Replay mode UI ───────────────────────────────────────────────────────────
  if (isReplayMode() && replayReady && !replayLoading) {
    const replayParams = getReplayParams()
    const store = useGameStore.getState()
    const win = store.lastWin
    const bet = store.bet
    
    return (
      <div style={{
        position: 'relative',
        width, height,
        overflow: 'hidden',
        background: '#1A0E08',
        fontFamily: "'Barlow', sans-serif",
      }}>
        <GameCanvas width={width} height={height} />
        
        {/* Replay UI overlay */}
        <div style={{
          position: 'absolute',
          top: 20,
          left: 20,
          color: '#fff',
          fontSize: 14,
        }}>
          <div style={{ marginBottom: 8, opacity: 0.7 }}>REPLAY</div>
          <div>Event ID: {replayParams?.event}</div>
          <div>Mode: {replayParams?.mode}</div>
        </div>
        
        {/* Replay results */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          color: '#fff',
        }}>
          <div style={{ fontSize: 48, fontFamily: "'Bebas Neue', sans-serif", marginBottom: 10 }}>
            {win > 0 ? `+$${win.toFixed(2)}` : '$0.00'}
          </div>
          <div style={{ fontSize: 18, opacity: 0.7, marginBottom: 20 }}>
            Bet: ${bet.toFixed(2)} | Multiplier: {replayParams ? (win / bet).toFixed(1) : 0}x
          </div>
          
          {/* Play Again button */}
          <button
            onClick={handleReplayAgain}
            style={{
              padding: '12px 32px',
              fontSize: 18,
              fontFamily: "'Bebas Neue', sans-serif",
              background: '#E6A23C',
              border: 'none',
              borderRadius: 4,
              color: '#1A0E08',
              cursor: 'pointer',
              marginRight: 10,
            }}
          >
            PLAY AGAIN
          </button>
          
          {/* Start Replay (for initial load) */}
          {phase === 'IDLE' && (
            <button
              onClick={handleReplayPlay}
              style={{
                padding: '12px 32px',
                fontSize: 18,
                fontFamily: "'Bebas Neue', sans-serif",
                background: '#E6A23C',
                border: 'none',
                borderRadius: 4,
                color: '#1A0E08',
                cursor: 'pointer',
              }}
            >
              PLAY
            </button>
          )}
        </div>
        
        {/* Disable balance display in replay mode - show win info instead */}
      </div>
    )
  }

  return (
    <div style={{
      position: 'relative',
      width, height,
      overflow: 'hidden',
      background: '#1A0E08',
      fontFamily: "'Barlow', sans-serif",
    }}>
      {/* ── PixiJS canvas ── */}
      <GameCanvas width={width} height={height} />

      {/* ── HUD (bottom bar) ── */}
      <Hud />

{/* ── DIG button + Autoplay button ── */}
      <DigButton />

      {/* ── Top-right controls ── */}
      <TopBar />

      {/* ── Overlays ── */}
      <ResultOverlay />
      <AutoplayModal />
      <BurgerMenu />

      {/* ── Boot loading spinner ── */}
      {phase === 'BOOT' && (
        <div className="ui-boot">
          <div className="ui-boot-spinner" />
          <div className="ui-boot-title">DEEP RUSH</div>
        </div>
      )}
    </div>
  )
}
