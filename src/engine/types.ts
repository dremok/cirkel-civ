// Shared game types. This file is the contract between engine, server, client and renderer.
// Everything here must stay JSON-serializable: the server persists GameState as JSON and
// sends it over the wire.

export type PlayerId = number // seat index, 0..3
export type TileId = number // row * width + col
export type UnitId = number
export type CityId = number

export type Biome =
  | 'deep' // height 0, open water
  | 'shallow' // height 1, coastal water
  | 'beach'
  | 'grass'
  | 'plains'
  | 'forest'
  | 'hills'
  | 'mountain' // impassable
  | 'snow' // impassable peaks

export interface Tile {
  id: TileId
  col: number
  row: number
  q: number // axial
  r: number // axial
  height: number // integer 0..8, water below 2
  biome: Biome
  moisture: number // 0..1, used for visual variety (and future rules)
}

export interface GameMap {
  width: number // columns
  height: number // rows (always even, so 2-player maps can be point-symmetric)
  seed: string
  tiles: Tile[] // indexed by TileId
  starts: TileId[] // one start tile per seat
}

export type UnitType = 'spear' | 'archer' | 'rider' | 'settler'

/** How a unit's local commander reacts to the unexpected during resolution. */
export type Stance = 'cautious' | 'aggressive' | 'hold'

export interface Unit {
  id: UnitId
  owner: PlayerId
  type: UnitType
  tile: TileId
  hp: number
  stance: Stance
  /** Remaining planned path (tiles to enter, in order, excluding the current tile). Persists across turns. */
  path: TileId[]
  /** Settlers: found a city when the path is done (or now, if the path is empty). */
  found: boolean
  /** Archers: preferred volley target tile. */
  target: TileId | null
}

export type BuildItem = UnitType | 'walls'

export interface City {
  id: CityId
  owner: PlayerId
  name: string
  tile: TileId
  pop: number
  food: number // stored food toward next growth
  prod: number // stored production toward the current build
  hp: number
  walls: boolean
  build: BuildItem | null
  capital: boolean
  founded: number // turn
}

export interface Player {
  id: PlayerId
  name: string
  color: number // index into the shared player palette (see client/render/palette.ts)
  kind: 'human' | 'bot'
  alive: boolean
}

export interface GameConfig {
  seed: string
  players: { name: string; kind: 'human' | 'bot' }[] // 2..4
  mapSize?: 'small' | 'medium' | 'large'
  maxTurns?: number
}

export interface GameState {
  turn: number // starts at 1; incremented by each resolveTurn
  maxTurns: number
  map: GameMap
  players: Player[]
  units: Unit[]
  cities: City[]
  nextId: number // shared id counter for units and cities
  winner: PlayerId | 'draw' | null
}

/** What a player wants a unit to do. Units without an entry keep their persistent orders. */
export interface UnitOrder {
  path: TileId[]
  stance: Stance
  found?: boolean
  target?: TileId | null
}

export interface PlayerOrders {
  units: Record<UnitId, UnitOrder>
  cities: Record<CityId, BuildItem | null>
}

/** Where something sits in the turn: ticks 1..6 are the simultaneous resolution, 7 = end-of-turn
 * volleys, 8 = founding / economy / healing. */
export type Tick = number

export type Target = { unit: UnitId } | { city: CityId }

export type GameEvent =
  | { t: Tick; kind: 'move'; unit: UnitId; from: TileId; to: TileId }
  /** Two enemies tried to enter the same tile, or to swap tiles: they meet and fight. */
  | { t: Tick; kind: 'clash'; a: UnitId; b: UnitId; tile: TileId | null; dmgA: number; dmgB: number }
  | { t: Tick; kind: 'melee'; attacker: UnitId; target: Target; dmgToTarget: number; dmgToAttacker: number }
  | { t: Tick; kind: 'shot'; from: Target; target: Target; dmg: number }
  /** A cautious unit stopped at contact, or a unit could not continue. */
  | { t: Tick; kind: 'halt'; unit: UnitId; reason: 'contact' | 'blocked' | 'engaged' }
  | { t: Tick; kind: 'death'; unit: UnitId; tile: TileId }
  | { t: Tick; kind: 'capture'; city: CityId; from: PlayerId; to: PlayerId; unit: UnitId }
  | { t: Tick; kind: 'razed'; city: CityId } // reserved
  | { t: Tick; kind: 'found'; city: City; unit: UnitId }
  | { t: Tick; kind: 'foundFailed'; unit: UnitId; reason: string }
  | { t: Tick; kind: 'spawn'; unit: Unit; city: CityId }
  | { t: Tick; kind: 'built'; city: CityId; item: BuildItem }
  | { t: Tick; kind: 'grow'; city: CityId; pop: number }
  | { t: Tick; kind: 'heal'; unit: UnitId; hp: number }
  | { t: Tick; kind: 'eliminated'; player: PlayerId }
  | { t: Tick; kind: 'victory'; winner: PlayerId | 'draw' }

export interface ResolveResult {
  state: GameState
  events: GameEvent[]
}
