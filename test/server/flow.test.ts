// End-to-end: real server process, real sockets, a temp DATA_DIR, and a restart in the middle.
// Ports 8811..8819 are reserved for these tests.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { botOrders } from '../../src/engine/index.ts'
import type { ClientMessage, ServerMessage } from '../../src/shared/protocol.ts'
import type { GameRecord } from '../../src/server/types.ts'

const ROOT = resolve(import.meta.dirname, '../..')
type Msg<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>

interface Server {
  port: number
  logs: string[]
  stop(): Promise<number | null>
}

async function startServer(port: number, dataDir: string): Promise<Server> {
  const logs: string[] = []
  const proc: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = new Promise<number | null>((r) => proc.once('exit', (code) => r(code)))
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`server did not start:\n${logs.join('')}`)), 15_000)
    const onData = (d: Buffer) => {
      logs.push(d.toString())
      if (logs.join('').includes(`cirkel-civ on :${port}`)) {
        clearTimeout(timer)
        ok()
      }
    }
    proc.stdout!.on('data', onData)
    proc.stderr!.on('data', onData)
    proc.once('exit', () => fail(new Error(`server exited:\n${logs.join('')}`)))
  })
  return {
    port,
    logs,
    stop: () => {
      proc.kill('SIGTERM')
      return exited
    },
  }
}

class Client {
  inbox: ServerMessage[] = []
  private wake: (() => void) | null = null
  closed: Promise<number>

  private constructor(public ws: WebSocket) {
    ws.on('message', (data) => {
      this.inbox.push(JSON.parse(data.toString()))
      this.wake?.()
    })
    this.closed = new Promise((r) => ws.once('close', (code) => r(code)))
  }

  static connect(port: number): Promise<Client> {
    const ws = new WebSocket(`ws://localhost:${port}/ws`)
    return new Promise((ok, fail) => {
      ws.once('open', () => ok(new Client(ws)))
      ws.once('error', fail)
    })
  }

  send(msg: ClientMessage | string) {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }

  /** The first message of `type` (matching `pred`) in the inbox, removing it; waits if none yet. */
  async next<T extends ServerMessage['type']>(type: T, pred: (m: Msg<T>) => boolean = () => true, ms = 4000): Promise<Msg<T>> {
    const deadline = Date.now() + ms
    for (;;) {
      const i = this.inbox.findIndex((m) => m.type === type && pred(m as Msg<T>))
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Msg<T>
      const left = deadline - Date.now()
      if (left <= 0) throw new Error(`timed out waiting for '${type}'; inbox: ${JSON.stringify(this.inbox.map((m) => m.type))}`)
      await new Promise<void>((r) => {
        const t = setTimeout(r, left)
        this.wake = () => {
          clearTimeout(t)
          r()
        }
      })
      this.wake = null
    }
  }

  drain() {
    this.inbox = []
  }

  close() {
    this.ws.close()
    return this.closed
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** First port in 8811..8819 (reserved for these tests) that nobody listens on. */
async function freePort(): Promise<number> {
  for (let port = 8811; port <= 8819; port++) {
    const free = await new Promise<boolean>((r) => {
      const probe = createServer()
      probe.once('error', () => r(false))
      probe.listen(port, () => probe.close(() => r(true)))
    })
    if (free) return port
  }
  throw new Error('no free port in 8811..8819')
}

describe('server flow', () => {
  let dataDir: string
  let server: Server
  const clients: Client[] = []
  const connect = async (port = server.port) => {
    const c = await Client.connect(port)
    clients.push(c)
    return c
  }

  // Carried across the restart.
  let gameId = ''
  let hostToken = ''
  let guestToken = ''
  let turnBeforeRestart = 0
  let draft: Msg<'state'>['myOrders'] = null

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'cirkel-civ-test-'))
    server = await startServer(await freePort(), dataDir)
  })

  afterAll(async () => {
    for (const c of clients) c.ws.terminate()
    await server?.stop()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('serves health, the spec and refuses path traversal', async () => {
    const base = `http://localhost:${server.port}`
    expect(await (await fetch(`${base}/health`)).text()).toBe('ok')
    const spec = await fetch(`${base}/SPEC.md`)
    expect(spec.status).toBe(200)
    expect(await spec.text()).toContain('Cirkel-Civ')
    for (const p of ['/..%2fpackage.json', '/docs/..%2f..%2fpackage.json', '/assets/missing.js', '/docs/nope.md']) {
      expect((await fetch(`${base}${p}`)).status, p).toBe(404)
    }
  })

  it('rejects bad input without dying', async () => {
    const c = await connect()
    c.send('not json')
    expect((await c.next('error')).code).toBe('bad_request')
    c.send({ type: 'nope' } as unknown as ClientMessage)
    expect((await c.next('error')).code).toBe('bad_request')
    c.send({ type: 'create', options: { name: 'x', seats: 9, bots: 0 }, playerName: 'A' })
    expect((await c.next('error')).code).toBe('bad_request')
    c.send({ type: 'create', options: { name: 'x', seats: 2, bots: 0 }, playerName: '   ' })
    expect((await c.next('error')).code).toBe('bad_request')
    c.send({ type: 'resume', gameId: 'nosuch', token: 'x' })
    expect((await c.next('error')).code).toBe('not_found')
    c.send({ type: 'start' })
    expect((await c.next('error')).code).toBe('forbidden')
    c.send({ type: 'orders', turn: 1, orders: { units: {}, cities: {} }, ready: true })
    expect((await c.next('error')).code).toBe('forbidden')
    c.ws.send(Buffer.from([1, 2, 3]), { binary: true })
    expect((await c.next('error')).code).toBe('bad_request')
    c.send({ type: 'ping' })
    await c.next('pong')
  })

  it('runs a lobby: create, join, seat changes, start', async () => {
    const host = await connect()
    const guest = await connect()
    guest.send({ type: 'list' })
    expect((await guest.next('games')).games).toEqual([])

    host.send({ type: 'create', options: { name: 'Testspel', seats: 3, bots: 1 }, playerName: 'Anna' })
    const joined = await host.next('joined')
    expect(joined).toMatchObject({ seat: 0, host: true })
    gameId = joined.gameId
    hostToken = joined.token
    const s0 = (await host.next('summary')).game
    expect(s0.phase).toBe('lobby')
    expect(s0.seats.map((s) => s.kind)).toEqual(['human', 'open', 'bot'])
    expect(s0.seats[0]).toMatchObject({ name: 'Anna', connected: true })

    // The list screen gets pushed the new game.
    const pushed = await guest.next('games', (m) => m.games.length === 1)
    expect(pushed.games[0].id).toBe(gameId)

    guest.send({ type: 'join', gameId, playerName: 'Bertil' })
    const gj = await guest.next('joined')
    expect(gj).toMatchObject({ gameId, seat: 1, host: false })
    guestToken = gj.token
    expect(guestToken).not.toBe(hostToken)
    const s1 = (await host.next('summary', (m) => m.game.seats[1].kind === 'human')).game
    expect(s1.seats[1]).toMatchObject({ name: 'Bertil', connected: true })

    // A third player finds no seat.
    const late = await connect()
    late.send({ type: 'join', gameId, playerName: 'Cesar' })
    expect((await late.next('error')).code).toBe('full')

    // Only the host changes seats or starts.
    guest.send({ type: 'setSeat', seat: 2, kind: 'open' })
    expect((await guest.next('error')).code).toBe('forbidden')
    guest.send({ type: 'start' })
    expect((await guest.next('error')).code).toBe('forbidden')
    host.send({ type: 'setSeat', seat: 0, kind: 'bot' })
    expect((await host.next('error')).code).toBe('forbidden')
    host.send({ type: 'setSeat', seat: 2, kind: 'open' })
    expect((await guest.next('summary', (m) => m.game.seats[2].kind === 'open')).game.seats[2].name).toBeNull()

    host.drain()
    guest.drain()
    host.send({ type: 'start' })
    const started = (await guest.next('summary', (m) => m.game.phase === 'planning')).game
    expect(started.turn).toBe(1)
    expect(started.seats[2]).toMatchObject({ kind: 'bot', ready: true, connected: true })
    expect(started.seats[0].ready).toBe(false)
    const hs = await host.next('state')
    const gs = await guest.next('state')
    expect(hs.you).toBe(0)
    expect(gs.you).toBe(1)
    expect(hs.state.turn).toBe(1)
    expect(hs.previous).toBeNull()
    expect(hs.state.players.map((p) => p.kind)).toEqual(['human', 'human', 'bot'])
    expect(hs.state.players.map((p) => p.name)).toEqual(['Anna', 'Bertil', 'Bot 3'])

    host.send({ type: 'start' })
    expect((await host.next('error')).code).toBe('wrong_phase')
    late.send({ type: 'join', gameId, playerName: 'Cesar' })
    expect((await late.next('error')).code).toBe('wrong_phase')
  })

  it('plays turns: ready, un-ready, stale turns, resolution broadcasts', async () => {
    const [, host, guest] = clients
    const watcher = await connect()
    watcher.send({ type: 'watch', gameId })
    expect((await watcher.next('summary')).game.id).toBe(gameId)
    const ws = await watcher.next('state')
    expect(ws.you).toBeNull()
    expect(ws.myOrders).toBeNull()

    let state = ws.state
    for (let turn = 1; turn <= 5; turn++) {
      expect(state.turn).toBe(turn)
      for (const c of [host, guest, watcher]) c.drain()
      const hostOrders = botOrders(state, 0, turn)
      host.send({ type: 'orders', turn, orders: hostOrders, ready: true })
      const r1 = (await guest.next('summary', (m) => m.game.seats[0].ready)).game
      expect(r1.seats[1].ready).toBe(false)

      if (turn === 1) {
        // Un-ready is allowed until the turn resolves; stale turns are refused with a fresh state.
        host.send({ type: 'orders', turn, orders: hostOrders, ready: false })
        await guest.next('summary', (m) => !m.game.seats[0].ready)
        guest.send({ type: 'orders', turn: 99, orders: { units: {}, cities: {} }, ready: true })
        expect((await guest.next('error')).code).toBe('stale_turn')
        expect((await guest.next('state')).state.turn).toBe(1)
        host.send({ type: 'orders', turn, orders: hostOrders, ready: true })
        await guest.next('summary', (m) => m.game.seats[0].ready)
        // Malformed orders are refused, orders for someone else's units are dropped.
        guest.send({ type: 'orders', turn, orders: { units: { 1: { path: 'north' } }, cities: {} }, ready: false } as never)
        expect((await guest.next('error')).code).toBe('bad_request')
        const enemy = state.units.find((u) => u.owner === 0)!
        guest.send({ type: 'orders', turn, orders: { units: { [enemy.id]: { path: [], stance: 'hold' } }, cities: {} }, ready: false })
        await guest.next('summary') // ack to the sender only
        guest.send({ type: 'resume', gameId, token: guestToken })
        expect((await guest.next('state')).myOrders).toEqual({ units: {}, cities: {} })
        await guest.next('joined')
      }

      guest.send({ type: 'orders', turn, orders: botOrders(state, 1, turn), ready: true })
      const [hs, gs, vs] = await Promise.all([host.next('state'), guest.next('state'), watcher.next('state')])
      for (const s of [hs, gs, vs]) {
        expect(s.state.turn).toBe(turn + 1)
        expect(s.previous?.turn).toBe(turn)
        expect(Array.isArray(s.events)).toBe(true)
        expect(s.myOrders).toBeNull()
      }
      expect([hs.you, gs.you, vs.you]).toEqual([0, 1, null])
      const after = (await host.next('summary', (m) => m.game.turn === turn + 1)).game
      expect(after.seats.map((s) => s.ready)).toEqual([false, false, true])
      state = hs.state
      if (state.winner !== null) break
    }
    turnBeforeRestart = state.turn

    // A draft (not ready) survives a restart.
    draft = botOrders(state, 0, 1234)
    host.send({ type: 'orders', turn: state.turn, orders: draft, ready: false })
    await host.next('summary')

    // Connected flags follow the sockets.
    host.drain()
    await guest.close()
    const gone = (await host.next('summary', (m) => !m.game.seats[1].connected)).game
    expect(gone.seats[0].connected).toBe(true)
    await watcher.close()
  })

  it('kicks a player from a lobby seat', async () => {
    const host = await connect()
    const guest = await connect()
    host.send({ type: 'create', options: { name: 'Kick', seats: 2, bots: 0 }, playerName: 'Host' })
    const { gameId: id } = await host.next('joined')
    guest.send({ type: 'join', gameId: id, playerName: 'Gäst' })
    const { token } = await guest.next('joined')
    host.send({ type: 'setSeat', seat: 1, kind: 'bot' })
    expect((await guest.next('error')).code).toBe('kicked')
    expect((await guest.next('summary', (m) => m.game.seats[1].kind === 'bot')).game.seats[1].name).toBe('Bot 2')
    guest.send({ type: 'resume', gameId: id, token })
    expect((await guest.next('error')).code).toBe('bad_token')
  })

  it('single player against bots resolves on every submit', async () => {
    const solo = await connect()
    solo.send({ type: 'create', options: { name: 'Solo', seats: 4, bots: 3, mapSize: 'small' }, playerName: 'Anna' })
    await solo.next('joined')
    solo.send({ type: 'start' })
    let s = await solo.next('state')
    expect(s.state.players.filter((p) => p.kind === 'bot')).toHaveLength(3)
    for (let i = 0; i < 3 && s.state.winner === null; i++) {
      const turn = s.state.turn
      solo.send({ type: 'orders', turn, orders: botOrders(s.state, 0, turn), ready: true })
      s = await solo.next('state')
      expect(s.state.turn).toBe(turn + 1)
    }
  })

  it('resolves at the turn deadline with whatever orders exist', async () => {
    const c = await connect()
    c.send({ type: 'create', options: { name: 'Klocka', seats: 2, bots: 1, turnSeconds: 5 }, playerName: 'Snigel' })
    await c.next('joined')
    c.send({ type: 'start' })
    const s = await c.next('state')
    expect(s.deadline).toBeGreaterThan(Date.now() + 3000)
    expect(s.deadline).toBeLessThanOrEqual(Date.now() + 5000)
    const next = await c.next('state', () => true, 8000)
    expect(next.state.turn).toBe(2)
    expect(next.deadline).toBeGreaterThan(s.deadline!)
  }, 15_000)

  it('keeps games across a restart and resumes with tokens', async () => {
    for (const c of clients) c.ws.terminate()
    clients.length = 0
    expect(await server.stop()).toBe(0)
    const files = await readdir(join(dataDir, 'games'))
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(files).toContain(`${gameId}.json`)

    // An abandoned lobby from four days ago is cleaned up on boot.
    const old = Date.now() - 4 * 24 * 3600_000
    const stale: GameRecord = {
      v: 1, id: 'stale1', name: 'Gammal', phase: 'lobby', createdAt: old, updatedAt: old, host: 0,
      seats: [{ kind: 'human', name: 'X', tokenHash: null }, { kind: 'open', name: null, tokenHash: null }],
      turnSeconds: null, mapSize: null, seed: null, config: null, state: null, previous: null, events: [],
      orders: {}, ready: [false, false], deadline: null, log: [],
    }
    await writeFile(join(dataDir, 'games', 'stale1.json'), JSON.stringify(stale))
    await writeFile(join(dataDir, 'games', 'broken.json'), '{ not json')

    server = await startServer(await freePort(), dataDir)
    await sleep(100)
    expect(server.logs.join('')).toContain('abandoned lobby deleted')
    expect(await readdir(join(dataDir, 'games'))).not.toContain('stale1.json')

    const host = await connect()
    host.send({ type: 'resume', gameId, token: hostToken })
    expect(await host.next('joined')).toMatchObject({ gameId, seat: 0, host: true, token: hostToken })
    const summary = (await host.next('summary')).game
    expect(summary.seats[0].connected).toBe(true)
    expect(summary.seats[1].connected).toBe(false)
    const s = await host.next('state')
    expect(s.state.turn).toBe(turnBeforeRestart)
    expect(s.myOrders).toEqual(draft)
    expect(s.previous?.turn).toBe(turnBeforeRestart - 1)

    const guest = await connect()
    guest.send({ type: 'resume', gameId, token: 'wrong' })
    expect((await guest.next('error')).code).toBe('bad_token')
    guest.send({ type: 'resume', gameId, token: guestToken })
    expect((await guest.next('joined')).seat).toBe(1)
    await host.next('summary', (m) => m.game.seats[1].connected)
    const gs = await guest.next('state')

    // And the game goes on.
    const turn = s.state.turn
    host.send({ type: 'orders', turn, orders: draft!, ready: true })
    guest.send({ type: 'orders', turn, orders: botOrders(gs.state, 1, turn), ready: true })
    expect((await host.next('state')).state.turn).toBe(turn + 1)

    const list = (await (await fetch(`http://localhost:${server.port}/api/games`)).json()) as { id: string; updatedAt: number }[]
    expect(list.map((g) => g.id)).toContain(gameId)
    expect(list.map((g) => g.updatedAt)).toEqual([...list.map((g) => g.updatedAt)].sort((a, b) => b - a))
  }, 30_000)
})
