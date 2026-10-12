// Saved games are upgraded on load, one step per schema version, so a deploy that changes a saved
// shape (GameState, City, BuildItem, GameEvent, orders, or the record itself) never strands a game
// in progress. When you change one: bump SCHEMA_VERSION and add the step from the previous version.
import { BUILDINGS, PLOT_COUNT } from '../engine/city.ts'
import { capitalInterior, newCity } from '../engine/index.ts'
import type { City, CityInterior, GameState } from '../engine/types.ts'
import type { GameRecord, SeatRecord } from './types.ts'
import { asBuildItem, FOCI } from './validate.ts'

export const SCHEMA_VERSION = 2

type Old = any // a parsed record of some older shape: steps check what they read

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Each step takes a record at version `n` (the key) and returns it at version n + 1. */
const STEPS: Record<number, (rec: Old) => Old> = {
  // v2, 2026-10-12: cities have an interior (19 plots + focus) and 'walls' is no longer a build item.
  1(rec) {
    const state = rec.state
    for (const s of [rec.state, rec.previous]) if (isObj(s) && Array.isArray(s.cities)) s.cities = s.cities.map((c: Old) => cityV2(s, c))
    if (Array.isArray(rec.events)) {
      rec.events = rec.events
        .filter((e: Old) => !(e?.kind === 'built' && asBuildItem(e.item) === undefined))
        .map((e: Old) => (e?.kind === 'found' && isObj(state) ? { ...e, city: cityV2(state, e.city) } : e))
    }
    for (const o of Object.values<Old>(isObj(rec.orders) ? rec.orders : {})) {
      if (isObj(o?.cities)) for (const id of Object.keys(o.cities)) o.cities[id] = asBuildItem(o.cities[id]) ?? null
    }
    return rec
  },
}

/** The interior a fresh game gives the city (capitals: House and Farm or so; others: newCity's House),
 * unless it already has a valid one. */
function cityV2(state: Old, c: Old): City {
  const interior = validInterior(c?.interior) ??
    (c.capital ? capitalInterior(state.map, c.tile) : newCity({ ...state, nextId: 0 } as GameState, c.owner, c.tile).interior)
  return {
    id: c.id, owner: c.owner, name: c.name, tile: c.tile, pop: c.pop, food: c.food, prod: c.prod, hp: c.hp,
    walls: interior.plots.includes('wall'), build: asBuildItem(c.build) ?? null, capital: !!c.capital, founded: c.founded, interior,
  }
}

function validInterior(v: Old): CityInterior | undefined {
  if (!isObj(v) || !Array.isArray(v.plots) || v.plots.length !== PLOT_COUNT || !FOCI.has(v.focus)) return undefined
  if (!v.plots.every((p: unknown) => p === null || (typeof p === 'string' && Object.hasOwn(BUILDINGS, p)))) return undefined
  return { plots: [...v.plots], focus: v.focus }
}

const PHASES = new Set(['lobby', 'planning', 'finished'])
const SEAT_KINDS = new Set(['human', 'bot', 'open'])
const MAP_SIZES = new Set(['small', 'medium', 'large'])

function isState(s: Old): s is GameState {
  return isObj(s) && Number.isInteger(s.turn) && isObj(s.map) && Array.isArray(s.map.tiles) &&
    Array.isArray(s.players) && Array.isArray(s.units) && Array.isArray(s.cities)
}

/** The record with exactly the current fields (anything else is dropped), or an Error if it is unusable. */
function normalize(r: Old): GameRecord {
  const need = (ok: unknown, what: string) => {
    if (!ok) throw new Error(`bad ${what}`)
  }
  need(typeof r.id === 'string' && /^[a-z0-9]{1,32}$/.test(r.id), 'id')
  need(PHASES.has(r.phase), 'phase')
  need(Array.isArray(r.seats) && r.seats.length >= 2 && r.seats.length <= 4, 'seats')
  const seats: SeatRecord[] = r.seats.map((s: Old) => {
    need(SEAT_KINDS.has(s?.kind), 'seat kind')
    return { kind: s.kind, name: typeof s.name === 'string' ? s.name : null, tokenHash: typeof s.tokenHash === 'string' ? s.tokenHash : null }
  })
  const started = r.phase !== 'lobby'
  if (started) {
    need(isState(r.state) && r.state.players.length === seats.length, 'state')
    need(isObj(r.config), 'config')
    need(r.previous == null || isState(r.previous), 'previous')
  }
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  return {
    schemaVersion: SCHEMA_VERSION,
    id: r.id,
    name: typeof r.name === 'string' ? r.name : r.id,
    phase: r.phase,
    createdAt: num(r.createdAt, 0),
    updatedAt: num(r.updatedAt, 0),
    host: Number.isInteger(r.host) && r.host >= 0 && r.host < seats.length ? r.host : 0,
    seats,
    turnSeconds: typeof r.turnSeconds === 'number' && r.turnSeconds > 0 ? r.turnSeconds : null,
    mapSize: MAP_SIZES.has(r.mapSize) ? r.mapSize : null,
    seed: typeof r.seed === 'string' ? r.seed : null,
    config: started ? r.config : null,
    state: started ? r.state : null,
    previous: started ? (r.previous ?? null) : null,
    events: started && Array.isArray(r.events) ? r.events : [],
    orders: started && isObj(r.orders) ? r.orders : {},
    ready: seats.map((_, i) => r.ready?.[i] === true),
    deadline: r.phase === 'planning' && typeof r.deadline === 'number' ? r.deadline : null,
    log: Array.isArray(r.log) ? r.log : [],
  }
}

/**
 * Brings a parsed save up to SCHEMA_VERSION. Throws if it cannot: not a game, broken, or written by
 * a newer server (a rolled-back deploy must not touch games it does not understand).
 */
export function migrate(raw: unknown): { rec: GameRecord; from: number } {
  if (!isObj(raw)) throw new Error('not a game record')
  // Records from before schemaVersion existed carried `v: 1`.
  const from = raw.schemaVersion ?? (raw.v === 1 ? 1 : undefined)
  if (!Number.isInteger(from) || from < 1) throw new Error('no schema version')
  if (from > SCHEMA_VERSION) throw new Error(`schema v${from} is newer than this server's v${SCHEMA_VERSION}`)
  let rec: Old = structuredClone(raw)
  for (let v = from; v < SCHEMA_VERSION; v++) rec = STEPS[v](rec)
  return { rec: normalize(rec), from }
}
