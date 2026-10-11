import type { GameConfig, GameEvent, GameState, PlayerId, PlayerOrders } from '../engine/types.ts'
import type { CreateOptions, GamePhase } from '../shared/protocol.ts'

export interface SeatRecord {
  kind: 'human' | 'bot' | 'open'
  name: string | null
  /** sha256 of the seat's resume token (humans only). */
  tokenHash: string | null
}

/** Everything the server persists about one game (one JSON file). */
export interface GameRecord {
  v: 1
  id: string
  name: string
  phase: GamePhase
  createdAt: number
  updatedAt: number
  host: PlayerId
  seats: SeatRecord[]
  turnSeconds: number | null
  mapSize: CreateOptions['mapSize'] | null
  /** Seed asked for at create; the seed actually used is config.seed. */
  seed: string | null
  config: GameConfig | null
  state: GameState | null
  previous: GameState | null
  events: GameEvent[]
  /** Orders saved for the current turn, by seat (bots fill theirs when the turn begins). */
  orders: Record<string, PlayerOrders>
  ready: boolean[]
  deadline: number | null
  /** Every resolved turn's orders: with config and a deterministic engine this replays the game. */
  log: { turn: number; at: number; orders: Record<string, PlayerOrders> }[]
}
