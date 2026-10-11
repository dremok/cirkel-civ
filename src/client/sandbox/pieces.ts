// Pieces sandbox: /sandbox/pieces.html?seed=aurora&seats=2
//   &replay=1        play the scripted turn after load (or &real=1 for a real resolveTurn with bots)
//   &freeze=<sec>    freeze the replay this many seconds in (for screenshots)
//   &zoom=<n>        zoom in n wheel steps around the battlefield; &focus=<tile>
//   &sel=<role>      select one of my units (rider, spear, settler, archer) and preview a path
import '@fontsource-variable/inter'
import {
  type City, type GameEvent, type GameState, type PlayerOrders, type Target, type TileId, type Unit, type UnitType,
  botOrders, canStep, createGame, distance, findPath, isPassable, neighbors, newCity, newUnit, pathTiming, reachableThisTurn, resolveTurn,
} from '../../engine/index.ts'
import type { PlanStep, UnitPlan } from '../render/api.ts'
import { createGameView } from '../render/index.ts'

const q = new URLSearchParams(location.search)
const seats = Number(q.get('seats') ?? 2)
const NAMES = ['Anna', 'Lars', 'Ida', 'Olle']
let state: GameState = createGame({
  seed: q.get('seed') ?? 'aurora',
  players: NAMES.slice(0, seats).map((name, i) => ({ name, kind: i === 0 ? 'human' : 'bot' })),
})
const map = state.map
const ME = 0

// ---------------------------------------------------------------------------------------------
// Staging: a battlefield halfway between the first two capitals.

const occupied = () => new Set(state.units.map((u) => u.tile))
const cityTiles = () => new Set(state.cities.map((c) => c.tile))
const land = (t: TileId) => isPassable(map, t)

function bfsPath(a: TileId, b: TileId): TileId[] {
  const prev = new Map<TileId, TileId>([[a, a]])
  const queue = [a]
  while (queue.length) {
    const t = queue.shift()!
    if (t === b) break
    for (const n of neighbors(map, t)) if (!prev.has(n) && canStep(map, t, n)) { prev.set(n, t); queue.push(n) }
  }
  const out: TileId[] = []
  for (let t = b; t !== a; t = prev.get(t)!) { out.unshift(t); if (!prev.has(t)) break }
  return [a, ...out]
}

function freeNear(t: TileId, avoid: Set<TileId>, pred: (x: TileId) => boolean = () => true): TileId {
  const seen = new Set([t])
  const queue = [t]
  while (queue.length) {
    const x = queue.shift()!
    if (land(x) && !avoid.has(x) && !occupied().has(x) && !cityTiles().has(x) && pred(x)) return x
    for (const n of neighbors(map, x)) if (!seen.has(n)) { seen.add(n); queue.push(n) }
  }
  return t
}

const capA = state.cities.find((c) => c.owner === 0)!
const capB = state.cities.find((c) => c.owner === 1)!
const P = bfsPath(capA.tile, capB.tile)
const m = Math.floor(P.length / 2)
const reserved = new Set<TileId>(P.slice(m - 1, m + 2))
const add = (owner: number, type: UnitType, tile: TileId, patch: Partial<Unit> = {}) => {
  const u = newUnit(state, owner, type, tile)
  Object.assign(u, patch)
  state.units.push(u)
  return u
}

// clash pair: A rider and B spear both step into P[m] on tick 2
const a1 = add(0, 'rider', P[m - 1], { stance: 'aggressive' })
const b1 = add(1, 'spear', P[m + 1], { stance: 'aggressive' })
// melee: A spear kills a wounded B archer and steps in
const a2 = add(0, 'spear', freeNear(P[m - 1], reserved, (x) => distance(map, x, P[m - 1]) === 1))
const b2 = add(1, 'archer', freeNear(a2.tile, reserved, (x) => distance(map, x, a2.tile) === 1 && distance(map, x, capB.tile) < distance(map, a2.tile, capB.tile) + 1), { hp: 4, stance: 'hold' })
// a B archer two tiles from the rider shoots in the volley
const b3 = add(1, 'archer', freeNear(P[m + 1], reserved, (x) => distance(map, x, a1.tile) === 2), { stance: 'hold' })
// a halted cautious spear
const b5 = add(1, 'spear', freeNear(P[m + 2] ?? P[m + 1], reserved), { hp: 8 })
// a B rider raiding near my capital: shot by the city and my archer
const myArcher = state.units.find((u) => u.owner === 0 && u.type === 'archer')!
const b4 = add(1, 'rider', freeNear(capA.tile, reserved, (x) => distance(map, x, capA.tile) === 2 && distance(map, x, myArcher.tile) <= 2), { hp: 6, stance: 'aggressive' })
// an undefended B town to capture
const townTile = freeNear(P[m - 2] ?? P[m - 1], reserved, (x) => state.cities.every((c) => distance(map, c.tile, x) >= 3) && distance(map, x, P[m]) >= 2)
const town: City = newCity(state, 1, townTile, false)
town.hp = 0
town.pop = 2
state.cities.push(town)
const a3 = add(0, 'rider', freeNear(townTile, reserved, (x) => distance(map, x, townTile) === 1))
// my capital is bigger and walled; a second town of mine
capA.pop = 4
capA.walls = true
capB.pop = 3
const extra = add(0, 'archer', freeNear(capA.tile, reserved, (x) => distance(map, x, capA.tile) === 1), { hp: 7, stance: 'hold' })
void extra
const mySettler = state.units.find((u) => u.owner === 0 && u.type === 'settler')!
const foundTile = freeNear(capA.tile, reserved, (x) => distance(map, x, capA.tile) >= 3 && state.cities.every((c) => distance(map, c.tile, x) >= 3)
  && neighbors(map, x).some((n) => land(n) && !occupied().has(n) && distance(map, n, capA.tile) < distance(map, x, capA.tile)))
mySettler.tile = freeNear(foundTile, reserved, (x) => neighbors(map, foundTile).includes(x) && distance(map, x, capA.tile) < distance(map, foundTile, capA.tile))
const foundOk = state.cities.every((c) => distance(map, c.tile, foundTile) >= 3) && neighbors(map, mySettler.tile).includes(foundTile)
// extra seats get a few pieces too
for (const c of state.cities.filter((c) => c.owner >= 2)) {
  add(c.owner, 'rider', freeNear(c.tile, new Set()))
  c.pop = 2
}

// &crowd=<n>: fill the board up to n units (performance)
{
  const want = Number(q.get('crowd') ?? 0)
  const types: UnitType[] = ['spear', 'archer', 'rider', 'settler', 'spear', 'archer']
  const stances = ['cautious', 'aggressive', 'hold'] as const
  let i = 0
  const tiles = map.tiles.map((t) => t.id).filter((t) => land(t) && !cityTiles().has(t))
  for (const t of tiles) {
    if (state.units.length >= want) break
    if (occupied().has(t) || (i++ * 7919) % 3 !== 0) continue
    add(state.units.length % state.players.length, types[i % types.length], t, { hp: 3 + (i * 37) % 8, stance: stances[i % 3] })
  }
}

// ---------------------------------------------------------------------------------------------
// A hand-written turn, applied to get `next`.

const spawnTile = freeNear(capB.tile, reserved)
const ev: GameEvent[] = []
const stepToward = (u: Unit, goal: TileId): TileId | null => {
  const path = bfsPath(u.tile, goal)
  const nb = path[1]
  if (nb === undefined || occupied().has(nb) || cityTiles().has(nb)) return null
  return nb
}
const b3Step = stepToward(b3, a1.tile)
ev.push({ t: 1, kind: 'halt', unit: b5.id, reason: 'contact' })
ev.push({ t: 2, kind: 'clash', a: a1.id, b: b1.id, tile: P[m], dmgA: 5, dmgB: 2 })
ev.push({ t: 3, kind: 'melee', attacker: a2.id, target: { unit: b2.id }, dmgToTarget: 4, dmgToAttacker: 1 })
ev.push({ t: 3, kind: 'death', unit: b2.id, tile: b2.tile })
ev.push({ t: 3, kind: 'move', unit: a2.id, from: a2.tile, to: b2.tile })
if (foundOk) ev.push({ t: 3, kind: 'move', unit: mySettler.id, from: mySettler.tile, to: foundTile })
if (b3Step !== null && b3Step !== P[m]) ev.push({ t: 4, kind: 'move', unit: b3.id, from: b3.tile, to: b3Step })
ev.push({ t: 4, kind: 'move', unit: a3.id, from: a3.tile, to: townTile })
ev.push({ t: 4, kind: 'capture', city: town.id, from: 1, to: 0, unit: a3.id })
ev.push({ t: 5, kind: 'move', unit: b4.id, from: b4.tile, to: freeNear(b4.tile, reserved, (x) => distance(map, x, b4.tile) === 1) })
ev.push({ t: 7, kind: 'shot', from: { unit: b3.id }, target: { unit: a1.id }, dmg: 3 })
ev.push({ t: 7, kind: 'shot', from: { city: capA.id }, target: { unit: b4.id }, dmg: 3 })
ev.push({ t: 7, kind: 'shot', from: { unit: myArcher.id }, target: { unit: b4.id }, dmg: 4 })
ev.push({ t: 7, kind: 'death', unit: b4.id, tile: -1 })
if (foundOk) {
  const fc = newCity(state, 0, foundTile, false)
  state.nextId-- // keep ids stable: the city is added by the event below
  fc.id = 9000
  ev.push({ t: 8, kind: 'found', city: fc, unit: mySettler.id })
}
ev.push({ t: 8, kind: 'built', city: capB.id, item: 'rider' })
ev.push({ t: 8, kind: 'spawn', unit: { ...newUnit(state, 1, 'rider', spawnTile) }, city: capB.id })
ev.push({ t: 8, kind: 'built', city: capB.id, item: 'walls' })
ev.push({ t: 8, kind: 'grow', city: capA.id, pop: 5 })
ev.push({ t: 8, kind: 'heal', unit: a2.id, hp: 10 })

function applyScript(s0: GameState, events: GameEvent[]): GameState {
  const s = structuredClone(s0)
  const unit = (id: number) => s.units.find((u) => u.id === id)
  const city = (id: number) => s.cities.find((c) => c.id === id)
  const hurt = (t: Target, d: number) => {
    if ('unit' in t) { const u = unit(t.unit); if (u) u.hp = Math.max(0, u.hp - d) }
    else { const c = city(t.city); if (c) c.hp = Math.max(0, c.hp - d) }
  }
  for (const e of events) {
    switch (e.kind) {
      case 'move': { const u = unit(e.unit); if (u) u.tile = e.to; break }
      case 'clash': hurt({ unit: e.a }, e.dmgA); hurt({ unit: e.b }, e.dmgB); break
      case 'melee': hurt(e.target, e.dmgToTarget); hurt({ unit: e.attacker }, e.dmgToAttacker); break
      case 'shot': hurt(e.target, e.dmg); break
      case 'death': s.units = s.units.filter((u) => u.id !== e.unit); break
      case 'capture': { const c = city(e.city); if (c) { c.owner = e.to; c.hp = 5 } break }
      case 'found': s.cities.push(structuredClone(e.city)); s.units = s.units.filter((u) => u.id !== e.unit); break
      case 'spawn': s.units.push(structuredClone(e.unit)); break
      case 'built': { const c = city(e.city); if (c && e.item === 'walls') c.walls = true; break }
      case 'grow': { const c = city(e.city); if (c) c.pop = e.pop; break }
      case 'heal': { const u = unit(e.unit); if (u) u.hp = e.hp; break }
    }
  }
  s.turn++
  return s
}
const scripted = applyScript(state, ev)

// ---------------------------------------------------------------------------------------------
// View + a tiny planning UI.

const clicks: { tile: TileId; button: number; shift: boolean }[] = []
const hovers: (TileId | null)[] = []

const view = createGameView(document.getElementById('app')!, map, {
  onTileClick(tile, info) { clicks.push({ tile, ...info }); click(tile) },
  onTileHover(tile) { hovers.push(tile); hover = tile; refreshSelection() },
})
addEventListener('resize', () => view.resize())
view.setState(state, ME)

let selected: number | null = null
let hover: TileId | null = null
const orders = new Map<number, { path: TileId[]; kind: UnitPlan['kind'] }>()

function stepsFor(unitId: number, path: TileId[]): PlanStep[] {
  return pathTiming(state, unitId, path).map((t, i) => ({ tile: path[i], turn: t.turn, tick: t.tick }))
}
function kindFor(unitId: number, dest: TileId): UnitPlan['kind'] {
  const u = state.units.find((x) => x.id === unitId)!
  if (u.type === 'settler') return 'found'
  const enemy = state.units.some((x) => x.tile === dest && x.owner !== u.owner) || state.cities.some((c) => c.tile === dest && c.owner !== u.owner)
  return enemy ? 'attack' : 'move'
}
function pushPlans() {
  const plans: UnitPlan[] = []
  for (const [unit, o] of orders) {
    const u = state.units.find((x) => x.id === unit)
    if (!u) continue
    plans.push({ unit, steps: stepsFor(unit, o.path), kind: o.kind, stance: u.stance })
  }
  view.setPlans(plans)
}
function refreshSelection() {
  const u = selected !== null ? state.units.find((x) => x.id === selected) : undefined
  let preview = null
  if (u && hover !== null && hover !== u.tile) {
    const path = findPath(state, u.id, hover)
    if (path?.length) preview = { steps: stepsFor(u.id, path), kind: kindFor(u.id, hover) }
  }
  view.setSelection({ unit: u?.id ?? null, city: null, reachable: u ? reachableThisTurn(state, u.id) : [], preview, hover })
}
function click(tile: TileId) {
  const mine = state.units.find((u) => u.tile === tile && u.owner === ME)
  if (mine) { selected = mine.id; refreshSelection(); return }
  if (selected !== null) {
    const path = findPath(state, selected, tile)
    if (path?.length) orders.set(selected, { path, kind: kindFor(selected, tile) })
    selected = null
    pushPlans()
    refreshSelection()
  }
}

// some standing orders
const planFor = (u: Unit, dest: TileId) => {
  const path = findPath(state, u.id, dest)
  if (path?.length) orders.set(u.id, { path, kind: kindFor(u.id, dest) })
}
planFor(a3, capB.tile)
planFor(a2, b2.tile)
planFor(mySettler, foundTile)
planFor(myArcher, freeNear(P[m - 2] ?? P[m - 1], reserved))
pushPlans()

const sel = q.get('sel')
if (sel) {
  const roles: Record<string, Unit> = { rider: a3, spear: a2, settler: mySettler, archer: myArcher, clash: a1 }
  const u = roles[sel]
  if (u) {
    selected = u.id
    hover = Number(q.get('hover') ?? freeNear(P[m - 3] ?? P[m - 1], reserved, (x) => distance(map, x, u.tile) >= 3))
    refreshSelection()
  }
}

// ---------------------------------------------------------------------------------------------
// Replay

let playing = false
async function playScripted() {
  if (playing) return
  playing = true
  const times: string[] = []
  await view.playEvents(state, ev, scripted, {
    speed: Number(q.get('speed') ?? 0.5),
    onTick: (t) => { times.push(`${t}@${debug.time().toFixed(2)}`); log(`tick ${t}\n${times.join(' ')}`) },
  })
  playing = false
}
async function playReal() {
  if (playing) return
  playing = true
  const all: Record<number, PlayerOrders> = {}
  for (const p of state.players) all[p.id] = botOrders(state, p.id, state.turn)
  const res = resolveTurn(state, all)
  log(`real turn ${state.turn}: ${res.events.length} events\n${summarize(res.events)}`)
  await view.playEvents(state, res.events, res.state, { onTick: (t) => log(`tick ${t}`) })
  state = res.state
  orders.clear()
  pushPlans()
  playing = false
}
function summarize(events: GameEvent[]) {
  const n: Record<string, number> = {}
  for (const e of events) n[e.kind] = (n[e.kind] ?? 0) + 1
  return Object.entries(n).map(([k, v]) => `${k}: ${v}`).join('  ')
}
const logEl = document.getElementById('log')!
function log(s: string) {
  if (!q.has('log')) return
  logEl.style.display = 'block'
  logEl.textContent = s
}

document.getElementById('play')!.onclick = () => playScripted()
document.getElementById('skip')!.onclick = () => view.skipPlayback()
document.getElementById('real')!.onclick = () => playReal()

const named: Record<string, TileId> = { capA: capA.tile, capB: capB.tile, town: townTile, mid: P[m], found: foundTile }
const fq = q.get('focus')
// camera, then (optionally) the replay, once the world has rendered a few frames
const focusTile = fq === null ? P[m] : fq in named ? named[fq] : Number(fq)
view.focusTile(focusTile, false)
const zoom = Number(q.get('zoom') ?? 0)
const debug = (view as unknown as { __debug: { timeScale: number; seek(t: number): void; time(): number } }).__debug
const freeze = q.get('freeze')
let frames = 0
const offFrame = view.world.onFrame(() => {
  frames++
  if (frames === 20 && zoom) {
    const c = view.world.renderer.domElement
    for (let i = 0; i < zoom; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: c.clientWidth / 2, clientY: c.clientHeight / 2, bubbles: true, cancelable: true }))
  }
  if (frames === 45) {
    offFrame()
    if (q.has('replay')) {
      void (q.has('real') ? playReal() : playScripted())
      if (freeze) debug.seek(Number(freeze))
    }
  }
})

/** Screen position (client px) of a tile's top, or of a point above it. */
function screenOf(tile: TileId, lift = 0) {
  const p = view.world.tileTop(tile).clone()
  p.y += lift
  p.project(view.world.camera)
  const r = view.world.renderer.domElement.getBoundingClientRect()
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height }
}
const roles = { rider: a3.id, spear: a2.id, settler: mySettler.id, archer: myArcher.id, clash: a1.id }

Object.assign(window, { view, state: () => state, debug, playScripted, playReal, clicks, hovers, screenOf, roles, selected: () => selected })
