// What a player is allowed to see. Other players' plans are always hidden: their units' paths,
// founding flags and volley targets, and their cities' current construction and stores. Stances,
// buildings and city focus are visible.
// With fog of war (state.fog set): enemy units only on tiles in sight now; rival cities live while
// in sight, else as remembered; other seats' memories blanked. Without fog: everything on the board.
import { citySnapshot, exploredOf, markSight, visibility } from './vision.ts'
import type { City, CityId, GameEvent, GameState, PlayerId, TileId, Unit, UnitId } from './types.ts'

/** An enemy unit as a player sees it: no plans. */
function unitSnapshot(u: Unit): Unit {
  return { ...u, path: [], found: false, target: null }
}

export function observe(state: GameState, player: PlayerId): GameState {
  const own = (c: City) => ({ ...c, interior: { ...c.interior, plots: [...c.interior.plots] } })
  if (!state.fog) {
    return {
      ...state,
      players: state.players.map((p) => ({ ...p })),
      units: state.units.map((u) => (u.owner === player ? { ...u, path: [...u.path] } : unitSnapshot(u))),
      cities: state.cities.map((c) => (c.owner === player ? own(c) : citySnapshot(c))),
    }
  }
  const seen = visibility(state, player)
  const memory = state.fog[player]
  const live = new Set<CityId>()
  const cities: City[] = []
  for (const c of state.cities) {
    if (c.owner === player) cities.push(own(c))
    else if (seen[c.tile]) {
      cities.push(citySnapshot(c))
      live.add(c.id)
    }
  }
  // Remembered rival cities out of sight, as last seen (a city seen again is shown live instead).
  for (const m of memory?.cities ?? []) if (!live.has(m.id) && !seen[m.tile] && m.owner !== player) cities.push(citySnapshot(m))
  cities.sort((a, b) => a.id - b.id)
  return {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    units: state.units.flatMap((u) => (u.owner === player ? [{ ...u, path: [...u.path] }] : seen[u.tile] ? [unitSnapshot(u)] : [])),
    cities,
    fog: state.fog.map((m, i) =>
      i === player ? { explored: m.explored, cities: m.cities.map(citySnapshot), seen: { ...m.seen } } : { explored: '', cities: [], seen: {} },
    ),
  }
}

/**
 * One player's stream of a resolved turn: `prev` is the full state before it and `events` are
 * resolveTurn's full events. Without fog the events come back unchanged. With fog an event is kept
 * when one of its tiles is in sight at the start or end of its tick, or when it involves the player's
 * own unit or city (so an attacker that hits you is revealed). Added: `spotted` before an enemy unit
 * first shows up (or comes into sight), `lost` when it leaves sight, and `explore` with each tick's
 * newly seen tiles. A rival's failed construction stays hidden (it is a plan).
 */
export function observeEvents(prev: GameState, events: GameEvent[], player: PlayerId): GameEvent[] {
  if (!prev.fog) return events
  const { map } = prev
  const n = map.tiles.length
  const units = new Map<UnitId, Unit>(prev.units.map((u) => [u.id, { ...u }]))
  const cities = new Map<CityId, City>(prev.cities.map((c) => [c.id, { ...c }]))
  const sight = () => markSight({ map, units: [...units.values()], cities: [...cities.values()] }, player, new Uint8Array(n))
  const explored = exploredOf(prev, player)
  let before = sight()
  const known = new Set<UnitId>()
  for (const u of units.values()) if (u.owner !== player && before[u.tile]) known.add(u.id)
  const out: GameEvent[] = []

  for (let i = 0; i < events.length; ) {
    const t = events[i].t
    let j = i
    while (j < events.length && events[j].t === t) j++
    // Pass 1: play the tick on the reconstructed board, noting who and where each event touches.
    const notes = events.slice(i, j).map((e) => {
      const note = touched(e, units, cities, player)
      apply(e, units, cities)
      return note
    })
    const after = sight()
    // Pass 2: emit what the player can see, introducing enemy units the first time they appear.
    const shownDeath = new Set<UnitId>()
    events.slice(i, j).forEach((e, k) => {
      const { tiles, enemies, own } = notes[k]
      if (e.kind === 'buildFailed' && !own) return
      const visible = own || e.kind === 'eliminated' || e.kind === 'victory' || tiles.some((x) => before[x] || after[x])
      if (!visible) return
      for (const { unit } of enemies) {
        if (known.has(unit.id)) continue
        known.add(unit.id)
        out.push({ t, kind: 'spotted', unit: unitSnapshot(unit) })
      }
      if (e.kind === 'death') shownDeath.add(e.unit)
      out.push(e.kind === 'spawn' && e.unit.owner !== player ? { ...e, unit: unitSnapshot(e.unit) } : e)
    })
    // End of the tick: newly explored land, units that left sight, units that came into sight.
    const fresh: TileId[] = []
    for (let x = 0; x < n; x++) {
      if (after[x] && !explored[x]) {
        explored[x] = 1
        fresh.push(x)
      }
    }
    if (fresh.length) out.push({ t, kind: 'explore', tiles: fresh })
    for (const id of [...known]) {
      const u = units.get(id)
      if (u && after[u.tile]) continue
      known.delete(id)
      if (!shownDeath.has(id)) out.push({ t, kind: 'lost', unit: id, tile: u?.tile ?? lastTile(notes, id) })
    }
    for (const u of units.values()) {
      if (u.owner === player || !after[u.tile] || known.has(u.id)) continue
      known.add(u.id)
      out.push({ t, kind: 'spotted', unit: unitSnapshot(u) })
    }
    before = after
    i = j
  }
  return out
}

interface Note {
  tiles: TileId[]
  /** Enemy units involved, as they stood when it happened. */
  enemies: { unit: Unit }[]
  /** Involves the player's own unit or city. */
  own: boolean
}

function touched(e: GameEvent, units: Map<UnitId, Unit>, cities: Map<CityId, City>, player: PlayerId): Note {
  const note: Note = { tiles: [], enemies: [], own: false }
  const unit = (id: UnitId) => {
    const u = units.get(id)
    if (!u) return
    note.tiles.push(u.tile)
    if (u.owner === player) note.own = true
    else note.enemies.push({ unit: { ...u } })
  }
  const city = (id: CityId) => {
    const c = cities.get(id)
    if (!c) return
    note.tiles.push(c.tile)
    if (c.owner === player) note.own = true
  }
  const target = (x: { unit: UnitId } | { city: CityId }) => ('unit' in x ? unit(x.unit) : city(x.city))
  switch (e.kind) {
    case 'move':
      unit(e.unit)
      note.tiles.push(e.to)
      break
    case 'clash':
      unit(e.a)
      unit(e.b)
      if (e.tile !== null) note.tiles.push(e.tile)
      break
    case 'melee':
      unit(e.attacker)
      target(e.target)
      break
    case 'shot':
      target(e.from)
      target(e.target)
      break
    case 'halt':
    case 'heal':
    case 'foundFailed':
      unit(e.unit)
      break
    case 'death':
      unit(e.unit)
      note.tiles.push(e.tile)
      break
    case 'capture':
      city(e.city)
      unit(e.unit)
      if (e.from === player || e.to === player) note.own = true
      break
    case 'found':
      note.tiles.push(e.city.tile)
      if (e.city.owner === player) note.own = true
      break
    case 'spawn':
      note.tiles.push(e.unit.tile)
      if (e.unit.owner === player) note.own = true
      break
    case 'built':
    case 'buildFailed':
    case 'grow':
    case 'cityRepair':
      city(e.city)
      break
  }
  return note
}

function apply(e: GameEvent, units: Map<UnitId, Unit>, cities: Map<CityId, City>): void {
  switch (e.kind) {
    case 'move': {
      const u = units.get(e.unit)
      if (u) units.set(u.id, { ...u, tile: e.to })
      break
    }
    case 'death':
      units.delete(e.unit)
      break
    case 'spawn':
      units.set(e.unit.id, { ...e.unit })
      break
    case 'found':
      units.delete(e.unit)
      cities.set(e.city.id, { ...e.city })
      break
    case 'capture': {
      const c = cities.get(e.city)
      if (c) cities.set(c.id, { ...c, owner: e.to })
      break
    }
  }
}

function lastTile(notes: Note[], id: UnitId): TileId {
  for (let k = notes.length - 1; k >= 0; k--) {
    const hit = notes[k].enemies.find((x) => x.unit.id === id)
    if (hit) return hit.unit.tile
  }
  return -1
}

/** Points per city, citizen, building (a temple counts extra) and unit, used at the turn limit. */
export const SCORE = { city: 10, pop: 3, building: 1, temple: 3, unit: 1 }

/** Score per player: cities, citizens, buildings and units (used at the turn limit). */
export function scores(state: GameState): number[] {
  return state.players.map((p) => {
    let s = 0
    for (const c of state.cities) {
      if (c.owner !== p.id) continue
      s += SCORE.city + c.pop * SCORE.pop
      for (const b of c.interior.plots) if (b) s += SCORE.building + (b === 'temple' ? SCORE.temple : 0)
    }
    for (const u of state.units) if (u.owner === p.id) s += SCORE.unit
    return s
  })
}
