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
import type { AutoplayConfig, GamePhase } from '../store/gameStore'
import * as RGS from '../rgs/client'
import * as Demo from '../rgs/demo'
import { GameConfig } from './GameConfig'
import { GameLogger } from '../dev/GameLogger'

class GameEngine {
  private static _instance: GameEngine
  private _abortAutoplay = false
  /** Колбэк рендерера: мгновенно завершить раунд по полной дорожке RGS (повторный Spin). */
  private _rendererInstantFinish: (() => Promise<void>) | null = null

  private _setPhase(store: ReturnType<typeof useGameStore.getState>, phase: GamePhase): void {
    GameLogger.phaseChange(useGameStore.getState().phase, phase)
    store.setPhase(phase)
  }

  static get instance(): GameEngine {
    if (!this._instance) this._instance = new GameEngine()
    return this._instance
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────

  async boot(): Promise<void> {
    const store = useGameStore.getState()
    this._setPhase(store, 'BOOT')

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

      this._setPhase(store, 'IDLE')

    } catch (err) {
      console.error('[GameEngine] boot error:', err)
      if (err instanceof RGS.RgsError) {
        // Fallback to demo on auth failure in dev
        if (import.meta.env.DEV) {
          const auth = await Demo.demoAuthenticate()
          store.setBalance(auth.balance.amount)
          store.setCurrency('FUN')
          store.setConfig(auth.config)
          this._setPhase(store, 'IDLE')
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

  startReplay(events: RGS.RoundEvent[], worldSeed: number): void {
    const store = useGameStore.getState()
    if (store.phase === 'BETTING' || store.phase === 'RUNNING') return
    store.setMenuOpen(false)
    store.setWorldSeed(worldSeed)
    store.setReplayMode(true)
    store.resetStats()
    store.setEvents(events, store.roundID)
    this._setPhase(store, 'RUNNING')
  }

  /** Регистрируется из `GameCanvas` при создании `GameRenderer`. */
  setRendererInstantFinish(fn: (() => Promise<void>) | null): void {
    this._rendererInstantFinish = fn
  }

  /**
   * Во время RUNNING: сразу завершить раунд так, будто собраны все предметы
   * по текущей дорожке RGS (итог HOME/LAVA и множитель — из полной цепочки событий).
   */
  async instantFinishRound(): Promise<void> {
    const store = useGameStore.getState()
    if (store.phase !== 'RUNNING') return
    if (store.autoplay.active) return
    await this._rendererInstantFinish?.()
  }

  async startRound(): Promise<void> {
    let store = useGameStore.getState()
    if (store.phase === 'BETTING' || store.phase === 'RUNNING') return

    performance.mark('dr-round-click')
    // Один кадр перед BETTING: на тач-устройствах иначе иногда «съедается» жест вместе с обновлением React.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    store = useGameStore.getState()
    if (store.phase === 'BETTING' || store.phase === 'RUNNING') return

    this._setPhase(store, 'BETTING')
    store.resetStats()

    const bet = store.bet

    try {
      performance.mark('dr-rgs-start')
      const response = await this._playWithRecovery(bet)
      performance.mark('dr-rgs-end')
      performance.measure('[DR] RGS /play', 'dr-rgs-start', 'dr-rgs-end')

      store.setBalance(response.balance?.amount ?? 0)
      const evs = response.round?.events ?? []
      if (evs.length === 0) {
        console.error('[GameEngine] play returned empty events; raw response:', response)
        throw new RGS.RgsError('ERR_GEN')
      }
      store.setEvents(evs, response.round?.roundID ?? '')
      performance.mark('dr-phase-running')
      this._setPhase(store, 'RUNNING')

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

    if (store.replayMode) {
      if (won) {
        store.setLastWin(RGS.toDisplay(Math.round(bet * multiplier * RGS.MONEY_SCALE)))
        store.setLastWinMult(multiplier)
        this._setPhase(store, 'WIN')
      } else {
        store.setLastWin(0)
        this._setPhase(store, 'LOSE')
      }
      return
    }

    try {
      let newBalance: number
      /** В demo выплата считается из base_coeff математики; экран WIN тоже показывает этот множитель. */
      let displayMult = multiplier
      /** Баланс до зачисления выплаты — для lastWin без float-ошибок bet×mult. */
      const balanceBeforePayout = store.balance

      if (RGS.isDemo()) {
        const coeffSnap = Demo.peekPendingBaseCoeff()
        const res = await Demo.demoEndRound(bet, won ? multiplier : 0)
        newBalance = res.balance.amount
        if (won && coeffSnap > 0) displayMult = coeffSnap
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

      let creditedWinDisplay = 0
      if (won) {
        const winApi = newBalance - balanceBeforePayout
        creditedWinDisplay = RGS.toDisplay(winApi)
        store.setLastWin(creditedWinDisplay)
        store.setLastWinMult(displayMult)
        this._setPhase(store, 'WIN')
      } else {
        store.setLastWin(0)
        this._setPhase(store, 'LOSE')
      }

      // ── Autoplay continuation ──────────────────────────────────────────────
      const ap = store.autoplay
      if (ap.active && !this._abortAutoplay) {
        const shouldStop = this._shouldStopAutoplay(ap, creditedWinDisplay, newBalance)
        const isLastRound = !ap.infinite && ap.remainingRounds <= 1
        if (shouldStop || isLastRound) {
          store.setAutoplay({ active: false, remainingRounds: 0, infinite: false })
        } else {
          if (!ap.infinite) {
            store.decrementAutoplay()
          }
          setTimeout(() => this.startRound(), GameConfig.round.autoplayDelayMs)
        }
      }

    } catch (err) {
      this._handleRgsError(err)
    }
  }

  // ─── Autoplay ──────────────────────────────────────────────────────────────

  startAutoplay(
    cfg: Pick<
      AutoplayConfig,
      | 'totalRounds'
      | 'stopOnAnyWin'
      | 'stopIfSingleWinExceeds'
      | 'stopIfBalanceIncreasesBy'
      | 'stopIfBalanceDecreasesBy'
    > & { infinite?: boolean }
  ): void {
    const store = useGameStore.getState()
    this._abortAutoplay = false
    const infinite = cfg.infinite === true
    const total = infinite ? 0 : cfg.totalRounds
    const remaining = infinite ? 0 : cfg.totalRounds
    store.setAutoplay({
      active:           true,
      infinite,
      totalRounds:      total,
      remainingRounds:  remaining,
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
    store.setAutoplay({ active: false, remainingRounds: 0, infinite: false })
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
        this._setPhase(store, 'IDLE')
        console.warn('[GameEngine] RGS error:', err.code, msg)
      }
    } else {
      this._setPhase(store, 'IDLE')
      console.error('[GameEngine] Unknown error:', err)
    }
  }
}

export const gameEngine = GameEngine.instance
