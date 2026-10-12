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

// ---- The city seen from inside (SPEC.md §5b; layout, buildings and output in city.ts) ----

export type BuildingType =
  | 'house' | 'farm' | 'sawmill' | 'workshop' | 'market' | 'harbor' | 'barracks' | 'temple' | 'tower' | 'wall'

/** Which buildings get workers first when a city has fewer citizens than jobs. */
export type CityFocus = 'growth' | 'production' | 'balance'

export interface CityInterior {
  /** One entry per plot (19: 0 the square, 1..6 inner, 7..18 outer); plot 0 is always null. */
  plots: (BuildingType | null)[]
  focus: CityFocus
}

/** Build `building` on `plot` of the city. */
export interface BuildingOrder {
  building: BuildingType
  plot: number
}

/** What a city works on: a unit (repeats until changed) or one building on one plot. */
export type BuildItem = UnitType | BuildingOrder

export interface City {
  id: CityId
  owner: PlayerId
  name: string
  tile: TileId
  pop: number
  food: number // stored food toward next growth
  prod: number // stored production toward the current build
  hp: number
  /** @deprecated derived: true when any wall stands in `interior` (kept in sync by the engine). */
  walls: boolean
  build: BuildItem | null
  capital: boolean
  founded: number // turn
  interior: CityInterior
}

/** Fog of war (SPEC.md §7b): what one player has seen. */
export interface PlayerMemory {
  /** One character per tile (indexed by TileId): '1' = explored (seen at least once), '0' = never seen. */
  explored: string
  /** Rival cities as this player last saw them (observe-filtered snapshots). While a city is in
   * sight the live city replaces its snapshot; a remembered city stays as it was until seen again. */
  cities: City[]
  /** The turn each remembered city (by id) was last seen. */
  seen: Record<CityId, number>
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
  /** Fog of war (default true). */
  fog?: boolean
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
  /** Fog of war: one memory per seat, or null when the game has no fog (everything visible).
   * In observe(state, p) only seat p's memory is filled; the others are blanked. */
  fog: PlayerMemory[] | null
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
  /** City focus changes (cities without an entry keep theirs). */
  focus?: Record<CityId, CityFocus>
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
  /** A construction finished: a unit (followed by its 'spawn') or a building now standing on its plot. */
  | { t: Tick; kind: 'built'; city: CityId; item: BuildItem }
  /** A building could not be placed when it was finished; the production stays in the city. */
  | { t: Tick; kind: 'buildFailed'; city: CityId; item: BuildingOrder; reason: string }
  | { t: Tick; kind: 'grow'; city: CityId; pop: number }
  | { t: Tick; kind: 'heal'; unit: UnitId; hp: number }
  /** A city that was not under siege this turn repaired itself (new hp). */
  | { t: Tick; kind: 'cityRepair'; city: CityId; hp: number }
  // The next three exist only in a per-player stream from observeEvents(), never in resolveTurn's output.
  /** Fog: an enemy unit came into sight (as observe would show it). Emitted before the first event that involves it. */
  | { t: Tick; kind: 'spotted'; unit: Unit }
  /** Fog: an enemy unit went out of sight at `tile`. It is not in the next observed state unless spotted again. */
  | { t: Tick; kind: 'lost'; unit: UnitId; tile: TileId }
  /** Fog: tiles this player saw for the first time during this tick. */
  | { t: Tick; kind: 'explore'; tiles: TileId[] }
  | { t: Tick; kind: 'eliminated'; player: PlayerId }
  | { t: Tick; kind: 'victory'; winner: PlayerId | 'draw' }

export interface ResolveResult {
  state: GameState
  events: GameEvent[]
}
