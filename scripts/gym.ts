// Line-delimited JSON over stdin/stdout, so an external (e.g. Python RL) agent can play.
//   npx tsx scripts/gym.ts
// One request per line, one response per line, in order. Logs go to stderr only.
// Protocol (every request may carry an "id", echoed in its response):
//   {"cmd":"reset","config":{...}}       new game; config fields below
//   {"cmd":"step","orders":{"0":{...}}}  orders for the agent seats; other seats are played by the
//                                        opponent policy; resolves one turn
//   {"cmd":"moves","seat":0}             every unit of that seat: tile -> path for all tiles it can
//                                        enter this turn (action masks / legal moves)
//   {"cmd":"path","unit":7,"dest":42}    fastest path (may span turns), or null
//   {"cmd":"bot","seat":0}               the built-in bot's orders for a seat (baseline / imitation)
//   {"cmd":"close"}
// reset config: seed (string), players (2..4), agents (seats you control, default [0]),
//   opponent ("bot" | "random" | "idle", default "bot"), mapSize ("small" | "medium" | "large"),
//   maxTurns (default 60), obs ("state" | "grid" | "both", default "state").
// Responses: {"id", "ok": true, ...} or {"id", "ok": false, "error"}. reset and step answer with
//   turn, done, winner, scores and observations (one per agent seat); step also returns the turn's
//   events. The static map is sent once, in the reset response. See examples/README.md.

import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { botOrders, randomOrders } from '../src/engine/bot.ts'
import { createGame } from '../src/engine/game.ts'
import { observe, scores } from '../src/engine/observe.ts'
import { findPath, reachablePaths } from '../src/engine/paths.ts'
import { hashString } from '../src/engine/rng.ts'
import { resolveTurn } from '../src/engine/rules.ts'
import type { Biome, GameState, PlayerId, PlayerOrders, Stance, UnitType } from '../src/engine/types.ts'

type Policy = (s: GameState, p: PlayerId, seed: number) => PlayerOrders
type Message = Record<string, unknown>

const OPPONENTS: Record<string, Policy> = { bot: botOrders, random: randomOrders, idle: () => ({ units: {}, cities: {} }) }
const BIOMES: Biome[] = ['deep', 'shallow', 'beach', 'grass', 'plains', 'forest', 'hills', 'mountain', 'snow']
const UNIT_TYPES: UnitType[] = ['spear', 'archer', 'rider', 'settler']
const STANCES: Stance[] = ['cautious', 'aggressive', 'hold']
const OBS = ['state', 'grid', 'both'] as const

interface Session {
  state: GameState
  agents: PlayerId[]
  opponent: Policy
  obs: (typeof OBS)[number]
  seed: number
}

/** Feature planes, row-major (index = tile id), -1 = none. */
function grid(s: GameState) {
  const n = s.map.tiles.length
  const plane = () => new Array<number>(n).fill(-1)
  const g = {
    unitOwner: plane(), unitType: plane(), unitHp: plane(), unitStance: plane(),
    cityOwner: plane(), cityPop: plane(), cityHp: plane(), cityWalls: plane(),
  }
  for (const u of s.units) {
    g.unitOwner[u.tile] = u.owner
    g.unitType[u.tile] = UNIT_TYPES.indexOf(u.type)
    g.unitHp[u.tile] = u.hp
    g.unitStance[u.tile] = STANCES.indexOf(u.stance)
  }
  for (const c of s.cities) {
    g.cityOwner[c.tile] = c.owner
    g.cityPop[c.tile] = c.pop
    g.cityHp[c.tile] = c.hp
    g.cityWalls[c.tile] = c.walls ? 1 : 0
  }
  return g
}

/** One game behind the protocol. The CLI below wraps it in stdio; tests use it directly. */
export class Gym {
  private session: Session | null = null

  handle(msg: Message): Message {
    switch (msg.cmd) {
      case 'reset':
        return this.reset((msg.config ?? {}) as Message)
      case 'step':
        return this.step((msg.orders ?? {}) as Record<string, PlayerOrders>)
      case 'moves': {
        const s = this.need()
        const seat = Number(msg.seat ?? s.agents[0])
        const moves: Record<number, Record<number, number[]>> = {}
        for (const u of s.state.units) if (u.owner === seat) moves[u.id] = reachablePaths(s.state, u.id)
        return { moves }
      }
      case 'path':
        return { path: findPath(this.need().state, Number(msg.unit), Number(msg.dest)) }
      case 'bot': {
        const s = this.need()
        const seat = Number(msg.seat ?? s.agents[0])
        return { orders: botOrders(observe(s.state, seat), seat, s.seed) }
      }
      default:
        throw new Error(`unknown cmd ${JSON.stringify(msg.cmd)}`)
    }
  }

  private need(): Session {
    if (!this.session) throw new Error('no game: send reset first')
    return this.session
  }

  private reset(cfg: Message): Message {
    const seats = Number(cfg.players ?? 2)
    const agents = Array.isArray(cfg.agents) ? cfg.agents.map(Number) : [0]
    const opponent = OPPONENTS[String(cfg.opponent ?? 'bot')]
    const obs = String(cfg.obs ?? 'state') as Session['obs']
    if (!opponent) throw new Error(`opponent must be one of ${Object.keys(OPPONENTS).join(', ')}`)
    if (!OBS.includes(obs)) throw new Error(`obs must be one of ${OBS.join(', ')}`)
    if (agents.some((a) => !Number.isInteger(a) || a < 0 || a >= seats)) throw new Error('agents must be seat numbers')
    const seed = String(cfg.seed ?? 'gym')
    const state = createGame({
      seed,
      players: Array.from({ length: seats }, (_, i) => (agents.includes(i) ? { name: `agent${i}`, kind: 'human' } : { name: `bot${i}`, kind: 'bot' })),
      mapSize: cfg.mapSize as 'small' | 'medium' | 'large' | undefined,
      maxTurns: cfg.maxTurns === undefined ? undefined : Number(cfg.maxTurns),
    })
    this.session = { state, agents, opponent, obs, seed: hashString(seed) }
    const { map } = state
    return {
      ...this.summary(true),
      map: {
        width: map.width,
        height: map.height,
        starts: map.starts,
        tileHeight: map.tiles.map((t) => t.height),
        biome: map.tiles.map((t) => BIOMES.indexOf(t.biome)),
        biomes: BIOMES,
        unitTypes: UNIT_TYPES,
        stances: STANCES,
      },
    }
  }

  private step(given: Record<string, PlayerOrders>): Message {
    const s = this.need()
    if (s.state.winner !== null) return { ...this.summary(false), events: [] }
    const orders: Record<number, PlayerOrders> = {}
    for (const p of s.state.players) {
      if (!p.alive) continue
      orders[p.id] = s.agents.includes(p.id) ? given[p.id] ?? { units: {}, cities: {} } : s.opponent(observe(s.state, p.id), p.id, s.seed)
    }
    const r = resolveTurn(s.state, orders)
    s.state = r.state
    return { ...this.summary(false), events: r.events }
  }

  private summary(withMap: boolean): Message {
    const s = this.need()
    const observations: Record<number, Message> = {}
    for (const seat of s.agents) {
      const { map, ...rest } = observe(s.state, seat)
      const o: Message = {}
      if (s.obs !== 'grid') o.state = withMap ? { map, ...rest } : rest
      if (s.obs !== 'state') o.grid = grid(s.state)
      observations[seat] = o
    }
    return { turn: s.state.turn, done: s.state.winner !== null, winner: s.state.winner, scores: scores(s.state), observations }
  }
}

function serve(): void {
  const gym = new Gym()
  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let id: unknown = null
    let reply: Message
    try {
      const msg = JSON.parse(line) as Message
      id = msg.id ?? null
      if (msg.cmd === 'close') process.exit(0)
      reply = { id, ok: true, ...gym.handle(msg) }
    } catch (e) {
      reply = { id, ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    process.stdout.write(JSON.stringify(reply) + '\n')
  })
  rl.on('close', () => process.exit(0))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve()
