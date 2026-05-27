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

/**
 * Индивидуальные множители громкости для конкретных файлов.
 * Применяются поверх sfxVolume / musicVolume из настроек пользователя.
 */
const FILE_VOLUME_SCALE: Record<string, number> = {
  'iddle.ogg':   0.5,
  'drill.ogg':   0.5,
  'ambient.ogg': 0.5,
}

/**
 * HTML5 Audio для этих луперов НЕ удаляем через src='' при остановке —
 * они часто перезапускаются (каждый раунд) и пересоздание вызывает задержку на мобильном.
 * Просто ставим на паузу и переиспользуем элемент.
 */
const REUSE_LOOPERS = new Set([
  'ambient.ogg', 'iddle.ogg',
  'background_1.ogg',
  'finish_pay.ogg', 'finish_coins.ogg',
  'gold.ogg', 'stone.ogg',
])

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
  /** Файлы, которые были активны до скрытия страницы (для resume при возврате). */
  private _bgPausedFiles: Set<string> | null = null
  /**
   * Файлы, у которых play() был заблокирован autoplay-политикой браузера.
   * Будут повторно запущены при следующем пользовательском жесте (unlock).
   */
  private _blockedPlays = new Set<string>()
  private readonly _onVisibility = () => {
    if (document.hidden) {
      this._pauseAllForBackground()
    } else {
      this._resumeFromBackground()
    }
  }

  /**
   * Вызывает play() на HTML5 Audio-элементе.
   * Если заблокирован autoplay-политикой — добавляет в очередь для retry при unlock().
   */
  private _htmlPlay(a: HTMLAudioElement, file: string): void {
    void a.play().catch(() => {
      // play() заблокирован — запомним файл, повторим попытку при следующем жесте (unlock).
      this._blockedPlays.add(file)
    })
  }

  /** Повторяет play() для всех ранее заблокированных луперов. */
  private _retryBlockedPlays(): void {
    if (!this._blockedPlays.size) return
    for (const file of this._blockedPlays) {
      const looper = this.loopers.get(file)
      if (looper && looper.paused && looper.src) {
        void looper.play().catch(() => {})
      }
    }
    this._blockedPlays.clear()
  }

  /** Пауза всех активных луперов при уходе страницы в фон (visibilitychange). */
  private _pauseAllForBackground(): void {
    const playing = new Set<string>()
    for (const [file, looper] of this.loopers.entries()) {
      if (!looper.paused) {
        playing.add(file)
        looper.pause()
      }
    }
    // Приостанавливаем AudioContext — освобождает системные ресурсы и
    // предотвращает двойной запуск треков при возврате в foreground на iOS.
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend()
    }
    this._bgPausedFiles = playing
  }

  /** Возобновляет только те луперы, которые играли до ухода в фон. */
  private _resumeFromBackground(): void {
    const files = this._bgPausedFiles
    this._bgPausedFiles = null

    const doPlay = () => {
      if (files) {
        for (const file of files) {
          const looper = this.loopers.get(file)
          // Возобновляем только если элемент ещё существует и не был намеренно остановлен.
          if (looper && looper.src) void looper.play().catch(() => { this._blockedPlays.add(file) })
        }
      }
      // Параллельно повторяем любые ранее заблокированные play().
      this._retryBlockedPlays()
    }

    // AudioContext необходимо resume() раньше чем HTML5 Audio play(),
    // иначе на iOS WebAudio-ноды (drill.ogg) не восстановятся корректно.
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().then(doPlay)
    } else {
      doPlay()
    }
  }

  /** Вызывать по первому клику пользователя (DIG), чтобы снять блокировку autoplay. */
  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' })
    void this.ctx.resume().then(() => {
      const ctx = this.ctx!
      // 1. Прогреваем аудиопайплайн тихим буфером — устраняет задержку первого звука (iOS/Android).
      const silence = ctx.createBuffer(1, 1, ctx.sampleRate)
      const s = ctx.createBufferSource()
      s.buffer = silence
      s.connect(ctx.destination)
      s.start()
      // 2. Повторяем play() ТОЛЬКО для файлов, заблокированных autoplay-политикой.
      //    Нельзя трогать все паузированные loopers — часть из них намеренно остановлена
      //    (gold.ogg/stone.ogg после окончания события, iddle.ogg во время спина и т.д.).
      this._retryBlockedPlays()
    })
    void this.ensureBuffers()
    // refreshFromStore уже вызывает syncPhase внутри — второй прямой вызов не нужен.
    this.refreshFromStore()
  }

  init(): void {
    void this.ensureBuffers()
    document.addEventListener('visibilitychange', this._onVisibility)
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

      // background_2: запускаем только во время RUNNING, иначе плавно затухаем и останавливаем.
      if (phase === 'RUNNING') {
        this._ensureLoopStartedAt('background_2.ogg', 0)
        this._fadeLooper('background_2.ogg', targetVol)
      } else {
        this._fadeLooper('background_2.ogg', 0)   // fade → auto-stop (см. _fadeLooper)
      }

      // background_3: запускаем ТОЛЬКО при достижении порогового множителя.
      const intenseBgMin = GameConfig.round.megaWinMinMultiplier
      const wantBg3 = phase === 'RUNNING' && multiplier >= intenseBgMin
      if (wantBg3) {
        this._ensureLoopStartedAt('background_3.ogg', 0)
        this._fadeLooper('background_3.ogg', targetVol)
      } else {
        this._fadeLooper('background_3.ogg', 0)   // fade → auto-stop
      }
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
    if (this.loadDone) {
      // Буферы готовы — играем синхронно без .then() задержки.
      // На мобильном это устраняет 10–50 мс запаздывание SFX относительно анимации.
      this._playBuffer(file, sfxVolume)
    } else {
      void this.ensureBuffers().then(() => this._playBuffer(file, sfxVolume))
    }
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
    const volume = (isMusic ? musicVolume : sfxVolume) * (FILE_VOLUME_SCALE[file] ?? 1)
    if (!soundEnabled || (isMusic && !musicEnabled) || volume <= 0) on = false

    if (GAPLESS_LOOPS.has(file)) {
      this._setGaplessLoop(file, on, volume)
      return
    }

    const existing = this.loopers.get(file)
    if (on) {
      if (existing) {
        existing.volume = volume
        if (existing.paused) this._htmlPlay(existing, file)
        return
      }
      const a = new Audio(url(file))
      a.loop = true
      a.preload = 'auto'
      a.volume = volume
      this.loopers.set(file, a)
      this._htmlPlay(a, file)
      return
    }
    if (existing) {
      const fadeInterval = this.fadeIntervals.get(file)
      if (fadeInterval) {
        clearInterval(fadeInterval)
        this.fadeIntervals.delete(file)
      }
      this.fadeTargetVolumes.delete(file)
      this._blockedPlays.delete(file)
      existing.pause()
      existing.currentTime = 0
      if (REUSE_LOOPERS.has(file)) {
        // Переиспользуемые луперы: только пауза, не удаляем элемент.
        // Следующий setLoop(true) сразу возобновит без пересоздания и без задержки.
      } else {
        existing.src = ''  // полностью освобождаем медиаресурс
        this.loopers.delete(file)
      }
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
      // play() ранее мог быть заблокирован autoplay-политикой — повторяем попытку.
      if (existing.paused) this._htmlPlay(existing, file)
      return
    }
    const a = new Audio(url(file))
    a.loop = true
    a.preload = 'auto'
    a.volume = initialVolume
    this.loopers.set(file, a)
    this._htmlPlay(a, file)
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
      looper.currentTime = 0
      this._blockedPlays.delete(file)
      this.fadeTargetVolumes.delete(file)
      if (!REUSE_LOOPERS.has(file)) {
        looper.src = ''
        this.loopers.delete(file)
      }
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
        const finalVol = Math.max(0, Math.min(1, targetVolume))
        l.volume = finalVol
        clearInterval(interval)
        this.fadeIntervals.delete(file)
        this.fadeTargetVolumes.delete(file)
        // Трек дотух до нуля — останавливаем.
        if (finalVol <= 0.001) {
          l.pause()
          l.currentTime = 0
          this._blockedPlays.delete(file)
          if (!REUSE_LOOPERS.has(file)) {
            l.src = ''
            this.loopers.delete(file)
          }
        }
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
    this._blockedPlays.delete(file)
    const existing = this.loopers.get(file)
    if (existing) {
      existing.pause()
      existing.currentTime = 0
      if (!REUSE_LOOPERS.has(file)) {
        existing.src = ''
        this.loopers.delete(file)
      }
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
      const startNode = () => {
        // Двойная проверка: пока мы ждали resume(), loop мог быть уже остановлен.
        if (this.looperNodes.has(file)) return
        const g = ctx.createGain()
        g.gain.value = volume
        const s = ctx.createBufferSource()
        s.buffer = buf
        s.loop = true
        s.connect(g)
        g.connect(ctx.destination)
        s.start()
        this.looperNodes.set(file, { src: s, gain: g })
      }
      if (ctx.state === 'running') {
        startNode()
      } else {
        void ctx.resume().then(startNode)
      }
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
      const baseVolume = (isMusic ? musicVolume : sfxVolume) * (FILE_VOLUME_SCALE[file] ?? 1)
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
      const volume = (isMusic ? musicVolume : sfxVolume) * (FILE_VOLUME_SCALE[file] ?? 1)
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
      const upgrade = (f: string, v: number) => {
        if (this.looperNodes.has(f)) return
        const g = ctx.createGain()
        g.gain.value = v
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.loop = true
        src.connect(g)
        g.connect(ctx.destination)
        src.start()
        this.looperNodes.set(f, { src, gain: g })
      }
      if (ctx.state === 'running') {
        upgrade(file, volume)
      } else {
        void ctx.resume().then(() => upgrade(file, volume))
      }
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
    const play = () => {
      const g = ctx.createGain()
      g.gain.value = Math.max(0, Math.min(1, vol))
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(g)
      g.connect(ctx.destination)
      src.start()
    }
    // Если контекст уже запущен — играем немедленно (нет задержки).
    // Если suspended (например после ухода в фон) — ждём resume(), только потом играем.
    if (ctx.state === 'running') {
      play()
    } else {
      void ctx.resume().then(play)
    }
  }
}

export const gameAudio = new GameAudioModule()
