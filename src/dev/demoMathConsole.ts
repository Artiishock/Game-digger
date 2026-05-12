/**
 * Только dev: глобальный API для подстановки base_coeff из математики под тест big/epic/mega win UI.
 * Подключён из main.tsx; в production не бандлится по смыслу (условие import.meta.env.DEV).
 */
import * as Demo from '../rgs/demo'
import { GameConfig } from '../game/GameConfig'

const r = GameConfig.round

if (import.meta.env.DEV) {
  const api = {
    help() {
      console.log(
        `%c__DEEP_RUSH_MATH_DEV%c (FUN / demo, без rgs_url)\n` +
          `  .nextBig()     — → bigwin (×>${r.bigWinExclusiveAboveMultiplier}, < ${r.megaWinMinMultiplier})\n` +
          `  .nextMega()    — → megawin (×≥${r.megaWinMinMultiplier}, < ${r.epicWinMinMultiplier})\n` +
          `  .nextEpic()    — → epicwin (×≥${r.epicWinMinMultiplier})\n` +
          `  .nextCoeff(n)  — ближайший доступный base_coeff к числу n (/math/road…)\n` +
          `  .clear()       — сброс очереди\n` +
          `  .peek()        — что в очереди\n` +
          `Затем DIG — один раунд с этой математикой.`,
        'color:#7CFC00;font-weight:bold',
        'color:inherit;font-weight:normal',
      )
    },

    nextBig: () => Demo.devQueueCelebrateAnimation('bigwin'),

    nextEpic: () => Demo.devQueueCelebrateAnimation('epicwin'),

    nextMega: () => Demo.devQueueCelebrateAnimation('megawin'),

    nextCoeff: (n: number) => Demo.devQueueForcedCoeff(n),

    clear: () => Demo.devClearForcedCoefficientQueue(),

    peek: () => Demo.devGetForcedCoefficientQueueHint(),
  }

  ;(window as unknown as { __DEEP_RUSH_MATH_DEV: typeof api }).__DEEP_RUSH_MATH_DEV = api

  console.info(
    '%c[DEV] __DEEP_RUSH_MATH_DEV',
    'color:#7CFC00',
    '— наберите __DEEP_RUSH_MATH_DEV.help() в консоли (Demo / FUN).',
  )
}
