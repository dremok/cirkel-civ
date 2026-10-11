// Combat math, shared by the rules, the bot and any UI that wants to preview a fight.
// No dice: damage = 3 x strength ratio, rounded, clamped to 1..10 (see docs/RULES.md).

import { CITY_DEFENSE, CITY_MAX_HP, CITY_RANGE, CITY_RANGED, MODIFIERS, UNITS, UNIT_MAX_HP } from './config.ts'
import { distance } from './hex.ts'
import type { City, GameMap, TileId, Unit } from './types.ts'

const DAMAGE_SCALE = 3
const MIN_DAMAGE = 1
const MAX_DAMAGE = 10

/** Wounded fighters are weaker: 100 % at full health down to 50 % near death. */
function healthFactor(hp: number, max: number): number {
  return 0.5 + (0.5 * Math.max(0, hp)) / max
}

/** +15 % per level above the opponent, at most +45 %. */
function heightBonus(map: GameMap, mine: TileId, theirs: TileId): number {
  const diff = map.tiles[mine].height - map.tiles[theirs].height
  return Math.min(MODIFIERS.heightMax, Math.max(0, diff) * MODIFIERS.heightPerLevel)
}

function typeFactor(u: Unit, vs: Unit | null): number {
  if (!vs) return 1
  return UNITS[u.type].bonusVs?.[vs.type] ?? 1
}

export function damage(attack: number, defense: number): number {
  if (attack <= 0) return 0
  const raw = Math.round((DAMAGE_SCALE * attack) / Math.max(defense, 1e-9))
  return Math.min(MAX_DAMAGE, Math.max(MIN_DAMAGE, raw))
}

/** Where a fight happens and what the defender stands on. */
export interface DefenseContext {
  /** Own city on the defender's tile (null if none). */
  city: City | null
}

/** Defence strength of a unit on its own tile against an attacker standing on `fromTile`. */
export function unitDefense(map: GameMap, u: Unit, vs: Unit | null, fromTile: TileId, ctx: DefenseContext): number {
  let pct = heightBonus(map, u.tile, fromTile)
  if (map.tiles[u.tile].biome === 'forest') pct += MODIFIERS.forestDefense
  if (u.stance === 'hold') pct += MODIFIERS.holdDefense
  if (ctx.city) {
    pct += MODIFIERS.cityDefense
    if (ctx.city.walls) pct += MODIFIERS.wallsDefense
  }
  return UNITS[u.type].defense * typeFactor(u, vs) * healthFactor(u.hp, UNIT_MAX_HP) * (1 + pct)
}

/** Melee attack strength of `u` from its tile into `toTile`. */
export function unitAttack(map: GameMap, u: Unit, vs: Unit | null, toTile: TileId): number {
  const s = UNITS[u.type]
  if (s.civilian) return 0
  return s.attack * typeFactor(u, vs) * healthFactor(u.hp, UNIT_MAX_HP) * (1 + heightBonus(map, u.tile, toTile))
}

/** Strength in a meeting clash: attack strength, type bonus and health only (civilians use defence). */
export function clashStrength(u: Unit, vs: Unit): number {
  const s = UNITS[u.type]
  const base = s.civilian ? s.defense : s.attack
  return base * typeFactor(u, vs) * healthFactor(u.hp, UNIT_MAX_HP)
}

export function cityDefense(map: GameMap, c: City, fromTile: TileId): number {
  let pct = heightBonus(map, c.tile, fromTile)
  if (c.walls) pct += MODIFIERS.wallsDefense
  return CITY_DEFENSE * healthFactor(c.hp, CITY_MAX_HP) * (1 + pct)
}

export function unitRangedStrength(map: GameMap, u: Unit, toTile: TileId): number {
  return (UNITS[u.type].ranged ?? 0) * healthFactor(u.hp, UNIT_MAX_HP) * (1 + heightBonus(map, u.tile, toTile))
}

export function cityRangedStrength(map: GameMap, c: City, toTile: TileId): number {
  return CITY_RANGED * healthFactor(c.hp, CITY_MAX_HP) * (1 + heightBonus(map, c.tile, toTile))
}

/** Range of a shooter on `from` against `to`: +1 from high ground (2+ levels above). */
export function inRange(map: GameMap, from: TileId, to: TileId, range: number): boolean {
  const bonus = map.tiles[from].height - map.tiles[to].height >= MODIFIERS.highGroundRangeLevels ? 1 : 0
  return distance(map, from, to) <= range + bonus
}

export function unitRange(u: Unit): number {
  return UNITS[u.type].range ?? 0
}

export const cityRange = CITY_RANGE

/** Preview of a melee: damage each side takes. */
export function meleeOutcome(map: GameMap, att: Unit, def: Unit, defCity: City | null): { toDefender: number; toAttacker: number } {
  const a = unitAttack(map, att, def, def.tile)
  const d = unitDefense(map, def, att, att.tile, { city: defCity })
  return { toDefender: damage(a, d), toAttacker: damage(d, a) }
}

export function meleeVsCity(map: GameMap, att: Unit, city: City): { toCity: number; toAttacker: number } {
  const a = unitAttack(map, att, null, city.tile)
  const d = cityDefense(map, city, att.tile)
  return { toCity: damage(a, d), toAttacker: damage(d, a) }
}
