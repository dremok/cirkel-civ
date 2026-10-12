// Headless bot-vs-bot games: win rates per seat, game length and engine speed.
//   npx tsx scripts/sim.ts --games 200 --seats 2 [--size small] [--vs bot|random|idle] [--max-turns 60] [--seed sim] [--no-fog] [--verbose]
// --vs sets the policy of every seat except seat 0 (which is always the bot).

import { botOrders, randomOrders } from '../src/engine/bot.ts'
import { createGame } from '../src/engine/game.ts'
import { observe, scores } from '../src/engine/observe.ts'
import { resolveTurn } from '../src/engine/rules.ts'
import type { GameState, PlayerId, PlayerOrders } from '../src/engine/types.ts'

type Policy = (s: GameState, p: PlayerId, seed: number) => PlayerOrders
const POLICIES: Record<string, Policy> = {
  bot: botOrders,
  random: randomOrders,
  idle: () => ({ units: {}, cities: {} }),
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}

const games = Number(arg('games', '100'))
const seats = Number(arg('seats', '2'))
const size = arg('size', seats === 2 ? 'small' : 'medium') as 'small' | 'medium' | 'large'
const maxTurns = Number(arg('max-turns', '60'))
const vs = arg('vs', 'bot')
const prefix = arg('seed', 'sim')
const verbose = process.argv.includes('--verbose')
const fog = !process.argv.includes('--no-fog')
if (!POLICIES[vs]) throw new Error(`--vs must be one of ${Object.keys(POLICIES).join(', ')}`)

const wins = new Array(seats).fill(0)
let draws = 0
let conquests = 0
let totalTurns = 0
let captures = 0
let deaths = 0
let resolveMs = 0
let botMs = 0
const endCities = new Array(seats).fill(0)
const endUnits = new Array(seats).fill(0)
const t0 = performance.now()

for (let g = 0; g < games; g++) {
  let s = createGame({
    seed: `${prefix}-${g}`,
    players: Array.from({ length: seats }, (_, i) => ({ name: `S${i}`, kind: 'bot' as const })),
    mapSize: size,
    maxTurns,
    fog,
  })
  while (s.winner === null) {
    const orders: Record<number, PlayerOrders> = {}
    const b0 = performance.now()
    for (const p of s.players) {
      if (!p.alive) continue
      const policy = p.id === 0 ? botOrders : POLICIES[vs]
      orders[p.id] = policy(observe(s, p.id), p.id, g)
    }
    const r0 = performance.now()
    const r = resolveTurn(s, orders)
    const r1 = performance.now()
    s = r.state
    for (const e of r.events) {
      if (e.kind === 'capture') captures++
      else if (e.kind === 'death') deaths++
    }
    botMs += r0 - b0
    resolveMs += r1 - r0
    totalTurns++
  }
  if (s.winner === 'draw') draws++
  else wins[s.winner]++
  const turns = s.turn - 1
  if (turns < s.maxTurns) conquests++
  s.players.forEach((p) => {
    endCities[p.id] += s.cities.filter((c) => c.owner === p.id).length
    endUnits[p.id] += s.units.filter((u) => u.owner === p.id).length
  })
  if (verbose) {
    const cs = s.players.map((p) => s.cities.filter((c) => c.owner === p.id).length).join('/')
    console.log(`game ${g}: winner ${s.winner} after ${turns} turns, cities ${cs}, scores ${scores(s).join('/')}`)
  }
}

const elapsed = (performance.now() - t0) / 1000
const pct = (x: number) => `${((100 * x) / games).toFixed(1)}%`
console.log(`${games} games, ${seats} seats, ${size} map, fog ${fog ? 'on' : 'off'}, seat 0 = bot vs ${vs}`)
for (let i = 0; i < seats; i++) {
  console.log(`  seat ${i}: ${pct(wins[i])} wins, avg ${(endCities[i] / games).toFixed(1)} cities and ${(endUnits[i] / games).toFixed(1)} units at the end`)
}
console.log(`  draws: ${pct(draws)}, decided by conquest: ${pct(conquests)}`)
console.log(`  avg game length: ${(totalTurns / games).toFixed(1)} turns, ${(captures / games).toFixed(1)} cities captured and ${(deaths / games).toFixed(0)} units killed per game`)
console.log(
  `  speed: ${(totalTurns / elapsed).toFixed(0)} turns/s overall, resolveTurn ${((1000 * totalTurns) / resolveMs).toFixed(0)} turns/s, ` +
    `bots ${((botMs / totalTurns) * 1000).toFixed(0)} µs/turn`,
)
