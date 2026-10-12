import { describe, expect, it } from 'vitest'
import { resolveTurn } from '../src/engine/rules.ts'
import type { GameState, PlayerOrders } from '../src/engine/types.ts'
import { at, city, find, makeMap, makeState, ofKind, order, orders, unit } from './helpers.ts'

// Geometry used below: on an even row r, tile (c, r) neighbours (c±1, r), (c-1, r±1) and (c, r±1).
const map = makeMap(12, 6, (t) => {
  if (t.col === 10 && t.row === 0) {
    t.biome = 'mountain'
    t.height = 7
  }
})
const T = (c: number, r: number) => at(map, c, r)

function run(state: GameState, o: Record<number, PlayerOrders>) {
  return resolveTurn(state, o)
}

describe('movement', () => {
  it('spends speed points per tick: spears step at ticks 3 and 6, riders at 2, 4, 6', () => {
    const s = unit(0, 'spear', T(1, 2))
    const r = unit(0, 'rider', T(1, 3))
    const st = makeState(map, [s, r])
    const { state, events } = run(st, {
      0: orders({ [s.id]: order([T(2, 2), T(3, 2), T(4, 2)]), [r.id]: order([T(2, 3), T(3, 3), T(4, 3), T(5, 3)]) }),
    })
    const moves = ofKind(events, 'move')
    expect(moves.filter((m) => m.unit === s.id).map((m) => m.t)).toEqual([3, 6])
    expect(moves.filter((m) => m.unit === r.id).map((m) => m.t)).toEqual([2, 4, 6])
    // Unfinished paths persist; consumed steps are removed.
    expect(find(state, s.id)!.path).toEqual([T(4, 2)])
    expect(find(state, r.id)!.path).toEqual([T(5, 3)])
    const next = run(state, {}).state
    expect(find(next, s.id)!.tile).toBe(T(4, 2))
    expect(find(next, r.id)!.tile).toBe(T(5, 3))
  })

  it('moves a friendly column in one tick (tiles vacated the same tick)', () => {
    const a = unit(0, 'spear', T(2, 2))
    const b = unit(0, 'spear', T(3, 2))
    const c = unit(0, 'spear', T(4, 2))
    const { state, events } = run(makeState(map, [a, b, c]), {
      0: orders({
        [a.id]: order([T(3, 2), T(4, 2)]),
        [b.id]: order([T(4, 2), T(5, 2)]),
        [c.id]: order([T(5, 2), T(6, 2)]),
      }),
    })
    expect([a, b, c].map((u) => find(state, u.id)!.tile)).toEqual([T(4, 2), T(5, 2), T(6, 2)])
    expect(ofKind(events, 'move').every((m) => m.t === 3 || m.t === 6)).toBe(true)
    expect(ofKind(events, 'halt')).toEqual([])
  })

  it('lets friends swap places', () => {
    const a = unit(0, 'spear', T(2, 2))
    const b = unit(0, 'archer', T(3, 2))
    const { state } = run(makeState(map, [a, b]), { 0: orders({ [a.id]: order([T(3, 2)]), [b.id]: order([T(2, 2)]) }) })
    expect(find(state, a.id)!.tile).toBe(T(3, 2))
    expect(find(state, b.id)!.tile).toBe(T(2, 2))
  })

  it('resolves friendly contention for a tile deterministically; the loser waits and reports blocked', () => {
    const a = unit(0, 'spear', T(3, 2))
    const b = unit(0, 'spear', T(5, 2))
    const { state, events } = run(makeState(map, [a, b]), { 0: orders({ [a.id]: order([T(4, 2)]), [b.id]: order([T(4, 2)]) }) })
    expect(find(state, a.id)!.tile).toBe(T(4, 2)) // lower id wins a tie
    expect(find(state, b.id)!.tile).toBe(T(5, 2))
    expect(find(state, b.id)!.path).toEqual([T(4, 2)])
    expect(ofKind(events, 'halt')).toEqual([{ t: 6, kind: 'halt', unit: b.id, reason: 'blocked' }])
  })

  it('a faster unit gets there first', () => {
    const s = unit(0, 'spear', T(3, 2))
    const r = unit(1, 'rider', T(5, 2))
    const { events } = run(makeState(map, [s, r]), { 0: orders({ [s.id]: order([T(4, 2)]) }), 1: orders({ [r.id]: order([T(4, 2)]) }) })
    // Rider steps in at tick 2; at tick 3 the spear's step becomes an attack on it (spears x2 vs riders).
    expect(ofKind(events, 'move')).toEqual([{ t: 2, kind: 'move', unit: r.id, from: T(5, 2), to: T(4, 2) }])
    const [m] = ofKind(events, 'melee')
    expect(m).toMatchObject({ t: 3, attacker: s.id, target: { unit: r.id }, dmgToTarget: 8, dmgToAttacker: 1 })
  })
})

describe('meetings', () => {
  it('swap: two enemies stepping into each other meet halfway and stop', () => {
    const a = unit(0, 'spear', T(4, 2))
    const b = unit(1, 'spear', T(5, 2))
    const { state, events } = run(makeState(map, [a, b]), {
      0: orders({ [a.id]: order([T(5, 2), T(6, 2)], 'aggressive') }),
      1: orders({ [b.id]: order([T(4, 2), T(3, 2)], 'aggressive') }),
    })
    expect(ofKind(events, 'clash')).toEqual([{ t: 3, kind: 'clash', a: a.id, b: b.id, tile: null, dmgA: 3, dmgB: 3 }])
    expect(ofKind(events, 'move')).toEqual([])
    expect(ofKind(events, 'melee')).toEqual([]) // stopped for the rest of the turn
    expect(find(state, a.id)).toMatchObject({ tile: T(4, 2), hp: 7, path: [T(5, 2), T(6, 2)] })
    expect(find(state, b.id)).toMatchObject({ tile: T(5, 2), hp: 7 })
  })

  it('same target, same tick: clash in the tile', () => {
    const a = unit(0, 'spear', T(3, 2))
    const b = unit(1, 'spear', T(5, 2), { hp: 6 })
    const { state, events } = run(makeState(map, [a, b]), {
      0: orders({ [a.id]: order([T(4, 2), T(4, 1)]) }),
      1: orders({ [b.id]: order([T(4, 2), T(3, 1)]) }),
    })
    const [c] = ofKind(events, 'clash')
    // Wounded b fights at 4 * (0.5 + 0.5 * 0.6) = 3.2: a takes round(3 * 3.2 / 4) = 2, b takes round(3 * 4 / 3.2) = 4.
    expect(c).toEqual({ t: 3, kind: 'clash', a: a.id, b: b.id, tile: T(4, 2), dmgA: 2, dmgB: 4 })
    expect(ofKind(events, 'move')).toEqual([])
    expect(find(state, a.id)!.tile).toBe(T(3, 2))
    expect(find(state, b.id)!.tile).toBe(T(5, 2))
  })

  it('a unit entering a tile its enemy leaves follows into it instead of fighting', () => {
    const s = unit(0, 'spear', T(3, 2))
    const e = unit(1, 'archer', T(4, 2))
    const { state, events } = run(makeState(map, [s, e]), {
      0: orders({ [s.id]: order([T(4, 2)]) }), // explicit attack on the archer
      1: orders({ [e.id]: order([T(5, 2), T(6, 2)]) }),
    })
    expect(ofKind(events, 'melee')).toEqual([])
    expect(ofKind(events, 'move').filter((m) => m.t === 3)).toEqual([
      { t: 3, kind: 'move', unit: s.id, from: T(3, 2), to: T(4, 2) },
      { t: 3, kind: 'move', unit: e.id, from: T(4, 2), to: T(5, 2) },
    ])
    expect(find(state, s.id)!.tile).toBe(T(4, 2))
    expect(find(state, e.id)!.tile).toBe(T(6, 2))
  })

  it('an enemy entering a tile a friend leaves, while another friend follows, clashes with the follower', () => {
    const lead = unit(0, 'spear', T(4, 2))
    const follower = unit(0, 'spear', T(3, 2))
    const enemy = unit(1, 'spear', T(4, 3))
    const { events } = run(makeState(map, [lead, follower, enemy]), {
      0: orders({ [lead.id]: order([T(5, 2)]), [follower.id]: order([T(4, 2)]) }),
      1: orders({ [enemy.id]: order([T(4, 2)]) }),
    })
    expect(ofKind(events, 'move')).toEqual([{ t: 3, kind: 'move', unit: lead.id, from: T(4, 2), to: T(5, 2) }])
    expect(ofKind(events, 'clash')).toEqual([{ t: 3, kind: 'clash', a: follower.id, b: enemy.id, tile: T(4, 2), dmgA: 3, dmgB: 3 }])
  })
})

describe('stances', () => {
  it('cautious: stops at new contact and drops its path', () => {
    const s = unit(0, 'spear', T(1, 2))
    const e = unit(1, 'spear', T(2, 1), { stance: 'hold' })
    const { state, events } = run(makeState(map, [s, e]), { 0: orders({ [s.id]: order([T(2, 2), T(3, 2), T(4, 2)]) }) })
    expect(ofKind(events, 'halt')).toEqual([{ t: 3, kind: 'halt', unit: s.id, reason: 'contact' }])
    expect(find(state, s.id)).toMatchObject({ tile: T(2, 2), path: [] })
    expect(ofKind(events, 'melee')).toEqual([])
  })

  it('cautious: an explicit attack (enemy at the end of the path) goes through', () => {
    const s = unit(0, 'spear', T(1, 2))
    const e = unit(1, 'spear', T(3, 2), { stance: 'cautious' })
    const { events } = run(makeState(map, [s, e]), { 0: orders({ [s.id]: order([T(2, 2), T(3, 2)]) }) })
    expect(ofKind(events, 'halt')).toEqual([])
    expect(ofKind(events, 'melee')).toMatchObject([{ t: 6, attacker: s.id, target: { unit: e.id }, dmgToTarget: 3, dmgToAttacker: 3 }])
  })

  it('cautious: ignores enemies that were already adjacent (can retreat)', () => {
    const s = unit(0, 'archer', T(3, 2))
    const e = unit(1, 'spear', T(4, 2), { stance: 'hold' })
    const { state, events } = run(makeState(map, [s, e]), { 0: orders({ [s.id]: order([T(3, 1)]) }) })
    expect(ofKind(events, 'halt')).toEqual([])
    expect(find(state, s.id)!.tile).toBe(T(3, 1))
  })

  it('aggressive: attacks the weakest adjacent enemy when ready instead of walking on', () => {
    const r = unit(0, 'rider', T(3, 2), { stance: 'aggressive', path: [T(4, 2), T(5, 2)] })
    const spear = unit(1, 'spear', T(3, 1))
    const archer = unit(1, 'archer', T(3, 3), { hp: 6 })
    const { state, events } = run(makeState(map, [r, spear, archer]), {})
    const [m] = ofKind(events, 'melee')
    expect(m).toMatchObject({ t: 2, attacker: r.id, target: { unit: archer.id } })
    // Rider 5 vs archer 2 * 0.8 = 1.6: 9 damage kills it; the rider advances and its old path is dropped.
    expect(ofKind(events, 'death')).toEqual([{ t: 2, kind: 'death', unit: archer.id, tile: T(3, 3) }])
    expect(find(state, r.id)).toMatchObject({ tile: T(3, 3), path: [] })
  })

  it('aggressive: does not chase an adjacent enemy that steps away', () => {
    const a = unit(0, 'spear', T(3, 2), { stance: 'aggressive' })
    const e = unit(1, 'spear', T(4, 2))
    const { state, events } = run(makeState(map, [a, e]), { 1: orders({ [e.id]: order([T(5, 2), T(6, 2)]) }) })
    expect(ofKind(events, 'melee')).toEqual([])
    expect(find(state, a.id)!.tile).toBe(T(3, 2))
  })

  it('hold: never moves and defends at +50 %', () => {
    const h = unit(0, 'spear', T(4, 2))
    const r = unit(1, 'spear', T(5, 2))
    const { state, events } = run(makeState(map, [h, r]), {
      0: orders({ [h.id]: order([T(3, 2)], 'hold') }),
      1: orders({ [r.id]: order([T(4, 2)]) }),
    })
    expect(find(state, h.id)).toMatchObject({ tile: T(4, 2), path: [] })
    // 4 vs 4 * 1.5 = 6: attacker takes round(4.5) = 5, defender round(2) = 2.
    expect(ofKind(events, 'melee')).toMatchObject([{ t: 3, attacker: r.id, dmgToTarget: 2, dmgToAttacker: 5 }])
  })

  it('a unit attacked in melee is engaged and stops', () => {
    const r = unit(0, 'rider', T(3, 2))
    const a = unit(1, 'archer', T(4, 2))
    const { state, events } = run(makeState(map, [r, a]), {
      0: orders({ [r.id]: order([T(4, 2)]) }),
      1: orders({ [a.id]: order([T(5, 2), T(6, 2)]) }),
    })
    // The rider is ready at tick 2, before the archer (tick 3) can leave.
    expect(ofKind(events, 'melee')).toMatchObject([{ t: 2, attacker: r.id, target: { unit: a.id } }])
    expect(ofKind(events, 'halt')).toEqual([{ t: 2, kind: 'halt', unit: a.id, reason: 'engaged' }])
    expect(find(state, a.id)!.tile).toBe(T(4, 2))
    // In melee this turn: no volley.
    expect(ofKind(events, 'shot').filter((s) => 'unit' in s.from && s.from.unit === a.id)).toEqual([])
  })
})

describe('shooting', () => {
  it('overwatch: a hold archer shoots the first enemy entering range, during the ticks', () => {
    const h = unit(0, 'archer', T(2, 2), { stance: 'hold' })
    const r = unit(1, 'rider', T(6, 2))
    const { events } = run(makeState(map, [h, r]), { 1: orders({ [r.id]: order([T(5, 2), T(4, 2), T(3, 2)]) }) })
    // Rider is at distance 3 after tick 2 and 2 after tick 4.
    expect(ofKind(events, 'shot')).toEqual([{ t: 4, kind: 'shot', from: { unit: h.id }, target: { unit: r.id }, dmg: 4 }])
  })

  it('volley at tick 7: the ordered target if in range, else the weakest enemy in range', () => {
    const a = unit(0, 'archer', T(2, 2), { target: T(4, 2) })
    const b = unit(0, 'archer', T(2, 3), { target: T(9, 2) })
    const spear = unit(1, 'spear', T(4, 2), { stance: 'hold' })
    const weak = unit(1, 'spear', T(3, 3), { hp: 5, stance: 'hold' })
    const { events } = run(makeState(map, [a, b, spear, weak]), {})
    const shots = ofKind(events, 'shot')
    expect(shots).toContainEqual({ t: 7, kind: 'shot', from: { unit: a.id }, target: { unit: spear.id }, dmg: 2 })
    expect(shots).toContainEqual(expect.objectContaining({ t: 7, from: { unit: b.id }, target: { unit: weak.id } }))
  })

  it('volleys are simultaneous: two archers that kill each other both shoot', () => {
    const a = unit(0, 'archer', T(2, 2), { hp: 3, stance: 'hold' })
    const b = unit(1, 'archer', T(4, 2), { hp: 3, stance: 'cautious' })
    const { state, events } = run(makeState(map, [a, b]), { 0: orders({ [a.id]: order([], 'cautious') }) })
    expect(ofKind(events, 'shot')).toHaveLength(2)
    expect(ofKind(events, 'death').map((d) => d.unit).sort()).toEqual([a.id, b.id].sort())
    expect(state.units).toEqual([])
  })

  it('cities shoot the weakest enemy within 2', () => {
    const c = city(0, T(2, 2))
    const e = unit(1, 'spear', T(4, 2), { stance: 'hold' })
    const st = makeState(map, [e], [c, city(1, T(11, 5))])
    const { events } = run(st, {})
    // City 2 vs spear on hold 4 * 1.5 = 6: round(1) = 1.
    expect(ofKind(events, 'shot')).toEqual([{ t: 7, kind: 'shot', from: { city: c.id }, target: { unit: e.id }, dmg: 1 }])
  })

  it('high ground: +1 range from two levels up', () => {
    const hill = makeMap(12, 6, (t) => {
      if (t.col === 2 && t.row === 2) t.height = 4
    })
    const a = unit(0, 'archer', at(hill, 2, 2))
    const e = unit(1, 'spear', at(hill, 5, 2), { stance: 'hold' })
    const { events } = resolveTurn(makeState(hill, [a, e]), {})
    expect(ofKind(events, 'shot')).toMatchObject([{ t: 7, from: { unit: a.id }, target: { unit: e.id } }])
  })
})

describe('cities', () => {
  it('an empty city at 0 hp is captured by the first unit that walks in', () => {
    const victim = city(1, T(5, 2), { hp: 0, pop: 3 })
    const s = unit(0, 'spear', T(4, 2))
    const st = makeState(map, [s], [city(0, T(0, 5)), victim])
    const { state, events } = run(st, { 0: orders({ [s.id]: order([T(5, 2)]) }) })
    expect(ofKind(events, 'capture')).toEqual([{ t: 3, kind: 'capture', city: victim.id, from: 1, to: 0, unit: s.id }])
    const c = state.cities.find((x) => x.id === victim.id)!
    expect(c).toMatchObject({ owner: 0, pop: 2 })
    // Player 1 lost its last city: eliminated, and player 0 wins.
    expect(ofKind(events, 'eliminated')).toEqual([{ t: 8, kind: 'eliminated', player: 1 }])
    expect(state.winner).toBe(0)
    expect(ofKind(events, 'victory')).toEqual([{ t: 8, kind: 'victory', winner: 0 }])
  })

  it('a melee attack that brings an empty city to 0 captures it', () => {
    const victim = city(1, T(5, 2), { hp: 2 })
    const r = unit(0, 'rider', T(4, 2))
    const st = makeState(map, [r], [city(0, T(0, 5)), victim, city(1, T(11, 5))])
    const { state, events } = run(st, { 0: orders({ [r.id]: order([T(5, 2)]) }) })
    expect(ofKind(events, 'melee')).toMatchObject([{ t: 2, attacker: r.id, target: { city: victim.id } }])
    expect(ofKind(events, 'capture')).toMatchObject([{ t: 2, city: victim.id, to: 0 }])
    expect(find(state, r.id)!.tile).toBe(T(5, 2))
    expect(state.winner).toBeNull()
  })

  it('killing a garrison does not take a city that still has hp; arrows hit the city, not the garrison', () => {
    const c = city(1, T(5, 2))
    const g = unit(1, 'archer', T(5, 2), { hp: 1, stance: 'cautious' })
    const r = unit(0, 'rider', T(4, 2))
    const a = unit(0, 'archer', T(3, 2), { stance: 'hold', target: T(5, 2) })
    const st = makeState(map, [g, r, a], [city(0, T(0, 5)), c])
    const { state, events } = run(st, { 0: orders({ [r.id]: order([T(5, 2)]) }) })
    expect(ofKind(events, 'death').map((d) => d.unit)).toEqual([g.id])
    expect(find(state, r.id)!.tile).toBe(T(4, 2))
    expect(state.cities.find((x) => x.id === c.id)!.owner).toBe(1)
    expect(ofKind(events, 'shot')).toContainEqual(expect.objectContaining({ from: { unit: a.id }, target: { city: c.id } }))
  })

  it('once a city is at 0 hp its garrison can be shot, and the siege stops regeneration', () => {
    const c = city(1, T(5, 2), { hp: 0 })
    const g = unit(1, 'spear', T(5, 2), { stance: 'hold' })
    const a = unit(0, 'archer', T(3, 2), { target: T(5, 2) })
    const st = makeState(map, [g, a], [city(0, T(0, 5)), c, city(1, T(11, 5))])
    const { state, events } = run(st, {})
    expect(ofKind(events, 'shot')).toContainEqual(expect.objectContaining({ from: { unit: a.id }, target: { unit: g.id } }))
    expect(state.cities.find((x) => x.id === c.id)!.hp).toBe(0)
  })

  it('a city under attack does not regenerate; an untouched one does', () => {
    const hurt = city(0, T(2, 2), { hp: 10 })
    const besieged = city(1, T(8, 2), { hp: 10 })
    const a = unit(0, 'archer', T(7, 2), { stance: 'hold', target: T(8, 2) })
    const st = makeState(map, [a], [hurt, besieged])
    const { state, events } = run(st, {})
    expect(state.cities.find((x) => x.id === hurt.id)!.hp).toBe(13)
    expect(state.cities.find((x) => x.id === besieged.id)!.hp).toBeLessThan(10)
    expect(ofKind(events, 'cityRepair')).toEqual([{ t: 8, kind: 'cityRepair', city: hurt.id, hp: 13 }])
  })

  it('builds when production is enough, carries the rest, keeps the build; settlers cost a citizen', () => {
    const c = city(0, T(2, 2), { prod: 19, build: 'spear' })
    const s = city(1, T(8, 2), { prod: 29, build: 'settler', pop: 1 })
    const st = makeState(map, [], [c, s])
    const { state, events } = run(st, {})
    const [sp] = ofKind(events, 'spawn')
    expect(sp).toMatchObject({ t: 8, city: c.id, unit: { type: 'spear', owner: 0, tile: T(2, 2) } })
    const after = state.cities.find((x) => x.id === c.id)!
    expect(after.build).toBe('spear')
    // Grass centre 1 + 2 bonus, plus one worked grass tile 1: 19 + 4 - 20.
    expect(after.prod).toBe(3)
    // Pop 1 cannot give up a citizen: the settler waits.
    expect(ofKind(events, 'spawn').some((e) => e.city === s.id)).toBe(false)
  })
})

describe('founding', () => {
  it('a settler founds at the end of the turn when its path is done', () => {
    const s = unit(0, 'settler', T(4, 2))
    const { state, events } = run(makeState(map, [s]), { 0: orders({ [s.id]: order([T(5, 2)], 'cautious', { found: true }) }) })
    const [f] = ofKind(events, 'found')
    expect(f).toMatchObject({ t: 8, unit: s.id, city: { owner: 0, tile: T(5, 2), pop: 1 } })
    expect(find(state, s.id)).toBeUndefined()
    expect(state.cities.some((c) => c.tile === T(5, 2))).toBe(true)
  })

  it('two settlers founding too close in the same turn both fail', () => {
    const a = unit(0, 'settler', T(3, 2))
    const b = unit(1, 'settler', T(5, 2))
    const { state, events } = run(makeState(map, [a, b]), {
      0: orders({ [a.id]: order([], 'cautious', { found: true }) }),
      1: orders({ [b.id]: order([], 'cautious', { found: true }) }),
    })
    expect(ofKind(events, 'found')).toEqual([])
    expect(ofKind(events, 'foundFailed')).toEqual([
      { t: 8, kind: 'foundFailed', unit: a.id, reason: 'conflict' },
      { t: 8, kind: 'foundFailed', unit: b.id, reason: 'conflict' },
    ])
    expect(find(state, a.id)!.found).toBe(false)
  })

  it('cannot found within 2 of an existing city', () => {
    const s = unit(0, 'settler', T(4, 2))
    const st = makeState(map, [s], [city(0, T(2, 2)), city(1, T(11, 5))])
    const { events } = run(st, { 0: orders({ [s.id]: order([], 'cautious', { found: true }) }) })
    expect(ofKind(events, 'foundFailed')).toEqual([{ t: 8, kind: 'foundFailed', unit: s.id, reason: 'tooClose' }])
  })
})

describe('robustness and purity', () => {
  it('ignores orders for foreign units and truncates bad paths', () => {
    const mine = unit(0, 'spear', T(8, 1))
    const theirs = unit(1, 'spear', T(2, 4))
    const st = makeState(map, [mine, theirs])
    const garbage = {
      0: orders({
        [theirs.id]: order([T(3, 4)]),
        // (9,1) is fine, (10,0) is a mountain: truncated there.
        [mine.id]: order([T(9, 1), T(10, 0), T(11, 0)]),
        99999: order([T(1, 1)]),
      }),
      1: { units: { [theirs.id]: { path: [T(3, 4), T(7, 4), 'x', -3] } }, cities: null },
    } as unknown as Record<number, PlayerOrders>
    const { state } = resolveTurn(st, garbage)
    expect(find(state, mine.id)!.tile).toBe(T(9, 1))
    expect(find(state, mine.id)!.path).toEqual([])
    expect(find(state, theirs.id)!.tile).toBe(T(3, 4)) // its own order, truncated after the first step
    expect(() => resolveTurn(st, null as unknown as Record<number, PlayerOrders>)).not.toThrow()
    expect(() => resolveTurn(st, { 0: 'nope' } as unknown as Record<number, PlayerOrders>)).not.toThrow()
  })

  it('never mutates its input', () => {
    const a = unit(0, 'spear', T(4, 2), { path: [T(5, 2)] })
    const b = unit(1, 'rider', T(6, 2), { stance: 'aggressive' })
    const st = makeState(map, [a, b], [city(0, T(2, 2), { build: 'spear', prod: 25 }), city(1, T(9, 4), { hp: 4 })])
    const before = JSON.stringify(st)
    const o = { 0: orders({ [a.id]: order([T(5, 2), T(6, 2)], 'aggressive') }) }
    const r1 = resolveTurn(st, o)
    expect(JSON.stringify(st)).toBe(before)
    expect(JSON.stringify(resolveTurn(st, o))).toBe(JSON.stringify(r1))
  })
})
