// A scripted bot that plays through the same API as humans: it only returns PlayerOrders.
// Deterministic given (state, player, seed). Each turn:
//   strategy  pick the softest enemy city by real walking distance; when the field army has an edge
//             (smaller as the game goes on), mass just outside its reach and storm it, else gather
//             in front of my nearest city; seriously threatened cities pull nearby units home
//   settlers  walk to the best free sites (never two that would conflict) and found
//   garrison  one defender on hold in the capital and in every city with enemies near (archers
//             preferred: they shoot from safety)
//   army      every field unit scores the tiles it can reach this turn (progress toward its
//             objective, danger, terrain, volleys for archers, melee value for attacks); the best
//             option commits first and options made stale by a commit are re-scored (lazy greedy)
//   cities    keep a minimum army, expand while good sites remain, give idle citizens jobs (the best
//             building and plot per production), add houses before the cap, wall the threatened side,
//             barracks and temples when it can, otherwise units that counter the enemy's mix;
//             focus on production when threatened, on growth while there is room

import { CITY_MAX_HP, MIN_CITY_DISTANCE, MODIFIERS, TICKS_PER_TURN, UNITS } from './config.ts'
import { BUILDINGS, PLOTS, PLOT_NEIGHBORS, buildingYield, canPlace, fortifiedSides, hasBuilding } from './city.ts'
import { foodSurplus, housingOf, outputOf } from './economy.ts'
import {
  cityCanShoot,
  cityDefense,
  cityRangedStrength,
  sidesToward,
  damage,
  inRange,
  meleeOutcome,
  meleeVsCity,
  unitDefense,
  unitRange,
  unitRangedStrength,
} from './combat.ts'
import { distance, neighbors, tileAt, tilesInRange } from './hex.ts'
import { extractPath, knownEdges, pathField, pathTiming, type Edges, type PathField } from './paths.ts'
import { mirror } from './mapgen.ts'
import { exploredOf, lineOfSight } from './vision.ts'
import { hashString, mulberry32, type Rng } from './rng.ts'
import { isPassable, isWater } from './terrain.ts'
import type {
  Biome, BuildItem, BuildingOrder, BuildingType, City, CityFocus, GameState, PlayerId, PlayerOrders, Stance, TileId, Unit, UnitType,
} from './types.ts'

const VALUE: Record<UnitType, number> = { spear: 20, archer: 25, rider: 30, settler: 45 }
const MILITARY: UnitType[] = ['spear', 'archer', 'rider']
/** Settlers do not look further than this from my cities (hex steps). */
const SITE_REACH = 5
/** Site score worth a settler. */
const GOOD_SITE = 40
/** How much a neighbouring tile of a new city is worth (it decides the plots facing it). */
const SITE_VALUE: Record<Biome, number> = {
  grass: 3, plains: 3, forest: 2.5, hills: 2.5, shallow: 2, deep: 1.5, beach: 0.5, mountain: 0, snow: 0,
}
/** A neighbour the bot has not seen yet (fog of war): about average. */
const UNSEEN_SITE_VALUE = 1.8
const MAX_SETTLERS = 2
/** Score per turn of progress toward the objective. */
const PROGRESS = 10

export function botOrders(state: GameState, player: PlayerId, seed = 0): PlayerOrders {
  if (state.winner !== null || !state.players[player]?.alive) return { units: {}, cities: {} }
  return new Bot(state, player, seed).run()
}

interface Plan {
  unit: Unit
  path: TileId[]
  stance: Stance
  target: TileId | null
  found: boolean
}

/** A scored choice for one army unit; its path is only built if it is chosen. */
interface Option {
  unit: Unit
  field: PathField
  /** Last tile of the path (the attacked tile for attacks; the unit's own tile when staying). */
  dest: TileId
  /** Where the unit ends the turn. */
  end: TileId
  stance: Stance
  target: TileId | null
  v: number
  /** Enemy unit this option damages (attack or volley), and how much. */
  hit?: { id: number; d: number }
  /** Planned-damage version of `hit` when scored (stale if it changed). */
  seen?: number
}

/** A path field plus the tiles it reaches this turn. */
interface Reach {
  field: PathField
  tiles: TileId[]
}

class Bot {
  readonly s: GameState
  readonly me: PlayerId
  readonly rng: Rng
  readonly mine: Unit[]
  readonly enemies: Unit[]
  readonly myCities: City[]
  readonly enemyCities: City[]
  readonly unitAt: Int32Array // tile -> index in s.units, or -1
  readonly cityAt: Int32Array // tile -> index in s.cities, or -1
  readonly plans = new Map<number, Plan>()
  /** Tiles where one of my units will end the turn. */
  readonly endAt = new Map<TileId, number>()
  /** Tiles my units will not leave this turn (others cannot path through them). */
  readonly stayers = new Set<TileId>()
  /** Tiles my moving units pass through this turn (others should not stop there). */
  readonly passing = new Map<TileId, number>()
  /** Damage already planned against enemy units this turn (focus fire), with a version counter. */
  readonly planned = new Map<number, number>()
  readonly plannedVersion = new Map<number, number>()
  /** Indices into `enemies` of units that could melee / shoot each tile next turn. */
  private meleeThreat: number[][] = []
  private rangedThreat: number[][] = []
  private distCache = new Map<TileId, Float64Array>()
  private sites: Float64Array | null = null
  private mode: 'gather' | 'attack' | 'explore' = 'gather'
  /** The map's movement costs as I know them (unexplored land counts as open grass under fog). */
  private readonly known: Edges
  /** What I have explored (all 1 without fog). */
  private readonly explored: Uint8Array
  /** While exploring: the unit that scouts ahead. */
  private scout = -1
  private scoutGoal: TileId = -1
  private objective: TileId = -1
  private targetCity: City | null = null
  /** Massing at the staging tile before an assault (units gather tightly). */
  private staging = false
  /** My cities with enemy soldiers within 4: their power and the closest intruder. */
  private threatened: { c: City; power: number; intruder: Unit }[] = []

  constructor(s: GameState, me: PlayerId, seed: number) {
    this.s = s
    this.me = me
    this.rng = mulberry32(hashString(`${seed}:${s.turn}:${me}`))
    const n = s.map.tiles.length
    this.unitAt = new Int32Array(n).fill(-1)
    s.units.forEach((u, i) => (this.unitAt[u.tile] = i))
    this.cityAt = new Int32Array(n).fill(-1)
    s.cities.forEach((c, i) => (this.cityAt[c.tile] = i))
    this.mine = s.units.filter((u) => u.owner === me)
    this.enemies = s.units.filter((u) => u.owner !== me)
    this.myCities = s.cities.filter((c) => c.owner === me)
    this.enemyCities = s.cities.filter((c) => c.owner !== me)
    this.known = knownEdges(s, me)
    this.explored = exploredOf(s, me)
  }

  run(): PlayerOrders {
    this.computeThreats()
    this.chooseStrategy()
    this.holdCities()
    this.planSettlers()
    this.planGarrisons()
    this.planArmy()
    const orders: PlayerOrders = { units: {}, ...this.planCities() }
    for (const p of this.plans.values()) {
      orders.units[p.unit.id] = { path: p.path, stance: p.stance, found: p.found, target: p.target }
    }
    return orders
  }

  // ---------------------------------------------------------------------------------------------
  // Analysis

  private computeThreats(): void {
    const { map } = this.s
    const n = map.tiles.length
    this.meleeThreat = Array.from({ length: n }, () => [])
    this.rangedThreat = Array.from({ length: n }, () => [])
    const through = new Uint8Array(n)
    for (const u of this.mine) through[u.tile] = 1
    for (const c of this.myCities) through[c.tile] = 1
    const { nb } = this.known
    // Stamped visit marks instead of a Set per enemy.
    const seen = new Int32Array(n)
    const depth = new Int32Array(n)
    let stamp = 0
    const mark = (t: TileId, lists: number[][], k: number) => {
      if (seen[t] === stamp) return
      seen[t] = stamp
      lists[t].push(k)
    }
    this.enemies.forEach((e, k) => {
      const st = UNITS[e.type]
      if (st.civilian) return
      const reach = e.stance === 'hold' ? [e.tile] : pathField(map, e.tile, st.speed, { through, maxTurns: 1, edges: this.known }).reached
      stamp++
      for (const t of reach) mark(t, this.meleeThreat, k)
      for (let x = e.tile * 6; x < e.tile * 6 + 6; x++) if (nb[x] >= 0) mark(nb[x], this.meleeThreat, k)
      if (st.ranged) {
        // Hex distance from the reachable tiles, by BFS; one more ring counts from high ground.
        stamp++
        const range = unitRange(e)
        let ring = reach
        let top = 0
        for (const t of reach) top = Math.max(top, map.tiles[t].height)
        for (const t of ring) depth[t] = stamp * 8
        for (let r = 0; r <= range + 1 && ring.length; r++) {
          const next: TileId[] = []
          for (const t of ring) {
            if (r <= range || top - map.tiles[t].height >= MODIFIERS.highGroundRangeLevels) this.rangedThreat[t].push(k)
            if (r === range + 1) continue
            for (let x = t * 6; x < t * 6 + 6; x++) {
              const y = nb[x]
              if (y >= 0 && depth[y] < stamp * 8) {
                depth[y] = stamp * 8 + r + 1
                next.push(y)
              }
            }
          }
          ring = next
        }
      }
    })
    for (const c of this.myCities) {
      const near = this.enemies.filter((e) => !UNITS[e.type].civilian && distance(map, e.tile, c.tile) <= 4)
      if (near.length === 0) continue
      const d = (e: Unit) => distance(map, e.tile, c.tile)
      const intruder = near.reduce((a, b) => (d(b) < d(a) || (d(b) === d(a) && b.id < a.id) ? b : a))
      this.threatened.push({ c, power: this.power(near), intruder })
    }
  }

  /** Expected damage to `u` standing on `tile` with `stance` over the next turn. */
  private danger(u: Unit, tile: TileId, stance: Stance): number {
    const { map } = this.s
    const v: Unit = { ...u, tile, stance }
    const ci = this.cityAt[tile]
    const city = ci >= 0 && this.s.cities[ci].owner === this.me ? this.s.cities[ci] : null
    let m1 = 0
    let m2 = 0
    for (const k of this.meleeThreat[tile]) {
      const e = this.enemies[k]
      if (e.hp <= (this.planned.get(e.id) ?? 0)) continue
      const d = meleeOutcome(map, e, v, city).toDefender
      if (d > m1) [m1, m2] = [d, m1]
      else if (d > m2) m2 = d
    }
    let total = m1 + m2 * 0.5
    if (!city || city.hp === 0) {
      for (const k of this.rangedThreat[tile]) {
        const e = this.enemies[k]
        if (e.hp <= (this.planned.get(e.id) ?? 0)) continue
        total += 0.6 * damage(unitRangedStrength(map, e, tile), unitDefense(map, v, null, e.tile, { city: null }))
      }
      for (const c of this.enemyCities) {
        if (c.hp > 0 && cityCanShoot(map, c, tile) && this.sees(c.tile, tile)) {
          total += damage(cityRangedStrength(map, c, tile), unitDefense(map, v, null, c.tile, { city: null }))
        }
      }
    }
    return total
  }

  /** Movement cost from every tile to `goal` (steps capped at 12), cached. Dial's bucket queue:
   * step costs are small integers. */
  private distTo(goal: TileId): Float64Array {
    let d = this.distCache.get(goal)
    if (d) return d
    const { nb, back } = this.known
    const n = this.s.map.tiles.length
    d = new Float64Array(n).fill(Infinity)
    d[goal] = 0
    const buckets: TileId[][] = [[goal]]
    for (let k = 0; k < buckets.length; k++) {
      const bucket = buckets[k]
      if (!bucket) continue
      for (const x of bucket) {
        if (d[x] !== k) continue
        // Walking from a neighbour y into x costs the reverse edge.
        for (let e = x * 6; e < x * 6 + 6; e++) {
          const y = nb[e]
          const c = back[e]
          if (y < 0 || c === Infinity) continue
          const nd = k + Math.min(c, 12)
          if (nd < d[y]) {
            d[y] = nd
            ;(buckets[nd] ??= []).push(y)
          }
        }
      }
    }
    this.distCache.set(goal, d)
    return d
  }

  private power(units: Unit[]): number {
    let p = 0
    for (const u of units) {
      const st = UNITS[u.type]
      if (!st.civilian) p += ((st.attack + st.defense + (st.ranged ?? 0)) / 2) * (0.5 + u.hp / 20)
    }
    return p
  }

  private garrisonOf(c: City, owner: PlayerId): Unit | null {
    const i = this.unitAt[c.tile]
    return i >= 0 && this.s.units[i].owner === owner ? this.s.units[i] : null
  }

  private nearestCity(tile: TileId): City | null {
    let best: City | null = null
    let bd = Infinity
    for (const c of this.myCities) {
      const d = distance(this.s.map, c.tile, tile)
      if (d < bd) {
        best = c
        bd = d
      }
    }
    return best
  }

  private chooseStrategy(): void {
    if (this.myCities.length === 0) return
    if (this.enemyCities.length === 0) return this.explore()
    const { map } = this.s
    const anchor = this.myCities.find((c) => c.capital) ?? this.myCities[0]
    const field = this.mine.filter((u) => !UNITS[u.type].civilian && this.cityAt[u.tile] < 0)
    // Turns of walking from where the army stands (or from the capital), along real paths: an army
    // near a city keeps at it, and a city across a ridge is as far as the detour.
    const away = (c: City) => {
      const d = this.distTo(c.tile)
      if (!field.length) return d[anchor.tile] / 12
      return field.reduce((s, u) => s + Math.min(d[u.tile], 200) / (UNITS[u.type].speed * TICKS_PER_TURN), 0) / field.length
    }
    let best: { c: City; v: number } | null = null
    for (const c of this.enemyCities) {
      const near = this.enemies.filter((e) => distance(map, e.tile, c.tile) <= 3)
      // A siege already under way is worth finishing.
      const besieging = this.power(field.filter((u) => distance(map, u.tile, c.tile) <= 3))
      const v =
        away(c) * 3 + this.power(near) * 0.5 + fortifiedSides(c.interior, 'wall').size + c.hp / 4 - besieging + this.rng() * 0.3
      if (!best || v < best.v) best = { c, v }
    }
    const target = best!.c
    this.targetCity = target
    // The city itself shoots and defends: count it as a few soldiers.
    const theirs = this.power(this.enemies.filter((e) => distance(map, e.tile, target.tile) <= 5)) + 5 + fortifiedSides(target.interior, 'wall').size / 2
    const mine = this.power(field)
    // The edge it waits for shrinks as the game goes on: early it builds up, later it commits.
    const edge = Math.max(0.6, 1.1 - Math.max(0, this.s.turn - 21) / 40)
    const front = [...this.myCities].sort(
      (a, b) => distance(map, a.tile, target.tile) - distance(map, b.tile, target.tile) || a.id - b.id,
    )[0]
    if (mine < theirs * edge + 2) {
      this.mode = 'gather'
      this.objective = this.frontTile(front.tile, target.tile, 2)
      return
    }
    // Mass just outside the city's reach, on a side it can actually be reached from, then storm it
    // together; once engaged, keep going. Closeness is measured along real paths (ridges and cliffs
    // can make a city three hexes away four turns away), so the army does not trickle in.
    this.mode = 'attack'
    const toTarget = this.distTo(target.tile)
    const staging = this.stagingTile(target, front.tile, toTarget)
    const steps = (u: Unit) => toTarget[u.tile] / (UNITS[u.type].speed * TICKS_PER_TURN)
    const engaged = this.power(field.filter((u) => steps(u) <= 1))
    const massed = this.power(field.filter((u) => steps(u) <= 2.5 || distance(map, u.tile, staging) <= 2))
    const go = engaged >= theirs * 0.8 * edge || massed >= theirs * edge + 2
    this.objective = go ? target.tile : staging
    this.staging = !go
  }

  /** No rival city known (fog of war): the fastest field unit scouts toward the enemy's likely home
   * (the mirrored start on two-player maps, else unexplored land near the middle); the rest wait in
   * front of the city nearest to it. */
  private explore(): void {
    const { map } = this.s
    this.mode = 'explore'
    const home = this.myCities.find((c) => c.capital) ?? this.myCities[0]
    const goal = this.exploreGoal(home.tile)
    const field = this.mine.filter((u) => !UNITS[u.type].civilian && this.cityAt[u.tile] < 0)
    const scout = [...field].sort((a, b) => UNITS[b.type].speed - UNITS[a.type].speed || a.id - b.id)[0]
    this.scout = scout ? scout.id : -1
    this.targetCity = null
    const front = [...this.myCities].sort((a, b) => distance(map, a.tile, goal) - distance(map, b.tile, goal) || a.id - b.id)[0]
    this.objective = this.frontTile(front.tile, goal, 2)
    this.scoutGoal = goal
  }

  private exploreGoal(home: TileId): TileId {
    const { map } = this.s
    if (this.s.players.length === 2) {
      const mirrored = mirror(map.starts[this.me], map.width, map.height)
      if (!this.explored[mirrored]) return mirrored
    }
    const mid = tileAt(map, Math.floor(map.width / 2), Math.floor(map.height / 2)) ?? home
    let best = home
    let bestD = Infinity
    for (let t = 0; t < map.tiles.length; t++) {
      if (this.explored[t]) continue
      const d = distance(map, t, mid) * 2 + distance(map, t, home)
      if (d < bestD) [best, bestD] = [t, d]
    }
    return best
  }

  /** Where to mass before storming `target`: 3-4 hexes out, at most about a turn and a half of real
   * walking from it, and on the side facing `home`. */
  private stagingTile(target: City, home: TileId, toTarget: Float64Array): TileId {
    const { map } = this.s
    const fromHome = this.distTo(home)
    let best = this.frontTile(target.tile, home, 4)
    let bestV = Infinity
    for (const t of tilesInRange(map, target.tile, 4)) {
      const d = distance(map, t, target.tile)
      if (d < 3 || !isPassable(map, t) || this.cityAt[t] >= 0 || toTarget[t] > 18) continue
      const v = toTarget[t] + fromHome[t] * 0.5
      if (v < bestV) [best, bestV] = [t, v]
    }
    return best
  }

  /** A passable tile `steps` out from `home` in the direction of `toward`. */
  private frontTile(home: TileId, toward: TileId, steps: number): TileId {
    const { map } = this.s
    let best = home
    let bestV = Infinity
    for (const t of tilesInRange(map, home, steps)) {
      if (!isPassable(map, t) || this.cityAt[t] >= 0) continue
      const v = distance(map, t, toward) + (distance(map, t, home) === steps ? 0 : 1)
      if (v < bestV || (v === bestV && t < best)) {
        best = t
        bestV = v
      }
    }
    return best
  }

  /** Where this unit should be heading: home to heal, at an intruder near one of my cities, or the
   * army objective. While attacking, only serious threats (more than the garrison holds) pull units back. */
  private objectiveFor(u: Unit): TileId {
    const { map } = this.s
    if (u.hp <= 4 && !(this.mode === 'attack' && this.targetCity && distance(map, u.tile, this.targetCity.tile) <= 3)) {
      const home = this.nearestCity(u.tile)
      if (home) return home.tile
    }
    // While attacking, only nearby units turn back, and only for a force that outweighs the city
    // and its garrison (enemy soldiers near a frontier city are often just guarding their own).
    const attacking = this.mode === 'attack'
    let defend: { d: number; intruder: Unit } | null = null
    for (const { c, power, intruder } of this.threatened) {
      const g = this.garrisonOf(c, this.me)
      const close = attacking ? this.power(this.enemies.filter((e) => !UNITS[e.type].civilian && distance(map, e.tile, c.tile) <= 3)) : power
      const serious = close > (g ? this.power([g]) * 2 : 0) + (attacking ? 8 : 0)
      const d = distance(map, u.tile, c.tile)
      if (serious && d <= (attacking ? 3 : 5) && (!defend || d < defend.d)) defend = { d, intruder }
    }
    if (defend) return defend.intruder.tile
    if (this.mode === 'explore' && u.id === this.scout) return this.scoutGoal
    return this.objective >= 0 ? this.objective : u.tile
  }

  // ---------------------------------------------------------------------------------------------
  // Paths and commits

  private fieldFor(u: Unit, maxTurns?: number): PathField {
    const n = this.s.map.tiles.length
    const through = new Uint8Array(n)
    const enter = new Uint8Array(n)
    const civilian = !!UNITS[u.type].civilian
    for (const e of this.enemies) {
      through[e.tile] = 1
      if (civilian) enter[e.tile] = 1
    }
    for (const c of this.enemyCities) {
      through[c.tile] = 1
      if (civilian) enter[c.tile] = 1
    }
    for (const t of this.stayers) if (t !== u.tile) through[t] = 1
    return pathField(this.s.map, u.tile, UNITS[u.type].speed, { through, enter, maxTurns, edges: this.known })
  }

  /** Can `u` end the turn on `tile` without fighting a friend for it or blocking a friend's route? */
  private canEnd(u: Unit, tile: TileId): boolean {
    const r = this.endAt.get(tile) ?? this.passing.get(tile)
    if (r !== undefined && r !== u.id) return false
    const i = this.unitAt[tile]
    if (i < 0) return true
    const o = this.s.units[i]
    if (o.id === u.id) return true
    if (o.owner !== this.me) return false
    const p = this.plans.get(o.id)
    return !!p && p.path.length > 0
  }

  /** Record a plan; `end` (if known to be free) is reserved for it, and so is its route this turn. */
  private commit(p: Plan, end: TileId | null): void {
    this.plans.set(p.unit.id, p)
    if (end !== null) this.endAt.set(end, p.unit.id)
    if (p.path.length === 0) this.stayers.add(p.unit.tile)
    const thisTurn = pathTicks(this.s, p.unit, p.path)
    p.path.forEach((t, i) => {
      if (t !== end && thisTurn[i] <= TICKS_PER_TURN && !this.passing.has(t)) this.passing.set(t, p.unit.id)
    })
  }

  private addPlanned(id: number, d: number): void {
    this.planned.set(id, (this.planned.get(id) ?? 0) + d)
    this.plannedVersion.set(id, (this.plannedVersion.get(id) ?? 0) + 1)
  }

  // ---------------------------------------------------------------------------------------------
  // Settlers

  private siteScores(): Float64Array {
    if (this.sites) return this.sites
    const { map } = this.s
    const n = map.tiles.length
    const score = new Float64Array(n).fill(-Infinity)
    const close = new Uint8Array(n)
    for (const c of this.myCities) for (const t of tilesInRange(map, c.tile, SITE_REACH)) close[t] = 1
    for (let t = 0; t < n; t++) {
      if (!close[t] || !this.explored[t] || !isPassable(map, t)) continue
      let near = Infinity
      let mineNear = Infinity
      let enemyNear = Infinity
      for (const c of this.s.cities) {
        const d = distance(map, c.tile, t)
        near = Math.min(near, d)
        if (c.owner === this.me) mineNear = Math.min(mineNear, d)
        else enemyNear = Math.min(enemyNear, d)
      }
      if (near < MIN_CITY_DISTANCE || mineNear > SITE_REACH || enemyNear < 4 || enemyNear < mineNear - 1) continue
      // Each neighbour is faced by three outer plots (one corner, two sides).
      let v = 0
      for (const nb of neighbors(map, t)) v += (this.explored[nb] ? SITE_VALUE[map.tiles[nb].biome] : UNSEEN_SITE_VALUE) * 4
      if (map.tiles[t].biome === 'hills') v += 3 // defensible
      v -= Math.max(0, mineNear - 3) * 3
      v -= this.meleeThreat[t].length * 6
      if (neighbors(map, t).filter((nb) => isWater(map, nb)).length >= 4) v -= 8
      score[t] = v
    }
    this.sites = score
    return score
  }

  private planSettlers(): void {
    const score = this.siteScores()
    const taken: TileId[] = []
    for (const u of this.mine) {
      if (u.type !== 'settler') continue
      const f = this.fieldFor(u)
      let best: { t: TileId; v: number } | null = null
      for (let t = 0; t < score.length; t++) {
        if (score[t] === -Infinity || f.ticks[t] === Infinity) continue
        if (taken.some((x) => distance(this.s.map, x, t) < MIN_CITY_DISTANCE)) continue
        if (f.ticks[t] <= TICKS_PER_TURN && !this.canEnd(u, t)) continue
        const v = score[t] - (f.ticks[t] / TICKS_PER_TURN) * 8 + this.rng() * 0.5
        if (!best || v > best.v) best = { t, v }
      }
      if (!best) {
        // Nowhere to settle: wait in (or walk to) the nearest city.
        const home = this.nearestCity(u.tile)
        const path = home && home.tile !== u.tile && this.canEnd(u, home.tile) ? extractPath(f, home.tile) ?? [] : []
        this.commit({ unit: u, path, stance: 'cautious', target: null, found: false }, path.at(-1) ?? u.tile)
        continue
      }
      taken.push(best.t)
      const path = extractPath(f, best.t)!
      const end = [u.tile, ...path].filter((t) => f.ticks[t] <= TICKS_PER_TURN).at(-1)!
      this.commit({ unit: u, path, stance: 'cautious', target: null, found: true }, this.canEnd(u, end) ? end : null)
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Garrisons

  /** The capital always keeps a garrison; other cities when enemy soldiers are within 7. */
  private needsGarrison(c: City): boolean {
    return c.capital || this.enemies.some((e) => !UNITS[e.type].civilian && distance(this.s.map, e.tile, c.tile) <= 7)
  }

  /** Defenders already in a city that needs one stay there, on hold. */
  private holdCities(): void {
    for (const c of this.myCities) {
      const here = this.garrisonOf(c, this.me)
      if (here && !UNITS[here.type].civilian && this.needsGarrison(c)) {
        this.commit({ unit: here, path: [], stance: 'hold', target: null, found: false }, c.tile)
      }
    }
  }

  /** Empty cities that need a garrison call the closest free unit home. */
  private planGarrisons(): void {
    for (const c of this.myCities) {
      const here = this.garrisonOf(c, this.me)
      if (this.endAt.has(c.tile) || (here && !this.plans.get(here.id)?.path.length) || !this.needsGarrison(c)) continue
      // The closest free unit within about two turns comes home (archers preferred).
      const home = this.distTo(c.tile)
      let best: { u: Unit; v: number } | null = null
      for (const u of this.mine) {
        if (UNITS[u.type].civilian || this.plans.has(u.id)) continue
        const turns = home[u.tile] / (UNITS[u.type].speed * TICKS_PER_TURN)
        const v = turns + (u.type === 'archer' ? 0 : u.type === 'spear' ? 0.3 : 1)
        if (turns <= 2 && (!best || v < best.v)) best = { u, v }
      }
      const path = best && extractPath(this.fieldFor(best.u, 3), c.tile)
      if (best && path) this.commit({ unit: best.u, path, stance: 'cautious', target: null, found: false }, c.tile)
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Army

  private cityValue(c: City): number {
    return 90 + c.pop * 15
  }

  private planArmy(): void {
    const units = this.mine.filter((u) => !UNITS[u.type].civilian && !this.plans.has(u.id))
    const reach = new Map(units.map((u) => [u.id, this.reachFor(u)]))
    const options = new Map(units.map((u) => [u.id, this.bestOption(u, reach.get(u.id)!)]))
    while (options.size) {
      let pick: Option | null = null
      for (const o of options.values()) {
        if (!pick || o.v > pick.v || (o.v === pick.v && o.unit.id < pick.unit.id)) pick = o
      }
      const o = pick!
      const path = o.dest === o.unit.tile ? [] : extractPath(o.field, o.dest)!
      const blocked = path.some((t) => t !== o.end && this.stayers.has(t))
      if (o.v !== -Infinity && (blocked || this.stale(o))) {
        // Re-score (with a fresh field if a new stayer blocks the route); a fresh option is never stale.
        if (blocked) reach.set(o.unit.id, this.reachFor(o.unit))
        options.set(o.unit.id, this.bestOption(o.unit, reach.get(o.unit.id)!))
        continue
      }
      options.delete(o.unit.id)
      this.commit({ unit: o.unit, path, stance: o.stance, target: o.target, found: false }, o.end)
      if (o.hit) this.addPlanned(o.hit.id, o.hit.d)
    }
  }

  private reachFor(u: Unit): Reach {
    const field = this.fieldFor(u, 1)
    // Tile order matters only for determinism of the random jitter: keep it by tile id.
    return { field, tiles: [...field.reached].sort((a, b) => a - b) }
  }

  private stale(o: Option): boolean {
    if (!this.canEnd(o.unit, o.end)) return true
    return !!o.hit && (this.plannedVersion.get(o.hit.id) ?? 0) !== o.seen
  }

  private bestOption(u: Unit, { field: f, tiles }: Reach): Option {
    const { map } = this.s
    const st = UNITS[u.type]
    const objective = this.objectiveFor(u)
    const perTurn = st.speed * TICKS_PER_TURN
    // Gathering: within a turn of the spot counts as there (units spread out instead of queueing).
    // Massing for an assault: everyone closes to the staging ring around the target (measured along
    // real paths) and nobody walks back to it. The assault itself goes all the way in.
    const massing = this.staging && objective === this.objective && !!this.targetCity
    const goal = this.distTo(massing ? this.targetCity!.tile : objective)
    const slack = objective === this.targetCity?.tile || objective === this.scoutGoal ? 0 : massing ? goal[this.objective] / perTurn : 1
    const caution = this.mode === 'attack' ? 0.35 : 0.6
    let best: Option = { unit: u, field: f, dest: u.tile, end: u.tile, stance: 'hold', target: null, v: -Infinity }
    const consider = (o: Option) => {
      if (o.v <= best.v) return
      if (o.hit) o.seen = this.plannedVersion.get(o.hit.id) ?? 0
      best = o
    }
    for (const t of tiles) {
      const ei = this.unitAt[t]
      const enemy = ei >= 0 && this.s.units[ei].owner !== this.me ? this.s.units[ei] : null
      const ci = this.cityAt[t]
      const ecity = ci >= 0 && this.s.cities[ci].owner !== this.me ? this.s.cities[ci] : null
      if (enemy || ecity) {
        const from = f.prev[t]
        const end = ecity && !enemy && ecity.hp === 0 ? t : from // walking into a breached, empty city
        if (from < 0 || !this.canEnd(u, end)) continue
        const a = this.attackValue(u, from, enemy, ecity)
        if (!a) continue
        const v = a.v - Math.max(0, goal[from] / perTurn - slack) * PROGRESS * 0.3
        consider({ unit: u, field: f, dest: t, end, stance: 'cautious', target: null, v, hit: enemy ? { id: enemy.id, d: a.dealt } : undefined })
        continue
      }
      if (!this.canEnd(u, t)) continue
      const exposed = this.meleeThreat[t].length + this.rangedThreat[t].length > 0
      let stance: Stance = t === u.tile && exposed ? 'hold' : u.type === 'spear' && this.mode === 'attack' ? 'aggressive' : 'cautious'
      let v = -Math.max(0, goal[t] / perTurn - slack) * PROGRESS
      let target: TileId | null = null
      let hit: Option['hit']
      if (st.ranged) {
        const shot = this.bestShot(u, t)
        if (shot) {
          v += shot.v
          target = shot.tile
          if (shot.unit !== undefined) hit = { id: shot.unit, d: shot.d }
          // Overwatch picks the first unit in range, not a city: stay cautious while sieging.
          else if (stance === 'hold') stance = 'cautious'
        }
      }
      if (exposed || this.nearEnemyCity(t)) {
        const dz = this.danger(u, t, stance)
        v -= (Math.min(dz, u.hp) / 10) * VALUE[u.type] * caution + (dz >= u.hp ? VALUE[u.type] * caution : 0)
      }
      const biome = map.tiles[t].biome
      v += biome === 'hills' ? 1.5 : biome === 'forest' ? 1 : 0
      v += this.rng() * 0.3
      consider({ unit: u, field: f, dest: t, end: t, stance, target, v, hit })
    }
    return best
  }

  /** With fog, shooting needs a line of sight (same rule as resolveTurn). */
  private sees(from: TileId, to: TileId): boolean {
    return !this.s.fog || lineOfSight(this.s.map, from, to)
  }

  private nearEnemyCity(t: TileId): boolean {
    for (const c of this.enemyCities) if (c.hp > 0 && cityCanShoot(this.s.map, c, t) && this.sees(c.tile, t)) return true
    return false
  }

  /** Value of a melee from `from` into an enemy unit or city (null if pointless). */
  private attackValue(u: Unit, from: TileId, enemy: Unit | null, city: City | null): { v: number; dealt: number } | null {
    const { map } = this.s
    const v: Unit = { ...u, tile: from }
    const cost = (taken: number) => (Math.min(taken, u.hp) / 10) * VALUE[u.type] + (taken >= u.hp ? VALUE[u.type] * 0.6 : 0)
    const exposure = (this.danger(u, from, 'cautious') / 10) * VALUE[u.type] * 0.3
    if (enemy) {
      const left = enemy.hp - (this.planned.get(enemy.id) ?? 0)
      if (left <= 0) return null
      const defCity = city && city.owner === enemy.owner ? city : null
      const o = meleeOutcome(map, v, enemy, defCity)
      const kill = o.toDefender >= left
      let val = (Math.min(o.toDefender, left) / 10) * VALUE[enemy.type] + (kill ? VALUE[enemy.type] * 0.6 : 0)
      if (kill && defCity && defCity.hp === 0) val += this.cityValue(defCity)
      return { v: val - cost(o.toAttacker) - exposure, dealt: o.toDefender }
    }
    if (!city) return null
    if (city.hp === 0) return { v: this.cityValue(city), dealt: 0 }
    const o = meleeVsCity(map, v, city)
    const val = o.toCity >= city.hp ? this.cityValue(city) : (o.toCity / CITY_MAX_HP) * this.cityValue(city) * 0.25
    return { v: val - cost(o.toAttacker) - exposure, dealt: 0 }
  }

  /** Best volley from `tile` at the end of this turn: a unit (id) or a city. */
  private bestShot(u: Unit, tile: TileId): { v: number; tile: TileId; unit?: number; d: number } | null {
    const { map } = this.s
    const v: Unit = { ...u, tile }
    let best: { v: number; tile: TileId; unit?: number; d: number } | null = null
    for (const e of this.enemies) {
      if (!inRange(map, tile, e.tile, unitRange(u)) || !this.sees(tile, e.tile)) continue
      const ci = this.cityAt[e.tile]
      if (ci >= 0 && this.s.cities[ci].owner === e.owner && this.s.cities[ci].hp > 0) continue
      const left = e.hp - (this.planned.get(e.id) ?? 0)
      if (left <= 0) continue
      const d = damage(unitRangedStrength(map, v, e.tile), unitDefense(map, e, null, tile, { city: null }))
      const val = (Math.min(d, left) / 10) * VALUE[e.type] + (d >= left ? VALUE[e.type] * 0.4 : 0)
      if (!best || val > best.v) best = { v: val, tile: e.tile, unit: e.id, d }
    }
    for (const c of this.enemyCities) {
      if (c.hp <= 0 || !inRange(map, tile, c.tile, unitRange(u)) || !this.sees(tile, c.tile)) continue
      const d = damage(unitRangedStrength(map, v, c.tile), cityDefense(map, c, tile))
      const val = (d / CITY_MAX_HP) * this.cityValue(c) * (this.mode === 'attack' ? 0.7 : 0.2)
      if (!best || val > best.v) best = { v: val, tile: c.tile, d }
    }
    return best
  }

  // ---------------------------------------------------------------------------------------------
  // Cities

  /** Every city's build (a unit or a building on a plot) and focus. */
  private planCities(): { cities: Record<number, BuildItem>; focus: Record<number, CityFocus> } {
    const { map } = this.s
    const cities: Record<number, BuildItem> = {}
    const focus: Record<number, CityFocus> = {}
    const sites = this.siteScores()
    let goodSites = 0
    for (let t = 0; t < sites.length; t++) if (sites[t] >= GOOD_SITE) goodSites++
    const counts: Record<UnitType, number> = { spear: 0, archer: 0, rider: 0, settler: 0 }
    for (const u of this.mine) counts[u.type]++
    const theirs: Record<UnitType, number> = { spear: 0, archer: 0, rider: 0, settler: 0 }
    for (const e of this.enemies) theirs[e.type]++
    let military = counts.spear + counts.archer + counts.rider
    // New cities stop paying off late in the game.
    let settlers = this.s.turn > this.s.maxTurns - 32 ? 0 : Math.min(MAX_SETTLERS - counts.settler, goodSites)
    const minArmy = this.myCities.length + 1
    // The army to keep up: a garrison where one is needed, plus a field army that grows with time.
    const garrisons = this.myCities.filter((c) => this.needsGarrison(c)).length
    const wantArmy = garrisons + Math.round(3.6 + this.s.turn * 0.3)
    const unit = (t: UnitType): BuildItem => {
      if (t !== 'settler') {
        counts[t]++
        military++
      }
      return t
    }

    for (const c of [...this.myCities].sort((a, b) => b.pop - a.pop || a.id - b.id)) {
      const out = outputOf(map, c)
      const housing = housingOf(c.interior)
      const surplus = foodSurplus(c, out)
      const threat = this.threatened.find((x) => x.c === c)
      const danger = threat?.power ?? 0
      const guard = this.garrisonOf(c, this.me)
      let item: BuildItem | null = null
      if (danger > 0 && !guard) item = unit(theirs.rider > theirs.spear ? 'spear' : 'archer')
      else if (threat && danger > 6 + this.power(guard ? [guard] : []) * 2) {
        item = this.fortify(c, threat.intruder, danger) ?? unit(this.counter(counts, theirs))
      } else if (danger > 3 || military < minArmy) item = unit(this.counter(counts, theirs))
      else if (settlers > 0 && c.pop >= 2) {
        item = 'settler'
        settlers--
      } else if (military < wantArmy / 2) item = unit(this.counter(counts, theirs))
      else if (out.idle > 0) item = this.bestJob(c, surplus, c.pop < housing)
      if (!item && c.pop >= housing - 1 && surplus > 0) item = this.bestPlot(c, 'house')
      if (!item && military < wantArmy) item = unit(this.counter(counts, theirs))
      if (!item && !hasBuilding(c.interior, 'barracks') && out.prod >= 6) item = this.bestPlot(c, 'barracks')
      if (!item && !hasBuilding(c.interior, 'temple') && c.pop >= 4 && danger === 0) item = this.bestPlot(c, 'temple')
      if (!item) item = unit(this.counter(counts, theirs))
      cities[c.id] = item
      focus[c.id] = danger > 3 ? 'production' : c.pop < housing && surplus < 4 ? 'growth' : 'balance'
    }
    return { cities, focus }
  }

  /** Best value of a plot for a job building facing outward (what a House would waste there). */
  private plotReserve(c: City, plot: number): number {
    if (PLOTS[plot].ring === 1) return 2
    let best = 0
    for (const b of ['farm', 'sawmill', 'harbor'] as BuildingType[]) {
      if (!canPlace(this.s.map, c.tile, c.interior, b, plot).ok) continue
      const y = this.yieldIf(c, b, plot)
      best = Math.max(best, y.food + y.prod)
    }
    return best
  }

  private yieldIf(c: City, b: BuildingType, plot: number): { food: number; prod: number } {
    const trial = { ...c.interior, plots: c.interior.plots.slice() }
    trial.plots[plot] = b
    return buildingYield(this.s.map, c.tile, trial, plot)
  }

  /** A worker-less building on its best plot: houses next to markets and away from good land,
   * barracks and temples on any inner plot. */
  private bestPlot(c: City, b: BuildingType): BuildingOrder | null {
    let best: { plot: number; v: number } | null = null
    for (let p = 1; p < PLOTS.length; p++) {
      if (!canPlace(this.s.map, c.tile, c.interior, b, p).ok) continue
      const markets = PLOT_NEIGHBORS[p].filter((n) => c.interior.plots[n] === 'market').length
      const v = b === 'house' ? markets - this.plotReserve(c, p) : -p * 0.01
      if (!best || v > best.v) best = { plot: p, v }
    }
    return best && { building: b, plot: best.plot }
  }

  /** The job building worth most per production, counting what it adds to its neighbours. Food is
   * worth more while the city can still grow. */
  private bestJob(c: City, surplus: number, canGrow: boolean): BuildingOrder | null {
    const wf = canGrow ? (surplus < 3 ? 1.6 : 1.1) : 0.5
    let best: { order: BuildingOrder; v: number } | null = null
    for (const b of ['farm', 'harbor', 'sawmill', 'workshop', 'market'] as BuildingType[]) {
      for (let p = 1; p < PLOTS.length; p++) {
        if (!canPlace(this.s.map, c.tile, c.interior, b, p).ok) continue
        const y = this.yieldIf(c, b, p)
        const food = y.food
        let prod = y.prod
        for (const n of PLOT_NEIGHBORS[p]) {
          const nb = c.interior.plots[n]
          if (nb === 'workshop' && (b === 'workshop' || b === 'sawmill')) prod++
        }
        // An idle citizen already gives 1 food: the job is worth what it adds on top.
        const v = ((food * wf + prod - 1 * wf) * 20) / BUILDINGS[b].cost - this.plotReserve(c, p) * (PLOTS[p].ring === 1 ? 0 : 0.05)
        if (!best || v > best.v) best = { order: { building: b, plot: p }, v }
      }
    }
    return best && best.v > 0 ? best.order : null
  }

  /** A wall (or, once walled, a tower) on the side the intruder comes from, if a plot is free. */
  private fortify(c: City, intruder: Unit, danger: number): BuildingOrder | null {
    const sides = sidesToward(this.s.map, c.tile, intruder.tile)
    const walls = fortifiedSides(c.interior, 'wall')
    const kind: BuildingType | null = sides.some((d) => !walls.has(d)) ? 'wall' : danger > 9 && !fortifiedSides(c.interior, 'tower').size ? 'tower' : null
    if (!kind) return null
    let best: { plot: number; v: number } | null = null
    for (let p = 7; p < PLOTS.length; p++) {
      if (!canPlace(this.s.map, c.tile, c.interior, kind, p).ok) continue
      const cover = PLOTS[p].facing.filter((d) => sides.includes(d) && !(kind === 'wall' && walls.has(d))).length
      if (cover === 0) continue
      const v = cover * 2 + PLOTS[p].facing.length - this.plotReserve(c, p) * 0.5
      if (!best || v > best.v) best = { plot: p, v }
    }
    return best && { building: kind, plot: best.plot }
  }

  /** The unit type that best fills the gap between my mix and the counter to theirs. */
  private counter(mine: Record<UnitType, number>, theirs: Record<UnitType, number>): UnitType {
    const total = theirs.spear + theirs.archer + theirs.rider + 1
    // Spear beats rider, rider beats archer, archer beats spear (and breaches cities: more of them
    // while attacking).
    const want: Record<string, number> = {
      spear: 1 + (2 * theirs.rider) / total,
      archer: (this.mode === 'attack' ? 1.8 : 1.2) + (2 * theirs.spear) / total,
      rider: 0.8 + (2 * theirs.archer) / total,
    }
    const sum = want.spear + want.archer + want.rider
    const have = mine.spear + mine.archer + mine.rider + 1
    let best: UnitType = 'spear'
    let bestGap = -Infinity
    for (const t of MILITARY) {
      const gap = want[t] / sum - mine[t] / have + this.rng() * 0.05
      if (gap > bestGap) {
        best = t
        bestGap = gap
      }
    }
    return best
  }
}

/** Absolute tick (turn offset * 6 + tick) at which `u` enters each tile of `path`, unobstructed. */
function pathTicks(s: GameState, u: Unit, path: TileId[]): number[] {
  return pathTiming(s, u.id, path).map((x) => x.turn * TICKS_PER_TURN + x.tick)
}

/** A baseline opponent: wanders at random and builds at random. */
export function randomOrders(state: GameState, player: PlayerId, seed = 0): PlayerOrders {
  const rng = mulberry32(hashString(`random:${seed}:${state.turn}:${player}`))
  const orders: PlayerOrders = { units: {}, cities: {} }
  const stances: Stance[] = ['cautious', 'aggressive', 'hold']
  for (const u of state.units) {
    if (u.owner !== player) continue
    const path: TileId[] = []
    let at = u.tile
    for (let k = 0; k < 3; k++) {
      const nbs = neighbors(state.map, at).filter((nb) => isPassable(state.map, nb))
      if (nbs.length === 0) break
      at = nbs[Math.floor(rng() * nbs.length)]
      path.push(at)
    }
    orders.units[u.id] = { path, stance: stances[Math.floor(rng() * 3)], found: u.type === 'settler' && rng() < 0.3 }
  }
  const units: UnitType[] = ['spear', 'archer', 'rider', 'settler']
  const buildings = Object.keys(BUILDINGS) as BuildingType[]
  for (const c of state.cities) {
    if (c.owner !== player) continue
    // A random unit, or a random building on a random plot (the engine ignores ones that do not fit).
    orders.cities[c.id] =
      rng() < 0.6
        ? units[Math.floor(rng() * units.length)]
        : { building: buildings[Math.floor(rng() * buildings.length)], plot: 1 + Math.floor(rng() * (PLOTS.length - 1)) }
  }
  return orders
}
