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

export const MONEY_SCALE = 1_000_000

// ─── URL params (injected by Stake Engine) ───────────────────────────────────

export interface UrlParams {
  sessionID: string
  lang:      string
  device:    'mobile' | 'desktop'
  rgsUrl:    string
}

export function getUrlParams(): UrlParams {
  const p = new URLSearchParams(window.location.search)
  return {
    sessionID: p.get('sessionID') ?? 'demo',
    lang:      p.get('lang')      ?? 'en',
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
export type EventType = 'COIN' | 'GOLD' | 'DIAMOND' | 'BOMB' | 'STONE' | 'LAVA' | 'HOME'

export interface RoundEvent {
  type:             EventType
  depth:            number   // metres from surface
  distance:         number   // path distance metres
  multiplierBefore: number   // multiplier BEFORE this event — вычисляется в gameStore.setEvents, RGS не присылает
  multiplierSnap:   number   // multiplier AFTER this event — приходит от RGS
  durationMs?:      number   // GOLD / STONE: time to destroy
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

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { rgsUrl } = getUrlParams()
  const base = rgsUrl.startsWith('http') ? rgsUrl.replace(/\/$/, '') : `https://${rgsUrl}`
  const url  = `${base}${path}`

  let res: Response
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
  } catch (e) {
    throw new RgsError('ERR_GEN')
  }

  if (!res.ok) {
    let code = `HTTP_${res.status}`
    try {
      const data = await res.json() as { statusCode?: string }
      if (data.statusCode) code = data.statusCode
    } catch { /* ignore */ }
    throw new RgsError(code, res.status)
  }

  return res.json() as Promise<T>
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function authenticate(): Promise<AuthResponse> {
  const { sessionID } = getUrlParams()
  return post<AuthResponse>('/wallet/authenticate', { sessionID })
}

export async function getBalance(): Promise<MoneyAmount> {
  const { sessionID } = getUrlParams()
  const r = await post<{ balance: MoneyAmount }>('/wallet/balance', { sessionID })
  return r.balance
}

/** betDisplay — display dollars (e.g. 1.00).  Converted to API units internally. */
export async function play(betDisplay: number): Promise<PlayResponse> {
  const { sessionID } = getUrlParams()
  return post<PlayResponse>('/wallet/play', {
    sessionID,
    amount: Math.round(betDisplay * MONEY_SCALE),
    mode:   'BASE',
  })
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
  if (currency === 'FUN' || currency === 'XGC' || currency === 'XSC') {
    return `${d.toFixed(2)} ${currency}`
  }
  try {
    return new Intl.NumberFormat('en-US', {
      style:                 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(d)
  } catch {
    return `${d.toFixed(2)} ${currency}`
  }
}