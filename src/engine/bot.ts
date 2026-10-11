// A scripted bot that plays through the same API as humans: it only returns PlayerOrders.
// Deterministic given (state, player, seed). Each turn:
//   strategy  pick the softest enemy city; attack it when the field army has an edge, else gather
//             in front of my nearest city; threatened cities pull nearby units home
//   settlers  walk to the best free sites (never two that would conflict) and found
//   garrison  one defender on hold in the capital and in every city with enemies near (archers
//             preferred: they shoot from safety)
//   army      every field unit scores the tiles it can reach this turn (progress toward its
//             objective, danger, terrain, volleys for archers, melee value for attacks); the best
//             option commits first and options made stale by a commit are re-scored (lazy greedy)
//   cities    expand while good sites remain, keep a garrison, counter the enemy's unit mix

import { CITY_MAX_HP, MIN_CITY_DISTANCE, MODIFIERS, TICKS_PER_TURN, TILE_YIELD, UNITS } from './config.ts'
import {
  cityDefense,
  cityRange,
  cityRangedStrength,
  damage,
  inRange,
  meleeOutcome,
  meleeVsCity,
  unitDefense,
  unitRange,
  unitRangedStrength,
} from './combat.ts'
import { distance, neighbors, tilesInRange } from './hex.ts'
import { edges, extractPath, pathField, pathTiming, type PathField } from './paths.ts'
import { hashString, mulberry32, type Rng } from './rng.ts'
import { isPassable, isWater } from './terrain.ts'
import type { BuildItem, City, GameState, PlayerId, PlayerOrders, Stance, TileId, Unit, UnitType } from './types.ts'

const VALUE: Record<UnitType, number> = { spear: 20, archer: 25, rider: 30, settler: 45 }
const MILITARY: UnitType[] = ['spear', 'archer', 'rider']
/** Settlers do not look further than this from my cities (hex steps). */
const SITE_REACH = 5
/** Site score worth a settler. */
const GOOD_SITE = 40
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
  private mode: 'gather' | 'attack' = 'gather'
  private objective: TileId = -1
  private targetCity: City | null = null
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
  }

  run(): PlayerOrders {
    this.computeThreats()
    this.chooseStrategy()
    this.holdCities()
    this.planSettlers()
    this.planGarrisons()
    this.planArmy()
    const orders: PlayerOrders = { units: {}, cities: this.planCities() }
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
    const { nb } = edges(map)
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
      const reach = e.stance === 'hold' ? [e.tile] : pathField(map, e.tile, st.speed, { through, maxTurns: 1 }).reached
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
        if (c.hp > 0 && inRange(map, c.tile, tile, cityRange)) {
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
    const { nb, back } = edges(this.s.map)
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
    if (this.enemyCities.length === 0 || this.myCities.length === 0) return
    const { map } = this.s
    const anchor = this.myCities.find((c) => c.capital) ?? this.myCities[0]
    let best: { c: City; v: number } | null = null
    for (const c of this.enemyCities) {
      const near = this.enemies.filter((e) => distance(map, e.tile, c.tile) <= 3)
      const v =
        distance(map, anchor.tile, c.tile) * 1.5 + this.power(near) + (c.walls ? 5 : 0) + c.hp / 4 + this.rng()
      if (!best || v < best.v) best = { c, v }
    }
    const target = best!.c
    this.targetCity = target
    const myField = this.mine.filter((u) => !UNITS[u.type].civilian && this.cityAt[u.tile] < 0)
    const within = (r: number, at: TileId) => myField.filter((u) => distance(map, u.tile, at) <= r)
    // The city itself shoots and defends: count it as a few soldiers.
    const theirs = this.power(this.enemies.filter((e) => distance(map, e.tile, target.tile) <= 5)) + (target.walls ? 8 : 5)
    const mine = this.power(myField)
    const late = this.s.turn > this.s.maxTurns - 15
    const front = [...this.myCities].sort(
      (a, b) => distance(map, a.tile, target.tile) - distance(map, b.tile, target.tile) || a.id - b.id,
    )[0]
    if (mine < theirs * 1.1 + 2 && !(late && mine >= theirs * 0.8)) {
      this.mode = 'gather'
      this.objective = this.frontTile(front.tile, target.tile, 2)
      return
    }
    // Mass at a staging tile three steps out, then assault; once engaged, keep going.
    this.mode = 'attack'
    const staging = this.frontTile(target.tile, front.tile, 3)
    const engaged = this.power(within(3, target.tile))
    const massed = engaged + this.power(within(2, staging))
    this.objective = engaged >= theirs * 0.8 || massed >= theirs * 1.1 + 2 ? target.tile : staging
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
    let defend: { d: number; intruder: Unit } | null = null
    for (const { c, power, intruder } of this.threatened) {
      const g = this.garrisonOf(c, this.me)
      const serious = power > (g ? this.power([g]) * 2 : 0) + (this.mode === 'attack' ? 6 : 0)
      const d = distance(map, u.tile, c.tile)
      if (serious && d <= 5 && (!defend || d < defend.d)) defend = { d, intruder }
    }
    if (defend) return defend.intruder.tile
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
    return pathField(this.s.map, u.tile, UNITS[u.type].speed, { through, enter, maxTurns })
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
    const worked = new Uint8Array(n)
    for (const c of this.s.cities) for (const t of tilesInRange(map, c.tile, 2)) worked[t] = 1
    const close = new Uint8Array(n)
    for (const c of this.myCities) for (const t of tilesInRange(map, c.tile, SITE_REACH)) close[t] = 1
    for (let t = 0; t < n; t++) {
      if (!close[t] || !isPassable(map, t)) continue
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
      let v = 0
      for (const r of tilesInRange(map, t, 2)) {
        if (r === t) continue
        const y = TILE_YIELD[map.tiles[r].biome]
        v += (y.food * 1.2 + y.prod) * (worked[r] ? 0.4 : 1)
      }
      const cy = TILE_YIELD[map.tiles[t].biome]
      v += cy.food + cy.prod
      if (map.tiles[t].biome === 'hills') v += 3 // defensible
      v -= Math.max(0, mineNear - 3) * 3
      v -= this.meleeThreat[t].length * 6
      if (neighbors(map, t).filter((nb) => isWater(map, nb)).length >= 4) v -= 6
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
    const goal = this.distTo(objective)
    // When gathering, within a turn of the spot counts as there (units spread out instead of
    // queueing); an assault goes all the way in.
    const slack = objective === this.targetCity?.tile ? 0 : 1
    const perTurn = st.speed * TICKS_PER_TURN
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

  private nearEnemyCity(t: TileId): boolean {
    for (const c of this.enemyCities) if (c.hp > 0 && inRange(this.s.map, c.tile, t, cityRange)) return true
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
      if (!inRange(map, tile, e.tile, unitRange(u))) continue
      const ci = this.cityAt[e.tile]
      if (ci >= 0 && this.s.cities[ci].owner === e.owner && this.s.cities[ci].hp > 0) continue
      const left = e.hp - (this.planned.get(e.id) ?? 0)
      if (left <= 0) continue
      const d = damage(unitRangedStrength(map, v, e.tile), unitDefense(map, e, null, tile, { city: null }))
      const val = (Math.min(d, left) / 10) * VALUE[e.type] + (d >= left ? VALUE[e.type] * 0.4 : 0)
      if (!best || val > best.v) best = { v: val, tile: e.tile, unit: e.id, d }
    }
    for (const c of this.enemyCities) {
      if (c.hp <= 0 || !inRange(map, tile, c.tile, unitRange(u))) continue
      const d = damage(unitRangedStrength(map, v, c.tile), cityDefense(map, c, tile))
      const val = (d / CITY_MAX_HP) * this.cityValue(c) * (this.mode === 'attack' ? 0.7 : 0.2)
      if (!best || val > best.v) best = { v: val, tile: c.tile, d }
    }
    return best
  }

  // ---------------------------------------------------------------------------------------------
  // Cities

  private planCities(): Record<number, BuildItem> {
    const out: Record<number, BuildItem> = {}
    const sites = this.siteScores()
    let goodSites = 0
    for (let t = 0; t < sites.length; t++) if (sites[t] >= GOOD_SITE) goodSites++
    const counts: Record<UnitType, number> = { spear: 0, archer: 0, rider: 0, settler: 0 }
    for (const u of this.mine) counts[u.type]++
    const theirs: Record<UnitType, number> = { spear: 0, archer: 0, rider: 0, settler: 0 }
    for (const e of this.enemies) theirs[e.type]++
    const military = counts.spear + counts.archer + counts.rider
    const enemyMilitary = theirs.spear + theirs.archer + theirs.rider
    let settlers = Math.min(MAX_SETTLERS - counts.settler, goodSites)
    const minArmy = this.myCities.length + 1

    for (const c of [...this.myCities].sort((a, b) => b.pop - a.pop || a.id - b.id)) {
      const threat = this.threatened.find((x) => x.c === c)?.power ?? 0
      let item: BuildItem
      if (threat > 0 && !this.garrisonOf(c, this.me)) item = theirs.rider > theirs.spear ? 'spear' : 'archer'
      else if (threat > 8 && !c.walls && c.pop >= 3) item = 'walls'
      else if (threat > 3) item = this.counter(counts, theirs)
      else if (settlers > 0 && c.pop >= 2 && military >= minArmy) {
        item = 'settler'
        settlers--
      } else if (!c.walls && c.pop >= 5 && enemyMilitary > military) item = 'walls'
      else item = this.counter(counts, theirs)
      if (item !== 'settler' && item !== 'walls') counts[item]++
      out[c.id] = item
    }
    return out
  }

  /** The unit type that best fills the gap between my mix and the counter to theirs. */
  private counter(mine: Record<UnitType, number>, theirs: Record<UnitType, number>): UnitType {
    const total = theirs.spear + theirs.archer + theirs.rider + 1
    // Spear beats rider, rider beats archer, archer beats spear (and breaches cities).
    const want: Record<string, number> = {
      spear: 1 + (2 * theirs.rider) / total,
      archer: 1.2 + (2 * theirs.spear) / total,
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
  const items: BuildItem[] = ['spear', 'archer', 'rider', 'settler', 'walls']
  for (const c of state.cities) if (c.owner === player) orders.cities[c.id] = items[Math.floor(rng() * items.length)]
  return orders
}
