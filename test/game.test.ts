import { describe, expect, it } from 'vitest'
import { botOrders, randomOrders } from '../src/engine/bot.ts'
import { createGame } from '../src/engine/game.ts'
import { mirror } from '../src/engine/mapgen.ts'
import { observe } from '../src/engine/observe.ts'
import { resolveTurn } from '../src/engine/rules.ts'
import type { GameState, PlayerId, PlayerOrders } from '../src/engine/types.ts'

type Policy = (s: GameState, p: PlayerId, seed: number) => PlayerOrders
const players = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, kind: 'bot' as const }))

function play(seed: string, policies: Policy[], opts: { maxTurns?: number; mapSize?: 'small' | 'medium' } = {}) {
  let s = createGame({ seed, players: players(policies.length), ...opts })
  const log: string[] = []
  while (s.winner === null) {
    const orders: Record<number, PlayerOrders> = {}
    for (const p of s.players) if (p.alive) orders[p.id] = policies[p.id](observe(s, p.id), p.id, 7)
    const r = resolveTurn(s, orders)
    log.push(JSON.stringify(r.events))
    s = r.state
  }
  return { state: s, log }
}

describe('whole games', () => {
  it('bot vs bot games terminate with a result, for 2, 3 and 4 players', () => {
    for (const n of [2, 3, 4]) {
      const { state } = play(`end-${n}`, Array(n).fill(botOrders), { maxTurns: 40 })
      expect(state.winner).not.toBeNull()
      expect(state.turn).toBeLessThanOrEqual(41)
    }
  })

  it('is deterministic: same seed and orders give the same game', () => {
    const a = play('det', [botOrders, botOrders], { maxTurns: 30 })
    const b = play('det', [botOrders, botOrders], { maxTurns: 30 })
    expect(a.log).toEqual(b.log)
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state))
  })

  it('the bot clearly beats a random player and an idle one', () => {
    const idle: Policy = () => ({ units: {}, cities: {} })
    let wins = 0
    for (let g = 0; g < 6; g++) {
      if (play(`vs-${g}`, g % 2 ? [botOrders, randomOrders] : [botOrders, idle]).state.winner === 0) wins++
    }
    expect(wins).toBe(6)
  })

  it('rules are fair on point-symmetric maps: a mirrored position resolves to the mirrored result', () => {
    let s = createGame({ seed: 'mirror', players: players(2) })
    const M = (t: number) => mirror(t, s.map.width, s.map.height)
    const flip = (st: GameState): GameState => ({
      ...st,
      units: st.units.map((u) => ({ ...u, tile: M(u.tile), path: u.path.map(M), target: u.target === null ? null : M(u.target) })),
      cities: st.cities.map((c) => ({ ...c, tile: M(c.tile) })),
    })
    const flipOrders = (o: Record<number, PlayerOrders>) =>
      Object.fromEntries(
        Object.entries(o).map(([p, po]) => [
          p,
          { cities: po.cities, units: Object.fromEntries(Object.entries(po.units).map(([id, uo]) => [id, { ...uo, path: uo.path.map(M), target: uo.target == null ? uo.target : M(uo.target) }])) },
        ]),
      )
    for (let turn = 0; turn < 40 && s.winner === null; turn++) {
      const o: Record<number, PlayerOrders> = { 0: botOrders(s, 0, 1), 1: botOrders(s, 1, 1) }
      const direct = resolveTurn(s, o)
      const mirrored = resolveTurn(flip(s), flipOrders(o))
      expect(JSON.stringify(flip(direct.state))).toBe(JSON.stringify(mirrored.state))
      s = direct.state
    }
  })
})

describe('bot', () => {
  it('only orders its own units and cities, and never mutates the state', () => {
    let s = createGame({ seed: 'own', players: players(2) })
    for (let t = 0; t < 15; t++) {
      const before = JSON.stringify(s)
      const o0 = botOrders(s, 0, 3)
      expect(JSON.stringify(s)).toBe(before)
      for (const id of Object.keys(o0.units)) expect(s.units.find((u) => u.id === Number(id))?.owner).toBe(0)
      for (const id of Object.keys(o0.cities)) expect(s.cities.find((c) => c.id === Number(id))?.owner).toBe(0)
      s = resolveTurn(s, { 0: o0, 1: botOrders(s, 1, 3) }).state
    }
  })

  it('is deterministic given (state, player, seed)', () => {
    const s = createGame({ seed: 'botdet', players: players(2) })
    expect(botOrders(s, 1, 5)).toEqual(botOrders(s, 1, 5))
  })

  it('expands: founds new cities early', () => {
    let s = createGame({ seed: 'expand', players: players(2) })
    for (let t = 0; t < 20; t++) s = resolveTurn(s, { 0: botOrders(s, 0, 0), 1: botOrders(s, 1, 0) }).state
    for (const p of [0, 1]) expect(s.cities.filter((c) => c.owner === p).length).toBeGreaterThanOrEqual(3)
  })
})

describe('observe', () => {
  it('hides other players plans but shows everything on the board', () => {
    let s = createGame({ seed: 'obs', players: players(2) })
    s = resolveTurn(s, { 0: botOrders(s, 0, 0), 1: botOrders(s, 1, 0) }).state
    const withPlans = { ...s, units: s.units.map((u) => ({ ...u, path: [u.tile], found: true, target: 3 })) }
    const view = observe(withPlans, 0)
    expect(view.units).toHaveLength(s.units.length)
    for (const u of view.units) {
      if (u.owner === 0) expect(u.path).toEqual([u.tile])
      else expect(u).toMatchObject({ path: [], found: false, target: null })
    }
    for (const c of view.cities) if (c.owner !== 0) expect(c).toMatchObject({ build: null, prod: 0, food: 0 })
    expect(withPlans.units.every((u) => u.found)).toBe(true) // input untouched
  })
})
