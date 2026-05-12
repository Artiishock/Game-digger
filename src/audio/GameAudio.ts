import { useGameStore } from '../store/gameStore'
import type { EventType } from '../rgs/client'
import type { GamePhase } from '../store/gameStore'
import { GameConfig } from '../game/GameConfig'
import { resolveWinCelebration, type WinCelebrateKind } from '../ui/winCelebration'

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
  'finish_bigwin.ogg',
  'finish_epicwin.ogg',
  'finish_megawin.ogg',
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

const MUSIC_LOOPS = new Set([
  'background_1.ogg',
  'background_2.ogg',
  'background_3.ogg',
])

// Files requiring gap-free looping via Web Audio API (HTML5 Audio has a seek-gap on loop)
const GAPLESS_LOOPS = new Set(['drill.ogg'])

// Background tracks controlled by gradual volume fading rather than hard on/off
const FADE_TRACKS = new Set(['background_2.ogg', 'background_3.ogg'])

class GameAudioModule {
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private loadStarted = false
  private loadDone = false
  private loopers = new Map<string, HTMLAudioElement>()
  private looperNodes = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>()
  private fadeIntervals = new Map<string, ReturnType<typeof setInterval>>()
  private fadeTargetVolumes = new Map<string, number>()
  private readonly FADE_DURATION_MS = 2000
  private readonly FADE_STEP_MS = 50
  private _loseInProgress = false

  /** Вызывать по первому клику пользователя (DIG), чтобы снять блокировку autoplay. */
  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' })
    void this.ctx.resume()
    void this.ensureBuffers()
    this.refreshFromStore()
    const store = useGameStore.getState()
    this.syncPhase(store.phase, store.stats.multiplier)
  }

  init(): void {
    void this.ensureBuffers()
  }

  /** Вызывать из React при смене настроек звука (громкость / mute). */
  refreshFromStore(): void {
    this.applyMusicFromStore()
    const store = useGameStore.getState()
    this.syncPhase(store.phase, store.stats.multiplier)
  }

  syncPhase(phase: GamePhase, multiplier = 1): void {
    this.setLoop('drill.ogg', phase === 'RUNNING' && !this._loseInProgress)

    if (this._loseInProgress) return

    const inPlayableScene =
      phase === 'IDLE' || phase === 'BETTING' || phase === 'RUNNING' || phase === 'WIN' || phase === 'LOSE'

    this.setLoop('ambient.ogg', inPlayableScene)
    this.setLoop('iddle.ogg', phase === 'IDLE')

    const { soundEnabled, musicEnabled, musicVolume } = useGameStore.getState().settings
    const targetVol = soundEnabled && musicEnabled ? musicVolume : 0

    if (inPlayableScene) {
      this.setLoop('background_1.ogg', true)

      this._ensureLoopStartedAt('background_2.ogg', 0)
      this._ensureLoopStartedAt('background_3.ogg', 0)

      this._fadeLooper('background_2.ogg', phase === 'RUNNING' ? targetVol : 0)

      const bigWin = GameConfig.round.bigWinExclusiveAboveMultiplier
      this._fadeLooper('background_3.ogg', phase === 'RUNNING' && multiplier >= bigWin ? targetVol : 0)
    } else {
      this._stopFadingLoop('background_2.ogg')
      this._stopFadingLoop('background_3.ogg')
      this.setLoop('background_1.ogg', false)
    }
  }

  /** Вызывать из _returnToIdle() — снимает подавление музыки и возобновляет треки. */
  resumeMusicAfterLose(): void {
    if (!this._loseInProgress) return
    this._loseInProgress = false
    const store = useGameStore.getState()
    this.syncPhase(store.phase, store.stats.multiplier)
  }

  /** Ставит всю музыку на паузу при смерти (LAVA), сохраняя позицию. Блокирует перезапуск до нового раунда. */
  stopMusicForLose(): void {
    this._loseInProgress = true

    // Fade tracks — отменяем плавное изменение, ставим на паузу без сброса позиции
    for (const file of FADE_TRACKS) {
      const interval = this.fadeIntervals.get(file)
      if (interval) { clearInterval(interval); this.fadeIntervals.delete(file) }
      this.loopers.get(file)?.pause()
    }

    // Остальные музыкальные треки — тоже только пауза
    for (const file of ['background_1.ogg', 'ambient.ogg', 'iddle.ogg'] as const) {
      this.loopers.get(file)?.pause()
    }

    this.setLoop('drill.ogg', false)
  }

  private readonly _WIN_FANFARE: Record<WinCelebrateKind, string> = {
    bigwin:  'finish_bigwin.ogg',
    epicwin: 'finish_epicwin.ogg',
    megawin: 'finish_megawin.ogg',
  }

  /** Запускает/останавливает аудио экрана победы. */
  syncWinScreen(show: boolean, kind: WinCelebrateKind | null): void {
    if (show) {
      if (kind) this.playSfx(this._WIN_FANFARE[kind])
      this.setLoop('finish_pay.ogg', true)
      if (kind) this.setLoop('finish_coins.ogg', true)
    } else {
      this.setLoop('finish_pay.ogg', false)
      this.setLoop('finish_coins.ogg', false)
    }
  }

  /** Останавливает луп счётчика (при скипе игроком). */
  stopWinPayLoop(): void {
    this.setLoop('finish_pay.ogg', false)
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

  playCollect(type: EventType, opts?: { terminal?: boolean; won?: boolean; multiplier?: number }): void {
    if (opts?.terminal) {
      if (type === 'HOME') {
        if (opts.won) {
          const hasFanfare = opts.multiplier != null && resolveWinCelebration(opts.multiplier) != null
          if (!hasFanfare) this.playSfx('finish_win.ogg')
        } else {
          this.playSfx('finish_lose.ogg')
        }
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
    const { soundEnabled, musicEnabled, sfxVolume, musicVolume } = useGameStore.getState().settings
    const isMusic = MUSIC_LOOPS.has(file)
    const volume = isMusic ? musicVolume : sfxVolume
    if (!soundEnabled || (isMusic && !musicEnabled) || volume <= 0) on = false

    if (GAPLESS_LOOPS.has(file)) {
      this._setGaplessLoop(file, on, volume)
      return
    }

    const existing = this.loopers.get(file)
    if (on) {
      if (existing) {
        existing.volume = volume
        if (existing.paused) void existing.play().catch(() => {})
        return
      }
      const a = new Audio(url(file))
      a.loop = true
      a.preload = 'auto'
      a.volume = volume
      this.loopers.set(file, a)
      void a.play().catch(() => {})
      return
    }
    if (existing) {
      const fadeInterval = this.fadeIntervals.get(file)
      if (fadeInterval) {
        clearInterval(fadeInterval)
        this.fadeIntervals.delete(file)
      }
      this.fadeTargetVolumes.delete(file)
      existing.pause()
      existing.currentTime = 0
      this.loopers.delete(file)
    }
  }

  /** Starts a loop at the given initial volume without overriding an already-running instance. */
  private _ensureLoopStartedAt(file: string, initialVolume: number): void {
    const { soundEnabled, musicEnabled } = useGameStore.getState().settings
    const existing = this.loopers.get(file)
    if (!soundEnabled || !musicEnabled) {
      if (existing && !existing.paused) existing.pause()
      return
    }
    if (existing) {
      // First render play() may have been blocked by autoplay policy — retry on user-gesture context
      if (existing.paused) void existing.play().catch(() => {})
      return
    }
    const a = new Audio(url(file))
    a.loop = true
    a.preload = 'auto'
    a.volume = initialVolume
    this.loopers.set(file, a)
    void a.play().catch(() => {})
  }

  /** Gradually fades a looper to targetVolume over FADE_DURATION_MS. No-ops if already heading there. */
  private _fadeLooper(file: string, targetVolume: number): void {
    const { soundEnabled, musicEnabled } = useGameStore.getState().settings
    const looperEarly = this.loopers.get(file)
    /** При выключении звука/музыки не тянуть 2s fade — иначе после mute syncPhase снова «поднимает» слой. */
    const snapSilent =
      targetVolume <= 0.001 && (!soundEnabled || !musicEnabled) && looperEarly

    const prevTarget = this.fadeTargetVolumes.get(file)
    if (!snapSilent && prevTarget === targetVolume && this.fadeIntervals.has(file)) return

    this.fadeTargetVolumes.set(file, targetVolume)

    const existing = this.fadeIntervals.get(file)
    if (existing) {
      clearInterval(existing)
      this.fadeIntervals.delete(file)
    }

    const looper = this.loopers.get(file)
    if (!looper) return

    if (snapSilent) {
      looper.volume = 0
      looper.pause()
      this.fadeTargetVolumes.delete(file)
      return
    }

    const startVolume = looper.volume
    if (Math.abs(targetVolume - startVolume) < 0.001) {
      looper.volume = targetVolume
      return
    }

    const steps = Math.ceil(this.FADE_DURATION_MS / this.FADE_STEP_MS)
    const delta = (targetVolume - startVolume) / steps

    const interval = setInterval(() => {
      const l = this.loopers.get(file)
      if (!l) {
        clearInterval(interval)
        this.fadeIntervals.delete(file)
        return
      }
      const next = l.volume + delta
      if ((delta > 0 && next >= targetVolume) || (delta < 0 && next <= targetVolume)) {
        l.volume = Math.max(0, Math.min(1, targetVolume))
        clearInterval(interval)
        this.fadeIntervals.delete(file)
      } else {
        l.volume = Math.max(0, Math.min(1, next))
      }
    }, this.FADE_STEP_MS)

    this.fadeIntervals.set(file, interval)
  }

  /** Stops a fade-controlled loop immediately (used when leaving the playable scene). */
  private _stopFadingLoop(file: string): void {
    const interval = this.fadeIntervals.get(file)
    if (interval) {
      clearInterval(interval)
      this.fadeIntervals.delete(file)
    }
    this.fadeTargetVolumes.delete(file)
    const existing = this.loopers.get(file)
    if (existing) {
      existing.pause()
      existing.currentTime = 0
      this.loopers.delete(file)
    }
  }

  private _setGaplessLoop(file: string, on: boolean, volume: number): void {
    if (on) {
      const existing = this.looperNodes.get(file)
      if (existing) {
        existing.gain.gain.value = volume
        return
      }
      const buf = this.buffers.get(file)
      const ctx = this.ctx
      if (!buf || !ctx) {
        // Buffer not ready yet — HTML5 Audio fallback until ensureBuffers upgrades it
        const htmlFallback = this.loopers.get(file)
        if (htmlFallback) {
          htmlFallback.volume = volume
          if (htmlFallback.paused) void htmlFallback.play().catch(() => {})
          return
        }
        const a = new Audio(url(file))
        a.loop = true
        a.preload = 'auto'
        a.volume = volume
        this.loopers.set(file, a)
        void a.play().catch(() => {})
        return
      }
      // Drop any HTML5 fallback before switching to WebAudio
      const htmlFallback = this.loopers.get(file)
      if (htmlFallback) {
        htmlFallback.pause()
        this.loopers.delete(file)
      }
      void ctx.resume()
      const g = ctx.createGain()
      g.gain.value = volume
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      src.connect(g)
      g.connect(ctx.destination)
      src.start()
      this.looperNodes.set(file, { src, gain: g })
    } else {
      const existing = this.looperNodes.get(file)
      if (existing) {
        try { existing.src.stop() } catch { /* already stopped */ }
        existing.src.disconnect()
        existing.gain.disconnect()
        this.looperNodes.delete(file)
      }
      const htmlFallback = this.loopers.get(file)
      if (htmlFallback) {
        htmlFallback.pause()
        htmlFallback.currentTime = 0
        this.loopers.delete(file)
      }
    }
  }

  private applyMusicFromStore(): void {
    const { soundEnabled, musicEnabled, sfxVolume, musicVolume } = useGameStore.getState().settings
    for (const [file, looper] of this.loopers.entries()) {
      const isMusic = MUSIC_LOOPS.has(file)
      const muted = !soundEnabled || (isMusic && !musicEnabled)
      if (muted) {
        const fadeInterval = this.fadeIntervals.get(file)
        if (fadeInterval) {
          clearInterval(fadeInterval)
          this.fadeIntervals.delete(file)
        }
        looper.pause()
        continue
      }
      const baseVolume = isMusic ? musicVolume : sfxVolume
      if (FADE_TRACKS.has(file)) {
        const fadeTarget = this.fadeTargetVolumes.get(file)
        if (fadeTarget !== undefined && fadeTarget > 0) {
          if (looper.paused) void looper.play().catch(() => {})
          this._fadeLooper(file, baseVolume)
        }
      } else {
        looper.volume = baseVolume
        if (looper.paused) void looper.play().catch(() => {})
      }
    }
    for (const [file, nodes] of this.looperNodes.entries()) {
      const isMusic = MUSIC_LOOPS.has(file)
      const volume = isMusic ? musicVolume : sfxVolume
      const active = soundEnabled && (!isMusic || musicEnabled)
      nodes.gain.gain.value = active ? volume : 0
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
      const allFiles = ([...SFX_LIST] as string[]).concat([...GAPLESS_LOOPS])
      for (const name of allFiles) {
        const res = await fetch(url(name))
        if (!res.ok) continue
        const raw = await res.arrayBuffer()
        const buf = await ctx.decodeAudioData(raw.slice(0))
        this.buffers.set(name, buf)
      }
      this.upgradeFallbackLoops()
    } catch (e) {
      console.warn('[GameAudio] preload failed', e)
    } finally {
      this.loadDone = true
    }
  }

  /** После загрузки буферов переводим GAPLESS_LOOPS с HTML5 fallback на WebAudio. */
  private upgradeFallbackLoops(): void {
    for (const file of GAPLESS_LOOPS) {
      const htmlFallback = this.loopers.get(file)
      if (!htmlFallback || htmlFallback.paused) continue
      const volume = htmlFallback.volume
      htmlFallback.pause()
      this.loopers.delete(file)
      const buf = this.buffers.get(file)
      const ctx = this.ctx
      if (!buf || !ctx) continue
      void ctx.resume()
      const g = ctx.createGain()
      g.gain.value = volume
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      src.connect(g)
      g.connect(ctx.destination)
      src.start()
      this.looperNodes.set(file, { src, gain: g })
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
