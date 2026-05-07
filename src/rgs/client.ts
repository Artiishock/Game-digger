/**
 * ═══════════════════════════════════════════════════════════
 *  Stake Engine RGS Client  — Deep Rush
 * ═══════════════════════════════════════════════════════════
 *
 *  Game URL structure (set by Stake Engine host):
 *  https://{team}.cdn.stake-engine.com/{gameID}/{ver}/index.html
 *    ?sessionID={sid}&lang={lang}&device={device}&rgs_url={url}
 *
 *  Money: integers with 6 implied decimal places
 *    1_000_000  =  $1.00
 *    100_000    =  $0.10
 */

import _currencyList from '../../public/Supported_currencies.json'

export const MONEY_SCALE = 1_000_000

// ─── Currency helpers ─────────────────────────────────────────────────────────

export interface CurrencyEntry {
  currency:     string   // full name, e.g. "United States Dollar"
  abbreviation: string   // ISO code,  e.g. "USD"
  display:      string   // symbol,    e.g. "$"
  example:      string   // formatted, e.g. "$10.00"
}

const _currencyMap: Record<string, CurrencyEntry> = Object.fromEntries(
  (_currencyList as CurrencyEntry[]).map((e) => [e.abbreviation, e])
)

/** Returns the display symbol for a currency code, falls back to the code itself.
 *  getCurrencySymbol('USD') → '$'
 *  getCurrencySymbol('XGC') → 'GC'
 *  getCurrencySymbol('FUN') → 'FUN'
 */
export function getCurrencySymbol(code: string): string {
  return _currencyMap[code]?.display ?? code
}

// ─── URL params (injected by Stake Engine) ───────────────────────────────────

export interface UrlParams {
  sessionID: string
  lang:      string
  device:    'mobile' | 'desktop'
  rgsUrl:    string
}

export function getUrlParams(): UrlParams {
  const p = new URLSearchParams(window.location.search)
  const rawLang = p.get('locale') ?? p.get('lang') ?? 'en'
  return {
    sessionID: p.get('sessionID') ?? 'demo',
    lang:      rawLang.split('-')[0].toLowerCase(),
    device:    (p.get('device')   ?? 'desktop') as 'mobile' | 'desktop',
    rgsUrl:    p.get('rgs_url')   ?? '',
  }
}

/** True when no rgs_url is present → run in FUN/demo mode */
export function isDemo(): boolean {
  return !getUrlParams().rgsUrl
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MoneyAmount {
  amount:   number   // API units (÷ MONEY_SCALE = display)
  currency: string
}

export interface JurisdictionConfig {
  socialCasino:        boolean
  disabledFullscreen:  boolean
  disabledTurbo:       boolean
}

export interface RgsConfig {
  minBet:          number
  maxBet:          number
  stepBet:         number
  defaultBetLevel: number
  betLevels:       number[]
  jurisdiction:    JurisdictionConfig
}

/** A single event in a game round — Deep Rush flavour */
export type EventType = 'COIN' | 'GOLD' | 'DIAMOND' | 'BOMB' | 'STONE' | 'HOME' | 'LAVA'

/** Детерминированный эффект события на множитель — единственный источник правды. */
export interface EventEffect {
  op:    'add' | 'sub' | 'mul' | 'div'
  value: number
}

export interface RoundEvent {
  type:            EventType
  depth:           number   // metres from surface
  distance:        number   // path distance metres
  effect?:         EventEffect   // явный эффект на множитель (для COIN/GOLD/DIAMOND/BOMB/STONE)
  durationMs?:     number   // GOLD/STONE: миллисекунды паузы (tier×500 для sN/gN из демо)
  /** @deprecated используется `effect`. Оставлено для совместимости старых рекордов. */
  multiplierSnap?: number
}

export interface RgsRound {
  roundID:          string
  payoutMultiplier: number
  isActive:         boolean
  events:           RoundEvent[]
}

export interface AuthResponse {
  balance: MoneyAmount
  config:  RgsConfig
  round?:  RgsRound   // active or last completed round (for resume)
}

export interface PlayResponse {
  balance: MoneyAmount
  round:   RgsRound
}

export interface EndRoundResponse {
  balance: MoneyAmount
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class RgsError extends Error {
  constructor(
    public readonly code: string,   // ERR_IPB, ERR_IS, ERR_ATE, ERR_GLE, ERR_LOC …
    public readonly httpStatus?: number
  ) {
    super(code)
    this.name = 'RgsError'
  }
}

const ERR_MESSAGES: Record<string, string> = {
  ERR_VAL:         'Неверный запрос',
  ERR_IPB:         'Недостаточно средств',
  ERR_IS:          'Сессия истекла',
  ERR_ATE:         'Ошибка аутентификации',
  ERR_GLE:         'Превышен лимит ставок',
  ERR_LOC:         'Недоступно в вашем регионе',
  ERR_GEN:         'Ошибка сервера',
  ERR_MAINTENANCE: 'Сервер на техническом обслуживании',
}

export function rgsErrorMessage(code: string): string {
  return ERR_MESSAGES[code] ?? `Ошибка: ${code}`
}

// ─── HTTP layer ───────────────────────────────────────────────────────────────

const RGS_TIMEOUT_MS = 10_000

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { rgsUrl } = getUrlParams()
  const base = rgsUrl.startsWith('http') ? rgsUrl.replace(/\/$/, '') : `https://${rgsUrl}`
  const url  = `${base}${path}`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), RGS_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  ctrl.signal,
    })
  } catch (e: any) {
    console.error('[RGS]', path, 'network/timeout error:', e?.message ?? e)
    throw new RgsError(e?.name === 'AbortError' ? 'ERR_TIMEOUT' : 'ERR_GEN')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let text = ''
    try {
      text = await res.text()
      const data = text ? JSON.parse(text) as { statusCode?: string; message?: string } : null
      if (data?.statusCode) code = data.statusCode
    } catch { /* ignore */ }
    console.error('[RGS]', path, 'status', res.status, 'body:', text)
    throw new RgsError(code, res.status)
  }

  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch (e) {
    console.error('[RGS]', path, 'invalid JSON response:', text.slice(0, 200))
    throw new RgsError('ERR_GEN')
  }
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function authenticate(): Promise<AuthResponse> {
  const { sessionID } = getUrlParams()
  const raw = await post<any>('/wallet/authenticate', { sessionID })
  const out: AuthResponse = {
    balance: raw?.balance ?? { amount: 0, currency: 'USD' },
    config:  raw?.config  ?? {
      minBet: 100_000, maxBet: 1_000_000_000, stepBet: 100_000,
      defaultBetLevel: 1_000_000, betLevels: [1_000_000],
      jurisdiction: { socialCasino: false, disabledFullscreen: false, disabledTurbo: false },
    },
  }
  // Активный незавершённый раунд (resume after disconnect)
  const ar = raw?.round ?? raw?.activeRound
  if (ar) {
    try {
      const rep = normalisePlayResponse({ balance: out.balance, round: ar })
      out.round = rep.round
    } catch { /* нет активного раунда — ок */ }
  }
  return out
}

export async function getBalance(): Promise<MoneyAmount> {
  const { sessionID } = getUrlParams()
  const r = await post<{ balance: MoneyAmount }>('/wallet/balance', { sessionID })
  return r.balance
}

/**
 * betDisplay — display dollars (e.g. 1.00).  Converted to API units internally.
 *
 * Stake RGS возвращает книгу из math-sdk as-is, но обёртка вокруг неё может
 * отличаться: `round.events` или `round.bookEvents`, payoutMultiplier как
 * float/int×100, isActive как bool/string. Нормализуем формат прямо здесь,
 * чтобы вся остальная игра работала с единым контрактом.
 */
export async function play(betDisplay: number): Promise<PlayResponse> {
  const { sessionID } = getUrlParams()
  const raw = await post<any>('/wallet/play', {
    sessionID,
    amount: Math.round(betDisplay * MONEY_SCALE),
    mode:   'base',
  })
  return normalisePlayResponse(raw)
}

function normalisePlayResponse(raw: any): PlayResponse {
  // Книга может лежать в `round` или в самом raw
  const r = raw?.round ?? raw

  // У Stake Engine события приходят в `round.state` (а не `events`).
  // Поддерживаем оба ключа для совместимости с локальным mock и Stake.
  const events: any[] = Array.isArray(r?.state)       ? r.state
                      : Array.isArray(r?.events)      ? r.events
                      : Array.isArray(r?.bookEvents)  ? r.bookEvents
                      : []
  if (!events.length) {
    console.error('[RGS] play returned no events. Raw response:', raw)
    throw new RgsError('ERR_GEN')
  }

  const normEvents: RoundEvent[] = events.map((ev: any) => {
    // Базовые поля, всегда нормализуем как числа.
    const out: any = {
      ...ev,                                    // не теряем лишние/будущие поля
      type:     ev.type,
      depth:    Number(ev.depth ?? 0),
      distance: Number(ev.distance ?? 0),
    }
    // effect — основной источник правды (op + value); если пришёл — кастуем value.
    if (ev.effect && typeof ev.effect === 'object') {
      out.effect = {
        op:    String(ev.effect.op),
        value: Number(ev.effect.value ?? 0),
      }
    }
    if (ev.multiplierSnap != null) out.multiplierSnap = Number(ev.multiplierSnap)
    if (ev.durationMs != null)     out.durationMs     = Number(ev.durationMs)
    return out as RoundEvent
  })

  // payoutMultiplier у Stake Engine может быть int×100 (как в book) или
  // уже float — нормализуем по эвристике.
  const rawPayout = Number(r?.payoutMultiplier ?? 0)
  const payoutMultiplier = rawPayout > 100 ? rawPayout / 100 : rawPayout

  // active (Stake) | isActive (mock/SDK) | state-строка
  const stateStr = typeof r?.state === 'string' ? r.state.toUpperCase() : ''
  const isActive = typeof r?.active === 'boolean'   ? r.active
                 : typeof r?.isActive === 'boolean' ? r.isActive
                 : (stateStr === 'ACTIVE' || payoutMultiplier > 0)

  // roundID может прийти как betID (Stake), id (book) или roundID (mock)
  const roundID = String(r?.roundID ?? r?.betID ?? r?.id ?? '')

  return {
    balance: raw?.balance ?? { amount: 0, currency: 'USD' },
    round: {
      roundID,
      payoutMultiplier,
      isActive,
      events: normEvents,
    },
  }
}

export async function endRound(): Promise<EndRoundResponse> {
  const { sessionID } = getUrlParams()
  return post<EndRoundResponse>('/wallet/end-round', { sessionID })
}

/** Track mid-round state (allows resume on disconnect) */
export async function sendEvent(eventData: string): Promise<void> {
  const { sessionID } = getUrlParams()
  await post('/bet/event', { sessionID, event: eventData })
}

// ─── Money helpers ────────────────────────────────────────────────────────────

export function toDisplay(apiAmount: number): number {
  return apiAmount / MONEY_SCALE
}

export function toApi(displayAmount: number): number {
  return Math.round(displayAmount * MONEY_SCALE)
}

export function formatMoney(apiAmount: number, currency: string): string {
  const d = toDisplay(apiAmount)
  // Non-ISO currencies (demo, Stake virtual): use display symbol from JSON
  if (!_currencyMap[currency]) {
    return `${d.toFixed(2)} ${currency}`
  }
  if (currency === 'XGC' || currency === 'XSC') {
    const sym = getCurrencySymbol(currency)
    return `${d.toFixed(2)} ${sym}`
  }
  try {
    return new Intl.NumberFormat('en-US', {
      style:                 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(d)
  } catch {
    return `${d.toFixed(2)} ${getCurrencySymbol(currency)}`
  }
}
