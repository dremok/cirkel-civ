// "What happened": a short, readable account of a resolved turn.
import type { City, GameEvent, GameState, PlayerId, Target, TileId, Unit, UnitId } from '../../../engine/types.ts'
import { possessive, unitNoun, withArticle } from '../strings.ts'
import { nearestCity } from './planning.ts'

export interface LogLine {
  key: string
  t: number
  /** Whose colour the bullet takes. */
  player: PlayerId | null
  text: string
  tone: 'good' | 'bad' | 'neutral'
  tile: TileId | null
  count?: number
}

const FOUND_FAILED: Record<string, string> = {
  tooClose: 'too close to another city',
  conflict: 'another settler tried to found too close at the same time',
}

export function describeTurn(prev: GameState, events: GameEvent[], next: GameState, me: PlayerId | null): LogLine[] {
  const units = new Map<UnitId, Unit>()
  for (const u of prev.units) units.set(u.id, u)
  for (const u of next.units) if (!units.has(u.id)) units.set(u.id, u)
  for (const e of events) if (e.kind === 'spawn') units.set(e.unit.id, e.unit)
  const cities = new Map<number, City>()
  for (const c of prev.cities) cities.set(c.id, c)
  for (const c of next.cities) if (!cities.has(c.id)) cities.set(c.id, c)
  for (const e of events) if (e.kind === 'found') cities.set(e.city.id, e.city)
  // End-of-turn events (growth, builds) happen after captures: use the city as it ended the turn.
  const after = (id: number) => next.cities.find((c) => c.id === id) ?? cities.get(id)

  const playerName = (p: PlayerId) => next.players[p]?.name ?? prev.players[p]?.name ?? `Player ${p + 1}`
  const owner = (p: PlayerId, capital: boolean) => (p === me ? (capital ? 'Your' : 'your') : possessive(playerName(p)))
  const unitName = (id: UnitId, capital = false) => {
    const u = units.get(id)
    if (!u) return capital ? 'A unit' : 'a unit'
    return `${owner(u.owner, capital)} ${unitNoun(u.type)}`
  }
  // Cities can change hands mid-turn: a city's volley at tick 7 belongs to whoever took it.
  const captures = events.filter((e): e is Extract<GameEvent, { kind: 'capture' }> => e.kind === 'capture')
  const cityOwnerAt = (id: number, t: number): PlayerId | null => {
    let owner = cities.get(id)?.owner ?? null
    for (const c of captures) if (c.city === id && c.t <= t) owner = c.to
    return owner
  }
  const targetName = (t: Target) => ('unit' in t ? unitName(t.unit) : cities.get(t.city)?.name ?? 'a city')
  const ownerOf = (t: Target, tick = 0): PlayerId | null => ('unit' in t ? units.get(t.unit)?.owner ?? null : cityOwnerAt(t.city, tick))
  const tileOf = (t: Target): TileId | null => ('unit' in t ? units.get(t.unit)?.tile ?? null : cities.get(t.city)?.tile ?? null)
  const at = (tile: TileId | null) => {
    if (tile === null) return ''
    const c = nearestCity(prev, tile) ?? nearestCity(next, tile)
    return c ? (c.tile === tile ? ` in ${c.name}` : ` near ${c.name}`) : ''
  }
  const tone = (good: boolean | null): LogLine['tone'] => (good === null ? 'neutral' : good ? 'good' : 'bad')
  const mine = (p: PlayerId | null | undefined) => (me === null || p == null ? null : p === me)
  /** Good if I acted, bad if it happened to me, neutral otherwise. */
  const side = (actor: PlayerId | null | undefined, victim: PlayerId | null | undefined) =>
    me === null ? null : actor === me ? true : victim === me ? false : null

  const moved = new Set<UnitId>()
  for (const e of events) if (e.kind === 'move') moved.add(e.unit)
  const halted = new Set<UnitId>()

  const lines: LogLine[] = []
  const add = (e: GameEvent, i: number, player: PlayerId | null, text: string, good: boolean | null, tile: TileId | null) =>
    lines.push({ key: `${i}`, t: e.t, player, text, tone: tone(good), tile })

  events.forEach((e, i) => {
    switch (e.kind) {
      case 'clash': {
        const a = units.get(e.a)
        const b = units.get(e.b)
        const tile = e.tile ?? a?.tile ?? null
        const aOwn = a ? (a.owner === me ? 'Yours' : possessive(playerName(a.owner))) : 'One'
        const bOwn = b ? (b.owner === me ? 'yours' : possessive(playerName(b.owner))) : 'the other'
        const good = a?.owner === me ? e.dmgA <= e.dmgB : b?.owner === me ? e.dmgB <= e.dmgA : null
        add(e, i, a?.owner ?? null, `${unitName(e.a, true)} and ${unitName(e.b)} clashed${at(tile)}. ${aOwn} took ${e.dmgA} damage, ${bOwn} ${e.dmgB}.`, good, tile)
        return
      }
      case 'melee': {
        const att = units.get(e.attacker)
        const tile = tileOf(e.target)
        const back = e.dmgToAttacker > 0 ? `, taking ${e.dmgToAttacker} in return` : ''
        add(e, i, att?.owner ?? null, `${unitName(e.attacker, true)} attacked ${targetName(e.target)}${at(tile)} and dealt ${e.dmgToTarget} damage${back}.`, side(att?.owner, ownerOf(e.target, e.t - 1)), tile)
        return
      }
      case 'shot': {
        const from = 'unit' in e.from ? unitName(e.from.unit, true) : cities.get(e.from.city)?.name ?? 'A city'
        const shooter = ownerOf(e.from, e.t)
        add(e, i, shooter, `${from} shot at ${targetName(e.target)}: ${e.dmg} damage.`, side(shooter, ownerOf(e.target, e.t)), tileOf(e.target))
        return
      }
      case 'death': {
        const u = units.get(e.unit)
        add(e, i, u?.owner ?? null, `${unitName(e.unit, true)} fell${at(e.tile)}.`, mine(u?.owner) === null ? null : !mine(u?.owner), e.tile)
        return
      }
      case 'capture': {
        const c = cities.get(e.city)
        const name = c?.name ?? 'a city'
        const text =
          e.to === me ? `You captured ${name}!` : e.from === me ? `${playerName(e.to)} captured ${name}.` : `${playerName(e.to)} captured ${name} from ${playerName(e.from)}.`
        add(e, i, e.to, text, e.to === me ? true : e.from === me ? false : null, c?.tile ?? null)
        return
      }
      case 'found': {
        const text = e.city.owner === me ? `You founded ${e.city.name}.` : `${playerName(e.city.owner)} founded ${e.city.name}.`
        add(e, i, e.city.owner, text, mine(e.city.owner) ? true : null, e.city.tile)
        return
      }
      case 'foundFailed': {
        const u = units.get(e.unit)
        if (u?.owner !== me) return
        const why = FOUND_FAILED[e.reason] ?? e.reason
        add(e, i, u.owner, `Your settler could not found a city${why ? `: ${why}` : ''}.`, false, u.tile)
        return
      }
      case 'spawn': {
        if (e.unit.owner !== me) return
        const c = after(e.city)
        add(e, i, me, `${c?.name ?? 'Your city'} trained ${withArticle(unitNoun(e.unit.type))}.`, true, e.unit.tile)
        return
      }
      case 'built': {
        if (e.item !== 'walls') return
        const c = after(e.city)
        if (!c) return
        add(e, i, c.owner, `${c.name} built walls.`, mine(c.owner) ? true : null, c.tile)
        return
      }
      case 'grow': {
        const c = after(e.city)
        if (!c || c.owner !== me) return
        add(e, i, me, `${c.name} grew to ${e.pop} citizens.`, true, c.tile)
        return
      }
      case 'halt': {
        const u = units.get(e.unit)
        if (u?.owner !== me || e.reason === 'engaged' || halted.has(e.unit)) return
        // A blocked step only matters if the unit never got going this turn.
        if (e.reason === 'blocked' && moved.has(e.unit)) return
        halted.add(e.unit)
        const text = e.reason === 'contact' ? `${unitName(e.unit, true)} stopped on contact with the enemy.` : `${unitName(e.unit, true)} stood still: its path was blocked.`
        add(e, i, me, text, null, u.tile)
        return
      }
      case 'eliminated':
        add(e, i, e.player, e.player === me ? 'You are out of the game.' : `${playerName(e.player)} is out of the game.`, e.player === me ? false : null, null)
        return
      case 'victory':
        add(
          e, i, e.winner === 'draw' ? null : e.winner,
          e.winner === 'draw' ? 'The game ended in a draw.' : e.winner === me ? 'You won!' : `${playerName(e.winner)} won.`,
          e.winner === 'draw' ? null : e.winner === me, null,
        )
        return
      default:
        return
    }
  })

  // The same sentence several times (three archers shooting the same unit) becomes one line.
  const merged: LogLine[] = []
  for (const l of lines) {
    const twin = merged.find((m) => m.text === l.text || m.text.startsWith(`${l.text} (`))
    if (twin) {
      const n = (twin.count ?? 1) + 1
      twin.count = n
      twin.text = `${l.text} (×${n})`
    } else merged.push({ ...l })
  }
  return merged
}

/** "Tick 3", or the end-of-turn phases. */
export function tickLabel(t: number): string {
  if (t <= 6) return `Tick ${t}`
  return t === 7 ? 'Volleys' : 'End of turn'
}
