/**
 * GameEngine — singleton that drives the game loop.
 *
 * Responsibilities:
 *  - Boot: authenticate with RGS (or Demo), load config
 *  - Per-round: place bet → stream events to renderer → end round
 *  - Autoplay: manage multi-round loop with stop conditions
 *  - Error handling: map RGS error codes to user messages
 */

import { useGameStore } from '../store/gameStore'
import { gameAudio } from '../audio/GameAudio'
import type { AutoplayConfig } from '../store/gameStore'
import * as RGS from '../rgs/client'
import * as Demo from '../rgs/demo'
import { GameConfig } from './GameConfig'

class GameEngine {
  private static _instance: GameEngine
  private _abortAutoplay = false
  private _forceDemoMode = false

  static get instance(): GameEngine {
    if (!this._instance) this._instance = new GameEngine()
    return this._instance
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────

  async boot(): Promise<void> {
    const store = useGameStore.getState()
    store.setPhase('BOOT')

    try {
      let auth: RGS.AuthResponse

      if (RGS.isDemo()) {
        auth = await Demo.demoAuthenticate()
      } else {
        // Try to end any orphan active round from previous session before authenticating
        try {
          auth = await RGS.authenticate()
        } catch (authErr) {
          // If auth fails with active bet, try to end it first
          if (authErr instanceof RGS.RgsError && authErr.code === 'ERR_VAL') {
            console.warn('[GameEngine] Orphan active bet detected, trying to close it...')
            await RGS.endRound()
            // Now retry auth
            auth = await RGS.authenticate()
          } else {
            throw authErr
          }
        }
      }

      store.setBalance(auth.balance.amount)
      store.setCurrency(auth.balance.currency)
      store.setConfig(auth.config)

      // Use server-defined default bet
      if (auth.config.defaultBetLevel) {
        store.setBet(RGS.toDisplay(auth.config.defaultBetLevel))
      }

      gameAudio.init()

      // Resume active round if disconnected mid-game
      if (auth.round?.isActive && auth.round.events.length > 0) {
        store.setEvents(auth.round.events, auth.round.roundID)
        store.setPhase('RUNNING')
        this._startRoundInProgress = true
        return
      }

      store.setPhase('IDLE')
      this._startRoundInProgress = false

    } catch (err) {
      console.error('[GameEngine] boot error:', err)
      if (err instanceof RGS.RgsError) {
        // Fallback to demo on auth failure in dev
        if (import.meta.env.DEV) {
          const auth = await Demo.demoAuthenticate()
          store.setBalance(auth.balance.amount)
          store.setCurrency('FUN')
          store.setConfig(auth.config)
          store.setPhase('IDLE')
          gameAudio.init()
        } else {
          store.setError(RGS.rgsErrorMessage(err.code))
        }
      } else {
        store.setError('Ошибка подключения к серверу')
      }
    }
  }

  // ─── Single round ──────────────────────────────────────────────────────────

  private _startRoundInProgress = false
  private _rgsRoundNeedsEnd = false
  private _lastRgsPayoutMultiplier = 0  // Save payout from RGS response

  async startRound(): Promise<void> {
    const store = useGameStore.getState()
    console.log('[GameEngine] startRound called, phase:', store.phase, 'inProgress:', this._startRoundInProgress, 'forceDemo:', this._forceDemoMode)
    
    // GUARD FIRST - absolutely prevent any double call
    if (this._startRoundInProgress) {
      console.warn('[GameEngine] startRound in progress - BLOCKED')
      return
    }
    this._startRoundInProgress = true
    
    // Then phase check
    if (store.phase !== 'IDLE' && store.phase !== 'WIN' && store.phase !== 'LOSE') {
      console.warn('[GameEngine] startRound called but phase is', store.phase, '- BLOCKING')
      this._startRoundInProgress = false
      return
    }

    store.setPhase('BETTING')
    store.resetStats()

    const bet = store.bet

    try {
      let response: RGS.PlayResponse

      // Check BOTH demo check AND force flag
      if (RGS.isDemo() || this._forceDemoMode) {
        response = await Demo.demoPlay(bet)
        store.setBalance(response.balance.amount)
        store.setEvents(response.round.events, response.round.roundID)
        store.setPhase('RUNNING')
      } else {
        response = await RGS.play(bet)
        const events = RGS.extractRgsEvents(response)
        this._rgsRoundNeedsEnd = RGS.roundNeedsEndRound(response)
        this._lastRgsPayoutMultiplier = RGS.getPayoutMultiplier(response)
        
        console.log('[GameEngine] RAW RGS response round:', JSON.stringify(response.round).substring(0, 500))
        console.log('[GameEngine] RGS response:', {
          payoutMultiplier: this._lastRgsPayoutMultiplier,
          active: response.round.active,
          hasEvents: !!events,
          firstEvent: events[0],
          needsEnd: this._rgsRoundNeedsEnd
        })
        
        // Guard: check if response has valid round data
        if (!events || events.length === 0) {
          console.error('[GameEngine] RGS play returned empty events, forcing demo')
          this._forceDemoMode = true
          this._startRoundInProgress = false
          response = await Demo.demoPlay(bet)
        }
        
        store.setBalance(response.balance.amount)
        store.setEvents(events, response.round.roundID || 'rgs-' + Date.now())
        store.setPhase('RUNNING')
      }

    } catch (err) {
      this._startRoundInProgress = false
      
      // If RGS returns ERR_VAL (active bet), try to close it first then retry
      if (err instanceof RGS.RgsError && err.code === 'ERR_VAL' && !this._forceDemoMode) {
        console.warn('[GameEngine] ERR_VAL on play - trying to close active bet...')
        try {
          const closeRes = await RGS.endRound()
          console.log('[GameEngine] Closed old bet, got balance:', closeRes.balance)
          store.setBalance(closeRes.balance.amount)
          console.log('[GameEngine] Closed old bet, retrying play...')
          // Retry play after closing
          const response = await RGS.play(store.bet)
          
          // Guard: check if response has valid round data
          if (!response.round || !response.round.events || response.round.events.length === 0) {
            console.error('[GameEngine] RGS play returned empty events, forcing demo')
            this._forceDemoMode = true
            throw new Error('Empty round events')
          }
          
          store.setBalance(response.balance.amount)
          store.setEvents(response.round.events, response.round.roundID)
          store.setPhase('RUNNING')
          this._startRoundInProgress = false
          return
        } catch (closeErr) {
          console.error('[GameEngine] Failed to close active bet:', closeErr)
        }
      }
      
      if (RGS.isDemo() || this._forceDemoMode) {
        this._handleRgsError(err)
        return
      }
      console.warn('[GameEngine] RGS play failed, falling back to demo:', err)
      this._forceDemoMode = true
      try {
        const response = await Demo.demoPlay(bet)
        store.setBalance(response.balance.amount)
        store.setEvents(response.round.events, response.round.roundID)
        store.setPhase('RUNNING')
      } catch (demoErr) {
        this._handleRgsError(demoErr)
      }
    }
    this._startRoundInProgress = false
  }

  /**
   * Called by the PixiJS renderer when the character reaches HOME or LAVA.
   * @param multiplier — final accumulated multiplier (0 on LAVA)
   * @param won        — true = HOME, false = LAVA
   */
  async onRoundComplete(multiplier: number, won: boolean): Promise<void> {
    const store = useGameStore.getState()
    const bet   = store.bet

    try {
      let newBalance: number

      // Only call endRound if the round was active (won) - losses auto-close
      if (RGS.isDemo() || this._forceDemoMode) {
        const demoRes = await Demo.demoEndRound(bet, won ? multiplier : 0)
        newBalance = demoRes.balance.amount
      } else if (this._rgsRoundNeedsEnd) {
        // Round was active - need to call end-round to get winnings
        let rgsEndRoundFailed = false
        try {
          console.log('[GameEngine] Calling RGS.endRound() (round was active)...')
          const endRes = await RGS.endRound()
          console.log('[GameEngine] RGS.endRound() response:', endRes)
          newBalance = endRes.balance.amount
        } catch (err) {
          console.error('[GameEngine] RGS endRound FAILED:', err)
          rgsEndRoundFailed = true
          this._forceDemoMode = true
          const demoRes = await Demo.demoEndRound(bet, won ? multiplier : 0)
          newBalance = demoRes.balance.amount
        }
      } else {
        // Round was NOT active (loss) - already settled, just get balance
        console.log('[GameEngine] Round was not active (loss), getting balance...')
        const bal = await RGS.getBalance()
        newBalance = bal.amount
      }

      this._rgsRoundNeedsEnd = false

      store.setBalance(newBalance)

      // Use RGS payout multiplier if available, otherwise use game-calculated
      const finalMultiplier = this._lastRgsPayoutMultiplier > 0 ? this._lastRgsPayoutMultiplier : multiplier
      
      if (won) {
        const winDisplay = Math.round(bet * finalMultiplier)
        store.setLastWin(winDisplay)
        store.setPhase('WIN')
      } else {
        store.setLastWin(0)
        store.setPhase('LOSE')
      }
      
      this._lastRgsPayoutMultiplier = 0

      // ── Autoplay continuation ──────────────────────────────────────────────
      const ap = store.autoplay
      if (ap.active && ap.remainingRounds > 0 && !this._abortAutoplay) {
        const winDisplay = won ? bet * multiplier : 0
        if (!this._shouldStopAutoplay(ap, winDisplay, newBalance)) {
          store.decrementAutoplay()
          setTimeout(() => this.startRound(), GameConfig.round.autoplayDelayMs)
        } else {
          store.setAutoplay({ active: false })
          store.setPhase('IDLE')
        }
      }

    } catch (err) {
      this._handleRgsError(err)
    }
  }

  // ─── Autoplay ──────────────────────────────────────────────────────────────

  startAutoplay(cfg: Pick<AutoplayConfig, 'totalRounds' | 'stopOnAnyWin' | 'stopIfSingleWinExceeds' | 'stopIfBalanceIncreasesBy' | 'stopIfBalanceDecreasesBy'>): void {
    const store = useGameStore.getState()
    this._abortAutoplay = false
    store.setAutoplay({
      active:           true,
      totalRounds:      cfg.totalRounds,
      remainingRounds:  cfg.totalRounds,
      stopOnAnyWin:     cfg.stopOnAnyWin,
      stopIfSingleWinExceeds:   cfg.stopIfSingleWinExceeds,
      stopIfBalanceIncreasesBy: cfg.stopIfBalanceIncreasesBy,
      stopIfBalanceDecreasesBy: cfg.stopIfBalanceDecreasesBy,
      balanceAtStart:   store.balance,
    })
    this.startRound()
  }

  stopAutoplay(): void {
    this._abortAutoplay = true
    const store = useGameStore.getState()
    store.setAutoplay({ active: false, remainingRounds: 0 })
  }

  private _shouldStopAutoplay(
    ap: AutoplayConfig,
    winDisplay: number,
    newBalance: number
  ): boolean {
    if (ap.stopOnAnyWin && winDisplay > 0) return true
    if (ap.stopIfSingleWinExceeds !== null && winDisplay > ap.stopIfSingleWinExceeds) return true
    if (ap.stopIfBalanceIncreasesBy !== null) {
      const delta = RGS.toDisplay(newBalance) - RGS.toDisplay(ap.balanceAtStart)
      if (delta >= ap.stopIfBalanceIncreasesBy) return true
    }
    if (ap.stopIfBalanceDecreasesBy !== null) {
      const delta = RGS.toDisplay(ap.balanceAtStart) - RGS.toDisplay(newBalance)
      if (delta >= ap.stopIfBalanceDecreasesBy) return true
    }
    return false
  }

  // ─── Error handling ────────────────────────────────────────────────────────

  private _handleRgsError(err: unknown): void {
    const store = useGameStore.getState()
    if (err instanceof RGS.RgsError) {
      const msg = RGS.rgsErrorMessage(err.code)
      if (err.code === 'ERR_IS' || err.code === 'ERR_ATE') {
        store.setError(msg + '. Обновите страницу.')
      } else if (err.code === 'ERR_VAL' || err.code.includes('active')) {
        console.error('[GameEngine] RGS active bet error - forcing demo mode')
        this._forceDemoMode = true
        store.setLastWin(0)
        store.setPhase('IDLE')
      } else {
        store.setLastWin(0)
        store.setPhase('IDLE')
        console.warn('[GameEngine] RGS error:', err.code, msg)
      }
    } else {
      store.setPhase('IDLE')
      console.error('[GameEngine] Unknown error:', err)
    }
  }
}

export const gameEngine = GameEngine.instance