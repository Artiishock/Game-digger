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

      // Если у игрока остался незакрытый раунд — закрываем его молча,
      // чтобы Stake не блокировал следующий /play с "player has active bet".
      if (auth.round?.isActive) {
        try {
          await RGS.endRound()
        } catch (e) {
          console.warn('[GameEngine] failed to close stale round:', e)
        }
        try {
          const fresh = await RGS.getBalance()
          store.setBalance(fresh.amount)
          store.setCurrency(fresh.currency)
        } catch { /* keep cached balance */ }
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
      const response = await this._playWithRecovery(bet)

      store.setBalance(response.balance?.amount ?? 0)
      const evs = response.round?.events ?? []
      if (evs.length === 0) {
        console.error('[GameEngine] play returned empty events; raw response:', response)
        throw new RGS.RgsError('ERR_GEN')
      }
      store.setEvents(evs, response.round?.roundID ?? '')
      store.setPhase('RUNNING')

    } catch (err) {
      this._handleRgsError(err)
    }
  }

  /**
   * Делает /play с одной попыткой восстановления: если RGS отвечает
   * "player has active bet" (ERR_VAL с висящим раундом), сначала
   * закрываем застрявший раунд через /end-round и пробуем play ещё раз.
   */
  private async _playWithRecovery(bet: number): Promise<RGS.PlayResponse> {
    const tryPlay = () => RGS.isDemo() ? Demo.demoPlay(bet) : RGS.play(bet)

    try {
      return await tryPlay()
    } catch (err) {
      const isStuckBet = err instanceof RGS.RgsError && err.code === 'ERR_VAL'
      if (!isStuckBet || RGS.isDemo()) throw err

      console.warn('[GameEngine] play hit ERR_VAL, attempting end-round recovery')
      try { await RGS.endRound() } catch (e2) {
        console.warn('[GameEngine] recovery end-round also failed:', e2)
      }
      return await tryPlay()
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

      if (RGS.isDemo()) {
        const res = await Demo.demoEndRound(bet, won ? multiplier : 0)
        newBalance = res.balance.amount
      } else {
        // Stake Engine: всегда закрываем раунд через /end-round, иначе
        // следующий /play получит "player has active bet". Если бэкенд
        // уже закрыл (auto_close), endRound вернёт ошибку — глотаем и
        // просто перечитываем баланс.
        try {
          const res = await RGS.endRound()
          newBalance = res.balance.amount
        } catch (e) {
          if (!(e instanceof RGS.RgsError && e.code === 'ERR_VAL')) {
            console.warn('[GameEngine] end-round failed:', e)
          }
          const bal = await RGS.getBalance()
          newBalance = bal.amount
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