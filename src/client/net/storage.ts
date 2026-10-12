// localStorage helpers. Every access is guarded: private windows and blocked storage must not break the game.

const PREFIX = 'cirkel:'

function get(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

function set(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key)
    else localStorage.setItem(PREFIX + key, value)
  } catch {
    // ignore
  }
}

export function getName(): string {
  return get('name') ?? ''
}

export function setName(name: string): void {
  set('name', name.trim() || null)
}

export interface SeatToken {
  token: string
  seat: number
}

export function getSeatToken(gameId: string): SeatToken | null {
  const raw = get(`seat:${gameId}`)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as SeatToken
    return typeof v.token === 'string' ? v : null
  } catch {
    return null
  }
}

export function setSeatToken(gameId: string, v: SeatToken | null): void {
  set(`seat:${gameId}`, v ? JSON.stringify(v) : null)
}

/** The last turn whose replay this browser has seen, per game. */
export function getSeenTurn(gameId: string): number {
  return Number(get(`seen:${gameId}`) ?? 0)
}

export function setSeenTurn(gameId: string, turn: number): void {
  set(`seen:${gameId}`, String(turn))
}

export function getFlag(name: string): boolean {
  return get(`flag:${name}`) === '1'
}

export function setFlag(name: string, on: boolean): void {
  set(`flag:${name}`, on ? '1' : null)
}

export type QualityChoice = 'auto' | 'low' | 'medium' | 'high' | 'ultra'

export function getQuality(): QualityChoice {
  const v = get('quality')
  return v === 'low' || v === 'medium' || v === 'high' || v === 'ultra' ? v : 'auto'
}

export function setQuality(q: QualityChoice): void {
  set('quality', q === 'auto' ? null : q)
}

/** A game created to start at once (against bots): skip its lobby for a few seconds. */
export function markAutostart(gameId: string): void {
  set(`autostart:${gameId}`, String(Date.now()))
}

export function isAutostart(gameId: string): boolean {
  const t = Number(get(`autostart:${gameId}`) ?? 0)
  return Date.now() - t < 15_000
}

export function clearAutostart(gameId: string): void {
  set(`autostart:${gameId}`, null)
}
