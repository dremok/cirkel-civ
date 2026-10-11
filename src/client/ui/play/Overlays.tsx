// The turn log, the end screen, the menu and the score sheet.
import type { CSSProperties } from 'react'
import { scores } from '../../../engine/index.ts'
import type { GameState, PlayerId, TileId } from '../../../engine/types.ts'
import { PLAYERS } from '../../render/palette.ts'
import { Icon } from '../icons.tsx'
import { Sheet } from '../Sheet.tsx'
import type { LogLine } from './log.ts'
import { tickLabel } from './log.ts'

const dot = (p: PlayerId | null) => ({ '--c': p === null ? 'var(--faint)' : PLAYERS[p]?.base } as CSSProperties)

export function ReplayPanel({ turn, lines, playing, tick, onReplay, onClose, onFocus }: {
  turn: number
  lines: LogLine[]
  playing: boolean
  tick: number | null
  onReplay: () => void
  onClose: () => void
  onFocus: (tile: TileId) => void
}) {
  // While playing, only show what has happened so far.
  const shown = playing && tick !== null ? lines.filter((l) => l.t <= tick) : lines
  return (
    <section className="panel glass replay-panel" aria-label={`Turn ${turn}`}>
      <div className="panel-head">
        <div className="panel-title">
          <span className="label">{playing ? (tick ? tickLabel(tick) : 'Replay') : 'What happened'}</span>
          <h3 className="serif">Turn {turn}</h3>
        </div>
        {!playing && (
          <button className="btn btn-sm btn-ghost" onClick={onReplay}>
            <Icon name="replay" size={17} />
            Watch again
          </button>
        )}
        {!playing && (
          <button className="icon-btn panel-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        )}
      </div>
      {lines.length === 0 ? (
        <p className="log-empty muted">{playing ? 'Units on the move…' : 'No fighting this turn. Everything went to plan.'}</p>
      ) : (
        <ol className="log">
          {shown.map((l) => (
            <li key={l.key} className={`log-line tone-${l.tone}`}>
              <button disabled={l.tile === null} onClick={() => l.tile !== null && onFocus(l.tile)}>
                <span className="log-dot" style={dot(l.player)} />
                <span className="log-text">{l.text}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function EndScreen({ state, me, onClose, onRematch }: { state: GameState; me: PlayerId | null; onClose: () => void; onRematch: () => void }) {
  const sc = scores(state)
  const rows = state.players
    .map((p) => ({
      p,
      score: sc[p.id] ?? 0,
      cities: state.cities.filter((c) => c.owner === p.id).length,
      pop: state.cities.filter((c) => c.owner === p.id).reduce((s, c) => s + c.pop, 0),
      units: state.units.filter((u) => u.owner === p.id).length,
    }))
    .sort((a, b) => (a.p.id === state.winner ? -1 : b.p.id === state.winner ? 1 : b.score - a.score))
  const w = state.winner
  const title = w === 'draw' ? 'Draw' : w === me ? 'Victory' : w === null ? 'Standings' : `${state.players[w]?.name ?? '?'} wins`
  const conquest = w !== null && w !== 'draw' && state.cities.every((c) => c.owner === w)
  const sub =
    w === 'draw'
      ? 'Neck and neck to the very last turn.'
      : w === me
        ? conquest ? 'Every city is yours.' : 'The highest score when time ran out.'
        : me !== null && !state.players[me]?.alive
          ? 'All your cities fell. Better luck next time.'
          : conquest ? `${state.players[w as number]?.name ?? '?'} took every city.` : `After ${Math.min(state.turn - 1, state.maxTurns)} turns.`
  return (
    <Sheet title={<span className="end-title">{title}</span>} onClose={onClose} className="end-sheet">
      <p className="end-sub serif">{sub}</p>
      <table className="score-table num">
        <thead>
          <tr>
            <th />
            <th>Cities</th>
            <th>Citizens</th>
            <th>Units</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, score, cities, pop, units }) => (
            <tr key={p.id} className={p.id === w ? 'is-winner' : ''}>
              <th>
                <span className="score-who">
                  <span className="swatch" style={{ '--c': PLAYERS[p.color]?.base } as CSSProperties} />
                  {p.id === me ? 'You' : p.name}
                  {p.id === w && <Icon name="crown" size={15} />}
                </span>
              </th>
              <td>{cities}</td>
              <td>{pop}</td>
              <td>{units}</td>
              <td className="serif">{score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="score-note muted">Score: 10 per city, 3 per citizen and 1 per unit.</p>
      <div className="help-actions">
        <button className="btn btn-primary" onClick={onRematch}>Play again vs bot</button>
        <button className="btn btn-ghost" onClick={onClose}>View the map</button>
      </div>
    </Sheet>
  )
}

export function ScoreSheet({ state, me, onClose }: { state: GameState; me: PlayerId | null; onClose: () => void }) {
  const sc = scores(state)
  return (
    <Sheet title="Standings" onClose={onClose}>
      <table className="score-table num">
        <thead>
          <tr>
            <th />
            <th>Cities</th>
            <th>Citizens</th>
            <th>Units</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {state.players.map((p) => (
            <tr key={p.id} className={p.alive ? '' : 'is-out'}>
              <th>
                <span className="score-who">
                  <span className="swatch" style={{ '--c': PLAYERS[p.color]?.base } as CSSProperties} />
                  {p.id === me ? 'You' : p.name}
                  {p.kind === 'bot' && <Icon name="bot" size={15} />}
                </span>
              </th>
              <td>{state.cities.filter((c) => c.owner === p.id).length}</td>
              <td>{state.cities.filter((c) => c.owner === p.id).reduce((s, c) => s + c.pop, 0)}</td>
              <td>{state.units.filter((u) => u.owner === p.id).length}</td>
              <td className="serif">{sc[p.id]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="score-note muted">
        Take every rival city to win outright. Otherwise the highest score after {state.maxTurns} turns wins.
      </p>
    </Sheet>
  )
}

export function MenuSheet({ onClose, onHelp, onShare, onReplayLast, canReplay }: {
  onClose: () => void
  onHelp: () => void
  onShare: () => void
  onReplayLast: () => void
  canReplay: boolean
}) {
  return (
    <Sheet title="Menu" onClose={onClose}>
      <nav className="menu-list">
        <button onClick={onHelp}><Icon name="help" />How to play</button>
        {canReplay && <button onClick={onReplayLast}><Icon name="replay" />Replay last turn</button>}
        <button onClick={onShare}><Icon name="share" />Invite or share</button>
        <a href="#/rules" onClick={onClose}><Icon name="book" />Rules</a>
        <a href="#/spec" onClick={onClose}><Icon name="book" />Spec</a>
        <a href="#/" onClick={onClose}><Icon name="home" />Home</a>
      </nav>
      <p className="menu-keys muted">
        Keyboard: <kbd>Enter</kbd> ready, <kbd>Tab</kbd> next unit, <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> stance, <kbd>Esc</kbd> deselect,
        {' '}<kbd>Space</kbd> skip the replay.
      </p>
    </Sheet>
  )
}
