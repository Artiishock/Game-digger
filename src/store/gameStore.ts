import { create } from 'zustand'
import type { RgsConfig, RoundEvent } from '../rgs/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export type GamePhase =
  | 'BOOT'       // initial load / auth
  | 'IDLE'       // waiting for DIG press
  | 'BETTING'    // placing bet with RGS
  | 'RUNNING'    // character digging
  | 'WIN'        // HOME reached — show result
  | 'LOSE'       // LAVA reached — show result
  | 'ERROR'      // RGS or session error

export type SpeedMode = 0.75 | 1 | 2 | 5

export interface AutoplayConfig {
  active:                      boolean
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

export interface SettingsState {
  soundEnabled:    boolean
  musicVolume:     number   // 0–1
  sfxVolume:       number   // 0–1
  highQuality:     boolean
  batterySaver:    boolean
  introScreen:     boolean
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
  balance:    number   // API units
  bet:        number   // display $
  lastWin:    number   // display $

  // Round
  events:    RoundEvent[]
  roundID:   string

  // Live stats (updated every frame by PixiJS renderer)
  stats:     SessionStats

  // Controls
  speed:     SpeedMode
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
  setEvents:   (events: RoundEvent[], roundID: string) => void
  setLastWin:  (win: number)            => void
  setSpeed:    (speed: SpeedMode)       => void
  updateStats: (partial: Partial<SessionStats>) => void
  resetStats:  ()                       => void

  setAutoplay:      (cfg: Partial<AutoplayConfig>) => void
  decrementAutoplay:()                  => void
  setMenuOpen:      (open: boolean)     => void
  setMenuTab:       (tab: 'settings' | 'info' | 'replay') => void
  setAutoplayOpen:  (open: boolean)     => void
  updateSettings:   (s: Partial<SettingsState>) => void
}

const DEFAULT_AUTOPLAY: AutoplayConfig = {
  active:                   false,
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
  musicVolume:   0.6,
  sfxVolume:     0.8,
  highQuality:   true,
  batterySaver:  false,
  introScreen:   true,
  digBtnSize:    1.0,
  digBtnOpacity: 1.0,
  digBtnX:       0.88,
  digBtnY:       0.75,
}

export const useGameStore = create<GameStore>((set) => ({
  phase:     'BOOT',
  sessionID: 'demo',
  currency:  'FUN',
  config:    null,
  errorMsg:  '',

  balance:   0,
  bet:       1.0,
  lastWin:   0,

  events:  [],
  roundID: '',
  stats:   { depth: 0, distance: 0, multiplier: 0 },

  speed: 1,

  autoplay: { ...DEFAULT_AUTOPLAY },
  settings: { ...DEFAULT_SETTINGS },

  menuOpen:     false,
  menuTab:      'settings',
  autoplayOpen: false,

  // ── setters ──────────────────────────────────────────────────────────────

  setPhase:    (phase)    => set({ phase }),
  setError:    (errorMsg) => set({ phase: 'ERROR', errorMsg }),
  setBalance:  (balance)  => set({ balance }),
  setConfig:   (config)   => set({ config }),
  setBet:      (bet)      => set({ bet }),
  setCurrency: (currency) => set({ currency }),
  setSessionID:(sessionID)=> set({ sessionID }),

  setEvents: (events, roundID) => set({ events, roundID }),
  setLastWin: (lastWin)  => set({ lastWin }),
  setSpeed:   (speed)    => set({ speed }),

  updateStats: (partial) =>
    set((s) => ({ stats: { ...s.stats, ...partial } })),

  resetStats: () =>
    set({ stats: { depth: 0, distance: 0, multiplier: 0 } }),

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
  updateSettings: (partial)      => set((s) => ({ settings: { ...s.settings, ...partial } })),
}))
