// Rooms and the turn cycle. Transport-agnostic: a Conn is anything that can receive a JSON string,
// so this file knows nothing about sockets. The server is authoritative: clients only send orders.
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { botOrders, createGame, hashString, observe, observeEvents, resolveTurn } from '../engine/index.ts'
import type { GameConfig, GameState, PlayerId, PlayerOrders, ResolveResult } from '../engine/types.ts'
import type { ClientMessage, CreateOptions, ErrorCode, GameSummary, ServerMessage } from '../shared/protocol.ts'
import { SCHEMA_VERSION } from './migrate.ts'
import type { Store } from './store.ts'
import type { GameRecord, SeatRecord } from './types.ts'
import { BadRequest, parseClientMessage, sanitizeOrders } from './validate.ts'

export interface Conn {
  send(data: string): void
  room: Room | null
  seat: PlayerId | null // null = spectator (or not in a game)
  /** Sent 'list' and has not entered a game since: gets 'games' pushes when the list changes. */
  listening: boolean
}

class Room {
  conns = new Set<Conn>()
  timer: NodeJS.Timeout | null = null
  constructor(public rec: GameRecord) {}
}

class Refused extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message)
  }
}

function refuse(code: ErrorCode, message: string): never {
  throw new Refused(code, message)
}

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const MAX_TIMEOUT = 2 ** 31 - 1
const LIST_LIMIT = 50
const FOG_HIDDEN = 'This game has fog of war. You can watch it when it ends.'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const botSeat = (i: number): SeatRecord => ({ kind: 'bot', name: `Bot ${i + 1}`, tokenHash: null })
const openSeat = (): SeatRecord => ({ kind: 'open', name: null, tokenHash: null })
/** "Anna's game", "Lars' game". */
const defaultName = (player: string) => `${player}${/s$/i.test(player) ? "'" : "'s"} game`

export interface HubOptions {
  /** Lobbies untouched this long, with nobody connected, are deleted. */
  lobbyTtlMs: number
}

export class Hub {
  private rooms = new Map<string, Room>()
  private conns = new Set<Conn>()
  private listTimer: NodeJS.Timeout | null = null

  constructor(private store: Store, private opts: HubOptions) {}

  /** Loads persisted games and catches up on turns that became due while the server was down. */
  async load(): Promise<void> {
    for (const rec of await this.store.loadAll()) this.rooms.set(rec.id, new Room(rec))
    const planning = [...this.rooms.values()].filter((r) => r.rec.phase === 'planning')
    console.log(`hub: loaded ${this.rooms.size} games (${planning.length} in progress) from ${this.store.dir}`)
    for (const room of planning) {
      this.recheckOrders(room)
      const due = room.rec.deadline !== null && room.rec.deadline <= Date.now()
      if (!this.advance(room, due)) this.arm(room)
    }
    this.cleanup()
  }

  open(send: (data: string) => void): Conn {
    const conn: Conn = { send, room: null, seat: null, listening: false }
    this.conns.add(conn)
    return conn
  }

  close(conn: Conn): void {
    this.unbind(conn)
    this.conns.delete(conn)
  }

  receive(conn: Conn, raw: string): void {
    try {
      this.dispatch(conn, parseClientMessage(raw))
    } catch (e) {
      if (e instanceof Refused) return this.error(conn, e.code, e.message)
      if (e instanceof BadRequest) return this.error(conn, 'bad_request', e.message)
      console.error('hub: handler failed:', e)
      this.error(conn, 'internal', 'server error')
    }
  }

  list(): GameSummary[] {
    return [...this.rooms.values()]
      .map((r) => this.summaryOf(r))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, LIST_LIMIT)
  }

  /** Deletes abandoned lobbies. Games that started are kept forever. */
  cleanup(): void {
    const cutoff = Date.now() - this.opts.lobbyTtlMs
    for (const [id, room] of this.rooms) {
      if (room.rec.phase !== 'lobby' || room.rec.updatedAt >= cutoff || room.conns.size) continue
      this.rooms.delete(id)
      void this.store.remove(id)
      console.log(`[${id}] abandoned lobby deleted`)
    }
  }

  stop(): void {
    for (const room of this.rooms.values()) if (room.timer) clearTimeout(room.timer)
    if (this.listTimer) clearTimeout(this.listTimer)
  }

  private dispatch(conn: Conn, msg: ClientMessage) {
    switch (msg.type) {
      case 'ping':
        return this.send(conn, { type: 'pong' })
      case 'list':
        conn.listening = true
        return this.send(conn, { type: 'games', games: this.list() })
      case 'create':
        return this.create(conn, msg.options, msg.playerName)
      case 'join':
        return this.join(conn, msg.gameId, msg.playerName)
      case 'resume':
        return this.resume(conn, msg.gameId, msg.token)
      case 'watch':
        return this.watch(conn, msg.gameId)
      case 'setSeat':
        return this.setSeat(conn, msg.seat, msg.kind)
      case 'start':
        return this.start(conn)
      case 'orders':
        return this.orders(conn, msg.turn, msg.orders, msg.ready)
    }
  }

  // ---- lobby ----

  private create(conn: Conn, o: CreateOptions, playerName: string) {
    let id: string
    do id = Array.from({ length: 6 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('')
    while (this.rooms.has(id))
    const token = randomBytes(24).toString('base64url')
    const now = Date.now()
    const seats = Array.from({ length: o.seats }, (_, i): SeatRecord =>
      i === 0 ? { kind: 'human', name: playerName, tokenHash: hashToken(token) } : i >= o.seats - o.bots ? botSeat(i) : openSeat(),
    )
    const rec: GameRecord = {
      schemaVersion: SCHEMA_VERSION, id, name: o.name || defaultName(playerName), phase: 'lobby', createdAt: now, updatedAt: now, host: 0, seats,
      turnSeconds: o.turnSeconds ?? null, fog: o.fog ?? true, mapSize: o.mapSize ?? null, seed: o.seed ?? null,
      config: null, state: null, previous: null, events: [], orders: {}, ready: seats.map(() => false), deadline: null, log: [],
    }
    const room = new Room(rec)
    this.rooms.set(id, room)
    this.touch(room)
    this.bind(conn, room, 0)
    this.send(conn, { type: 'joined', gameId: id, seat: 0, token, host: true })
    this.broadcastSummary(room)
    console.log(`[${id}] created by ${playerName}: ${o.seats} seats, ${o.bots} bots, timer ${rec.turnSeconds ?? 'none'}, fog ${rec.fog ? 'on' : 'off'}`)
  }

  private join(conn: Conn, gameId: string, playerName: string) {
    const room = this.room(gameId)
    const rec = room.rec
    if (rec.phase !== 'lobby') refuse('wrong_phase', 'The game has already started. You can watch it.')
    if (conn.room === room && conn.seat !== null) refuse('forbidden', 'You already have a seat in this game.')
    const seat = rec.seats.findIndex((s) => s.kind === 'open')
    if (seat < 0) refuse('full', 'No open seat left. You can watch the game.')
    const token = randomBytes(24).toString('base64url')
    rec.seats[seat] = { kind: 'human', name: playerName, tokenHash: hashToken(token) }
    this.touch(room)
    this.bind(conn, room, seat)
    this.send(conn, { type: 'joined', gameId, seat, token, host: seat === rec.host })
    this.broadcastSummary(room)
    console.log(`[${gameId}] ${playerName} joined seat ${seat}`)
  }

  private resume(conn: Conn, gameId: string, token: string) {
    const room = this.room(gameId)
    const hash = hashToken(token)
    const seat = room.rec.seats.findIndex((s) => s.kind === 'human' && s.tokenHash === hash)
    if (seat < 0) refuse('bad_token', 'That seat token is not valid for this game.')
    this.bind(conn, room, seat)
    this.send(conn, { type: 'joined', gameId, seat, token, host: seat === room.rec.host })
    this.broadcastSummary(room)
    if (room.rec.state) this.sendState(conn)
  }

  private watch(conn: Conn, gameId: string) {
    const room = this.room(gameId)
    this.bind(conn, room, null)
    this.send(conn, { type: 'summary', game: this.summaryOf(room) })
    if (!room.rec.state) return
    if (this.blindsSpectators(room.rec)) return this.error(conn, 'fog_hidden', FOG_HIDDEN)
    this.sendState(conn)
  }

  private setSeat(conn: Conn, seat: PlayerId, kind: 'bot' | 'open') {
    const room = this.hostRoom(conn)
    const rec = room.rec
    if (rec.phase !== 'lobby') refuse('wrong_phase', 'Seats can only be changed in the lobby.')
    if (seat < 0 || seat >= rec.seats.length) throw new BadRequest(`seat must be 0..${rec.seats.length - 1}`)
    if (seat === rec.host) refuse('forbidden', 'The host seat cannot be changed.')
    const cur = rec.seats[seat]
    if (cur.kind !== kind) {
      if (cur.kind === 'human') {
        for (const c of room.conns) {
          if (c.seat !== seat) continue
          c.seat = null
          this.error(c, 'kicked', 'The host gave your seat away. You are watching now.')
        }
        console.log(`[${rec.id}] host removed ${cur.name} from seat ${seat}`)
      }
      rec.seats[seat] = kind === 'bot' ? botSeat(seat) : openSeat()
      this.touch(room)
    }
    this.broadcastSummary(room)
  }

  private start(conn: Conn) {
    const room = this.hostRoom(conn)
    const rec = room.rec
    if (rec.phase !== 'lobby') refuse('wrong_phase', 'The game has already started.')
    const seats = rec.seats.map((s, i) => (s.kind === 'open' ? botSeat(i) : s))
    const config: GameConfig = {
      seed: rec.seed ?? randomBytes(6).toString('base64url'),
      players: seats.map((s) => ({ name: s.name ?? '?', kind: s.kind === 'human' ? 'human' : 'bot' })),
      ...(rec.mapSize ? { mapSize: rec.mapSize } : {}),
      fog: rec.fog,
    }
    let state: GameState
    try {
      state = createGame(config)
    } catch (e) {
      console.error(`[${rec.id}] createGame failed:`, e)
      refuse('internal', `Could not create the game: ${(e as Error).message}`)
    }
    rec.seats = seats
    rec.config = config
    rec.state = state
    rec.phase = 'planning'
    this.beginTurn(room)
    this.touch(room)
    this.arm(room)
    this.broadcastSummary(room)
    this.broadcastState(room)
    if (this.blindsSpectators(rec)) for (const c of room.conns) if (c.seat === null) this.error(c, 'fog_hidden', FOG_HIDDEN)
    console.log(`[${rec.id}] started: seed ${config.seed}, ${state.map.width}x${state.map.height}`)
  }

  // ---- turns ----

  private orders(conn: Conn, turn: number, raw: PlayerOrders, ready: boolean) {
    const room = conn.room
    const seat = conn.seat
    if (!room || seat === null) refuse('forbidden', 'You have no seat in a game.')
    const rec = room.rec
    if (rec.phase !== 'planning' || !rec.state) refuse('wrong_phase', 'The game is not in planning.')
    if (!rec.state.players[seat]?.alive) refuse('forbidden', 'You have been eliminated.')
    if (turn !== rec.state.turn) {
      this.error(conn, 'stale_turn', `Those orders are for turn ${turn}, but it is turn ${rec.state.turn}.`)
      return this.sendState(conn)
    }
    const { orders, dropped } = sanitizeOrders(raw, rec.state, seat)
    if (dropped) console.log(`[${rec.id}] seat ${seat}: dropped ${dropped} orders for things it does not own`)
    rec.orders[seat] = orders
    const changed = rec.ready[seat] !== ready
    rec.ready[seat] = ready
    this.touch(room)
    if (this.advance(room)) return
    if (changed) this.broadcastSummary(room)
    else this.send(conn, { type: 'summary', game: this.summaryOf(room) }) // ack: draft saved
  }

  /** Fresh orders for a new turn: bots plan now (and are ready), humans start unready. */
  private beginTurn(room: Room) {
    const rec = room.rec
    const state = rec.state!
    rec.orders = {}
    rec.ready = rec.seats.map(() => false)
    rec.seats.forEach((s, i) => {
      if (s.kind === 'bot' && state.players[i]?.alive) this.planBot(rec, i)
    })
    rec.deadline = rec.turnSeconds && this.aliveHumans(rec).length ? Date.now() + rec.turnSeconds * 1000 : null
  }

  private planBot(rec: GameRecord, seat: PlayerId) {
    const state = rec.state!
    try {
      rec.orders[seat] = botOrders(observe(state, seat), seat, hashString(`${rec.config!.seed}:${state.turn}:${seat}`))
    } catch (e) {
      console.error(`[${rec.id}] botOrders failed for seat ${seat} on turn ${state.turn}:`, e)
    }
    rec.ready[seat] = true
  }

  /**
   * After a load (and possibly a migration): saved orders must still pass today's validation.
   * A human whose orders do not is un-readied and plans again; a bot plans again.
   */
  private recheckOrders(room: Room) {
    const rec = room.rec
    let changed = false
    for (const [key, orders] of Object.entries(rec.orders)) {
      const seat = Number(key)
      try {
        rec.orders[seat] = sanitizeOrders(orders, rec.state!, seat).orders
      } catch (e) {
        if (!(e instanceof BadRequest)) throw e
        console.log(`[${rec.id}] seat ${seat}: saved orders no longer valid (${e.message}), dropped`)
        delete rec.orders[seat]
        rec.ready[seat] = false
        if (rec.seats[seat]?.kind === 'bot' && rec.state!.players[seat]?.alive) this.planBot(rec, seat)
        changed = true
      }
    }
    if (changed) this.store.save(rec)
  }

  private aliveHumans(rec: GameRecord): PlayerId[] {
    return rec.seats.flatMap((s, i) => (s.kind === 'human' && rec.state?.players[i]?.alive ? [i] : []))
  }

  /**
   * Resolves while the turn is due: everyone alive is ready, or `force` (the deadline passed).
   * With no human left alive this plays the bots out to the end. Returns true if anything
   * happened (and was broadcast).
   */
  private advance(room: Room, force = false): boolean {
    const rec = room.rec
    let resolved = 0
    let failed = false
    while (rec.phase === 'planning' && (force || this.aliveHumans(rec).every((i) => rec.ready[i]))) {
      force = false
      if (!this.resolveOnce(room)) {
        failed = true
        break
      }
      // Only reachable with no humans left and an engine that never declares a winner.
      if (++resolved > rec.state!.maxTurns + 1) {
        console.warn(`[${rec.id}] no winner after ${resolved} bot-only turns, ending the game`)
        this.finish(rec)
      }
    }
    if (!resolved && !failed) return false
    this.touch(room)
    this.arm(room)
    this.broadcastSummary(room)
    if (resolved) this.broadcastState(room)
    return true
  }

  private resolveOnce(room: Room): boolean {
    const rec = room.rec
    const before = rec.state!
    const orders: Partial<Record<PlayerId, PlayerOrders>> = {}
    for (const [seat, o] of Object.entries(rec.orders)) orders[Number(seat)] = o
    const t0 = performance.now()
    let result: ResolveResult
    try {
      result = resolveTurn(before, orders)
      if (!result?.state || !Array.isArray(result.events)) throw new Error('resolveTurn returned no state/events')
    } catch (e) {
      console.error(`[${rec.id}] resolveTurn failed on turn ${before.turn}:`, e)
      for (const i of this.aliveHumans(rec)) rec.ready[i] = false
      if (rec.turnSeconds && rec.deadline !== null) rec.deadline = Date.now() + rec.turnSeconds * 1000
      this.broadcast(room, {
        type: 'error',
        code: 'internal',
        message: `Turn ${before.turn} could not be resolved (engine error). Your orders are kept; press ready to try again.`,
      })
      return false
    }
    rec.log.push({ turn: before.turn, at: Date.now(), orders: rec.orders })
    rec.previous = before
    rec.state = result.state
    rec.events = result.events
    const ms = (performance.now() - t0).toFixed(1)
    console.log(`[${rec.id}] turn ${before.turn} resolved: ${result.events.length} events, ${ms} ms`)
    if (result.state.winner !== null) this.finish(rec)
    else this.beginTurn(room)
    return true
  }

  private finish(rec: GameRecord) {
    rec.phase = 'finished'
    rec.deadline = null
    rec.orders = {}
    rec.ready = rec.seats.map(() => false)
    const w = rec.state?.winner
    console.log(`[${rec.id}] finished on turn ${rec.state?.turn}: winner ${w === 'draw' ? 'draw' : w == null ? 'none' : rec.seats[w]?.name}`)
  }

  /** (Re)schedules the turn timer from rec.deadline. */
  private arm(room: Room) {
    if (room.timer) clearTimeout(room.timer)
    room.timer = null
    const deadline = room.rec.deadline
    if (room.rec.phase !== 'planning' || deadline === null) return
    room.timer = setTimeout(() => {
      room.timer = null
      if (room.rec.phase !== 'planning' || room.rec.deadline !== deadline) return
      try {
        if (Date.now() >= deadline) this.advance(room, true)
        else this.arm(room) // the wait was longer than one setTimeout can hold
      } catch (e) {
        console.error(`[${room.rec.id}] turn timer failed:`, e)
      }
    }, Math.min(Math.max(deadline - Date.now(), 0), MAX_TIMEOUT))
  }

  // ---- connections and messages ----

  private room(gameId: string): Room {
    return this.rooms.get(gameId) ?? refuse('not_found', 'That game does not exist (any more).')
  }

  private hostRoom(conn: Conn): Room {
    const room = conn.room
    if (!room || conn.seat === null || conn.seat !== room.rec.host) refuse('forbidden', 'Only the host can do that.')
    return room
  }

  private bind(conn: Conn, room: Room, seat: PlayerId | null) {
    this.unbind(conn)
    conn.room = room
    conn.seat = seat
    conn.listening = false
    room.conns.add(conn)
  }

  private unbind(conn: Conn) {
    const room = conn.room
    if (!room) return
    const seat = conn.seat
    room.conns.delete(conn)
    conn.room = null
    conn.seat = null
    if (seat !== null) this.broadcastSummary(room) // the seat's connected flag may have changed
  }

  /** Marks the game changed: persist it and refresh the lobby list. */
  private touch(room: Room) {
    room.rec.updatedAt = Date.now()
    this.store.save(room.rec)
    this.pushList()
  }

  private summaryOf(room: Room): GameSummary {
    const rec = room.rec
    const players = rec.state?.players
    return {
      id: rec.id,
      name: rec.name,
      phase: rec.phase,
      turn: rec.state?.turn ?? 0,
      seats: rec.seats.map((s, i) => ({
        seat: i,
        name: s.name,
        kind: s.kind,
        connected: s.kind === 'bot' || [...room.conns].some((c) => c.seat === i),
        // Ready = the turn is not waiting for this seat: bots and eliminated players always are.
        ready: rec.phase === 'planning' && (s.kind === 'bot' || rec.ready[i] || !players?.[i]?.alive),
      })),
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      turnSeconds: rec.turnSeconds,
      fog: rec.fog,
    }
  }

  /**
   * The game as `seat` may see it: observe() of the states and, from the full previous state, that
   * player's own event stream. Spectators, the eliminated and everyone after the end see it all.
   */
  private stateFor(rec: GameRecord, seat: PlayerId | null): ServerMessage {
    const state = rec.state!
    const all = seat === null || rec.phase === 'finished' || !state.players[seat]?.alive
    const view = (s: GameState) => (all ? s : observe(s, seat))
    return {
      type: 'state',
      gameId: rec.id,
      you: seat,
      state: view(state),
      previous: rec.previous && view(rec.previous),
      events: all || !rec.previous ? rec.events : observeEvents(rec.previous, rec.events, seat),
      myOrders: seat === null ? null : (rec.orders[seat] ?? null),
      deadline: rec.deadline,
    }
  }

  /** A running fog-of-war game shows spectators only its summary: a full view would let a player
   * watch their own game and see the whole map. Seated players, eliminated ones too, are not spectators. */
  private blindsSpectators(rec: GameRecord): boolean {
    return rec.fog && rec.phase === 'planning'
  }

  private sendState(conn: Conn) {
    const rec = conn.room?.rec
    if (!rec?.state || (conn.seat === null && this.blindsSpectators(rec))) return
    this.send(conn, this.stateFor(rec, conn.seat))
  }

  private broadcastState(room: Room) {
    const cache = new Map<PlayerId | null, string>()
    const blind = this.blindsSpectators(room.rec)
    for (const c of room.conns) {
      if (c.seat === null && blind) continue
      let data = cache.get(c.seat)
      if (data === undefined) cache.set(c.seat, (data = JSON.stringify(this.stateFor(room.rec, c.seat))))
      c.send(data)
    }
  }

  private broadcastSummary(room: Room) {
    this.broadcast(room, { type: 'summary', game: this.summaryOf(room) })
  }

  private broadcast(room: Room, msg: ServerMessage) {
    const data = JSON.stringify(msg)
    for (const c of room.conns) c.send(data)
  }

  private send(conn: Conn, msg: ServerMessage) {
    conn.send(JSON.stringify(msg))
  }

  private error(conn: Conn, code: ErrorCode, message: string) {
    this.send(conn, { type: 'error', code, message })
  }

  /** Lobby screens (conns that sent 'list') get the new list, at most every 250 ms. */
  private pushList() {
    if (this.listTimer) return
    this.listTimer = setTimeout(() => {
      this.listTimer = null
      const listeners = [...this.conns].filter((c) => c.listening)
      if (!listeners.length) return
      const data = JSON.stringify({ type: 'games', games: this.list() } satisfies ServerMessage)
      for (const c of listeners) c.send(data)
    }, 250)
  }
}
