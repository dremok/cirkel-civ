// One game as seen by this browser: lobby summary, my seat, the latest state message.
// Binds the shared connection to the game (resume with the stored token, else watch).

import type { ClientMessage, GameSummary, ServerMessage } from '../../shared/protocol.ts'
import type { PlayerId, PlayerOrders } from '../../engine/types.ts'
import { connection, type ConnStatus, type Transport } from './connection.ts'
import { errorText } from './errors.ts'
import { getSeatToken, setSeatToken } from './storage.ts'

export type StateMessage = Extract<ServerMessage, { type: 'state' }>

export interface GameSnapshot {
  gameId: string
  status: ConnStatus
  summary: GameSummary | null
  seat: PlayerId | null
  host: boolean
  view: StateMessage | null
  /** The game does not exist (or the server refused to show it). */
  missing: boolean
  /** Bumped on every 'state' message, so effects can react to repeats. */
  stateSeq: number
  /** A running fog-of-war game: spectators only get the summary until it ends. */
  fogHidden: boolean
}

export class GameSession {
  private snap: GameSnapshot
  private listeners = new Set<() => void>()
  private unsub: (() => void)[] = []
  private conn: Transport
  /** True while our resume / watch has not been answered yet. */
  private awaitingHello = true
  /** Errors that are not about joining (a refused order, a full game). */
  onError: ((message: string) => void) | null = null

  constructor(readonly gameId: string) {
    this.conn = connection()
    const tok = getSeatToken(gameId)
    this.snap = {
      gameId, status: this.conn.status, summary: null, seat: tok?.seat ?? null, host: false,
      view: null, missing: false, stateSeq: 0, fogHidden: false,
    }
    this.unsub.push(this.conn.subscribe((m) => this.onMessage(m)))
    this.unsub.push(this.conn.onStatus((s) => {
      if (s !== 'open') this.awaitingHello = true
      this.patch({ status: s })
    }))
    this.conn.setHello(() => this.hello())
  }

  dispose(): void {
    for (const u of this.unsub) u()
    this.conn.setHello(null)
    this.listeners.clear()
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): GameSnapshot => this.snap

  join(playerName: string): void {
    this.conn.send({ type: 'join', gameId: this.gameId, playerName })
  }

  setSeat(seat: PlayerId, kind: 'bot' | 'open'): void {
    this.conn.send({ type: 'setSeat', seat, kind })
  }

  start(): void {
    this.conn.send({ type: 'start' })
  }

  sendOrders(turn: number, orders: PlayerOrders, ready: boolean): void {
    this.conn.send({ type: 'orders', turn, orders, ready })
  }

  private hello(): ClientMessage[] {
    this.awaitingHello = true
    const tok = getSeatToken(this.gameId)
    return [tok ? { type: 'resume', gameId: this.gameId, token: tok.token } : { type: 'watch', gameId: this.gameId }]
  }

  private patch(p: Partial<GameSnapshot>) {
    this.snap = { ...this.snap, ...p }
    for (const fn of this.listeners) fn()
  }

  private onMessage(m: ServerMessage) {
    switch (m.type) {
      case 'joined':
        if (m.gameId !== this.gameId) return
        this.awaitingHello = false
        setSeatToken(m.gameId, { token: m.token, seat: m.seat })
        this.patch({ seat: m.seat, host: m.host, missing: false })
        return
      case 'summary':
        if (m.game.id !== this.gameId) return
        this.awaitingHello = false
        this.patch({ summary: m.game, missing: false })
        return
      case 'state':
        if (m.gameId !== this.gameId) return
        this.awaitingHello = false
        this.patch({ view: m, stateSeq: this.snap.stateSeq + 1, missing: false, fogHidden: false })
        return
      case 'error': {
        const code = m.code
        if (code === 'stale_turn') return
        if (code === 'fog_hidden') {
          this.awaitingHello = false
          this.patch({ fogHidden: true, view: null })
          return
        }
        const hadToken = !!getSeatToken(this.gameId)
        if (code === 'bad_token' || code === 'kicked' || (!code && this.awaitingHello && hadToken)) {
          // The seat is gone: forget the token and keep watching.
          setSeatToken(this.gameId, null)
          this.patch({ seat: null, host: false })
          this.conn.send({ type: 'watch', gameId: this.gameId })
          if (code === 'kicked') this.onError?.(errorText(m) ?? m.message)
          return
        }
        if (code === 'not_found' || (!code && this.awaitingHello)) {
          this.awaitingHello = false
          this.patch({ missing: true })
          return
        }
        const text = errorText(m)
        if (text) this.onError?.(text)
        return
      }
    }
  }
}
