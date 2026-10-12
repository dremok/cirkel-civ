// Saves written before a schema change load, migrate and keep playing; unusable saves are skipped.
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PLOT_COUNT } from '../../src/engine/city.ts'
import { createGame } from '../../src/engine/index.ts'
import { Hub, type Conn } from '../../src/server/hub.ts'
import { migrate, SCHEMA_VERSION } from '../../src/server/migrate.ts'
import { Store } from '../../src/server/store.ts'
import type { ServerMessage } from '../../src/shared/protocol.ts'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** A game as the v1 server saved it: cities without interiors, 'walls' builds, stray fields. */
function v1Save(id = 'old1', extra: (state: any) => void = () => {}) {
  const config = { seed: 'migrate-me', players: [{ name: 'A', kind: 'human' as const }, { name: 'B', kind: 'human' as const }, { name: 'Bot 3', kind: 'bot' as const }] }
  const state: any = createGame(config)
  extra(state)
  for (const c of state.cities) {
    delete c.interior
    c.legacy = 'dropped on migration'
  }
  const [cap0, cap1] = state.cities
  cap0.build = 'walls'
  cap0.walls = true
  const settler = state.units.find((u: any) => u.owner === 1)
  const previous = structuredClone(state)
  state.turn = 2
  return {
    v: 1, id, name: 'Old game', phase: 'planning', createdAt: 1, updatedAt: 2, host: 0,
    seats: [
      { kind: 'human', name: 'A', tokenHash: sha('tok-a') },
      { kind: 'human', name: 'B', tokenHash: sha('tok-b') },
      { kind: 'bot', name: 'Bot 3', tokenHash: null },
    ],
    turnSeconds: null, mapSize: null, seed: null, config, state, previous,
    events: [
      { t: 8, kind: 'built', city: cap0.id, item: 'walls' },
      { t: 8, kind: 'built', city: cap1.id, item: 'spear' },
      { t: 8, kind: 'found', city: structuredClone(cap1), unit: settler.id },
    ],
    orders: {
      0: { units: {}, cities: { [cap0.id]: 'walls' } }, // migrates to null: still valid
      1: { units: { [settler.id]: { path: [999999], stance: 'cautious' } }, cities: {} }, // invalid today
      2: { units: {}, cities: {} },
    },
    ready: [true, true, false],
    deadline: null,
    log: [],
    somethingRemoved: true,
  }
}

describe('migrate', () => {
  it('upgrades a v1 save to the current schema', () => {
    const raw = v1Save()
    const before = structuredClone(raw)
    const { rec, from } = migrate(raw)
    expect(raw).toEqual(before) // input untouched
    expect(from).toBe(1)
    expect(rec.schemaVersion).toBe(SCHEMA_VERSION)
    expect('somethingRemoved' in rec).toBe(false)
    // Capitals get exactly the interior a fresh game gives them.
    const fresh = createGame(rec.config!)
    for (const s of [rec.state!, rec.previous!]) {
      for (const c of s.cities) {
        expect(c.interior).toEqual(fresh.cities.find((f) => f.tile === c.tile)!.interior)
        expect(c.interior.plots).toHaveLength(PLOT_COUNT)
        expect(c.walls).toBe(false) // derived from the interior, which has no wall
        expect('legacy' in c).toBe(false)
      }
      expect(s.cities[0].build).toBeNull()
    }
    expect(rec.events.map((e) => e.kind)).toEqual(['built', 'found'])
    const found = rec.events[1] as Extract<(typeof rec.events)[number], { kind: 'found' }>
    expect(found.city.interior.plots).toHaveLength(PLOT_COUNT)
    expect(rec.orders[0].cities[rec.state!.cities[0].id]).toBeNull()
  })

  it('gives a non-capital the one-House interior of a newly founded city', () => {
    const raw = v1Save('old2', (state) => state.cities.push({ ...structuredClone(state.cities[1]), id: 900, capital: false, tile: state.units[0].tile }))
    const city = migrate(raw).rec.state!.cities.find((c) => c.id === 900)!
    expect(city.interior.plots.filter((p) => p !== null)).toEqual(['house'])
    expect(city.capital).toBe(false)
  })

  it('gives 2-player capitals the mirrored interiors of a fresh game', () => {
    const config = { seed: 'mirror', players: [{ name: 'A', kind: 'human' as const }, { name: 'B', kind: 'bot' as const }] }
    const raw: any = { ...v1Save(), config, state: createGame(config), previous: null, events: [], orders: {} }
    raw.seats = raw.seats.slice(0, 2)
    for (const c of raw.state.cities) delete c.interior
    const fresh = createGame(config)
    expect(migrate(raw).rec.state!.cities.map((c) => c.interior)).toEqual(fresh.cities.map((c) => c.interior))
  })

  it('is idempotent and keeps an interior that is already there', () => {
    const once = migrate(v1Save()).rec
    once.state!.cities[0].interior.plots[9] = 'wall'
    const twice = migrate({ ...once, schemaVersion: 1 }).rec
    expect(twice.state!.cities[0].interior.plots[9]).toBe('wall')
    expect(twice.state!.cities[0].walls).toBe(true)
    expect(migrate(once).rec).toEqual(once)
  })

  it('refuses saves it cannot understand', () => {
    expect(() => migrate({ ...v1Save(), v: undefined, schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/newer/)
    expect(() => migrate({ id: 'x' })).toThrow(/schema/)
    expect(() => migrate([])).toThrow()
    expect(() => migrate({ ...v1Save(), state: null })).toThrow(/state/)
    expect(() => migrate({ ...v1Save(), seats: [{ kind: 'alien' }, { kind: 'bot' }] })).toThrow(/seat/)
  })
})

describe('loading old saves', () => {
  let dir: string
  let store: Store
  let hub: Hub

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cirkel-civ-migrate-'))
    store = new Store(dir)
    hub = new Hub(store, { lobbyTtlMs: 3 * 24 * 3600_000 })
  })

  afterEach(async () => {
    hub.stop()
    await store.flush()
    await rm(dir, { recursive: true, force: true })
  })

  it('migrates on boot, backs up the original, skips what it cannot load, and plays on', async () => {
    const games = join(dir, 'games')
    await store.loadAll() // creates the directory
    const original = JSON.stringify(v1Save())
    await writeFile(join(games, 'old1.json'), original)
    const future = JSON.stringify({ ...v1Save('new1'), v: undefined, schemaVersion: SCHEMA_VERSION + 1 })
    await writeFile(join(games, 'new1.json'), future)
    await writeFile(join(games, 'junk.json'), '{"half": ')

    await hub.load()
    await store.flush()

    // Rewritten at the current schema; the original is kept; the others are left exactly as they were.
    const saved = JSON.parse(await readFile(join(games, 'old1.json'), 'utf8'))
    expect(saved.schemaVersion).toBe(SCHEMA_VERSION)
    expect(saved.state.cities.every((c: any) => c.interior)).toBe(true)
    expect(await readFile(join(games, 'backup', 'old1.v1.json'), 'utf8')).toBe(original)
    expect(await readFile(join(games, 'new1.json'), 'utf8')).toBe(future)
    expect((await readdir(games)).sort()).toEqual(['backup', 'junk.json', 'new1.json', 'old1.json'])
    expect(hub.list().map((g) => g.id)).toEqual(['old1'])

    const inbox: ServerMessage[] = []
    const conn: Conn = hub.open((d) => inbox.push(JSON.parse(d)))
    const b: ServerMessage[] = []
    const connB: Conn = hub.open((d) => b.push(JSON.parse(d)))
    hub.receive(conn, JSON.stringify({ type: 'resume', gameId: 'old1', token: 'tok-a' }))
    hub.receive(connB, JSON.stringify({ type: 'resume', gameId: 'old1', token: 'tok-b' }))
    const state = inbox.find((m) => m.type === 'state')
    if (state?.type !== 'state') throw new Error('no state')
    expect(state.state.cities.every((c) => c.interior.plots.length === PLOT_COUNT)).toBe(true)
    expect(state.myOrders).toEqual({ units: {}, cities: { [state.state.cities[0].id]: null } })
    // A's migrated orders still stand; B's no longer validate, so B plans again; the bot replanned.
    const summary = b.filter((m) => m.type === 'summary').pop()
    if (summary?.type !== 'summary') throw new Error('no summary')
    expect(summary.game.seats.map((s) => s.ready)).toEqual([true, false, true])

    // The real engine resolves the migrated state.
    hub.receive(connB, JSON.stringify({ type: 'orders', turn: 2, orders: { units: {}, cities: {} }, ready: true }))
    const next = b.filter((m) => m.type === 'state').pop()
    if (next?.type !== 'state') throw new Error('no state after resolution')
    expect(next.state.turn).toBe(3)
    expect(next.previous?.cities[0].interior).toBeDefined()
  })
})
