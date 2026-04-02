/**
 * SpineAnimator — загружает скелет DeepRush_Items и раздаёт
 * анимированные инстансы для монет, золота, алмазов, бомб и камней.
 *
 * Использование:
 *   await SpineAnimator.load()      — вызвать 1 раз при старте
 *   SpineAnimator.createItem(type)  — контейнер с анимацией (или null если не загружен)
 *   SpineAnimator.tick(dt)          — в основном тике, dt в секундах
 *   SpineAnimator.ready             — true если skeleton загружен
 */

import * as PIXI from 'pixi.js'
import { Spine, TextureAtlas } from 'pixi-spine'
import { SkeletonJson, AtlasAttachmentLoader } from '@pixi-spine/runtime-4.1'
import type { EventType } from '../rgs/client'
import { TILE } from './Tileworld'

// ─── Маппинг EventType → имя анимации ────────────────────────────────────────

const ANIM_MAP: Partial<Record<EventType, string>> = {
  COIN:    'coin_idle',
  GOLD:    'gold/gold_idle',
  DIAMOND: 'diamond_idle',
  BOMB:    'bomb_idle',
  STONE:   'rock/rock_idle',
}

// Анимации персонажа
export const CHAR_ANIM = {
  idle:   'character_idle',
  action: 'character_action',
}

// ─── Масштаб: Spine-юниты → пиксели ──────────────────────────────────────────
// coin в Spine ≈ 480 ед. при scale=1, coin_main.scaleX=0.5 → ~240 ед.
// Нам нужно ~50px → scale ≈ 0.20

const ITEM_SCALE: Partial<Record<EventType, number>> = {
  COIN:    0.22,
  GOLD:    0.08,
  DIAMOND: 0.22,
  BOMB:    0.18,
  STONE:   0.08,
}

// ─── SpineAnimator ────────────────────────────────────────────────────────────

export class SpineAnimator {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static _skeletonData: any = null
  private static _loading: Promise<boolean> | null = null
  private static _instances: Spine[] = []

  // ── Загрузка ────────────────────────────────────────────────────────────────

  static load(): Promise<boolean> {
    if (!this._loading) this._loading = this._doLoad()
    return this._loading
  }

  private static async _doLoad(): Promise<boolean> {
    try {
      const [atlasText, spineJson, texture] = await Promise.all([
        fetch('./DeepRush_Items.atlas.txt').then(r => {
          if (!r.ok) throw new Error(`Atlas not found (${r.status})`)
          return r.text()
        }),
        fetch('./DeepRush_Items.json').then(r => {
          if (!r.ok) throw new Error(`Spine JSON not found (${r.status})`)
          return r.json()
        }),
        PIXI.Texture.fromURL('./DeepRush_Items.png'),
      ])

      const atlas = new TextureAtlas(
        atlasText,
        (_path: string, cb: (t: PIXI.BaseTexture) => void) => cb(texture.baseTexture),
      )

      // pixi-spine ships runtime-4.1 only; Spine 4.2 JSON is backwards-compatible.
      // Patch the version so the loader accepts the file.
      if (typeof spineJson.skeleton?.spine === 'string' &&
          spineJson.skeleton.spine.startsWith('4.2')) {
        spineJson.skeleton.spine = '4.1.24'
      }

      const skelJson = new SkeletonJson(new AtlasAttachmentLoader(atlas))
      skelJson.scale = 1
      this._skeletonData = skelJson.readSkeletonData(spineJson)

      console.log('[SpineAnimator] ✓ Loaded OK')
      return true
    } catch (e) {
      console.warn('[SpineAnimator] Failed to load:', e)
      return false
    }
  }

  // ── Фабрики ──────────────────────────────────────────────────────────────────

  /** Создать анимированный Spine-спрайт для пикапа */
  static createItem(type: EventType): Spine | null {
    const animName = ANIM_MAP[type]
    if (!animName) return null
    return this._make(animName, ITEM_SCALE[type] ?? 0.20)
  }

  /** Создать Spine-персонажа (character_idle / character_action) */
  static createCharacter(scale = 0.30): Spine | null {
    return this._make(CHAR_ANIM.idle, scale)
  }

  /** Тикнуть один конкретный инстанс напрямую (для персонажа) */
  static tickOne(inst: Spine | null, dt: number): void {
    if (!inst || (inst as any).destroyed) return
    try { inst.update(dt) } catch { /* ignore */ }
  }

  // ── Управление анимацией ────────────────────────────────────────────────────

  static setAnimation(inst: Spine | null, animName: string, loop = true): void {
    if (!inst || (inst as any).destroyed) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cur = (inst.state as any).tracks?.[0]
      if (cur?.animation?.name === animName) return
      if (inst.spineData.findAnimation(animName)) {
        inst.state.setAnimation(0, animName, loop)
      }
    } catch { /* ignore */ }
  }

  /**
   * Переключить анимацию и растянуть её на totalSeconds.
   * timeScale = animDuration / totalSeconds — один полный цикл за весь брейк.
   */
  static setAnimationSyncedTo(inst: Spine | null, animName: string, totalSeconds: number): void {
    if (!inst || (inst as any).destroyed) return
    try {
      const anim = inst.spineData.findAnimation(animName)
      if (!anim) return
      const animDuration = anim.duration   // секунды
      const timeScale = animDuration > 0 ? animDuration / Math.max(totalSeconds, 0.1) : 1
      inst.state.setAnimation(0, animName, true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const track = (inst.state as any).tracks?.[0]
      if (track) track.timeScale = timeScale
    } catch { /* ignore */ }
  }

  /** Удалить из пула тиков */
  static remove(inst: Spine | null): void {
    if (!inst) return
    const i = this._instances.indexOf(inst)
    if (i >= 0) this._instances.splice(i, 1)
  }

  /** Тикать все инстансы. Вызывать каждый кадр, dt в секундах. */
  static tick(dt: number): void {
    this._instances = this._instances.filter(inst => {
      if (!inst || (inst as any).destroyed) return false
      try {
        inst.update(dt)
        // bomb_star — слот бомбы, кость которого смещена на ~424px от центра скелета.
        // При каждом loop Spine на 1 кадр восстанавливает дефолт (bomb_flare) перед
        // применением keyframe t=0 → null. Вспышка появляется далеко от объекта.
        // Глушим безусловно после каждого update.
        const slot = inst.skeleton.findSlot('bomb_star')
        if (slot) slot.attachment = null
      } catch { /* ignore */ }
      return true
    })
  }

  static get ready(): boolean { return !!this._skeletonData }

  // ── Внутреннее ───────────────────────────────────────────────────────────────

  private static _make(animName: string, scale: number): Spine | null {
    if (!this._skeletonData) return null
    try {
      const spine = new Spine(this._skeletonData)
      if (spine.spineData.findAnimation(animName)) {
        spine.state.setAnimation(0, animName, true)
      }
      spine.scale.set(scale)
      spine.autoUpdate = false   // ручное управление через tick()
      // Применяем первый кадр анимации сразу
      spine.update(0)
      this._instances.push(spine)
      return spine
    } catch (e) {
      console.warn('[SpineAnimator] _make failed:', animName, e)
      return null
    }
  }
}

/** Хитбокс пикапа в пикселях на основе масштаба */
export function getSpineItemSize(type: EventType): { w: number; h: number } {
  const s = ITEM_SCALE[type] ?? 0.20
  // Spine-радиус ≈ 240 ед. → * scale = размер в пикселях
  const px = 240 * s * 0.5
  return { w: Math.max(px, TILE * 0.8), h: Math.max(px, TILE * 0.8) }
}