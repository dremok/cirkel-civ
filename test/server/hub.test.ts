// The hub in-process, with resolveTurn scripted to reach paths a short real game rarely does:
// engine failures, eliminations, victory, and bots playing on after the last human is out.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as engine from '../../src/engine/index.ts'
import type { GameState } from '../../src/engine/types.ts'
import { Hub } from '../../src/server/hub.ts'
import { Store } from '../../src/server/store.ts'
import { Peer } from './peer.ts'

vi.mock('../../src/engine/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/index.ts')>()
  return { ...real, resolveTurn: vi.fn(real.resolveTurn) }
})
const resolveTurn = vi.mocked(engine.resolveTurn)

/** A next state with tweaks, the way a real engine would return it. */
function next(state: GameState, tweak: (s: GameState) => void = () => {}) {
  const s = structuredClone(state)
  s.turn++
  tweak(s)
  return { state: s, events: [] }
}

describe('hub turn cycle', () => {
  let dir: string
  let store: Store
  let hub: Hub

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cirkel-civ-hub-'))
    store = new Store(dir)
    hub = new Hub(store, { lobbyTtlMs: 3 * 24 * 3600_000 })
    await hub.load()
    resolveTurn.mockReset() // back to the real engine
  })

  afterEach(async () => {
    hub.stop()
    await store.flush()
    await rm(dir, { recursive: true, force: true })
  })

  async function twoHumansAndABot() {
    const a = new Peer(hub)
    const b = new Peer(hub)
    a.send({ type: 'create', options: { name: 'T', seats: 3, bots: 1 }, playerName: 'A' })
    const { gameId } = a.last('joined')
    b.send({ type: 'join', gameId, playerName: 'B' })
    b.last('joined')
    a.send({ type: 'start' })
    const { state } = a.last('state')
    a.inbox = []
    b.inbox = []
    return { a, b, gameId, state }
  }

  it('keeps the turn and the orders when the engine throws', async () => {
    const { a, b, state } = await twoHumansAndABot()
    resolveTurn.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    a.send({ type: 'orders', turn: 1, orders: { units: {}, cities: {} }, ready: true })
    b.send({ type: 'orders', turn: 1, orders: { units: {}, cities: {} }, ready: true })
    expect(b.last('error')).toMatchObject({ code: 'internal' })
    expect(b.take('state')).toEqual([])
    expect(b.last('summary').game.seats.map((s) => s.ready)).toEqual([false, false, true])
    // Retry works once the engine behaves.
    a.send({ type: 'orders', turn: 1, orders: { units: {}, cities: {} }, ready: true })
    b.send({ type: 'orders', turn: 1, orders: { units: {}, cities: {} }, ready: true })
    expect(b.last('state').state.turn).toBe(state.turn + 1)
  })

  it('turns an eliminated human into a spectator who no longer holds up the turn', async () => {
    const { a, b } = await twoHumansAndABot()
    resolveTurn.mockImplementationOnce((s) => next(s, (n) => (n.players[1].alive = false)))
    a.send({ type: 'orders', turn: 1, orders: { units: {}, cities: {} }, ready: true })
    b.send({ type: 'orders', turn: 1, orders: { units: {}, cities: {} }, ready: true })
    const bs = b.last('state')
    expect(bs.you).toBe(1)
    expect(bs.state.players[1].alive).toBe(false)
    expect(a.last('summary').game.seats.map((s) => s.ready)).toEqual([false, true, true])
    b.send({ type: 'orders', turn: 2, orders: { units: {}, cities: {} }, ready: true })
    expect(b.last('error').code).toBe('forbidden')
    a.send({ type: 'orders', turn: 2, orders: { units: {}, cities: {} }, ready: true })
    expect(b.last('state').state.turn).toBe(3)
  })

  it('finishes on a winner, and finished games stay viewable', async () => {
    const { a, b, gameId } = await twoHumansAndABot()
    resolveTurn.mockImplementationOnce((s) => next(s, (n) => (n.winner = 0)))
    a.send({ type: 'orders', turn: 1, orders: { units: {}, cities: {} }, ready: true })
    b.send({ type: 'orders', turn: 1, orders: { units: {}, cities: {} }, ready: true })
    expect(a.last('summary').game).toMatchObject({ phase: 'finished', turn: 2 })
    const fin = a.last('state')
    expect(fin.state.winner).toBe(0)
    expect(fin.deadline).toBeNull()
    a.send({ type: 'orders', turn: 2, orders: { units: {}, cities: {} }, ready: true })
    expect(a.last('error').code).toBe('wrong_phase')
    const w = new Peer(hub)
    w.send({ type: 'watch', gameId })
    expect(w.last('state').state.winner).toBe(0)
  })

  it('plays the bots out when the last human is eliminated', async () => {
    const solo = new Peer(hub)
    solo.send({ type: 'create', options: { name: 'S', seats: 3, bots: 2 }, playerName: 'S' })
    solo.last('joined')
    solo.send({ type: 'start' })
    solo.take('state')
    resolveTurn.mockImplementation((s) => next(s, (n) => {
      n.players[0].alive = false
      if (n.turn === 9) n.winner = 2
    }))
    solo.send({ type: 'orders', turn: 1, orders: { units: {}, cities: {} }, ready: true })
    expect(resolveTurn).toHaveBeenCalledTimes(8)
    const states = solo.take('state')
    expect(states).toHaveLength(1) // one broadcast for the whole play-out
    expect(states[0].state).toMatchObject({ turn: 9, winner: 2 })
    expect(states[0].previous?.turn).toBe(8)
    expect(solo.last('summary').game.phase).toBe('finished')
  })

  it('ends a bot-only game that never gets a winner', async () => {
    resolveTurn.mockImplementation((s) => next(s, (n) => (n.players[0].alive = false)))
    const solo = new Peer(hub)
    solo.send({ type: 'create', options: { name: 'S', seats: 2, bots: 1 }, playerName: 'S' })
    solo.last('joined')
    solo.send({ type: 'start' })
    const maxTurns = solo.last('state').state.maxTurns
    solo.send({ type: 'orders', turn: 1, orders: { units: {}, cities: {} }, ready: true })
    expect(resolveTurn.mock.calls.length).toBe(maxTurns + 2)
    expect(solo.last('summary').game.phase).toBe('finished')
  })
})
