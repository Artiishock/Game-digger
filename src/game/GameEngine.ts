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
        auth = await RGS.authenticate()
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
        return
      }

      store.setPhase('IDLE')

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

  async startRound(): Promise<void> {
    const store = useGameStore.getState()
    if (store.phase === 'BETTING' || store.phase === 'RUNNING') return

    store.setPhase('BETTING')
    store.resetStats()

    const bet = store.bet

    try {
      let response: RGS.PlayResponse

      if (RGS.isDemo()) {
        response = await Demo.demoPlay(bet)
      } else {
        response = await RGS.play(bet)
      }

      store.setBalance(response.balance.amount)
      store.setEvents(response.round.events, response.round.roundID)
      store.setPhase('RUNNING')

    } catch (err) {
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

      if (RGS.isDemo() || this._forceDemoMode) {
        const demoRes = await Demo.demoEndRound(bet, won ? multiplier : 0)
        newBalance = demoRes.balance.amount
      } else {
        try {
          if (won && multiplier > 0) {
            const endRes = await RGS.endRound()
            newBalance = endRes.balance.amount
          } else {
            const bal = await RGS.getBalance()
            newBalance = bal.amount
          }
        } catch {
          console.warn('[GameEngine] RGS endRound failed, falling back to demo')
          this._forceDemoMode = true
          const demoRes = await Demo.demoEndRound(bet, won ? multiplier : 0)
          newBalance = demoRes.balance.amount
        }
      }

      store.setBalance(newBalance)

      if (won) {
        const winDisplay = RGS.toDisplay(Math.round(bet * multiplier * RGS.MONEY_SCALE))
        store.setLastWin(winDisplay)
        store.setPhase('WIN')
      } else {
        store.setLastWin(0)
        store.setPhase('LOSE')
      }

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
      } else {
        // Transient errors: go back to IDLE, show message briefly
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