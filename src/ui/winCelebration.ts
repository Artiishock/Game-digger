import { GameConfig } from '../game/GameConfig'

export type WinCelebrateKind = 'megawin' | 'epicwin' | 'bigwin'

/**
 * По финальному множителю раунда (выигрыш / ставка) — какую Spine-анимацию празднования показать.
 * megawin ≥ epic ≥ big; ниже порога big — без отдельного клипа (только обычный экран победы).
 * Ассеты: `public/animations/{bigwin|epicwin|megawin}/win_alerts.*`
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

/**
 * То же распределение по tier, но при «обычном» победном множителе (≤ bigAbove)
 * всё равно показываем `bigwin`-Spine, чтобы на экране была анимация, а не только текст.
 */
export function resolveWinCelebrationOrFallback(multiplier: number): WinCelebrateKind | null {
  const tier = resolveWinCelebration(multiplier)
  if (tier != null) return tier
  return multiplier > 1 ? 'bigwin' : null
}
