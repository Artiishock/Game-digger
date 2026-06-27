import React, { useEffect, useRef, useState } from 'react'
import * as PIXI from 'pixi.js'
import { Assets } from 'pixi.js'
import { Spine, TextureAtlas, SpineTexture, SkeletonJson, AtlasAttachmentLoader } from '@esotericsoftware/spine-pixi-v8'
import type { WinCelebrateKind } from './winCelebration'
import { GameConfig, effectiveDevicePixelRatio } from '../game/GameConfig'

/**
 * Абсолютный URL папки приложения (рядом с index.html), с хвостом `/`.
 * Не используем `document.baseURI` один: на SPA-маршрутах `./animations/…` уходит не в `public/`,
 * Vite отдаёт index.html (200) и вместо атласа приходит `<!DOCTYPE html>…`.
 */
function getAppBaseHref(): string {
  if (typeof window === 'undefined') return '/'
  const bu = (import.meta.env.BASE_URL ?? '/').replace(/\\/g, '/')
  if (bu.startsWith('/')) {
    return `${window.location.origin}${bu.endsWith('/') ? bu : `${bu}/`}`
  }
  let href = new URL(bu || './', window.location.href).href
  if (!href.endsWith('/')) href += '/'
  return href
}

/** Файлы из `public/` — путь без ведущего слэша: `animations/bigwin/win_alerts.atlas`. */
function resolvePublicUrl(pathFromPublicDir: string): string {
  return new URL(pathFromPublicDir.replace(/^\/+/, ''), getAppBaseHref()).href
}

function isHtmlDocumentPayload(t: string): boolean {
  const s = t.trimStart().toLowerCase()
  return s.startsWith('<!doctype html') || s.startsWith('<html') || (s.startsWith('<!') && s.includes('<html'))
}

async function fetchWinAlertsAtlasTxt(kind: WinCelebrateKind): Promise<string> {
  const stems = [`animations/${kind}/win_alerts.atlas.txt`, `animations/${kind}/win_alerts.atlas`]
  const urls = stems.map(resolvePublicUrl)
  for (const url of urls) {
    const r = await fetch(url)
    if (!r.ok) continue
    let t = await r.text()
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
    if (isHtmlDocumentPayload(t)) continue
    return t
  }
  throw new Error(
    `нет Spine-атласа win_alerts (ожидался текст атласа, не HTML страницы). Проверенные URL:\n${urls.join('\n')}`,
  )
}

async function fetchWinAlertsJson(kind: WinCelebrateKind): Promise<Record<string, unknown>> {
  const url = resolvePublicUrl(`animations/${kind}/win_alerts.json`)
  const r = await fetch(url)
  if (!r.ok) throw new Error(`win_alerts.json ${r.status}`)
  const txt = await r.text()
  if (isHtmlDocumentPayload(txt)) {
    throw new Error(`win_alerts.json: сервер вернул HTML вместо JSON (${url})`)
  }
  try {
    return JSON.parse(txt) as Record<string, unknown>
  } catch {
    throw new Error(`win_alerts.json: невалидный JSON (${url})`)
  }
}

/** Строки-имена текстурных страниц в атласе Spine (`name.png` / `name.webp`). */
function atlasPageFiles(atlasText: string): string[] {
  const out: string[] = []
  for (const raw of atlasText.split('\n')) {
    const line = raw.trim()
    if (/^[\w.-]+\.(png|webp)$/i.test(line)) out.push(line)
  }
  return [...new Set(out)]
}

function atlasPageResolveKey(raw: string): string {
  return raw.replace(/\uFEFF/g, '').trim()
}

async function loadWinCelebrationSpine(kind: WinCelebrateKind): Promise<Spine> {
  const basePath = `animations/${kind}/`
  const [atlasText, spineJson] = await Promise.all([
    fetchWinAlertsAtlasTxt(kind),
    fetchWinAlertsJson(kind),
  ])

  if (!atlasText.trim()) {
    throw new Error('[WinCelebrationSpine] файл атласа пустой')
  }

  const pages = atlasPageFiles(atlasText)
  if (pages.length === 0) {
    throw new Error(
      `[WinCelebrationSpine] в атласе не найдено строк с *.png (начало файла): ${atlasText.slice(0, 160)}`,
    )
  }

  const urls = pages.map(p => resolvePublicUrl(`${basePath}${p}`))
  const textures = await Promise.all(
    urls.map(u =>
      Assets.load<PIXI.Texture>(u).catch((e: unknown) => {
        console.warn('[WinCelebrationSpine] PNG load failed:', u, e)
        throw e
      }),
    ),
  )
  const pageToTex = new Map(
    pages.map((p, i) => [atlasPageResolveKey(p), textures[i]!]),
  )

  // Регистрируем текстуры под basename в кэше PIXI до создания TextureAtlas,
  // чтобы spine-pixi-v8 не делал повторный запрос по короткому имени → 403
  for (const [name, tex] of pageToTex) {
    if (!Assets.cache.has(name)) Assets.cache.set(name, tex)
  }

  const atlas = new TextureAtlas(atlasText)
  for (const page of atlas.pages) {
    const key = atlasPageResolveKey(page.name)
    const tex = pageToTex.get(key)
    if (!tex) {
      throw new Error(
        `[WinCelebrationSpine] атлас ссылается на "${page.name}" (key "${key}"), в предзагрузке есть: ${[...pageToTex.keys()].join(', ')}`,
      )
    }
    if (page.pma) tex.source.alphaMode = 'premultiplied-alpha'
    page.setTexture(SpineTexture.from(tex.source))
  }

  if (atlas.regions.length === 0) {
    throw new Error(
      `[WinCelebrationSpine] 0 регионов после разбора атласа (pages=${pages.join(', ')}) — проверьте формат win_alerts.atlas`,
    )
  }

  const skelJson = new SkeletonJson(new AtlasAttachmentLoader(atlas))
  skelJson.scale = 1
  const data = skelJson.readSkeletonData(spineJson as never)
  const spine = new Spine(data)
  const names = data.animations.map(a => a.name)
  const anim = names.includes('animation') ? 'animation' : names[0]
  if (anim) spine.state.setAnimation(0, anim, true)
  return spine
}

/**
 * pixi-spine не синхронизирует timeline rgba слотов с PIXI slotContainers
 * (см. SpineAnimator._applySlotColors) — без этого win_alerts может быть пустым/без блика.
 */
function syncSlotContainerAlpha(inst: Spine): void {
  try {
    const skel = inst.skeleton
    const containers = (inst as Spine & { slotContainers?: PIXI.Container[] })
      .slotContainers as PIXI.Container[] | undefined
    if (!containers) return
    for (let i = 0; i < skel.slots.length; i++) {
      const slot = skel.slots[i]
      const c = containers[i]
      if (!slot || !c) continue
      const alpha = slot.color?.a ?? 1
      c.alpha = alpha
    }
  } catch {
    /* ignore */
  }
}

/** Доля min(W,H), в которую вписывается скелет (адаптивно на любом экране). */
const KIND_FIT_FRAC: Record<WinCelebrateKind, number> = {
  bigwin:  0.72,
  epicwin: 0.88,
  megawin: 0.72,
}

/** Смещение центра по Y в долях высоты хоста (положительное = вниз). */
const KIND_Y_OFFSET_FRAC: Record<WinCelebrateKind, number> = {
  bigwin:  0,
  epicwin: 0.04,
  megawin: 0,
}

function readHostSize(host: HTMLElement): { w: number; h: number } {
  const w = Math.max(1, Math.round(host.clientWidth))
  const h = Math.max(1, Math.round(host.clientHeight))
  return { w, h }
}

/** Фиксированный центр скелета (bind pose) — не пересчитываем getBounds() при resize. */
type SpineLayoutAnchor = {
  cx: number
  cy: number
  uw: number
  uh: number
}

function captureSpineLayoutAnchor(spine: Spine): SpineLayoutAnchor {
  spine.update(0)
  syncSlotContainerAlpha(spine)
  let b: { x: number; y: number; width: number; height: number } = spine.getBounds()
  if (!Number.isFinite(b.width) || b.width < 2 || !Number.isFinite(b.height) || b.height < 2) {
    const sd = spine.skeleton.data as { x?: number; y?: number; width?: number; height?: number }
    const rw = sd.width && sd.width > 0 ? sd.width : 1200
    const rh = sd.height && sd.height > 0 ? sd.height : 1500
    b = { x: sd.x ?? 0, y: sd.y ?? 0, width: rw, height: rh }
  }
  return {
    cx: b.x + b.width * 0.5,
    cy: b.y + b.height * 0.5,
    uw: b.width,
    uh: b.height,
  }
}

/** Масштаб ∝ min(W,H); центр экрана (доли 0.5) — позиция не плывёт при смене размера окна. */
function applySpineLayout(
  spine: Spine,
  w: number,
  h: number,
  anchor: SpineLayoutAnchor,
  fitFrac: number,
  yOffsetFrac = 0,
): void {
  const minSide = Math.min(w, h)
  const fitBox = minSide * fitFrac
  const s = Math.min(
    fitBox / Math.max(anchor.uw, 1e-3),
    fitBox / Math.max(anchor.uh, 1e-3),
  )
  spine.scale.set(s)
  spine.x = w * 0.5 - anchor.cx * s
  spine.y = h * (0.5 + yOffsetFrac) - anchor.cy * s
}

type Props = { kind: WinCelebrateKind; roundId: string }

/** Spine-анимация празднования (big / epic / mega) поверх экрана победы — вместо mp4. */
export const WinCelebrationSpine: React.FC<Props> = ({ kind, roundId }) => {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [errorText, setErrorText] = useState<string | null>(null)

  useEffect(() => {
    setErrorText(null)
    const el = wrapRef.current
    if (!el) return

    let alive = true
    let app: PIXI.Application | null = null
    let spine: Spine | null = null
    let ro: ResizeObserver | null = null
    let resizeRaf = 0
    let tickFn: (() => void) | null = null
    let onWindowResize: (() => void) | null = null
    let layoutAnchor: SpineLayoutAnchor | null = null

    const dispose = () => {
      layoutAnchor = null
      if (resizeRaf) {
        cancelAnimationFrame(resizeRaf)
        resizeRaf = 0
      }
      if (onWindowResize) {
        window.removeEventListener('resize', onWindowResize)
        onWindowResize = null
      }
      ro?.disconnect()
      ro = null
      // Stop ticker + renderer before touching the scene graph so no RAF fires
      // while we're mid-teardown (would crash on spine.renderGroup.ids === null).
      if (app) {
        app.ticker.stop()
        if (tickFn) app.ticker.remove(tickFn)
      }
      tickFn = null
      if (spine) {
        if (spine.parent) spine.parent.removeChild(spine)
        spine.destroy({ children: true })
        spine = null
      }
      if (app) {
        try {
          // Remove canvas from DOM manually — do NOT pass true to app.destroy().
          // app.destroy(true, ...) calls GlobalResourceRegistry.release() which
          // nukes the SHARED PixiJS batch pool, corrupting the main game renderer's
          // batches and causing a null.ids crash on every subsequent render frame.
          const canvas = app.canvas as HTMLCanvasElement
          if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
          app.destroy(false, { children: true })
        } catch {
          /* ignore */
        }
        app = null
      }
    }

    ;(async () => {
      try {
        const spineInst = await loadWinCelebrationSpine(kind)
        if (!alive) {
          spineInst.destroy({ children: true })
          return
        }
        spine = spineInst
        const sa = spine as Spine & { autoUpdate?: boolean }
        sa.autoUpdate = false

        const host0 = readHostSize(el)
        app = new PIXI.Application()
        try {
          await app.init({
            width: host0.w,
            height: host0.h,
            backgroundAlpha: 0,
            antialias: GameConfig.performance.webglAntialias,
            resolution: effectiveDevicePixelRatio(),
            autoDensity: true,
            hello: false,
          } as any)
        } catch {
          app = new PIXI.Application()
          await app.init({
            width: host0.w,
            height: host0.h,
            backgroundAlpha: 0,
            antialias: false,
            hello: false,
          } as any)
        }

        if (!alive) {
          dispose()
          return
        }

        const canvas = app.canvas as HTMLCanvasElement
        canvas.style.position = 'absolute'
        canvas.style.inset = '0'
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.display = 'block'
        canvas.style.pointerEvents = 'none'
        el.appendChild(canvas)

        const applyLayout = (): void => {
          if (!alive || !app || !spine) return
          const { w, h } = readHostSize(el)
          if (!layoutAnchor) {
            layoutAnchor = captureSpineLayoutAnchor(spine)
          }
          applySpineLayout(
            spine,
            w,
            h,
            layoutAnchor,
            KIND_FIT_FRAC[kind],
            KIND_Y_OFFSET_FRAC[kind],
          )
          app.renderer.resize(w, h)
          app.renderer.render({ container: app.stage })
        }

        app.stage.addChild(spine)
        applyLayout()

        const tick = () => {
          if (!alive || !app || !spine) return
          spine.update(app.ticker.deltaMS / 1000)
          syncSlotContainerAlpha(spine)
        }
        tickFn = tick
        app.ticker.add(tick)

        const scheduleReflow = (): void => {
          if (resizeRaf) cancelAnimationFrame(resizeRaf)
          resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0
            applyLayout()
          })
        }

        ro = new ResizeObserver(() => scheduleReflow())
        ro.observe(el)
        onWindowResize = () => scheduleReflow()
        window.addEventListener('resize', onWindowResize)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => applyLayout())
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn('[WinCelebrationSpine] failed to load', e)
        if (alive) setErrorText(msg)
      }
    })()

    return () => {
      alive = false
      dispose()
    }
  }, [kind, roundId])

  return (
    <div className={`ui-result-celebrate-canvas-wrap ui-result-celebrate-canvas-wrap--${kind}`}>
      {errorText && (
        <div className="ui-result-celebrate-fail" role="status">
          Не удалось показать анимацию победы ({errorText})
        </div>
      )}
      <div ref={wrapRef} className={`ui-result-celebrate-canvas ui-result-celebrate-canvas--${kind}`} aria-hidden />
    </div>
  )
}
