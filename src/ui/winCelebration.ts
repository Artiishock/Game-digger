import { GameConfig } from '../game/GameConfig'

export type WinCelebrateKind = 'megawin' | 'epicwin' | 'bigwin'

/**
 * По финальному множителю раунда (выигрыш / ставка) — какую Spine-анимацию празднования показать.
 * Уровни: epic (наивысший) ≥ mega ≥ big; при множителе ≤ bigWinExclusiveAboveMultiplier — без tier-клипа.
 * Ассеты: `public/animations/{bigwin|epicwin|megawin}/win_alerts.*`
 */
export function resolveWinCelebration(multiplier: number): WinCelebrateKind | null {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null
  const r = GameConfig.round
  const epicMin = r.epicWinMinMultiplier
  const megaMin = r.megaWinMinMultiplier
  const bigAbove = r.bigWinExclusiveAboveMultiplier
  if (multiplier >= epicMin) return 'epicwin'
  if (multiplier >= megaMin) return 'megawin'
  if (multiplier > bigAbove) return 'bigwin'
  return null
}

/**
 * То же распределение по tier, но при «обычном» победном множителе (≤ bigWinExclusiveAboveMultiplier)
 * всё равно показываем `bigwin`-Spine, чтобы на экране была анимация, а не только текст.
 */
export function resolveWinCelebrationOrFallback(multiplier: number): WinCelebrateKind | null {
  const tier = resolveWinCelebration(multiplier)
  if (tier != null) return tier
  return multiplier > 1 ? 'bigwin' : null
}
