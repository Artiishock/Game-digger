import { useGameStore } from '../store/gameStore'
import type { EventType } from '../rgs/client'
import type { GamePhase } from '../store/gameStore'

function baseUrl(): string {
  const b = import.meta.env.BASE_URL || '/'
  return b.endsWith('/') ? b : `${b}/`
}

function url(file: string): string {
  return `${baseUrl()}audio/${file}`
}

const SFX_LIST = [
  'sfx_coin.ogg',
  'sfx_gold.ogg',
  'sfx_diamond.ogg',
  'sfx_bomb.ogg',
  'sfx_stone.ogg',
  'sfx_home.ogg',
  'sfx_lava.ogg',
  'sfx_win.ogg',
  'sfx_dig_0.ogg',
  'sfx_dig_1.ogg',
  'sfx_dig_2.ogg',
  'sfx_dig_3.ogg',
  'sfx_dig_4.ogg',
] as const

const COLLECT_SFX: Partial<Record<EventType, string>> = {
  COIN: 'sfx_coin.ogg',
  GOLD: 'sfx_gold.ogg',
  DIAMOND: 'sfx_diamond.ogg',
  BOMB: 'sfx_bomb.ogg',
  STONE: 'sfx_stone.ogg',
  HOME: 'sfx_home.ogg',
  LAVA: 'sfx_lava.ogg',
}

class GameAudioModule {
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private loadStarted = false
  private loadDone = false
  private music: HTMLAudioElement | null = null

  /** Вызывать по первому клику пользователя (DIG), чтобы снять блокировку autoplay. */
  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' })
    void this.ctx.resume()
    void this.ensureBuffers()
    this.refreshFromStore()
  }

  init(): void {
    void this.ensureBuffers()
  }

  /** Вызывать из React при смене настроек звука (громкость / mute). */
  refreshFromStore(): void {
    const phase = useGameStore.getState().phase
    this.applyMusicFromStore()
    if (
      this.music &&
      (phase === 'RUNNING' || phase === 'BETTING') &&
      useGameStore.getState().settings.soundEnabled &&
      useGameStore.getState().settings.musicVolume > 0 &&
      this.music.paused
    ) {
      void this.music.play().catch(() => {})
    }
  }

  syncPhase(phase: GamePhase): void {
    const wantMusic = phase === 'RUNNING' || phase === 'BETTING'
    if (!this.music) {
      if (!wantMusic) return
      this.music = new Audio(url('bgm_main.mp3'))
      this.music.loop = true
      this.music.preload = 'auto'
    }
    this.applyMusicFromStore()
    if (!wantMusic) {
      this.music.pause()
      return
    }
    const store = useGameStore.getState()
    if (!store.settings.soundEnabled || store.settings.musicVolume <= 0) {
      this.music.pause()
      return
    }
    void this.music.play().catch(() => {
      /* ждём unlock() */
    })
  }

  playSfx(file: string): void {
    const { soundEnabled, sfxVolume } = useGameStore.getState().settings
    if (!soundEnabled || sfxVolume <= 0) return
    void this.ensureBuffers().then(() => this._playBuffer(file, sfxVolume))
  }

  playDig(): void {
    const i = Math.floor(Math.random() * 5)
    this.playSfx(`sfx_dig_${i}.ogg`)
  }

  playCollect(type: EventType, opts?: { terminal?: boolean; won?: boolean }): void {
    if (opts?.terminal) {
      if (type === 'HOME') {
        this.playSfx(opts.won ? 'sfx_win.ogg' : 'sfx_lava.ogg')
        return
      }
      if (type === 'LAVA') {
        this.playSfx('sfx_lava.ogg')
        return
      }
    }
    const f = COLLECT_SFX[type]
    if (f) this.playSfx(f)
  }

  private applyMusicFromStore(): void {
    if (!this.music) return
    const { soundEnabled, musicVolume } = useGameStore.getState().settings
    this.music.volume = soundEnabled ? musicVolume : 0
    if (!soundEnabled || musicVolume <= 0) this.music.pause()
  }

  private async ensureBuffers(): Promise<void> {
    if (this.loadDone) return
    if (this.loadStarted) {
      while (!this.loadDone) await new Promise(r => setTimeout(r, 30))
      return
    }
    this.loadStarted = true
    try {
      if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' })
      const ctx = this.ctx
      for (const name of SFX_LIST) {
        const res = await fetch(url(name))
        if (!res.ok) continue
        const raw = await res.arrayBuffer()
        const buf = await ctx.decodeAudioData(raw.slice(0))
        this.buffers.set(name, buf)
      }
    } catch (e) {
      console.warn('[GameAudio] preload failed', e)
    } finally {
      this.loadDone = true
    }
  }

  private _playBuffer(file: string, vol: number): void {
    const ctx = this.ctx
    const buf = this.buffers.get(file)
    if (!ctx || !buf) return
    void ctx.resume()
    const g = ctx.createGain()
    g.gain.value = Math.max(0, Math.min(1, vol))
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(g)
    g.connect(ctx.destination)
    src.start()
  }
}

export const gameAudio = new GameAudioModule()
