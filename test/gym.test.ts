import { describe, expect, it } from 'vitest'
import { Gym } from '../scripts/gym.ts'
import type { GameState, PlayerOrders } from '../src/engine/types.ts'

describe('gym protocol', () => {
  it('plays a whole game through reset / moves / step and ends', () => {
    const gym = new Gym()
    let r = gym.handle({ cmd: 'reset', config: { seed: 'gym-test', maxTurns: 12, obs: 'both' } })
    expect(r).toMatchObject({ turn: 1, done: false, winner: null })
    const map = r.map as { width: number; height: number; tileHeight: number[] }
    expect(map.tileHeight).toHaveLength(map.width * map.height)
    while (!r.done) {
      const obs = (r.observations as Record<string, { state: GameState; grid: Record<string, number[]> }>)['0']
      expect(obs.grid.unitOwner).toHaveLength(map.width * map.height)
      expect('map' in obs.state).toBe(r.turn === 1)
      const moves = gym.handle({ cmd: 'moves', seat: 0 }).moves as Record<string, Record<string, number[]>>
      const orders: PlayerOrders = { units: {}, cities: {} }
      for (const u of obs.state.units) {
        if (u.owner !== 0) continue
        const paths = Object.values(moves[u.id] ?? {})
        orders.units[u.id] = { path: paths[u.id % Math.max(1, paths.length)] ?? [], stance: 'cautious' }
      }
      r = gym.handle({ cmd: 'step', orders: { 0: orders } })
      expect(Array.isArray(r.events)).toBe(true)
    }
    expect(r.turn).toBe(13)
    expect(r.winner).not.toBeNull()
  })

  it('helps with paths and baseline orders, and reports errors', () => {
    const gym = new Gym()
    expect(() => gym.handle({ cmd: 'step' })).toThrow(/reset/)
    const r = gym.handle({ cmd: 'reset', config: { seed: 'gym-help', players: 3, agents: [0, 2] } })
    expect(Object.keys(r.observations as object)).toEqual(['0', '2'])
    const state = (r.observations as Record<string, { state: GameState }>)['0'].state
    const u = state.units.find((x) => x.owner === 0)!
    const far = state.cities.find((c) => c.owner === 1)!.tile
    const path = gym.handle({ cmd: 'path', unit: u.id, dest: far }).path as number[]
    expect(path.at(-1)).toBe(far)
    const bot = gym.handle({ cmd: 'bot', seat: 2 }).orders as PlayerOrders
    expect(Object.keys(bot.units).length).toBeGreaterThan(0)
    expect(() => gym.handle({ cmd: 'reset', config: { opponent: 'nobody' } })).toThrow(/opponent/)
    expect(() => gym.handle({ cmd: 'fly' })).toThrow(/unknown/)
  })
})
