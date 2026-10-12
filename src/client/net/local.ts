// An in-browser stand-in for the game server, speaking the same protocol. Enabled with `?local` in
// the URL. Used to develop and test the UI without a server; games live only in this tab.

import type { ClientMessage, GameSummary, ServerMessage } from '../../shared/protocol.ts'
import { botOrders, createGame, observe, observeEvents, resolveTurn } from '../../engine/index.ts'
import type { GameEvent, GameState, PlayerId, PlayerOrders } from '../../engine/types.ts'
import type { ConnStatus, Transport } from './connection.ts'

interface LocalGame {
  summary: GameSummary
  mapSize: 'small' | 'medium' | 'large'
  state: GameState | null
  previous: GameState | null
  events: GameEvent[]
  orders: Record<PlayerId, PlayerOrders>
  tokens: Record<string, PlayerId>
  host: string
}

export class LocalServer implements Transport {
  readonly status: ConnStatus = 'open'
  private games = new Map<string, LocalGame>()
  private current: { gameId: string; seat: PlayerId | null; token: string | null } | null = null
  private listeners = new Set<(m: ServerMessage) => void>()
  private hello: (() => ClientMessage[]) | null = null

  send(m: ClientMessage): void {
    setTimeout(() => this.handle(m), 40)
  }

  subscribe(fn: (m: ServerMessage) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  onStatus(): () => void {
    return () => {}
  }

  setHello(fn: (() => ClientMessage[]) | null): void {
    this.hello = fn
    if (fn) for (const m of fn()) this.send(m)
  }

  private emit(m: ServerMessage) {
    for (const fn of [...this.listeners]) fn(structuredClone(m))
  }

  private handle(m: ClientMessage) {
    void this.hello
    switch (m.type) {
      case 'list':
        return this.emit({ type: 'games', games: [...this.games.values()].map((g) => g.summary) })
      case 'create': {
        const id = Math.random().toString(36).slice(2, 8)
        const seats = Math.max(2, Math.min(4, m.options.seats))
        const now = Date.now()
        const g: LocalGame = {
          summary: {
            id, name: m.options.name, phase: 'lobby', turn: 0, createdAt: now, updatedAt: now,
            turnSeconds: m.options.turnSeconds ?? null,
            fog: m.options.fog ?? true,
            seats: Array.from({ length: seats }, (_, i) => ({
              seat: i,
              name: i === 0 ? m.playerName : i > seats - 1 - m.options.bots ? `Bot ${i}` : null,
              kind: i === 0 ? 'human' : i > seats - 1 - m.options.bots ? 'bot' : 'open',
              connected: i === 0,
              ready: false,
            })),
          },
          mapSize: m.options.mapSize ?? 'small',
          state: null, previous: null, events: [], orders: {}, tokens: {}, host: '',
        }
        const token = `t${Math.random().toString(36).slice(2)}`
        g.tokens[token] = 0
        g.host = token
        this.games.set(id, g)
        this.current = { gameId: id, seat: 0, token }
        this.emit({ type: 'joined', gameId: id, seat: 0, token, host: true })
        return this.emit({ type: 'summary', game: g.summary })
      }
      case 'resume':
      case 'watch':
      case 'join': {
        const g = this.games.get(m.gameId)
        if (!g) return this.emit({ type: 'error', code: 'not_found', message: 'That game does not exist.' })
        let seat: PlayerId | null = null
        let token: string | null = null
        if (m.type === 'resume') {
          if (!(m.token in g.tokens)) return this.emit({ type: 'error', code: 'bad_token', message: 'That seat token is not valid.' })
          seat = g.tokens[m.token]
          token = m.token
        } else if (m.type === 'join') {
          const open = g.summary.seats.find((s) => s.kind === 'open')
          if (!open || g.summary.phase !== 'lobby') return this.emit({ type: 'error', code: 'full', message: 'No open seat left.' })
          open.kind = 'human'
          open.name = m.playerName
          open.connected = true
          seat = open.seat
          token = `t${Math.random().toString(36).slice(2)}`
          g.tokens[token] = seat
        }
        this.current = { gameId: m.gameId, seat, token }
        if (seat !== null && token) this.emit({ type: 'joined', gameId: m.gameId, seat, token, host: token === g.host })
        this.emit({ type: 'summary', game: g.summary })
        if (g.state) this.sendState(g)
        return
      }
      case 'setSeat': {
        const g = this.cur()
        if (!g) return
        const s = g.summary.seats[m.seat]
        if (!s || s.kind === 'human') return
        s.kind = m.kind
        s.name = m.kind === 'bot' ? `Bot ${m.seat}` : null
        return this.emit({ type: 'summary', game: g.summary })
      }
      case 'start': {
        const g = this.cur()
        if (!g || g.summary.phase !== 'lobby') return
        for (const s of g.summary.seats) {
          if (s.kind === 'open') { s.kind = 'bot'; s.name = `Bot ${s.seat}` }
        }
        g.state = createGame({
          seed: g.summary.id,
          players: g.summary.seats.map((s) => ({ name: s.name ?? '?', kind: s.kind === 'human' ? 'human' : 'bot' })),
          mapSize: g.mapSize,
          fog: g.summary.fog,
        })
        g.summary.phase = 'planning'
        g.summary.turn = g.state.turn
        this.emit({ type: 'summary', game: g.summary })
        return this.sendState(g)
      }
      case 'orders': {
        const g = this.cur()
        if (!g || !g.state || this.current?.seat == null || m.turn !== g.state.turn) return
        const seat = this.current.seat
        g.orders[seat] = m.orders
        g.summary.seats[seat].ready = m.ready
        this.emit({ type: 'summary', game: g.summary })
        if (g.summary.seats.every((s) => s.kind === 'bot' || s.ready)) this.resolve(g)
        return
      }
      case 'ping':
        return this.emit({ type: 'pong' })
    }
  }

  private cur(): LocalGame | null {
    return this.current ? this.games.get(this.current.gameId) ?? null : null
  }

  private resolve(g: LocalGame) {
    const state = g.state!
    const orders: Record<PlayerId, PlayerOrders> = {}
    for (const s of g.summary.seats) {
      orders[s.seat] = s.kind === 'bot' ? botOrders(observe(state, s.seat), s.seat, state.turn) : g.orders[s.seat] ?? { units: {}, cities: {} }
    }
    const res = resolveTurn(state, orders)
    g.previous = state
    g.state = res.state
    g.events = res.events
    g.orders = {}
    for (const s of g.summary.seats) s.ready = false
    g.summary.turn = res.state.turn
    if (res.state.winner !== null) g.summary.phase = 'finished'
    this.emit({ type: 'summary', game: g.summary })
    this.sendState(g)
  }

  /** As the server does: a live player sees observe() and their own event stream; the eliminated
   * and everyone after the end see it all; spectators of a running fog game see nothing. */
  private sendState(g: LocalGame) {
    const seat = this.current?.seat ?? null
    if (seat === null && g.summary.fog && g.summary.phase === 'planning') {
      return this.emit({ type: 'error', code: 'fog_hidden', message: 'This game has fog of war. You can watch it when it ends.' })
    }
    const all = seat === null || g.summary.phase === 'finished' || !g.state!.players[seat]?.alive
    const view = (s: GameState) => (all ? s : observe(s, seat))
    this.emit({
      type: 'state', gameId: g.summary.id, you: seat, state: view(g.state!),
      previous: g.previous ? view(g.previous) : null,
      events: all || !g.previous ? g.events : observeEvents(g.previous, g.events, seat),
      myOrders: seat !== null ? g.orders[seat] ?? null : null, deadline: null,
    })
  }
}
