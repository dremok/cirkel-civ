// Parsing and sanitizing everything a client sends. Nothing from the wire reaches the game
// without passing through here.
import { BUILDINGS, PLOT_COUNT } from '../engine/city.ts'
import type { BuildItem, BuildingType, CityFocus, GameState, PlayerId, PlayerOrders, Stance, UnitOrder, UnitType } from '../engine/types.ts'
import type { ClientMessage, CreateOptions } from '../shared/protocol.ts'

export class BadRequest extends Error {}

const STANCES = new Set<Stance>(['cautious', 'aggressive', 'hold'])
const UNIT_BUILDS = new Set<UnitType>(['spear', 'archer', 'rider', 'settler'])
export const FOCI = new Set<CityFocus>(['growth', 'production', 'balance'])
const MAP_SIZES = new Set(['small', 'medium', 'large'])
export const MAX_TURN_SECONDS = 7 * 24 * 3600
export const MIN_TURN_SECONDS = 5
const MAX_PATH = 256

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => Number.isSafeInteger(v)

function fail(message: string): never {
  throw new BadRequest(message)
}

/** Printable, single-line, trimmed, at most `max` characters. */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  const s = v.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim()
  return [...s].slice(0, max).join('').trim()
}

function str(v: unknown, field: string, max = 128): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) fail(`${field} must be a string of 1..${max} chars`)
  return v
}

function playerName(v: unknown): string {
  const name = cleanText(v, 24)
  if (!name) fail('playerName is required')
  return name
}

function createOptions(v: unknown): CreateOptions {
  if (!isObj(v)) fail('options must be an object')
  const seats = v.seats
  if (!isInt(seats) || seats < 2 || seats > 4) fail('options.seats must be 2..4')
  const bots = v.bots ?? 0
  if (!isInt(bots) || bots < 0 || bots > seats - 1) fail(`options.bots must be 0..${seats - 1}`)
  const opts: CreateOptions = { name: cleanText(v.name, 40), seats, bots }
  if (v.mapSize !== undefined && v.mapSize !== null) {
    if (typeof v.mapSize !== 'string' || !MAP_SIZES.has(v.mapSize)) fail('options.mapSize must be small, medium or large')
    opts.mapSize = v.mapSize as CreateOptions['mapSize']
  }
  if (v.turnSeconds !== undefined && v.turnSeconds !== null) {
    const t = v.turnSeconds
    if (!isInt(t) || t < MIN_TURN_SECONDS || t > MAX_TURN_SECONDS) {
      fail(`options.turnSeconds must be null or ${MIN_TURN_SECONDS}..${MAX_TURN_SECONDS}`)
    }
    opts.turnSeconds = t
  }
  if (v.seed !== undefined && v.seed !== null && v.seed !== '') opts.seed = str(v.seed, 'options.seed', 64)
  if (v.fog !== undefined && v.fog !== null) {
    if (typeof v.fog !== 'boolean') fail('options.fog must be a boolean')
    opts.fog = v.fog
  }
  return opts
}

/** Shape-checks one client message. Throws BadRequest. */
export function parseClientMessage(raw: string): ClientMessage {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    fail('not JSON')
  }
  if (!isObj(v) || typeof v.type !== 'string') fail('message must be an object with a type')
  switch (v.type) {
    case 'create':
      return { type: 'create', options: createOptions(v.options), playerName: playerName(v.playerName) }
    case 'join':
      return { type: 'join', gameId: str(v.gameId, 'gameId', 32), playerName: playerName(v.playerName) }
    case 'resume':
      return { type: 'resume', gameId: str(v.gameId, 'gameId', 32), token: str(v.token, 'token') }
    case 'watch':
      return { type: 'watch', gameId: str(v.gameId, 'gameId', 32) }
    case 'list':
    case 'start':
    case 'ping':
      return { type: v.type }
    case 'setSeat':
      if (!isInt(v.seat)) fail('seat must be an integer')
      if (v.kind !== 'bot' && v.kind !== 'open') fail("kind must be 'bot' or 'open'")
      return { type: 'setSeat', seat: v.seat, kind: v.kind }
    case 'orders':
      if (!isInt(v.turn)) fail('turn must be an integer')
      if (typeof v.ready !== 'boolean') fail('ready must be a boolean')
      if (!isObj(v.orders)) fail('orders must be an object')
      return { type: 'orders', turn: v.turn, ready: v.ready, orders: v.orders as unknown as PlayerOrders }
    default:
      fail(`unknown message type '${String(v.type).slice(0, 32)}'`)
  }
}

function tile(v: unknown, state: GameState, field: string): number {
  if (!isInt(v) || v < 0 || v >= state.map.tiles.length) fail(`${field} must be a tile id`)
  return v
}

/** A unit type or a building on a plot (1..18; the engine checks that it fits), copied; else undefined. */
export function asBuildItem(v: unknown): BuildItem | undefined {
  if (typeof v === 'string' && UNIT_BUILDS.has(v as UnitType)) return v as UnitType
  if (isObj(v) && typeof v.building === 'string' && Object.hasOwn(BUILDINGS, v.building) && isInt(v.plot) && v.plot >= 1 && v.plot < PLOT_COUNT) {
    return { building: v.building as BuildingType, plot: v.plot }
  }
  return undefined
}

function buildItem(v: unknown, id: string): BuildItem | null {
  if (v === null) return null
  return asBuildItem(v) ?? fail(`orders.cities.${id} must be a unit type, {building, plot} or null`)
}

function unitOrder(v: unknown, state: GameState, id: string): UnitOrder {
  if (!isObj(v)) fail(`orders.units.${id} must be an object`)
  if (!Array.isArray(v.path) || v.path.length > MAX_PATH) fail(`orders.units.${id}.path must be an array of <= ${MAX_PATH} tiles`)
  if (typeof v.stance !== 'string' || !STANCES.has(v.stance as Stance)) fail(`orders.units.${id}.stance is invalid`)
  const order: UnitOrder = { path: v.path.map((t) => tile(t, state, `orders.units.${id}.path[]`)), stance: v.stance as Stance }
  if (v.found !== undefined) {
    if (typeof v.found !== 'boolean') fail(`orders.units.${id}.found must be a boolean`)
    order.found = v.found
  }
  if (v.target !== undefined) order.target = v.target === null ? null : tile(v.target, state, `orders.units.${id}.target`)
  return order
}

/**
 * Validates a player's orders against the current state. Malformed orders throw BadRequest;
 * entries for units or cities the player does not own are dropped (returned in `dropped`).
 */
export function sanitizeOrders(raw: unknown, state: GameState, seat: PlayerId): { orders: PlayerOrders; dropped: number } {
  if (!isObj(raw)) fail('orders must be an object')
  const units = raw.units ?? {}
  const cities = raw.cities ?? {}
  if (!isObj(units)) fail('orders.units must be an object')
  if (!isObj(cities)) fail('orders.cities must be an object')
  const mine = (list: { id: number; owner: PlayerId }[]) => new Set(list.filter((x) => x.owner === seat).map((x) => String(x.id)))
  const myUnits = mine(state.units)
  const myCities = mine(state.cities)
  const orders: PlayerOrders = { units: {}, cities: {} }
  let dropped = 0
  for (const [id, v] of Object.entries(units)) {
    const order = unitOrder(v, state, id)
    if (myUnits.has(id)) orders.units[Number(id)] = order
    else dropped++
  }
  for (const [id, v] of Object.entries(cities)) {
    const item = buildItem(v, id)
    if (myCities.has(id)) orders.cities[Number(id)] = item
    else dropped++
  }
  if (raw.focus !== undefined) {
    if (!isObj(raw.focus)) fail('orders.focus must be an object')
    orders.focus = {}
    for (const [id, f] of Object.entries(raw.focus)) {
      if (typeof f !== 'string' || !FOCI.has(f as CityFocus)) fail(`orders.focus.${id} must be growth, production or balance`)
      if (myCities.has(id)) orders.focus[Number(id)] = f as CityFocus
      else dropped++
    }
  }
  return { orders, dropped }
}
