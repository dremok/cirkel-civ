// Combat math, shared by the rules, the bot and any UI that wants to preview a fight.
// No dice: damage = 3 x strength ratio, rounded, clamped to 1..10 (see docs/RULES.md).

import { CITY_DEFENSE, CITY_MAX_HP, CITY_RANGE, CITY_RANGED, MODIFIERS, UNITS, UNIT_MAX_HP } from './config.ts'
import { PLOTS, fortifiedSides } from './city.ts'
import { AXIAL_DIRS, SQRT3, distance } from './hex.ts'
import type { City, GameMap, TileId, Unit } from './types.ts'

/** Towers add at most this much to a city's shooting strength on one side. */
const MAX_TOWER_BONUS = 2

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

/** The city's sides (0..5, AXIAL_DIRS order) that `other` lies on, by angle. A tile exactly between
 * two sides lies on both, so the rule is the same however the map is turned. */
export function sidesToward(map: GameMap, cityTile: TileId, other: TileId): number[] {
  const a = map.tiles[cityTile]
  const b = map.tiles[other]
  const dq = b.q - a.q
  const dr = b.r - a.r
  const vx = SQRT3 * (dq + dr / 2)
  const vz = 1.5 * dr
  const dots = AXIAL_DIRS.map(([q, r]) => vx * SQRT3 * (q + r / 2) + vz * 1.5 * r)
  const best = Math.max(...dots)
  const out: number[] = []
  dots.forEach((d, i) => {
    if (d >= best - 1e-9) out.push(i)
  })
  return out
}

/** Does a wall cover the side of `city` that `from` lies on? */
export function wallFacing(map: GameMap, city: City, from: TileId): boolean {
  const walls = fortifiedSides(city.interior, 'wall')
  return walls.size > 0 && sidesToward(map, city.tile, from).some((d) => walls.has(d))
}

/** Towers of `city` that face the side `to` lies on. */
export function towersFacing(map: GameMap, city: City, to: TileId): number {
  const sides = sidesToward(map, city.tile, to)
  let n = 0
  for (let p = 7; p < PLOTS.length; p++) {
    if (city.interior.plots[p] === 'tower' && PLOTS[p].facing.some((d) => sides.includes(d))) n++
  }
  return n
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
  // Hold digs a unit in outside cities; inside its city the city's bonus applies instead.
  if (u.stance === 'hold' && !ctx.city) pct += MODIFIERS.holdDefense
  if (ctx.city) {
    pct += MODIFIERS.cityDefense
    if (wallFacing(map, ctx.city, fromTile)) pct += MODIFIERS.wallsDefense
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
  if (wallFacing(map, c, fromTile)) pct += MODIFIERS.wallsDefense
  return CITY_DEFENSE * healthFactor(c.hp, CITY_MAX_HP) * (1 + pct)
}

export function unitRangedStrength(map: GameMap, u: Unit, toTile: TileId): number {
  return (UNITS[u.type].ranged ?? 0) * healthFactor(u.hp, UNIT_MAX_HP) * (1 + heightBonus(map, u.tile, toTile))
}

/** City shooting strength toward `toTile`: +1 per tower facing that side (at most +2). */
export function cityRangedStrength(map: GameMap, c: City, toTile: TileId): number {
  const towers = Math.min(MAX_TOWER_BONUS, towersFacing(map, c, toTile))
  return (CITY_RANGED + towers) * healthFactor(c.hp, CITY_MAX_HP) * (1 + heightBonus(map, c.tile, toTile))
}

/** Can the city shoot `toTile`? Range 2, +1 on a side with a tower, +1 from high ground. */
export function cityCanShoot(map: GameMap, c: City, toTile: TileId): boolean {
  if (distance(map, c.tile, toTile) > CITY_RANGE + 2) return false
  return inRange(map, c.tile, toTile, CITY_RANGE + (towersFacing(map, c, toTile) > 0 ? 1 : 0))
}

/** Range of a shooter on `from` against `to`: +1 from high ground (2+ levels above). */
export function inRange(map: GameMap, from: TileId, to: TileId, range: number): boolean {
  const bonus = map.tiles[from].height - map.tiles[to].height >= MODIFIERS.highGroundRangeLevels ? 1 : 0
  return distance(map, from, to) <= range + bonus
}

export function unitRange(u: Unit): number {
  return UNITS[u.type].range ?? 0
}

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
