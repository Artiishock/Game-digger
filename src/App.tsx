import React, { useEffect, useRef } from 'react'
import { GameCanvas }      from './game/GameCanvas'
import { Hud }             from './ui/hud/Hud'
import { BetControls }     from './ui/controls/BetControls'
import { DigButton }       from './ui/controls/DigButton'
import { TopBar }          from './ui/controls/TopBar'
import { ResultOverlay }   from './ui/modals/ResultOverlay'
import { AutoplayModal }   from './ui/modals/AutoplayModal'
import { BurgerMenu }      from './ui/menus/BurgerMenu'
import { ErrorScreen }     from './ui/modals/ErrorScreen'
import { useGameStore }    from './store/gameStore'
import { useWindowSize }   from './hooks/useWindowSize'
import { gameEngine }      from './game/GameEngine'
import { addReplayRound }  from './ui/menus/InfoAndReplay'
import { toDisplay }       from './rgs/client'

// Import Bebas Neue from Google Fonts
const fontLink = document.createElement('link')
fontLink.rel  = 'stylesheet'
fontLink.href = 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@300;400;600;700&display=swap'
document.head.appendChild(fontLink)

export const App: React.FC = () => {
  const { width, height } = useWindowSize()
  const phase    = useGameStore(s => s.phase)
  const prevPhase = useRef<string>('')

  // ── Boot ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    gameEngine.boot()
  }, [])

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

  if (phase === 'ERROR') return <ErrorScreen />

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

      {/* ── Bet controls ── */}
      <BetControls />

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
        <div style={{
          position: 'absolute', inset: 0, zIndex: 300,
          background: '#1A0E08',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 20,
        }}>
          <div style={{
            width: 56, height: 56,
            border: '4px solid rgba(255,184,48,0.2)',
            borderTopColor: '#FFB830',
            borderRadius: '50%',
            animation: 'spin 0.9s linear infinite',
          }} />
          <div style={{
            fontFamily: 'Bebas Neue, sans-serif',
            fontSize: 32, color: '#FFB830',
            letterSpacing: '.1em',
          }}>
            DEEP RUSH
          </div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
    </div>
  )
}
