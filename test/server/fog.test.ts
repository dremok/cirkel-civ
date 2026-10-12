// Fog of war through the hub: a live player gets observe() of the states and their own event
// stream; spectators of a running fog game get only the summary. The saved record is the truth.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as engine from '../../src/engine/index.ts'
import { botOrders, observe, observeEvents } from '../../src/engine/index.ts'
import { Hub } from '../../src/server/hub.ts'
import { Store } from '../../src/server/store.ts'
import type { GameRecord } from '../../src/server/types.ts'
import type { CreateOptions } from '../../src/shared/protocol.ts'
import { Peer, type Msg } from './peer.ts'

vi.mock('../../src/engine/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engine/index.ts')>()
  return { ...real, resolveTurn: vi.fn(real.resolveTurn) }
})
const resolveTurn = vi.mocked(engine.resolveTurn)

const FOG_ONLY = new Set(['spotted', 'lost', 'explore'])

describe('fog of war', () => {
  let dir: string
  let store: Store
  let hub: Hub

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cirkel-civ-fog-'))
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

  async function saved(id: string): Promise<GameRecord> {
    await store.flush()
    return JSON.parse(await readFile(join(dir, 'games', `${id}.json`), 'utf8'))
  }

  /** Two humans and a bot; `watchers` connect in the lobby. Started. */
  function game(options: Partial<CreateOptions> = {}, watchers = 0) {
    const a = new Peer(hub)
    const b = new Peer(hub)
    a.send({ type: 'create', options: { name: 'Fog', seats: 3, bots: 1, ...options }, playerName: 'A' })
    const { gameId } = a.last('joined')
    b.send({ type: 'join', gameId, playerName: 'B' })
    const ws = Array.from({ length: watchers }, () => new Peer(hub))
    for (const w of ws) w.send({ type: 'watch', gameId })
    a.send({ type: 'start' })
    const players = [a, b]
    return { id: gameId, players, ws, summary: a.last('summary').game, mine: players.map((p) => p.last('state')) }
  }

  /** Every human plans like a bot from what they see; returns what they got next. */
  function playTurn(players: Peer[], mine: Msg<'state'>[]) {
    mine.forEach((s, seat) => players[seat].send({ type: 'orders', turn: s.state.turn, orders: botOrders(s.state, seat, s.state.turn), ready: true }))
    return players.map((p) => p.last('state'))
  }

  it('is on by default and sends each player only their own view and event stream', async () => {
    const { id, players, summary, mine: start } = game()
    expect(summary.fog).toBe(true)
    let hid = false
    let explored = false
    let mine = start
    for (let turn = 1; turn <= 4; turn++) {
      mine = playTurn(players, mine)
      const rec = await saved(id)
      expect(rec.state!.fog).toHaveLength(3)
      expect(rec.events.some((e) => FOG_ONLY.has(e.kind))).toBe(false) // resolveTurn's raw events
      mine.forEach((s, seat) => {
        expect(s.you).toBe(seat)
        expect(s.state).toEqual(observe(rec.state!, seat))
        expect(s.previous).toEqual(observe(rec.previous!, seat))
        expect(s.events).toEqual(observeEvents(rec.previous!, rec.events, seat))
        if (JSON.stringify(s.events) !== JSON.stringify(rec.events)) hid = true
        if (s.events.some((e) => e.kind === 'explore')) explored = true
      })
    }
    expect(hid).toBe(true)
    expect(explored).toBe(true)
  })

  it('shows spectators only the summary until the game ends', async () => {
    const { id, players, ws: [early], mine } = game({}, 1)
    // Watching from the lobby: the start brings a summary and fog_hidden, no state.
    expect(early.take('state')).toEqual([])
    expect(early.last('error').code).toBe('fog_hidden')
    expect(early.last('summary').game.phase).toBe('planning')
    // Watching a running game (e.g. a player's second tab): the same.
    const late = new Peer(hub)
    late.send({ type: 'watch', gameId: id })
    expect(late.last('summary').game.id).toBe(id)
    expect(late.last('error')).toMatchObject({ code: 'fog_hidden', message: expect.stringMatching(/fog of war/) })
    expect(late.take('state')).toEqual([])

    // A resolution reaches the players, not the spectators. B is eliminated in it and sees it all.
    resolveTurn.mockImplementationOnce((s) => {
      const next = structuredClone(s)
      next.turn++
      next.players[1].alive = false
      return { state: next, events: [] }
    })
    const after = playTurn(players, mine)
    for (const w of [early, late]) {
      expect(w.take('state')).toEqual([])
      expect(w.take('error')).toEqual([])
      expect(w.last('summary').game.turn).toBe(2)
    }
    const rec = await saved(id)
    expect(after[0].state).toEqual(observe(rec.state!, 0))
    expect(after[1].state).toEqual(rec.state) // eliminated: the full view, as before

    // The end shows everyone everything.
    resolveTurn.mockImplementationOnce((s) => ({ state: { ...structuredClone(s), turn: s.turn + 1, winner: 0 }, events: [] }))
    players[0].send({ type: 'orders', turn: 2, orders: { units: {}, cities: {} }, ready: true })
    for (const w of [early, late]) {
      const end = w.last('state')
      expect(end.you).toBeNull()
      expect(end.state.winner).toBe(0)
      expect(end.state).toEqual((await saved(id)).state)
    }
    const again = new Peer(hub)
    again.send({ type: 'watch', gameId: id })
    expect(again.last('state').state.winner).toBe(0)
    expect(again.take('error')).toEqual([])
  })

  it('without fog everyone sees every event and spectators watch live', async () => {
    const { id, players, ws: [w], summary, mine: start } = game({ fog: false }, 1)
    expect(summary.fog).toBe(false)
    expect(w.last('state').state.fog).toBeNull()
    expect(w.take('error')).toEqual([])
    let mine = start
    for (let turn = 1; turn <= 2; turn++) {
      mine = playTurn(players, mine)
      const rec = await saved(id)
      expect(w.last('state').events).toEqual(rec.events)
      for (const s of mine) expect(s.events).toEqual(rec.events)
    }
  })

  it('refuses a fog option that is not a boolean', () => {
    const p = new Peer(hub)
    p.send({ type: 'create', options: { name: 'x', seats: 2, bots: 1, fog: 'yes' as never }, playerName: 'A' })
    expect(p.last('error').code).toBe('bad_request')
  })
})
