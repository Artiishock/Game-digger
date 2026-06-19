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
  betID:     string | null   // Legacy replay (?betID=xxx)
  // New Stake Bet Replay params (?replay=true&game=...&version=...&mode=...&event=...)
  isReplay:       boolean
  replayGame:     string | null
  replayVersion:  string | null
  replayBetMode:  string | null
  replayEvent:    string | null
  replayAmount:   number | null   // bet amount in API units (÷ MONEY_SCALE = display)
  replayCurrency: string | null
  social:         boolean
}

export function getUrlParams(): UrlParams {
  const p = new URLSearchParams(window.location.search)
  const rawLang = p.get('locale') ?? p.get('lang') ?? 'en'
  const rawAmount = p.get('amount')
  return {
    sessionID: p.get('sessionID') ?? 'demo',
    lang:      rawLang.split('-')[0].toLowerCase(),
    device:    (p.get('device')   ?? 'desktop') as 'mobile' | 'desktop',
    rgsUrl:    p.get('rgs_url')   ?? '',
    betID:     p.get('betID') ?? p.get('roundID') ?? null,
    // New replay params
    isReplay:       p.get('replay') === 'true',
    replayGame:     p.get('game'),
    replayVersion:  p.get('version') ?? p.get('front'),
    replayBetMode:  p.get('mode'),
    replayEvent:    p.get('event') ?? p.get('eventId'),
    replayAmount:   rawAmount !== null ? Number(rawAmount) : null,
    replayCurrency: p.get('currency'),
    social:         p.get('social') === 'true',
  }
}

/** True when no rgs_url is present → run in FUN/demo mode */
export function isDemo(): boolean {
  const p = getUrlParams()
  return !p.isReplay && !p.rgsUrl
}

/** True when Stake opens the game for bet replay (?replay=true or legacy ?betID=...) */
export function isReplayMode(): boolean {
  const p = getUrlParams()
  return p.isReplay || (p.betID !== null && p.rgsUrl !== '')
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
      const data = text ? JSON.parse(text) as { statusCode?: string; error?: string; message?: string } : null
      if (data?.error) code = data.error
      else if (data?.statusCode) code = data.statusCode
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
  const { sessionID, betID } = getUrlParams()
  const body: Record<string, unknown> = { sessionID }
  if (betID) body.betID = betID
  const raw = await post<any>('/wallet/authenticate', body)
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

// ─── Bet Replay (new Stake Engine format) ────────────────────────────────────

export interface ReplayDataResponse {
  payoutMultiplier: number
  costMultiplier:   number
  events:           RoundEvent[]
}

async function _fetchReplayFromUrl(url: string): Promise<ReplayDataResponse> {
  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), RGS_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, { signal: ctrl.signal })
  } catch (e: any) {
    console.error('[RGS] fetchReplay network/timeout error:', e?.message ?? e)
    throw new RgsError(e?.name === 'AbortError' ? 'ERR_TIMEOUT' : 'ERR_GEN')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    console.error('[RGS] fetchReplay status', res.status)
    throw new RgsError(`HTTP_${res.status}`, res.status)
  }

  let raw: any
  try { raw = await res.json() } catch {
    throw new RgsError('ERR_GEN')
  }

  const stateArr: any[] = Array.isArray(raw?.state)      ? raw.state
                        : Array.isArray(raw?.events)     ? raw.events
                        : Array.isArray(raw?.bookEvents) ? raw.bookEvents
                        : []
  if (!stateArr.length) {
    console.error('[RGS] fetchReplay: empty state in response:', raw)
    throw new RgsError('ERR_GEN')
  }

  const events: RoundEvent[] = stateArr.map((ev: any) => {
    const out: any = {
      ...ev,
      type:     ev.type,
      depth:    Number(ev.depth    ?? 0),
      distance: Number(ev.distance ?? 0),
    }
    if (ev.effect && typeof ev.effect === 'object') {
      out.effect = { op: String(ev.effect.op), value: Number(ev.effect.value ?? 0) }
    }
    if (ev.multiplierSnap != null) out.multiplierSnap = Number(ev.multiplierSnap)
    if (ev.durationMs    != null) out.durationMs     = Number(ev.durationMs)
    return out as RoundEvent
  })

  const rawPayout = Number(raw?.payoutMultiplier ?? 0)
  const payoutMultiplier = rawPayout > 100 ? rawPayout / 100 : rawPayout
  const rawCost = Number(raw?.costMultiplier ?? 1)
  const costMultiplier = rawCost > 100 ? rawCost / 100 : rawCost

  return { payoutMultiplier, costMultiplier, events }
}

/**
 * Fetch replay state from RGS — no session required.
 * GET {rgs_url}/bet/replay/{game}/{version}/{mode}/{event}
 * Used on game load when opened with ?replay=true URL params.
 */
export async function fetchReplayData(): Promise<ReplayDataResponse> {
  const { rgsUrl, replayGame, replayVersion, replayBetMode, replayEvent } = getUrlParams()
  if (!rgsUrl || !replayGame || !replayVersion || !replayBetMode || !replayEvent) {
    console.error('[RGS] fetchReplayData: missing URL params', { rgsUrl, replayGame, replayVersion, replayBetMode, replayEvent })
    throw new RgsError('ERR_GEN')
  }
  const base = rgsUrl.startsWith('http') ? rgsUrl.replace(/\/$/, '') : `https://${rgsUrl}`
  return _fetchReplayFromUrl(`${base}/bet/replay/${replayGame}/${replayVersion}/${replayBetMode}/${replayEvent}`)
}

/**
 * Fetch replay data for a specific eventId using the current session's rgsUrl.
 * Game slug and version are parsed from the page URL pathname.
 * Used by the in-game history panel to replay past rounds via Stake API.
 */
export async function fetchReplayDataByEventId(eventId: string): Promise<ReplayDataResponse> {
  const p = new URLSearchParams(window.location.search)
  const { rgsUrl } = getUrlParams()
  if (!rgsUrl) throw new RgsError('ERR_GEN')

  // Prefer URL params (game=, version= or front=), fall back to pathname parsing
  let game    = p.get('game') ?? ''
  let version = p.get('version') ?? p.get('front') ?? ''
  if (!game || !version) {
    const parts = window.location.pathname.split('/').filter(Boolean)
    const htmlIdx = parts.findIndex(seg => seg.endsWith('.html'))
    const pathParts = htmlIdx >= 0 ? parts.slice(0, htmlIdx) : parts
    game    = game    || pathParts[pathParts.length - 2] || ''
    version = version || pathParts[pathParts.length - 1] || ''
  }

  if (!game || !version) {
    console.error('[RGS] fetchReplayDataByEventId: cannot determine game/version', { search: window.location.search, pathname: window.location.pathname })
    throw new RgsError('ERR_GEN')
  }

  const mode = p.get('mode') ?? 'base'
  const base = rgsUrl.startsWith('http') ? rgsUrl.replace(/\/$/, '') : `https://${rgsUrl}`
  return _fetchReplayFromUrl(`${base}/bet/replay/${game}/${version}/${mode}/${eventId}`)
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
