import { createWithEqualityFn } from 'zustand/traditional'
import type { RgsConfig, RoundEvent } from '../rgs/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export type GamePhase =
  | 'BOOT'       // initial load / auth
  | 'IDLE'       // waiting for DIG press
  | 'BETTING'    // placing bet with RGS
  | 'RUNNING'    // character digging
  | 'WIN'        // HOME reached — show result
  | 'LOSE'       // LAVA: краткий переход, оверлей нет (сразу → IDLE)
  | 'ERROR'      // RGS or session error

export type SpeedMode = 0.75 | 1 | 2 | 5

export type VolatilityMode = 'low' | 'medium' | 'high'

const VOLATILITY_LS_KEY = 'dr_volatility'

function loadVolatility(): VolatilityMode {
  try {
    const v = localStorage.getItem(VOLATILITY_LS_KEY)
    if (v === 'low' || v === 'medium' || v === 'high') return v
  } catch { /* ignore */ }
  return 'medium'
}

export interface AutoplayConfig {
  active:                      boolean
  /** true = играть до стоп-условий или ручной остановки; счётчик раундов не уменьшается */
  infinite:                    boolean
  totalRounds:                 number
  remainingRounds:             number
  stopOnAnyWin:                boolean
  stopIfSingleWinExceeds:      number | null   // display $
  stopIfBalanceIncreasesBy:    number | null   // display $
  stopIfBalanceDecreasesBy:    number | null   // display $
  balanceAtStart:              number          // API units
}

export interface SessionStats {
  depth:      number   // metres
  distance:   number   // metres
  multiplier: number
}

/** Итог прошлого спина — для HUD «Last distance / Last depth» после раунда. */
export interface LastRoundStats {
  depth:    number
  distance: number
}

/** Значения ползунков по умолчанию (и fallback после mute, если снимка не было). */
export const DEFAULT_SFX_VOLUME = 0.8
export const DEFAULT_MUSIC_VOLUME = 0.6

export interface SettingsState {
  soundEnabled:    boolean
  musicEnabled:    boolean
  musicVolume:     number   // 0–1
  sfxVolume:       number   // 0–1
  /** Громкости до mute с иконки динамика; восстанавливаются при повторном включении звука. */
  muteVolumeSnapshot: { sfx: number; music: number } | null
  spaceEnabled:    boolean
  batterySaver:    boolean
  /** Показывать дистанцию и глубину в верхней панели во время игры */
  showDepthHud:    boolean
  digBtnSize:      number   // 0.5–1.5
  digBtnOpacity:   number   // 0–1
  digBtnX:         number   // 0–1 (normalised position)
  digBtnY:         number   // 0–1
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface GameStore {
  // Session
  phase:     GamePhase
  sessionID: string
  currency:  string
  config:    RgsConfig | null
  errorMsg:  string

  // Finance
  balance:     number   // API units
  bet:         number   // display $
  lastWin:     number   // display $
  lastWinMult: number   // multiplier from math engine

  // Round
  events:     RoundEvent[]
  roundID:    string
  worldSeed:  number
  replayMode: boolean
  /** Historical bet amount for Stake Bet Replay (display $, 0 = unknown / legacy). */
  replayBetAmount:      number
  /** Cost multiplier from /bet/replay response (default 1). */
  replayCostMultiplier: number
  /** true = replay data loaded, waiting for user "Play" click */
  replayPending:        boolean

  // Live stats (updated every frame by PixiJS renderer)
  stats:     SessionStats
  /** Финальные depth/distance последнего завершённого спина. */
  lastRoundStats: LastRoundStats

  // Controls
  speed:      SpeedMode
  volatility: VolatilityMode
  autoplay:  AutoplayConfig
  settings:  SettingsState

  // Menu
  menuOpen:     boolean
  menuTab:      'settings' | 'info' | 'replay'
  autoplayOpen: boolean

  // ── Actions ──────────────────────────────────────────────────────────────

  setPhase:    (phase: GamePhase)       => void
  setError:    (msg: string)            => void
  setBalance:  (amount: number)         => void
  setConfig:   (config: RgsConfig)      => void
  setBet:      (bet: number)            => void
  setCurrency: (c: string)              => void
  setSessionID:(id: string)             => void
  setEvents:            (events: RoundEvent[], roundID: string) => void
  setWorldSeed:         (seed: number) => void
  setReplayMode:        (mode: boolean) => void
  setReplayBetAmount:   (amount: number) => void
  setReplayCostMultiplier: (mult: number) => void
  setReplayPending:     (pending: boolean) => void
  setLastWin:     (win: number)          => void
  setLastWinMult: (mult: number)         => void
  setSpeed:       (speed: SpeedMode)       => void
  setVolatility:  (mode: VolatilityMode)  => void
  updateStats: (partial: Partial<SessionStats>) => void
  resetStats:  ()                       => void
  /** Сохранить текущие depth/distance как итог раунда (вызывать в onRoundComplete). */
  commitLastRoundStats: () => void

  setAutoplay:      (cfg: Partial<AutoplayConfig>) => void
  decrementAutoplay:()                  => void
  setMenuOpen:      (open: boolean)     => void
  setMenuTab:       (tab: 'settings' | 'info' | 'replay') => void
  setAutoplayOpen:  (open: boolean)     => void
  updateSettings:   (s: Partial<SettingsState>) => void
  /** Глобальный mute/unmute: звук + музыка, ползунки 0 / восстановление (как динамик в шапке). */
  toggleMasterSound: () => void

  // ── Toast notifications ──────────────────────────────────────────────────
  notification:      string
  showNotification:  (msg: string) => void
  clearNotification: ()            => void
}

const DEFAULT_AUTOPLAY: AutoplayConfig = {
  active:                   false,
  infinite:                 false,
  totalRounds:              10,
  remainingRounds:          0,
  stopOnAnyWin:             false,
  stopIfSingleWinExceeds:   null,
  stopIfBalanceIncreasesBy: null,
  stopIfBalanceDecreasesBy: null,
  balanceAtStart:           0,
}

const DEFAULT_SETTINGS: SettingsState = {
  soundEnabled:  true,
  musicEnabled:  true,
  musicVolume:   DEFAULT_MUSIC_VOLUME,
  sfxVolume:     DEFAULT_SFX_VOLUME,
  muteVolumeSnapshot: null,
  spaceEnabled:  true,
  batterySaver:  false,
  showDepthHud:  false,
  digBtnSize:    1.0,
  digBtnOpacity: 1.0,
  digBtnX:       0.88,
  digBtnY:       0.75,
}

export const useGameStore = createWithEqualityFn<GameStore>()((set, get) => ({
  phase:     'BOOT',
  sessionID: 'demo',
  currency:  'FUN',
  config:    null,
  errorMsg:  '',

  balance:     0,
  bet:         1.0,
  lastWin:     0,
  lastWinMult: 0,

  events:     [],
  roundID:    '',
  worldSeed:  0,
  replayMode: false,
  replayBetAmount:      0,
  replayCostMultiplier: 1,
  replayPending:        false,
  stats:   { depth: 0, distance: 0, multiplier: 0 },
  lastRoundStats: { depth: 0, distance: 0 },

  speed: 1,
  volatility: loadVolatility(),

  autoplay: { ...DEFAULT_AUTOPLAY },
  settings: { ...DEFAULT_SETTINGS },

  menuOpen:     false,
  menuTab:      'settings',
  autoplayOpen: false,
  notification: '',

  // ── setters ──────────────────────────────────────────────────────────────

  setPhase:    (phase)    => set({ phase }),
  setError:    (errorMsg) => set({ phase: 'ERROR', errorMsg }),
  setBalance:  (balance)  => set({ balance }),
  setConfig:   (config)   => set({ config }),
  setBet:      (bet)      => set({ bet }),
  setCurrency: (currency) => set({ currency }),
  setSessionID:(sessionID)=> set({ sessionID }),

  setEvents:     (events, roundID)   => set({ events, roundID }),
  setWorldSeed:  (worldSeed)         => set({ worldSeed }),
  setReplayMode: (replayMode)        => set({ replayMode }),
  setReplayBetAmount:      (replayBetAmount)      => set({ replayBetAmount }),
  setReplayCostMultiplier: (replayCostMultiplier) => set({ replayCostMultiplier }),
  setReplayPending:        (replayPending)        => set({ replayPending }),
  setLastWin:     (lastWin)     => set({ lastWin }),
  setLastWinMult: (lastWinMult) => set({ lastWinMult }),
  setSpeed:       (speed)    => set({ speed }),
  setVolatility:  (volatility) => {
    try { localStorage.setItem(VOLATILITY_LS_KEY, volatility) } catch { /* ignore */ }
    set({ volatility })
  },

  updateStats: (partial) => {
    const s = get()
    const next = { ...s.stats, ...partial }
    if (
      next.depth === s.stats.depth &&
      next.distance === s.stats.distance &&
      next.multiplier === s.stats.multiplier
    ) {
      return
    }
    set({ stats: next })
  },

  resetStats: () =>
    set({ stats: { depth: 0, distance: 0, multiplier: 0 } }),

  commitLastRoundStats: () => {
    const { stats } = get()
    set({
      lastRoundStats: {
        depth: Math.max(0, Math.round(stats.depth * 10) / 10),
        distance: Math.round(stats.distance * 10) / 10,
      },
    })
  },

  setAutoplay: (cfg) =>
    set((s) => ({ autoplay: { ...s.autoplay, ...cfg } })),

  decrementAutoplay: () =>
    set((s) => {
      const remaining = s.autoplay.remainingRounds - 1
      return {
        autoplay: { ...s.autoplay, remainingRounds: remaining, active: remaining > 0 },
      }
    }),

  setMenuOpen:    (menuOpen)     => set({ menuOpen }),
  setMenuTab:     (menuTab)      => set({ menuTab }),
  setAutoplayOpen:(autoplayOpen) => set({ autoplayOpen }),
  showNotification:  (notification) => set({ notification }),
  clearNotification: ()            => set({ notification: '' }),
  updateSettings: (partial) =>
    set((s) => {
      const next = { ...s.settings, ...partial }
      if (Object.prototype.hasOwnProperty.call(partial, 'soundEnabled')) {
        next.musicEnabled = next.soundEnabled
      }
      return { settings: next }
    }),

  toggleMasterSound: () =>
    set((s) => {
      const cur = s.settings
      if (cur.soundEnabled) {
        return {
          settings: {
            ...cur,
            soundEnabled: false,
            musicEnabled: false,
            sfxVolume: 0,
            musicVolume: 0,
            muteVolumeSnapshot: {
              sfx: cur.sfxVolume,
              music: cur.musicVolume,
            },
          },
        }
      }
      const snap = cur.muteVolumeSnapshot
      return {
        settings: {
          ...cur,
          soundEnabled: true,
          musicEnabled: true,
          sfxVolume: snap?.sfx ?? DEFAULT_SFX_VOLUME,
          musicVolume: snap?.music ?? DEFAULT_MUSIC_VOLUME,
          muteVolumeSnapshot: null,
        },
      }
    }),
}))
