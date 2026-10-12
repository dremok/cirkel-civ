import { CITY_MAX_HP, CITY_NAMES, DEFAULT_MAX_TURNS, UNIT_MAX_HP } from './config.ts'
import { buildingYield, canPlace, newInterior } from './city.ts'
import { AXIAL_DIRS, SQRT3, hexCenter, neighbors } from './hex.ts'
import { generateMap, mirror } from './mapgen.ts'
import { canStep } from './terrain.ts'
import type { BuildingType, City, CityInterior, GameConfig, GameMap, GameState, PlayerId, TileId, Unit, UnitType } from './types.ts'

/** A fresh game: each seat gets a founded capital (a House and a Farm, Sawmill or Harbor inside),
 * a spear, an archer and a settler. */
export function createGame(cfg: GameConfig): GameState {
  const seats = cfg.players.length
  if (seats < 2 || seats > 4) throw new Error('2 to 4 players')
  const map = generateMap(cfg.seed, seats, cfg.mapSize ?? (seats === 2 ? 'small' : 'medium'))
  const state: GameState = {
    turn: 1,
    maxTurns: cfg.maxTurns ?? DEFAULT_MAX_TURNS,
    map,
    players: cfg.players.map((p, i) => ({ id: i, name: p.name, color: i, kind: p.kind, alive: true })),
    units: [],
    cities: [],
    nextId: 1,
    winner: null,
  }
  const kinds: UnitType[] = ['spear', 'archer', 'settler']
  // Two-player maps are point-symmetric: seat 1 gets the mirror image of seat 0's setup.
  const mirrored = seats === 2
  map.starts.forEach((start, seat) => {
    const capital = newCity(state, seat, start, true)
    capital.interior = mirrored && seat === 1 ? rotateInterior(state.cities[0].interior, 3) : capitalInterior(map, start)
    state.cities.push(capital)
    const free = neighbors(map, start).filter((nb) => canStep(map, start, nb))
    kinds.forEach((type, i) => {
      const tile = mirrored && seat === 1 ? mirror(state.units[i].tile, map.width, map.height) : free[i % free.length]
      state.units.push(newUnit(state, seat, type, tile))
    })
  })
  return state
}

export function newUnit(state: GameState, owner: PlayerId, type: UnitType, tile: TileId): Unit {
  return { id: state.nextId++, owner, type, tile, hp: UNIT_MAX_HP, stance: 'cautious', path: [], found: false, target: null }
}

/** A new city with one citizen and one House. */
export function newCity(state: GameState, owner: PlayerId, tile: TileId, capital = false): City {
  const used = new Set(state.cities.map((c) => c.name))
  const name = CITY_NAMES.find((n) => !used.has(n)) ?? `City ${state.cities.length + 1}`
  const interior = newInterior()
  interior.plots[1 + towardMiddle(state.map, tile)] = 'house'
  return {
    id: state.nextId++, owner, name, tile, pop: 1, food: 0, prod: 0, hp: CITY_MAX_HP,
    walls: false, build: null, capital, founded: state.turn, interior,
  }
}

/** The capital: its House plus the best Farm plot (else the best Sawmill, else Harbor plot). */
function capitalInterior(map: GameMap, tile: TileId): CityInterior {
  const interior = newInterior()
  interior.plots[1 + towardMiddle(map, tile)] = 'house'
  for (const b of ['farm', 'sawmill', 'harbor'] as BuildingType[]) {
    let best = -1
    let bestV = -1
    for (let p = 7; p < interior.plots.length; p++) {
      if (!canPlace(map, tile, interior, b, p).ok) continue
      const trial = { ...interior, plots: interior.plots.slice() }
      trial.plots[p] = b
      const y = buildingYield(map, tile, trial, p)
      if (y.food + y.prod > bestV) [best, bestV] = [p, y.food + y.prod]
    }
    if (best >= 0) {
      interior.plots[best] = b
      break
    }
  }
  return interior
}

/** The interior seen after turning the city by `k` sixth-turns (plot directions shift by k). */
export function rotateInterior(interior: CityInterior, k: number): CityInterior {
  const plots = interior.plots.map(() => null as BuildingType | null)
  interior.plots.forEach((b, p) => (plots[rotatePlot(p, k)] = b))
  return { ...interior, plots }
}

/** Plot index after turning the city by `k` sixth-turns: inner 1 + d, corners 7 + 2d, sides 8 + 2d. */
export function rotatePlot(p: number, k: number): number {
  if (p === 0) return 0
  if (p <= 6) return 1 + ((p - 1 + k) % 6)
  const d = Math.floor((p - 7) / 2)
  return 7 + 2 * ((d + k) % 6) + ((p - 7) % 2)
}

/** The direction (0..5) from `tile` that points closest to the middle of the map; exact ties go to the
 * counter-clockwise one, so the choice survives a 180° rotation of the map. */
function towardMiddle(map: GameMap, tile: TileId): number {
  const t = map.tiles[tile]
  const at = hexCenter(t.col, t.row)
  const mid = hexCenter((map.width - 0.5) / 2, (map.height - 1) / 2)
  const vx = mid.x - at.x
  const vz = mid.z - at.z
  let best = 0
  let bestDot = -Infinity
  let bestCross = -Infinity
  AXIAL_DIRS.forEach(([q, r], d) => {
    const dx = SQRT3 * (q + r / 2)
    const dz = 1.5 * r
    const dot = vx * dx + vz * dz
    const cross = vx * dz - vz * dx
    if (dot > bestDot + 1e-9 || (dot >= bestDot - 1e-9 && cross > bestCross)) [best, bestDot, bestCross] = [d, dot, cross]
  })
  return best
}
