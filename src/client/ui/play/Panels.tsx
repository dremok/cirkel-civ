// Bottom-sheet panels for the selected unit, city or tile.
import type { CSSProperties, ReactNode } from 'react'
import { BUILD_COST, CITY_MAX_HP, TILE_YIELD, UNIT_MAX_HP, UNITS } from '../../../engine/index.ts'
import type { BuildItem, City, GameState, PlayerId, Stance, TileId, Unit } from '../../../engine/types.ts'
import { PLAYERS } from '../../render/palette.ts'
import { BUILD_ICON, Icon, STANCE_ICON } from '../icons.tsx'
import {
  ARCHER_HOLD_HINT, BIOME_NAME, BUILD_NAME, BUILD_SHORT, possessive, STANCE_HINT, STANCE_NAME, tapVerb, turnsWord, UNIT_NAME, unitNoun,
} from '../strings.ts'
import { inRange, unitRange } from '../../../engine/combat.ts'
import type { CityEconomy } from './economy.ts'
import { cityBuild, foundingCheck, isEnemyAt, planKind, planSteps, unitAt, unitOrder, type Draft } from './planning.ts'

const STANCES: Stance[] = ['cautious', 'aggressive', 'hold']
const BUILDS: BuildItem[] = ['spear', 'archer', 'rider', 'settler', 'walls']

const colorVars = (p: PlayerId | null | undefined): CSSProperties =>
  p == null ? {} : ({ '--c': PLAYERS[p]?.base, '--c-light': PLAYERS[p]?.light, '--c-dark': PLAYERS[p]?.dark } as CSSProperties)

function PanelHead({ icon, owner, title, sub, right, onClose }: { icon: ReactNode; owner: PlayerId | null; title: ReactNode; sub: ReactNode; right?: ReactNode; onClose: () => void }) {
  return (
    <div className="panel-head">
      <span className="panel-badge" style={colorVars(owner)}>{icon}</span>
      <div className="panel-title">
        <h3 className="serif">{title}</h3>
        <div className="panel-sub">{sub}</div>
      </div>
      {right}
      <button className="icon-btn panel-close" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}

export function Pips({ value, max, label }: { value: number; max: number; label: string }) {
  const n = Math.min(max, 10)
  const per = max / n
  const low = value / max <= 0.3
  return (
    <div className={`pips ${low ? 'is-low' : ''}`} aria-label={`${label} ${value} of ${max}`}>
      <span className="pips-row" aria-hidden="true">
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={value >= (i + 1) * per - 1e-6 ? 'on' : value > i * per ? 'half' : ''} />
        ))}
      </span>
      <span className="pips-num num">
        {value}
        <span className="muted">/{max}</span>
      </span>
    </div>
  )
}

function tileText(state: GameState, tile: TileId): string {
  const t = state.map.tiles[tile]
  return `${BIOME_NAME[t.biome]} · height ${t.height}`
}

function statsText(u: Unit): string {
  const s = UNITS[u.type]
  if (u.type === 'settler') return `Speed ${s.speed} · Founds a city`
  const parts = [`Speed ${s.speed}`, `Attack ${s.attack}`, `Defense ${s.defense}`]
  if (s.ranged) parts.push(`Ranged ${s.ranged}, range ${s.range}`)
  if (s.bonusVs?.rider) parts.push('Double vs riders')
  return parts.join(' · ')
}

function arrival(turn: number, tick: number): string {
  if (turn === 0) return `tick ${tick}`
  if (turn === 1) return `next turn, tick ${tick}`
  return `in ${turnsWord(turn)}`
}

/** One line saying what the unit is going to do. */
function orderLine(state: GameState, draft: Draft, me: PlayerId, u: Unit): { icon: Parameters<typeof Icon>[0]['name']; text: string } {
  const o = unitOrder(draft, u)
  const target = o.target != null ? targetName(state, me, o.target) : null
  // The volley is fired from wherever the archer ends this turn.
  const from = planSteps(state, u.id, o.path).filter((st) => st.turn === 0).at(-1)?.tile ?? u.tile
  const range = o.target != null && !inRange(state.map, from, o.target, unitRange(u)) ? ' (out of range)' : ''
  if (o.found) {
    const { tooClose } = foundingCheck(state, draft, u)
    if (tooClose) return { icon: 'flag', text: `Too close to ${tooClose.name} to found a city` }
    if (!o.path.length) return { icon: 'flag', text: 'Founds a city here at the end of the turn' }
    const steps = planSteps(state, u.id, o.path)
    const last = steps[steps.length - 1]
    return { icon: 'flag', text: last.turn === 0 ? 'Moves, then founds a city at the end of the turn' : `Founds a city, arriving ${arrival(last.turn, last.tick)}` }
  }
  if (o.path.length) {
    const steps = planSteps(state, u.id, o.path)
    const last = steps[steps.length - 1]
    const kind = planKind(state, me, o)
    const volley = target ? ` · volley at ${target}${range}` : ''
    if (kind === 'attack') return { icon: 'swords', text: `Attacks ${targetName(state, me, last.tile) ?? 'the enemy'}, ${arrival(last.turn, last.tick)}${volley}` }
    const n = o.path.length
    return { icon: 'arrowRight', text: `Moves ${n === 1 ? '1 step' : `${n} steps`}, arriving ${arrival(last.turn, last.tick)}${volley}` }
  }
  if (target) return { icon: 'target', text: `Volley at ${target}${range}` }
  if (o.stance === 'hold') return { icon: 'shield', text: u.type === 'archer' ? 'Holding and keeping watch' : 'Holding its ground' }
  const v = tapVerb()
  if (u.type === 'archer') return { icon: 'minus', text: `No orders. ${v} a tile to move, or an enemy to shoot at.` }
  return { icon: 'minus', text: `No orders. ${v} a tile to move there.` }
}

function targetName(state: GameState, me: PlayerId, tile: TileId): string | null {
  const u = unitAt(state, tile)
  if (u) return `${u.owner === me ? 'your' : possessive(state.players[u.owner]?.name ?? '?')} ${unitNoun(u.type)}`
  const c = state.cities.find((x) => x.tile === tile)
  if (c) return c.name
  return isEnemyAt(state, me, tile) ? 'the enemy' : null
}

export interface UnitActions {
  setStance(s: Stance): void
  toggleFound(): void
  clear(): void
  clearTarget(): void
}

export function UnitPanel({ state, draft, me, unit, editable, hint, actions, onClose }: {
  state: GameState
  draft: Draft
  me: PlayerId | null
  unit: Unit
  editable: boolean
  hint: { text: string; kind: 'confirm' | 'preview' | 'warn' } | null
  actions: UnitActions
  onClose: () => void
}) {
  const mine = me !== null && unit.owner === me
  const owner = state.players[unit.owner]
  const o = unitOrder(draft, unit)
  const line = mine ? orderLine(state, draft, me, unit) : null
  const hasOrders = o.path.length > 0 || !!o.found || o.target != null
  return (
    <section className="panel glass" aria-label={UNIT_NAME[unit.type]}>
      <PanelHead
        icon={<Icon name={BUILD_ICON[unit.type]} size={22} />}
        owner={unit.owner}
        title={UNIT_NAME[unit.type]}
        sub={mine ? tileText(state, unit.tile) : `${owner?.name ?? 'Unknown'} · ${tileText(state, unit.tile)}`}
        right={<Pips value={unit.hp} max={UNIT_MAX_HP} label="Health" />}
        onClose={onClose}
      />
      <p className="panel-stats num">{statsText(unit)}</p>

      {line && (
        <div className={`order-line ${hint ? `is-${hint.kind}` : ''}`} aria-live="polite">
          <Icon name={hint ? (hint.kind === 'confirm' ? 'check' : hint.kind === 'warn' ? 'close' : 'arrowRight') : line.icon} size={16} />
          <span className="order-text">{hint?.text ?? line.text}</span>
          {!hint && hasOrders && editable && (
            <button className="order-clear" onClick={actions.clear} aria-label="Clear orders" title="Clear orders">
              <Icon name="undo" size={16} />
              <span>Clear</span>
            </button>
          )}
        </div>
      )}

      {mine && editable ? (
        <>
          <div className="seg stance-seg" role="group" aria-label="Stance">
            {STANCES.map((s, i) => (
              <button key={s} aria-pressed={o.stance === s} onClick={() => actions.setStance(s)} title={`${STANCE_NAME[s]} (${i + 1})`}>
                <Icon name={STANCE_ICON[s]} size={17} />
                {STANCE_NAME[s]}
              </button>
            ))}
          </div>
          <p className="stance-hint">{o.stance === 'hold' && unit.type === 'archer' ? ARCHER_HOLD_HINT : STANCE_HINT[o.stance]}</p>

          {(unit.type === 'settler' || (o.target != null && o.path.length > 0)) && (
            <div className="panel-actions">
              {unit.type === 'settler' && (
                <button className={`btn btn-sm ${o.found ? 'btn-primary' : 'btn-ghost'}`} onClick={actions.toggleFound} aria-pressed={!!o.found}>
                  <Icon name="flag" size={17} />
                  {o.found ? 'Founding city' : o.path.length ? 'Found at destination' : 'Found city here'}
                </button>
              )}
              {o.target != null && o.path.length > 0 && (
                <button className="btn btn-sm btn-ghost" onClick={actions.clearTarget}>
                  <Icon name="target" size={17} />
                  No volley
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="stance-hint">
          <Icon name={STANCE_ICON[unit.stance]} size={15} />
          {STANCE_NAME[unit.stance]}
          {mine && !editable ? ` · You are ready. ${tapVerb()} Edit orders to change.` : ''}
        </p>
      )}
    </section>
  )
}

export function CityPanel({ state, draft, me, city, editable, economy, onBuild, onEnter, onClose }: {
  state: GameState
  draft: Draft
  me: PlayerId | null
  city: City
  editable: boolean
  economy: CityEconomy | null
  onBuild: (item: BuildItem) => void
  onEnter: () => void
  onClose: () => void
}) {
  const mine = me !== null && city.owner === me
  const owner = state.players[city.owner]
  const build = cityBuild(draft, city)
  const garrison = unitAt(state, city.tile)
  const turnsFor = (item: BuildItem) => {
    if (!economy || economy.prod <= 0) return null
    // Stored production carries over to whatever is built next.
    return Math.max(1, Math.ceil((BUILD_COST[item] - city.prod) / economy.prod))
  }
  const sub = [
    city.capital ? 'Capital' : null,
    mine ? null : owner?.name,
    city.pop === 1 ? '1 citizen' : `${city.pop} citizens`,
  ].filter(Boolean).join(' · ')
  return (
    <section className="panel glass" aria-label={city.name}>
      <PanelHead
        icon={<Icon name={city.capital ? 'tower' : 'city'} size={22} />}
        owner={city.owner}
        title={city.name}
        sub={sub}
        right={<Pips value={city.hp} max={CITY_MAX_HP} label="Health" />}
        onClose={onClose}
      />
      <div className="city-stats num">
        {economy && (
          <>
            <span><Icon name="food" size={16} />{economy.food >= 0 ? '+' : ''}{economy.food} food</span>
            <span><Icon name="prod" size={16} />+{economy.prod} production</span>
          </>
        )}
        <span className={city.walls ? '' : 'muted'}><Icon name="walls" size={16} />{city.walls ? 'Walls' : 'No walls'}</span>
        {garrison && <span><Icon name="shield" size={16} />{garrison.owner === city.owner ? 'Garrison' : 'Occupied'}</span>}
      </div>
      {economy?.growIn != null && mine && <p className="panel-stats">{economy.growIn <= 1 ? 'Grows next turn' : `Grows in ${turnsWord(economy.growIn)}`}</p>}

      {mine && (
        <>
          <button className="btn btn-sm btn-ghost enter-city" onClick={onEnter}>
            <Icon name="city" size={18} />
            <span>Enter city</span>
            <Icon name="arrowRight" size={16} />
          </button>
          <div className="build-now">
            <div className="build-now-row">
              <span className="label">Building</span>
              <span className="build-now-name serif">{build ? BUILD_NAME[build] : 'Nothing'}</span>
              <span className="build-now-eta num muted">
                {build ? `${Math.min(city.prod, BUILD_COST[build])}/${BUILD_COST[build]}${turnsFor(build) ? ` · ${turnsWord(turnsFor(build)!)}` : ''}` : 'Choose below'}
              </span>
            </div>
            <div className="bar" aria-hidden="true">
              <span style={{ width: build ? `${Math.min(100, (city.prod / BUILD_COST[build]) * 100)}%` : '0%' }} />
            </div>
          </div>
          <div className="build-grid" role="group" aria-label="Build">
            {BUILDS.map((item) => {
              const done = item === 'walls' && city.walls
              const t = turnsFor(item)
              return (
                <button key={item} className="build-opt" aria-pressed={build === item} disabled={!editable || done} onClick={() => onBuild(item)}>
                  <Icon name={BUILD_ICON[item]} size={22} />
                  <span className="build-opt-name">{BUILD_SHORT[item]}</span>
                  <span className="build-opt-cost num">{done ? 'Built' : t ? turnsWord(t) : BUILD_COST[item]}</span>
                </button>
              )
            })}
          </div>
          {build === 'settler' && <p className="stance-hint">A settler costs one citizen.</p>}
        </>
      )}
    </section>
  )
}

export function TilePanel({ state, tile, onClose }: { state: GameState; tile: TileId; onClose: () => void }) {
  const t = state.map.tiles[tile]
  const y = TILE_YIELD[t.biome]
  const notes: string[] = []
  if (t.biome === 'forest') notes.push('+25% defense')
  if (t.biome === 'forest' || t.biome === 'hills') notes.push('slow to enter')
  if (t.biome === 'mountain' || t.biome === 'snow') notes.push('impassable')
  if (t.biome === 'deep' || t.biome === 'shallow') notes.push('water')
  return (
    <section className="panel glass panel-compact" aria-label={BIOME_NAME[t.biome]}>
      <PanelHead
        icon={<Icon name="eye" size={20} />}
        owner={null}
        title={BIOME_NAME[t.biome]}
        sub={`Height ${t.height}${notes.length ? ` · ${notes.join(', ')}` : ''}`}
        onClose={onClose}
      />
      <div className="city-stats num">
        <span><Icon name="food" size={16} />{y.food} food</span>
        <span><Icon name="prod" size={16} />{y.prod} production</span>
      </div>
    </section>
  )
}
