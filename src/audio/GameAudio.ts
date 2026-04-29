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
  'start_game.ogg',
  'coin.ogg',
  'gold_crash.ogg',
  'crystal.ogg',
  'bomb.ogg',
  'stone_crash.ogg',
  'finish_win.ogg',
  'finish_lose.ogg',
  'click_ui.ogg',
  'click_ui_slide.ogg',
  'gold.ogg',
] as const

const COLLECT_SFX: Partial<Record<EventType, string>> = {
  COIN: 'coin.ogg',
  DIAMOND: 'crystal.ogg',
  BOMB: 'bomb.ogg',
  HOME: 'finish_win.ogg',
  LAVA: 'finish_lose.ogg',
}

class GameAudioModule {
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private loadStarted = false
  private loadDone = false
  private loopers = new Map<string, HTMLAudioElement>()

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
    this.applyMusicFromStore()
  }

  syncPhase(phase: GamePhase): void {
    this.setLoop('drill.ogg', phase === 'RUNNING')
  }

  /**
   * Длительность загруженного в WebAudio декодированного SFX в секундах.
   * Пока буфера нет (`ensureBuffers` ещё не отработал) — undefined.
   */
  getSfxBufferDurationSec(file: string): number | undefined {
    const buf = this.buffers.get(file)
    return buf != null && buf.duration > 0 ? buf.duration : undefined
  }

  playSfx(file: string): void {
    const { soundEnabled, sfxVolume } = useGameStore.getState().settings
    if (!soundEnabled || sfxVolume <= 0) return
    void this.ensureBuffers().then(() => this._playBuffer(file, sfxVolume))
  }

  playDig(): void {
    this.setLoop('drill.ogg', true)
  }

  playCollect(type: EventType, opts?: { terminal?: boolean; won?: boolean }): void {
    if (opts?.terminal) {
      if (type === 'HOME') {
        this.playSfx(opts.won ? 'finish_win.ogg' : 'finish_lose.ogg')
        return
      }
      if (type === 'LAVA') {
        this.playSfx('finish_lose.ogg')
        return
      }
    }
    const f = COLLECT_SFX[type]
    if (f) this.playSfx(f)
  }

  playUiClick(): void {
    this.playSfx('click_ui.ogg')
  }

  playUiSlide(): void {
    this.playSfx('click_ui_slide.ogg')
  }

  playStartGame(): void {
    this.playSfx('start_game.ogg')
  }

  setLoop(file: string, on: boolean): void {
    const { soundEnabled, sfxVolume } = useGameStore.getState().settings
    if (!soundEnabled || sfxVolume <= 0) on = false
    const existing = this.loopers.get(file)
    if (on) {
      if (existing) {
        existing.volume = sfxVolume
        if (existing.paused) void existing.play().catch(() => {})
        return
      }
      const a = new Audio(url(file))
      a.loop = true
      a.preload = 'auto'
      a.volume = sfxVolume
      this.loopers.set(file, a)
      void a.play().catch(() => {})
      return
    }
    if (existing) {
      existing.pause()
      existing.currentTime = 0
      this.loopers.delete(file)
    }
  }

  private applyMusicFromStore(): void {
    const { soundEnabled } = useGameStore.getState().settings
    for (const looper of this.loopers.values()) {
      looper.volume = soundEnabled ? useGameStore.getState().settings.sfxVolume : 0
      if (!soundEnabled) looper.pause()
    }
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
    if (!ctx || !buf) {
      // Fallback for files that failed WebAudio decode on some devices/codecs.
      const a = new Audio(url(file))
      a.volume = Math.max(0, Math.min(1, vol))
      void a.play().catch(() => {})
      return
    }
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
