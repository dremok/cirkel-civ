import type { Biome, BuildItem, UnitType } from './types.ts'

export const TICKS_PER_TURN = 6
/** Movement points needed to enter a flat tile. A unit gains `speed` points per tick. */
export const FLAT_COST = 6
export const CLIMB_COST_PER_LEVEL = 3
/** Height difference above this is a cliff: impassable. */
export const MAX_STEP = 2
export const WATER_LEVEL = 2 // heights below this are water

export const UNIT_MAX_HP = 10
export const CITY_MAX_HP = 20
export const CITY_REGEN = 3
export const CITY_RANGED = 3
export const CITY_RANGE = 2
export const CITY_DEFENSE = 4
export const MIN_CITY_DISTANCE = 3
export const CITY_WORK_RADIUS = 2

export interface UnitStats {
  cost: number
  speed: number
  attack: number
  defense: number
  ranged?: number
  range?: number
  civilian?: boolean
  /** Strength multiplier against a unit type. */
  bonusVs?: Partial<Record<UnitType, number>>
}

export const UNITS: Record<UnitType, UnitStats> = {
  spear: { cost: 20, speed: 2, attack: 4, defense: 4, bonusVs: { rider: 2 } },
  archer: { cost: 25, speed: 2, attack: 2, defense: 2, ranged: 4, range: 2 },
  rider: { cost: 30, speed: 3, attack: 5, defense: 3 },
  settler: { cost: 30, speed: 2, attack: 0, defense: 1, civilian: true },
}

export const BUILD_COST: Record<BuildItem, number> = {
  spear: UNITS.spear.cost,
  archer: UNITS.archer.cost,
  rider: UNITS.rider.cost,
  settler: UNITS.settler.cost,
  walls: 30,
}

export const MODIFIERS = {
  heightPerLevel: 0.15,
  heightMax: 0.45,
  forestDefense: 0.25,
  holdDefense: 0.5,
  cityDefense: 0.5,
  wallsDefense: 0.5,
  /** Shooters this many levels above the target reach one tile further. */
  highGroundRangeLevels: 2,
}

/** Terrain movement multiplier; Infinity = impassable for land units. */
export const TERRAIN_COST: Record<Biome, number> = {
  deep: Infinity,
  shallow: Infinity,
  beach: 1,
  grass: 1,
  plains: 1,
  forest: 2,
  hills: 2,
  mountain: Infinity,
  snow: Infinity,
}

export const TILE_YIELD: Record<Biome, { food: number; prod: number }> = {
  deep: { food: 1, prod: 0 },
  shallow: { food: 2, prod: 0 },
  beach: { food: 1, prod: 1 },
  grass: { food: 3, prod: 1 },
  plains: { food: 2, prod: 2 },
  forest: { food: 1, prod: 3 },
  hills: { food: 1, prod: 3 },
  mountain: { food: 0, prod: 1 },
  snow: { food: 0, prod: 0 },
}

export const DEFAULT_MAX_TURNS = 60

export const MAP_SIZES = {
  small: { width: 18, height: 14 },
  medium: { width: 24, height: 18 },
  large: { width: 30, height: 22 },
} as const

export const CITY_NAMES = [
  'Lund', 'Dalby', 'Genarp', 'Veberöd', 'Höör', 'Skurup', 'Sjöbo', 'Revinge', 'Torna Hällestad',
  'Klostergården', 'Södra Sandby', 'Furulund', 'Stångby', 'Vallkärra', 'Bjärred', 'Löddeköpinge',
  'Kävlinge', 'Hörby', 'Eslöv', 'Staffanstorp', 'Hjärup', 'Åkarp', 'Flyinge', 'Harlösa', 'Önnestad',
  'Kivik', 'Simrishamn', 'Ystad', 'Tomelilla', 'Brösarp', 'Kåseberga', 'Sandhammaren',
]
