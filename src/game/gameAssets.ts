import * as PIXI from 'pixi.js'
import { Assets } from 'pixi.js'
import { SpineAnimator } from './SpineAnimator'
import { resolvePublicUrl } from '../utils/publicUrl'

/**
 * Пути к PNG в public/assets (Vite отдаёт как /assets/...).
 */

export const GameAssets = {
  bg: './assets/bg_.png',
  rock: './assets/rock.png',
  cloud1: './assets/cloud1.png',
  cloud2: './assets/cloud2.png',
  cloud3: './assets/cloud3.png',
  cloud4: './assets/cloud4.png',
  cloud5: './assets/cloud5.png',
  cloud6: './assets/cloud6.png',
  forest: './assets/forest.png',
  tree1: './assets/tree1.png',
  tree2: './assets/tree2.png',
  tree3: './assets/tree3.png',
  hero: './assets/hero.png',
  grass: './assets/glass.png',
  earth1: './assets/earth1.png',
  earth2: './assets/earth2.png',
  earth3: './assets/earth3.png',
  lavaTex: './assets/lava.png',
  coin: './assets/coin.png',
  gold: './assets/gold.png',
  gem: './assets/gem.png',
  bomb: './assets/bomb.png',
  stone: './assets/stone.png',
  home: './assets/home.png',
} as const

const StartScreenAssets = [
  'rules/background.png',
  'rules/banner_logo.png',
  'rules/logo_magnetic.svg',
  'rules/multipliers.png',
  'rules/treats.png',
  'rules/places.png',
  'rules/button_left.svg',
  'rules/button_right.svg',
  'rules/point.svg',
  'rules/point_active.svg',
] as const

let _startupPreloadPromise: Promise<void> | null = null

function preloadDomImage(url: string): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve()

  return new Promise((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (!image.decode) {
        resolve()
        return
      }

      void image.decode().then(
        () => resolve(),
        () => resolve(),
      )
    }
    image.onerror = () => {
      console.warn(`[preload] failed dom image: ${url}`)
      resolve()
    }
    image.src = url
  })
}

/**
 * Предзагрузка ассетов перед показом игры.
 * Грузим все PNG и все Spine-наборы один раз за сессию.
 * onProgress вызывается с 0→1 по мере завершения каждого ассета.
 */
export function preloadStartupAssets(onProgress?: (progress: number) => void): Promise<void> {
  if (_startupPreloadPromise) return _startupPreloadPromise

  _startupPreloadPromise = (async () => {
    const textureUrls = Object.values(GameAssets)
    const spinePromises = [
      SpineAnimator.load(),
      SpineAnimator.loadHero(),
      SpineAnimator.loadGoldStone(),
    ]

    const total = textureUrls.length + StartScreenAssets.length + spinePromises.length
    let done = 0
    const tick = () => { onProgress?.(++done / total) }

    const textureLoads = textureUrls.map(async (url) => {
      try { await Assets.load<PIXI.Texture>(url) } catch { /* ignore */ }
      tick()
    })

    const startScreenLoads = StartScreenAssets.map(async (url) => {
      await preloadDomImage(resolvePublicUrl(url))
      tick()
    })

    const spineLoads = spinePromises.map(async (p) => {
      await p
      tick()
    })

    await Promise.all([...textureLoads, ...startScreenLoads, ...spineLoads])
  })()

  return _startupPreloadPromise
}
