// Client <-> server protocol over a single WebSocket at /ws. JSON messages.
// The server is authoritative: it owns GameState, collects orders, and runs resolveTurn.

import type { GameEvent, GameState, PlayerId, PlayerOrders } from '../engine/types.ts'

export type GamePhase = 'lobby' | 'planning' | 'finished'

export interface SeatInfo {
  seat: PlayerId
  name: string | null // null = open seat
  kind: 'human' | 'bot' | 'open'
  connected: boolean
  ready: boolean // planning: orders submitted for this turn
}

export interface GameSummary {
  id: string
  name: string
  phase: GamePhase
  turn: number
  seats: SeatInfo[]
  createdAt: number
  updatedAt: number
  turnSeconds: number | null // null = no turn timer
  fog: boolean
}

export interface CreateOptions {
  name: string // game title shown in the lobby
  seats: number // 2..4
  bots: number // how many seats are bots from the start
  mapSize?: 'small' | 'medium' | 'large'
  turnSeconds?: number | null
  seed?: string
  /** Fog of war (default true). */
  fog?: boolean
}

export type ClientMessage =
  | { type: 'create'; options: CreateOptions; playerName: string }
  | { type: 'join'; gameId: string; playerName: string }
  /** Reconnect with the token from 'joined'. Sent on every page load for a known game. */
  | { type: 'resume'; gameId: string; token: string }
  | { type: 'watch'; gameId: string }
  | { type: 'list' }
  /** Host only, in the lobby: fill a seat with a bot or open it again. */
  | { type: 'setSeat'; seat: PlayerId; kind: 'bot' | 'open' }
  /** Host only: start the game. Open seats become bots. */
  | { type: 'start' }
  /** Planning: replace this player's orders for the current turn. `ready` = done planning. */
  | { type: 'orders'; turn: number; orders: PlayerOrders; ready: boolean }
  | { type: 'ping' }

export type ServerMessage =
  | { type: 'games'; games: GameSummary[] }
  /** You hold `seat` in `gameId`; keep `token` (localStorage) to resume. */
  | { type: 'joined'; gameId: string; seat: PlayerId; token: string; host: boolean }
  | { type: 'summary'; game: GameSummary }
  /**
   * Full game view for this client (sent on join/resume and after each resolution).
   * `state` is observe(state, you). `events` are the events of the latest resolution, with
   * `previous` the state before it, so a client can replay the last turn.
   */
  | {
      type: 'state'
      gameId: string
      you: PlayerId | null // null = spectator
      state: GameState
      previous: GameState | null
      events: GameEvent[]
      /** Your own orders saved for the current turn (so a reload keeps your plan). */
      myOrders: PlayerOrders | null
      deadline: number | null // epoch ms when the turn auto-resolves, if timed
    }
  | { type: 'error'; message: string; code?: ErrorCode }
  | { type: 'pong' }

/** Machine-readable reason on 'error', so the client can react without parsing `message`. */
export type ErrorCode =
  | 'bad_request' // malformed message
  | 'not_found' // no such game (forget it)
  | 'bad_token' // the resume token matches no seat in that game (forget it; 'watch' still works)
  | 'forbidden' // not allowed for you: not the host, no seat, or eliminated
  | 'full' // join: no open seat left
  | 'wrong_phase' // e.g. join after start, orders in the lobby, start twice
  | 'stale_turn' // orders for another turn; a fresh 'state' follows
  | 'kicked' // the host removed you from your seat; you are a spectator now (forget the token)
  | 'internal' // server or engine failure
  /** watch: a running fog-of-war game shows spectators only its 'summary' (a full view would reveal
   * the whole map to its players). The full 'state' arrives when the game ends. */
  | 'fog_hidden'
