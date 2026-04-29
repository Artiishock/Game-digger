import { GameConfig } from '../game/GameConfig'

export type WinCelebrateKind = 'megawin' | 'epicwin' | 'bigwin'

/**
 * По финальному множителю раунда (выигрыш / ставка) — какой ролик празднования показать.
 * megawin ≥ epic ≥ big; ниже порога big — без отдельного клипа (только обычный экран победы).
 */
export function resolveWinCelebration(multiplier: number): WinCelebrateKind | null {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null
  const r = GameConfig.round
  const mega = r.megaWinMinMultiplier
  const epic = r.epicWinMinMultiplier
  const bigAbove = r.bigWinExclusiveAboveMultiplier
  if (multiplier >= mega) return 'megawin'
  if (multiplier >= epic) return 'epicwin'
  if (multiplier > bigAbove) return 'bigwin'
  return null
}

export function winCelebrationVideoSrc(kind: WinCelebrateKind): string {
  const b = import.meta.env.BASE_URL || '/'
  const base = b.endsWith('/') ? b : `${b}/`
  return `${base}animations/win/${kind}.mp4`
}
