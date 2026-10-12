// Simultaneous resolution of one turn (SPEC.md §3 to §6, made precise in docs/RULES.md).
// Pure and deterministic: the input state is never mutated, there is no randomness, and units are
// always processed in id order.

import {
  CITY_MAX_HP,
  CITY_REGEN,
  MIN_CITY_DISTANCE,
  TICKS_PER_TURN,
  UNITS,
  UNIT_MAX_HP,
} from './config.ts'
import {
  cityCanShoot,
  cityDefense,
  cityRangedStrength,
  clashStrength,
  damage,
  inRange,
  unitAttack,
  unitDefense,
  unitRange,
  unitRangedStrength,
} from './combat.ts'
import { BUILDINGS, canPlace, hasBuilding } from './city.ts'
import { buildCost, foodSurplus, growthNeed, housingOf, outputOf } from './economy.ts'
import { newCity, newUnit } from './game.ts'
import { distance, hexCenter, neighbors } from './hex.ts'
import { scores } from './observe.ts'
import { moveCost } from './paths.ts'
import { citySnapshot, encodeExplored, exploredOf, lineOfSight, remember, visibility } from './vision.ts'
import { canStep } from './terrain.ts'
import type {
  BuildItem,
  BuildingOrder,
  City,
  CityFocus,
  GameEvent,
  GameState,
  PlayerId,
  PlayerMemory,
  PlayerOrders,
  ResolveResult,
  Stance,
  Target,
  TileId,
  Unit,
  UnitOrder,
} from './types.ts'

const MAX_PATH = 64
const STANCES: readonly Stance[] = ['cautious', 'aggressive', 'hold']
const UNIT_TYPES: readonly string[] = Object.keys(UNITS)
const FOCI: readonly CityFocus[] = ['growth', 'production', 'balance']
const HEAL_FIELD = 1
const HEAL_CITY = 3
/** A captured city keeps this much health. */
const CAPTURED_CITY_HP = 5

/** Per-unit bookkeeping that only lives during one resolution. */
interface Live {
  u: Unit
  speed: number
  civilian: boolean
  points: number
  /** Can no longer move this turn (attacked, was attacked, clashed or halted). */
  stopped: boolean
  /** Took part in melee or a clash this turn: archers then cannot shoot. */
  fought: boolean
  damaged: boolean
  fired: boolean
  dead: boolean
}

/** Where a unit wants to step this tick. A lunge (aggressive retarget) only attacks a unit that stays. */
interface Intent {
  to: TileId
  lunge: boolean
}

const PENDING = 1
const MOVED = 2
const STAY = 3

export function resolveTurn(state: GameState, orders: Partial<Record<PlayerId, PlayerOrders>>): ResolveResult {
  const next = cloneState(state)
  if (state.winner !== null) return { state: next, events: [] }
  return new Resolver(next).run(orders)
}

function cloneState(s: GameState): GameState {
  return {
    ...s,
    map: s.map, // immutable, shared
    players: s.players.map((p) => ({ ...p })),
    units: s.units.map((u) => ({ ...u, path: [...u.path] })),
    cities: s.cities.map((c) => ({
      ...c,
      build: c.build && typeof c.build === 'object' ? { ...c.build } : c.build,
      interior: { ...c.interior, plots: [...c.interior.plots] },
    })),
    fog: s.fog && s.fog.map((m) => ({ explored: m.explored, cities: m.cities.map(citySnapshot), seen: { ...m.seen } })),
  }
}

class Resolver {
  readonly s: GameState
  readonly events: GameEvent[] = []
  readonly lives: Live[]
  /** Tile -> index into `lives`, or -1. */
  readonly unitAt: Int32Array
  /** Tile -> index into `s.cities`, or -1. */
  readonly cityAt: Int32Array
  readonly cityDamaged = new Set<number>()
  /** Fog of war, per seat: explored tiles (updated as the turn plays) and remembered cities. */
  readonly fog: { explored: Uint8Array; memory: Pick<PlayerMemory, 'cities' | 'seen'> }[] | null
  /** Per seat, lazily: tiles in sight when the turn began (orders are judged by what was known). */
  private sightAtStart: (Uint8Array | undefined)[] = []

  constructor(s: GameState) {
    this.s = s
    const n = s.map.tiles.length
    s.units.sort((a, b) => a.id - b.id)
    this.lives = s.units.map((u) => ({
      u,
      speed: UNITS[u.type].speed,
      civilian: !!UNITS[u.type].civilian,
      points: 0,
      stopped: false,
      fought: false,
      damaged: false,
      fired: false,
      dead: false,
    }))
    this.unitAt = new Int32Array(n).fill(-1)
    this.lives.forEach((L, i) => (this.unitAt[L.u.tile] = i))
    this.cityAt = new Int32Array(n).fill(-1)
    s.cities.forEach((c, i) => (this.cityAt[c.tile] = i))
    this.fog = s.fog && s.fog.map((m, p) => ({ explored: exploredOf(s, p), memory: { cities: m.cities, seen: m.seen } }))
  }

  run(orders: Partial<Record<PlayerId, PlayerOrders>>): ResolveResult {
    this.applyOrders(orders)
    for (let t = 1; t <= TICKS_PER_TURN; t++) {
      this.tick(t)
      this.discover(this.lives.filter((L) => !L.dead).map((L) => L.u))
    }
    this.reportBlocked(TICKS_PER_TURN)
    this.volleys(TICKS_PER_TURN + 1)
    this.endOfTurn(TICKS_PER_TURN + 2)
    this.discover(this.s.units)
    if (this.fog) this.s.fog = this.fog.map((f) => ({ explored: encodeExplored(f.explored), ...f.memory }))
    this.s.turn++
    return { state: this.s, events: this.events }
  }

  /** Fog: what every seat sees with `units` and the cities becomes explored and remembered. */
  private discover(units: Unit[]): void {
    if (!this.fog) return
    const view = { map: this.s.map, units, cities: this.s.cities, turn: this.s.turn }
    this.fog.forEach((f, p) => (f.memory = remember(view, p, f.explored, f.memory)))
  }

  /** Fog: shooters need a line of sight to their target (without fog there is no sight to check). */
  private sees(from: TileId, to: TileId): boolean {
    return !this.fog || lineOfSight(this.s.map, from, to)
  }

  /** Fog: does `player` know about a rival on `tile` (in sight when the turn began)? Always without fog. */
  private knows(player: PlayerId, tile: TileId): boolean {
    if (!this.fog) return true
    this.sightAtStart[player] ??= visibility(this.s, player)
    return this.sightAtStart[player]![tile] === 1
  }

  // ---------------------------------------------------------------------------------------------
  // Orders

  private applyOrders(orders: Partial<Record<PlayerId, PlayerOrders>>): void {
    if (!orders || typeof orders !== 'object') return
    const byId = new Map(this.lives.map((L) => [L.u.id, L]))
    const cityById = new Map(this.s.cities.map((c) => [c.id, c]))
    for (const p of this.s.players) {
      const po = (orders as Record<number, unknown>)[p.id] as PlayerOrders | undefined
      if (!p.alive || !po || typeof po !== 'object') continue
      if (po.units && typeof po.units === 'object') {
        for (const [key, order] of Object.entries(po.units)) {
          const L = byId.get(Number(key))
          if (L && L.u.owner === p.id) this.applyUnitOrder(L, order)
        }
      }
      if (po.cities && typeof po.cities === 'object') {
        for (const [key, item] of Object.entries(po.cities)) {
          const c = cityById.get(Number(key))
          if (!c || c.owner !== p.id) continue
          const build = this.cleanBuild(c, item)
          if (build !== undefined) c.build = build
        }
      }
      if (po.focus && typeof po.focus === 'object') {
        for (const [key, focus] of Object.entries(po.focus)) {
          const c = cityById.get(Number(key))
          if (c && c.owner === p.id && FOCI.includes(focus)) c.interior.focus = focus
        }
      }
    }
  }

  /** A valid build for this city, null to stop building, or undefined to ignore the order. */
  private cleanBuild(c: City, item: unknown): BuildItem | null | undefined {
    if (item === null) return null
    if (typeof item === 'string') return UNIT_TYPES.includes(item) ? (item as BuildItem) : undefined
    if (!item || typeof item !== 'object') return undefined
    const { building, plot } = item as Partial<BuildingOrder>
    if (typeof building !== 'string' || !(building in BUILDINGS) || !Number.isInteger(plot)) return undefined
    if (!canPlace(this.s.map, c.tile, c.interior, building, plot!).ok) return undefined
    return { building, plot: plot! }
  }

  private remembers(player: PlayerId, cityIndex: number): boolean {
    return !this.fog || this.fog[player].memory.cities.some((m) => m.id === this.s.cities[cityIndex].id)
  }

  private applyUnitOrder(L: Live, order: UnitOrder | undefined): void {
    if (!order || typeof order !== 'object') return
    const u = L.u
    if (STANCES.includes(order.stance)) u.stance = order.stance
    if (Array.isArray(order.path)) u.path = this.sanitizePath(L, order.path)
    if (u.stance === 'hold') u.path = []
    u.found = u.type === 'settler' && order.found === true
    if (u.type === 'archer' && 'target' in order) {
      const t = order.target
      u.target = Number.isInteger(t) && (t as number) >= 0 && (t as number) < this.s.map.tiles.length ? (t as number) : null
    }
  }

  /** Keep the longest valid prefix: passable neighbours; an enemy city ends the path; settlers stop
   * before any tile held by an enemy. With fog, only what the player knows counts: a step into
   * unexplored land is kept even if the land turns out impassable (the unit halts there), and
   * enemies it cannot see do not cut the path. */
  private sanitizePath(L: Live, raw: unknown[]): TileId[] {
    const { map } = this.s
    const owner = L.u.owner
    const explored = this.fog?.[owner]?.explored
    const out: TileId[] = []
    let at = L.u.tile
    for (const step of raw) {
      if (out.length >= MAX_PATH || typeof step !== 'number' || !Number.isInteger(step)) break
      if (step < 0 || step >= map.tiles.length || !neighbors(map, at).includes(step)) break
      const unknown = !!explored && (!explored[at] || !explored[step])
      if (!unknown && moveCost(map, at, step, L.speed) === Infinity) break
      const c = this.cityAt[step]
      const enemyCity = c >= 0 && this.s.cities[c].owner !== owner && (this.knows(owner, step) || this.remembers(owner, c))
      const occ = this.unitAt[step]
      const enemyUnit = occ >= 0 && this.lives[occ].u.owner !== owner && this.knows(owner, step)
      if (L.civilian && (enemyCity || enemyUnit)) break
      out.push(step)
      if (enemyCity) break
      at = step
    }
    return out
  }

  // ---------------------------------------------------------------------------------------------
  // Ticks 1..6

  private tick(t: number): void {
    const { lives } = this
    for (const L of lives) if (!L.dead && !L.stopped && L.u.stance !== 'hold') L.points += L.speed
    // A path planned into unknown land can run into water or a cliff: the unit stops there.
    for (const L of lives) {
      if (L.dead || L.stopped || L.u.path.length === 0) continue
      if (moveCost(this.s.map, L.u.tile, L.u.path[0], L.speed) !== Infinity) continue
      L.u.path = []
      L.u.found = false
      L.stopped = true
      this.events.push({ t, kind: 'halt', unit: L.u.id, reason: 'blocked' })
    }

    // Who is next to which enemy at the start of the tick (for cautious contact).
    const contactBefore = new Map<number, Set<number>>()
    lives.forEach((L, i) => {
      if (this.watchesContact(L)) contactBefore.set(i, this.adjacentEnemies(L))
    })

    // 1. Commanders react: every unit picks this tick's step.
    const intents: (Intent | null)[] = lives.map((L) => this.decide(L))

    // 2-3. Meetings and movement.
    const status = new Int8Array(lives.length)
    const frozen = new Uint8Array(lives.length)
    intents.forEach((it, i) => (status[i] = it ? PENDING : STAY))
    const clashes: { a: number; b: number; tile: TileId | null }[] = []
    const melee: { att: number; def: number }[] = []
    const cityMelee: { att: number; city: number }[] = []
    const moves: { i: number; from: TileId; to: TileId }[] = []

    // Swaps: two enemies stepping into each other's tiles meet halfway.
    intents.forEach((it, i) => {
      if (!it || status[i] !== PENDING) return
      const j = this.unitAt[it.to]
      const jt = j >= 0 ? intents[j] : null
      if (jt && status[j] === PENDING && jt.to === lives[i].u.tile && lives[j].u.owner !== lives[i].u.owner) {
        clashes.push({ a: i, b: j, tile: null })
        status[i] = status[j] = STAY
      }
    })

    const claimants = new Map<TileId, number[]>()
    intents.forEach((it, i) => {
      if (!it || status[i] !== PENDING) return
      const list = claimants.get(it.to)
      if (list) list.push(i)
      else claimants.set(it.to, [i])
    })

    const resolveTile = (T: TileId, list: number[]): void => {
      const occ = this.unitAt[T]
      const occupied = occ >= 0 && status[occ] !== MOVED
      if (occupied) {
        for (const c of list) {
          if (lives[c].u.owner !== lives[occ].u.owner) melee.push({ att: c, def: occ })
          status[c] = STAY
        }
        return
      }
      let rest = list
      if (occ >= 0) {
        // The occupant left: lunges do not follow, everyone else may enter.
        for (const c of rest) if (intents[c]!.lunge) status[c] = STAY
        rest = rest.filter((c) => !intents[c]!.lunge)
      }
      const ci = this.cityAt[T]
      if (ci >= 0 && this.s.cities[ci].hp > 0) {
        const owner = this.s.cities[ci].owner
        for (const c of rest) {
          if (lives[c].u.owner !== owner) {
            cityMelee.push({ att: c, city: ci })
            status[c] = STAY
          }
        }
        rest = rest.filter((c) => lives[c].u.owner === owner)
      }
      // One claimant per owner: most points, then lowest id. Several owners: they meet in the tile.
      const winners = new Map<PlayerId, number>()
      for (const c of rest) {
        const w = winners.get(lives[c].u.owner)
        if (w === undefined || lives[c].points > lives[w].points) winners.set(lives[c].u.owner, c)
      }
      for (const c of rest) status[c] = STAY
      const ws = [...winners.values()].sort((a, b) => a - b)
      if (ws.length === 1) {
        status[ws[0]] = MOVED
        moves.push({ i: ws[0], from: lives[ws[0]].u.tile, to: T })
      } else {
        for (let x = 0; x < ws.length; x++) for (let y = x + 1; y < ws.length; y++) clashes.push({ a: ws[x], b: ws[y], tile: T })
      }
    }

    // Fixed point: a tile is decided once its occupant (if any) is decided to stay or leave.
    const resolved = new Set<TileId>()
    while (resolved.size < claimants.size) {
      let progress = false
      for (const [T, list] of claimants) {
        if (resolved.has(T)) continue
        const occ = this.unitAt[T]
        if (occ >= 0 && status[occ] === PENDING && !frozen[occ]) continue
        resolveTile(T, list)
        resolved.add(T)
        progress = true
      }
      if (!progress) for (const T of this.breakCycle(intents, status, frozen, claimants, moves)) resolved.add(T)
    }

    // 4. Combat, all from start-of-tick strengths, applied at once.
    const dmg = new Map<number, number>()
    const addDmg = (i: number, d: number) => dmg.set(i, (dmg.get(i) ?? 0) + d)
    const cityDmg = new Map<number, number>()
    const dealt = new Map<number, number>()
    for (const { a, b, tile } of clashes) {
      const A = lives[a]
      const B = lives[b]
      const dmgA = damage(clashStrength(B.u, A.u), clashStrength(A.u, B.u))
      const dmgB = damage(clashStrength(A.u, B.u), clashStrength(B.u, A.u))
      addDmg(a, dmgA)
      addDmg(b, dmgB)
      A.stopped = B.stopped = A.fought = B.fought = true
      this.events.push({ t, kind: 'clash', a: A.u.id, b: B.u.id, tile, dmgA, dmgB })
    }
    moves.sort((x, y) => x.i - y.i)
    for (const m of moves) {
      const L = lives[m.i]
      L.points -= moveCost(this.s.map, m.from, m.to, L.speed)
      L.u.path.shift()
      this.events.push({ t, kind: 'move', unit: L.u.id, from: m.from, to: m.to })
    }
    for (const m of moves) if (this.unitAt[m.from] === m.i) this.unitAt[m.from] = -1
    for (const m of moves) {
      lives[m.i].u.tile = m.to
      this.unitAt[m.to] = m.i
    }
    const engaged = new Set<number>()
    for (const { att, def } of melee) {
      const A = lives[att]
      const D = lives[def]
      const ci = this.cityAt[D.u.tile]
      const city = ci >= 0 && this.s.cities[ci].owner === D.u.owner ? this.s.cities[ci] : null
      const a = unitAttack(this.s.map, A.u, D.u, D.u.tile)
      const d = unitDefense(this.s.map, D.u, A.u, A.u.tile, { city })
      const toDef = damage(a, d)
      const toAtt = damage(d, a)
      addDmg(def, toDef)
      addDmg(att, toAtt)
      dealt.set(att, toDef)
      A.stopped = A.fought = D.fought = true
      engaged.add(def)
      this.events.push({ t, kind: 'melee', attacker: A.u.id, target: { unit: D.u.id }, dmgToTarget: toDef, dmgToAttacker: toAtt })
    }
    for (const { att, city: ci } of cityMelee) {
      const A = lives[att]
      const c = this.s.cities[ci]
      const a = unitAttack(this.s.map, A.u, null, c.tile)
      const d = cityDefense(this.s.map, c, A.u.tile)
      const toCity = damage(a, d)
      const toAtt = damage(d, a)
      cityDmg.set(ci, (cityDmg.get(ci) ?? 0) + toCity)
      addDmg(att, toAtt)
      dealt.set(att, toCity)
      A.stopped = A.fought = true
      this.events.push({ t, kind: 'melee', attacker: A.u.id, target: { city: c.id }, dmgToTarget: toCity, dmgToAttacker: toAtt })
    }
    for (const i of engaged) {
      const L = lives[i]
      if (!L.stopped && L.u.path.length > 0) this.events.push({ t, kind: 'halt', unit: L.u.id, reason: 'engaged' })
      L.stopped = true
    }
    for (const [ci, d] of cityDmg) {
      this.s.cities[ci].hp = Math.max(0, this.s.cities[ci].hp - d)
      this.cityDamaged.add(ci)
    }
    this.applyDamage(dmg, t)

    // Attackers advance into the tiles of defenders they destroyed.
    const byTarget = new Map<TileId, number[]>()
    for (const { att, def } of melee) this.pushTarget(byTarget, att, lives[def].u.tile)
    for (const { att, city } of cityMelee) this.pushTarget(byTarget, att, this.s.cities[city].tile)
    for (const [T, atts] of byTarget) this.advance(T, atts, dealt, t)

    for (const m of moves) this.maybeCapture(m.i, t)

    // 5. Overwatch.
    this.overwatch(t)

    // Cautious units that met a new enemy stop and drop their orders.
    for (const [i, before] of contactBefore) {
      const L = lives[i]
      if (L.dead || L.stopped || L.u.path.length === 0 || this.explicitAttack(L)) continue
      for (const e of this.adjacentEnemies(L)) {
        if (before.has(e)) continue
        L.u.path = []
        L.u.found = false
        L.stopped = true
        this.events.push({ t, kind: 'halt', unit: L.u.id, reason: 'contact' })
        break
      }
    }
  }

  private pushTarget(m: Map<TileId, number[]>, att: number, T: TileId): void {
    const list = m.get(T)
    if (list) list.push(att)
    else m.set(T, [att])
  }

  /** With no decidable tile left, pending moves wait on each other in cycles. A cycle of friends
   * rotates when no one else wants its tiles (returns those tiles, now decided); otherwise its
   * members are treated as staying put. */
  private breakCycle(
    intents: (Intent | null)[],
    status: Int8Array,
    frozen: Uint8Array,
    claimants: Map<TileId, number[]>,
    moves: { i: number; from: TileId; to: TileId }[],
  ): TileId[] {
    const { lives } = this
    // Walk the wait chain from the first undecided unit until it repeats.
    const seen = new Map<number, number>()
    const chain: number[] = []
    let i = status.findIndex((st, k) => st === PENDING && !frozen[k])
    while (!seen.has(i)) {
      seen.set(i, chain.length)
      chain.push(i)
      i = this.unitAt[intents[i]!.to]
    }
    const cycle = chain.slice(seen.get(i)!)
    const owner = lives[cycle[0]].u.owner
    const rotate =
      cycle.every((c) => lives[c].u.owner === owner) && cycle.every((c) => claimants.get(intents[c]!.to)!.length === 1)
    if (!rotate) {
      for (const c of cycle) frozen[c] = 1
      return []
    }
    for (const c of cycle) {
      status[c] = MOVED
      moves.push({ i: c, from: lives[c].u.tile, to: intents[c]!.to })
    }
    return cycle.map((c) => intents[c]!.to)
  }

  private advance(T: TileId, atts: number[], dealt: Map<number, number>, t: number): void {
    if (this.unitAt[T] >= 0) return
    const ci = this.cityAt[T]
    if (ci >= 0 && this.s.cities[ci].hp > 0) return
    const alive = atts.filter((a) => !this.lives[a].dead)
    if (alive.length === 0 || alive.some((a) => this.lives[a].u.owner !== this.lives[alive[0]].u.owner)) return
    let best = alive[0]
    for (const a of alive) if ((dealt.get(a) ?? 0) > (dealt.get(best) ?? 0)) best = a
    const L = this.lives[best]
    const from = L.u.tile
    if (L.u.path[0] === T) L.u.path.shift()
    else L.u.path = []
    this.unitAt[from] = -1
    this.unitAt[T] = best
    L.u.tile = T
    this.events.push({ t, kind: 'move', unit: L.u.id, from, to: T })
    this.maybeCapture(best, t)
  }

  private maybeCapture(i: number, t: number): void {
    const L = this.lives[i]
    if (L.dead) return
    const ci = this.cityAt[L.u.tile]
    if (ci < 0) return
    const c = this.s.cities[ci]
    if (c.owner === L.u.owner) return
    const from = c.owner
    c.owner = L.u.owner
    c.hp = CAPTURED_CITY_HP
    c.build = null
    c.prod = 0
    c.food = 0
    c.capital = false
    this.events.push({ t, kind: 'capture', city: c.id, from, to: c.owner, unit: L.u.id })
    if (c.pop > 1) {
      c.pop--
      this.events.push({ t, kind: 'grow', city: c.id, pop: c.pop })
    }
  }

  private overwatch(t: number): void {
    const shots: { from: Target; i?: number; target: Target; dmg: number }[] = []
    this.lives.forEach((L) => {
      if (L.dead || L.fired || L.fought || L.u.stance !== 'hold' || !UNITS[L.u.type].ranged) return
      const reach = (tile: TileId) => inRange(this.s.map, L.u.tile, tile, unitRange(L.u)) && this.sees(L.u.tile, tile)
      const target = this.pickUnitTarget(L.u.tile, L.u.owner, reach, L.u.target, (e) => unitRangedStrength(this.s.map, L.u, e.tile))
      if (target < 0) return
      L.fired = true
      const E = this.lives[target]
      const dmg = damage(unitRangedStrength(this.s.map, L.u, E.u.tile), this.shotDefense(E.u, L.u.tile))
      shots.push({ from: { unit: L.u.id }, i: target, target: { unit: E.u.id }, dmg })
    })
    this.fireAll(shots, t)
  }

  /** Index of the enemy unit to shoot from `from`: the preferred tile if it holds a valid target,
   * else the weakest (fewest hp, then most damage taken, then lowest id). -1 if none. */
  private pickUnitTarget(from: TileId, owner: PlayerId, reach: (t: TileId) => boolean, prefer: TileId | null, strength: (e: Unit) => number): number {
    if (prefer !== null) {
      const p = this.unitAt[prefer]
      if (p >= 0 && this.shootable(p, owner) && reach(prefer)) return p
    }
    let best = -1
    let bestDmg = 0
    this.lives.forEach((E, i) => {
      if (!this.shootable(i, owner) || !reach(E.u.tile)) return
      const d = damage(strength(E.u), this.shotDefense(E.u, from))
      const B = best >= 0 ? this.lives[best] : null
      if (!B || E.u.hp < B.u.hp || (E.u.hp === B.u.hp && d > bestDmg)) {
        best = i
        bestDmg = d
      }
    })
    return best
  }

  /** Enemy units can be shot, except inside their own city while it still has hp (arrows hit the city). */
  private shootable(i: number, owner: PlayerId): boolean {
    const E = this.lives[i]
    if (E.dead || E.u.owner === owner) return false
    const ci = this.cityAt[E.u.tile]
    return !(ci >= 0 && this.s.cities[ci].owner === E.u.owner && this.s.cities[ci].hp > 0)
  }

  private shotDefense(e: Unit, from: TileId): number {
    return unitDefense(this.s.map, e, null, from, { city: null })
  }

  private fireAll(shots: { from: Target; i?: number; target: Target; dmg: number }[], t: number): void {
    const dmg = new Map<number, number>()
    for (const s of shots) {
      this.events.push({ t, kind: 'shot', from: s.from, target: s.target, dmg: s.dmg })
      if (s.i !== undefined) dmg.set(s.i, (dmg.get(s.i) ?? 0) + s.dmg)
      else if ('city' in s.target) {
        const id = s.target.city
        const ci = this.s.cities.findIndex((c) => c.id === id)
        this.s.cities[ci].hp = Math.max(0, this.s.cities[ci].hp - s.dmg)
        this.cityDamaged.add(ci)
      }
    }
    this.applyDamage(dmg, t)
  }

  private applyDamage(dmg: Map<number, number>, t: number): void {
    const hit = [...dmg.keys()].sort((a, b) => a - b)
    for (const i of hit) {
      const L = this.lives[i]
      L.u.hp -= dmg.get(i)!
      L.damaged = true
    }
    for (const i of hit) {
      const L = this.lives[i]
      if (L.u.hp > 0 || L.dead) continue
      L.dead = true
      L.u.hp = 0
      if (this.unitAt[L.u.tile] === i) this.unitAt[L.u.tile] = -1
      this.events.push({ t, kind: 'death', unit: L.u.id, tile: L.u.tile })
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Decisions

  private enemyUnitAt(L: Live, tile: TileId): number {
    const j = this.unitAt[tile]
    return j >= 0 && this.lives[j].u.owner !== L.u.owner ? j : -1
  }

  private hostile(L: Live, tile: TileId): boolean {
    if (this.enemyUnitAt(L, tile) >= 0) return true
    const ci = this.cityAt[tile]
    return ci >= 0 && this.s.cities[ci].owner !== L.u.owner
  }

  private ready(L: Live, tile: TileId): boolean {
    return L.points >= moveCost(this.s.map, L.u.tile, tile, L.speed)
  }

  /** Cautious units (and all moving civilians) stop at new contact. */
  private watchesContact(L: Live): boolean {
    return !L.dead && !L.stopped && L.u.path.length > 0 && (L.u.stance === 'cautious' || L.civilian)
  }

  private explicitAttack(L: Live): boolean {
    return L.u.path.length === 1 && this.hostile(L, L.u.path[0])
  }

  private adjacentEnemies(L: Live): Set<number> {
    const out = new Set<number>()
    for (const nb of neighbors(this.s.map, L.u.tile)) {
      const j = this.enemyUnitAt(L, nb)
      if (j >= 0) out.add(this.lives[j].u.id)
    }
    return out
  }

  private decide(L: Live): Intent | null {
    if (L.dead || L.stopped || L.u.stance === 'hold') return null
    const u = L.u
    const next = u.path.length > 0 ? u.path[0] : -1
    if (u.stance === 'aggressive' && !L.civilian) {
      if (next >= 0 && this.hostile(L, next)) return this.ready(L, next) ? { to: next, lunge: false } : null
      const target = this.weakestNeighbour(L)
      if (target >= 0) return this.ready(L, target) ? { to: target, lunge: true } : null
    }
    if (next < 0) return null
    if (this.hostile(L, next) && (L.civilian || (u.stance === 'cautious' && u.path.length !== 1))) return null
    return this.ready(L, next) ? { to: next, lunge: false } : null
  }

  /** Tile of the weakest adjacent enemy unit this unit can step to: fewest hp, then most damage
   * dealt, then lowest id. -1 if none. */
  private weakestNeighbour(L: Live): TileId {
    const { map } = this.s
    let best = -1
    let bestHp = Infinity
    let bestDmg = -1
    let bestId = Infinity
    for (const nb of neighbors(map, L.u.tile)) {
      const j = this.enemyUnitAt(L, nb)
      if (j < 0 || !canStep(map, L.u.tile, nb)) continue
      const E = this.lives[j].u
      const ci = this.cityAt[nb]
      const city = ci >= 0 && this.s.cities[ci].owner === E.owner ? this.s.cities[ci] : null
      const d = damage(unitAttack(map, L.u, E, nb), unitDefense(map, E, L.u, L.u.tile, { city }))
      if (E.hp < bestHp || (E.hp === bestHp && (d > bestDmg || (d === bestDmg && E.id < bestId)))) {
        best = nb
        bestHp = E.hp
        bestDmg = d
        bestId = E.id
      }
    }
    return best
  }

  private reportBlocked(t: number): void {
    for (const L of this.lives) {
      if (L.dead || L.stopped || L.u.path.length === 0) continue
      if (this.ready(L, L.u.path[0])) this.events.push({ t, kind: 'halt', unit: L.u.id, reason: 'blocked' })
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Tick 7: volleys

  private volleys(t: number): void {
    const { map } = this.s
    const shots: { from: Target; i?: number; target: Target; dmg: number }[] = []
    this.lives.forEach((L) => {
      if (L.dead || L.fired || L.fought || !UNITS[L.u.type].ranged) return
      const u = L.u
      const range = unitRange(u)
      const str = (tile: TileId) => unitRangedStrength(map, u, tile)
      // Ordered target first: a unit there, or the city there.
      if (u.target !== null && inRange(map, u.tile, u.target, range) && this.sees(u.tile, u.target)) {
        const j = this.unitAt[u.target]
        if (j >= 0 && this.shootable(j, u.owner)) {
          const E = this.lives[j].u
          shots.push({ from: { unit: u.id }, i: j, target: { unit: E.id }, dmg: damage(str(E.tile), this.shotDefense(E, u.tile)) })
          return
        }
        const ci = this.cityAt[u.target]
        if (ci >= 0 && this.s.cities[ci].owner !== u.owner && this.s.cities[ci].hp > 0) {
          const c = this.s.cities[ci]
          shots.push({ from: { unit: u.id }, target: { city: c.id }, dmg: damage(str(c.tile), cityDefense(map, c, u.tile)) })
          return
        }
      }
      const j = this.pickUnitTarget(u.tile, u.owner, (tile) => inRange(map, u.tile, tile, range) && this.sees(u.tile, tile), null, (e) => str(e.tile))
      if (j >= 0) {
        const E = this.lives[j].u
        shots.push({ from: { unit: u.id }, i: j, target: { unit: E.id }, dmg: damage(str(E.tile), this.shotDefense(E, u.tile)) })
        return
      }
      let city: City | null = null
      for (const c of this.s.cities) {
        if (c.owner === u.owner || c.hp <= 0 || !inRange(map, u.tile, c.tile, range) || !this.sees(u.tile, c.tile)) continue
        if (!city || c.hp < city.hp) city = c
      }
      if (city) shots.push({ from: { unit: u.id }, target: { city: city.id }, dmg: damage(str(city.tile), cityDefense(map, city, u.tile)) })
    })
    for (const c of this.s.cities) {
      if (c.hp <= 0) continue
      const j = this.pickUnitTarget(c.tile, c.owner, (tile) => cityCanShoot(map, c, tile) && this.sees(c.tile, tile), null, (e) => cityRangedStrength(map, c, e.tile))
      if (j < 0) continue
      const E = this.lives[j].u
      shots.push({ from: { city: c.id }, i: j, target: { unit: E.id }, dmg: damage(cityRangedStrength(map, c, E.tile), this.shotDefense(E, c.tile)) })
    }
    this.fireAll(shots, t)
  }

  // ---------------------------------------------------------------------------------------------
  // Tick 8: founding, economy, healing, elimination, victory

  private endOfTurn(t: number): void {
    const s = this.s
    this.found(t)
    const spawned = this.economy(t)

    for (const L of this.lives) {
      if (L.dead || L.damaged || L.u.hp >= UNIT_MAX_HP) continue
      const ci = this.cityAt[L.u.tile]
      const inOwnCity = ci >= 0 && s.cities[ci].owner === L.u.owner
      L.u.hp = Math.min(UNIT_MAX_HP, L.u.hp + (inOwnCity ? HEAL_CITY : HEAL_FIELD))
      this.events.push({ t, kind: 'heal', unit: L.u.id, hp: L.u.hp })
    }
    // A city under siege (it or its garrison took damage this turn) does not regenerate.
    for (const L of this.lives) {
      const ci = this.cityAt[L.u.tile]
      if (L.damaged && ci >= 0 && s.cities[ci].owner === L.u.owner) this.cityDamaged.add(ci)
    }
    s.cities.forEach((c, ci) => {
      if (this.cityDamaged.has(ci) || c.hp >= CITY_MAX_HP) return
      c.hp = Math.min(CITY_MAX_HP, c.hp + CITY_REGEN)
      this.events.push({ t, kind: 'cityRepair', city: c.id, hp: c.hp })
    })

    s.units = [...this.lives.filter((L) => !L.dead).map((L) => L.u), ...spawned]

    for (const p of s.players) {
      if (!p.alive || s.cities.some((c) => c.owner === p.id)) continue
      p.alive = false
      for (const u of s.units) if (u.owner === p.id) this.events.push({ t, kind: 'death', unit: u.id, tile: u.tile })
      s.units = s.units.filter((u) => u.owner !== p.id)
      this.events.push({ t, kind: 'eliminated', player: p.id })
    }

    const alive = s.players.filter((p) => p.alive)
    if (alive.length <= 1) s.winner = alive.length === 1 ? alive[0].id : 'draw'
    else if (s.turn >= s.maxTurns) {
      const sc = scores(s)
      const best = Math.max(...alive.map((p) => sc[p.id]))
      const top = alive.filter((p) => sc[p.id] === best)
      s.winner = top.length === 1 ? top[0].id : 'draw'
    }
    if (s.winner !== null) this.events.push({ t, kind: 'victory', winner: s.winner })
  }

  private found(t: number): void {
    const s = this.s
    const cands = this.lives.filter((L) => !L.dead && L.u.type === 'settler' && L.u.found && L.u.path.length === 0)
    const fail = new Map<Live, string>()
    for (const L of cands) {
      if (s.cities.some((c) => distance(s.map, c.tile, L.u.tile) < MIN_CITY_DISTANCE)) fail.set(L, 'tooClose')
      else if (cands.some((o) => o !== L && distance(s.map, o.u.tile, L.u.tile) < MIN_CITY_DISTANCE)) fail.set(L, 'conflict')
    }
    for (const L of cands) {
      const reason = fail.get(L)
      if (reason) {
        L.u.found = false
        this.events.push({ t, kind: 'foundFailed', unit: L.u.id, reason })
        continue
      }
      const city = newCity(s, L.u.owner, L.u.tile)
      s.cities.push(city)
      this.cityAt[city.tile] = s.cities.length - 1
      L.dead = true
      this.unitAt[L.u.tile] = -1
      this.events.push({ t, kind: 'found', city: { ...city }, unit: L.u.id })
    }
  }

  private economy(t: number): Unit[] {
    const s = this.s
    const spawned: Unit[] = []
    for (const c of [...s.cities].sort((a, b) => a.id - b.id)) {
      const out = outputOf(s.map, c)
      c.prod += out.prod
      const item = c.build
      if (item && c.prod >= buildCost(c, item)) {
        if (typeof item !== 'string') this.completeBuilding(c, item, t)
        else if (item !== 'settler' || c.pop >= 2) {
          const tile = this.spawnTile(c)
          if (tile >= 0) {
            c.prod -= buildCost(c, item)
            const u = newUnit(s, c.owner, item, tile)
            spawned.push(u)
            this.unitAt[tile] = -2 // occupied by a new unit (not in `lives`)
            this.events.push({ t, kind: 'built', city: c.id, item })
            this.events.push({ t, kind: 'spawn', unit: { ...u, path: [] }, city: c.id })
            if (item === 'settler') {
              c.pop--
              this.events.push({ t, kind: 'grow', city: c.id, pop: c.pop })
            }
          }
        }
      }
      // Growth, up to the housing; a full city keeps at most one citizen's worth of food.
      c.food = Math.max(0, c.food + foodSurplus(c, out))
      const need = growthNeed(c, out)
      if (c.food >= need) {
        if (c.pop < housingOf(c.interior)) {
          c.food -= need
          c.pop++
          this.events.push({ t, kind: 'grow', city: c.id, pop: c.pop })
        } else c.food = need
      }
    }
    return spawned
  }

  /** Place a finished building, or report why its plot no longer takes it (the production stays). */
  private completeBuilding(c: City, order: BuildingOrder, t: number): void {
    const check = canPlace(this.s.map, c.tile, c.interior, order.building, order.plot)
    c.build = null
    if (!check.ok) {
      this.events.push({ t, kind: 'buildFailed', city: c.id, item: { ...order }, reason: check.reason ?? 'This plot cannot take it.' })
      return
    }
    c.prod -= BUILDINGS[order.building].cost
    c.interior.plots[order.plot] = order.building
    c.walls = hasBuilding(c.interior, 'wall')
    this.events.push({ t, kind: 'built', city: c.id, item: { ...order } })
  }

  /** The city tile if free, else the free passable neighbour nearest the middle of the map (ties:
   * the counter-clockwise one, seen from the city toward the middle). Both rules survive a 180°
   * rotation, so point-symmetric maps stay fair. -1 if none. */
  private spawnTile(c: City): TileId {
    const { map } = this.s
    if (this.unitAt[c.tile] === -1) return c.tile
    const mid = hexCenter((map.width - 0.5) / 2, (map.height - 1) / 2)
    const at = hexCenter(map.tiles[c.tile].col, map.tiles[c.tile].row)
    let best = -1
    let bestD = Infinity
    let bestCross = -Infinity
    for (const nb of neighbors(map, c.tile)) {
      if (this.unitAt[nb] !== -1 || this.cityAt[nb] >= 0 || !canStep(map, c.tile, nb)) continue
      const p = hexCenter(map.tiles[nb].col, map.tiles[nb].row)
      const d = (p.x - mid.x) ** 2 + (p.z - mid.z) ** 2
      const cross = (mid.x - at.x) * (p.z - at.z) - (mid.z - at.z) * (p.x - at.x)
      if (d < bestD - 1e-9 || (d <= bestD + 1e-9 && cross > bestCross)) {
        best = nb
        bestD = d
        bestCross = cross
      }
    }
    return best
  }
}
