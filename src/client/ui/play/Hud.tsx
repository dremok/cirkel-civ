// Top bar (turn, phase, players) and the thumb-zone action bar.
import { useEffect, useState, type CSSProperties, type Ref } from 'react'
import type { GameSummary } from '../../../shared/protocol.ts'
import type { GameState, PlayerId } from '../../../engine/types.ts'
import { PLAYERS } from '../../render/palette.ts'
import { Icon } from '../icons.tsx'
import { listNames } from '../strings.ts'

export type Phase = 'planning' | 'waiting' | 'replay' | 'finished' | 'watching' | 'out'

const PHASE_LABEL: Record<Phase, string> = {
  planning: 'Planning',
  waiting: 'Waiting for others',
  replay: 'Replay',
  finished: 'Game over',
  watching: 'Watching',
  out: 'You are out',
}

function useCountdown(deadline: number | null): { text: string; urgent: boolean } | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadline) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [deadline])
  if (!deadline) return null
  const s = Math.max(0, Math.round((deadline - now) / 1000))
  if (s >= 3600) return { text: `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`, urgent: false }
  return { text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, urgent: s <= 15 }
}

export function TopBar({ ref, state, summary, me, phase, deadline, tick, offline, onMenu, onPlayers }: {
  ref?: Ref<HTMLElement>
  state: GameState
  summary: GameSummary | null
  me: PlayerId | null
  phase: Phase
  deadline: number | null
  tick: number | null
  offline: boolean
  onMenu: () => void
  onPlayers: () => void
}) {
  const left = useCountdown(phase === 'planning' || phase === 'waiting' || phase === 'watching' || phase === 'out' ? deadline : null)
  const turn = phase === 'replay' ? state.turn - 1 : state.turn
  return (
    <header className="topbar" ref={ref}>
      <div className="topbar-left glass">
        <button className="icon-btn" aria-label="Menu" onClick={onMenu}>
          <Icon name="menu" />
        </button>
        <div className="turn">
          <span className="turn-num serif num">
            Turn {Math.min(turn, state.maxTurns)}
            <span className="turn-of">/{state.maxTurns}</span>
          </span>
          <span className="turn-phase">
            {offline ? (
              <span className="offline"><Icon name="wifiOff" size={13} />Reconnecting…</span>
            ) : phase === 'replay' && tick ? (
              <>Replay · <TickDots tick={tick} /></>
            ) : (
              PHASE_LABEL[phase]
            )}
            {left && !offline && (
              <span className={`turn-timer num ${left.urgent ? 'is-urgent' : ''}`}>
                <Icon name="clock" size={13} />
                {left.text}
              </span>
            )}
          </span>
        </div>
        <span className="turn-progress" aria-hidden="true">
          <span style={{ width: `${(Math.min(turn, state.maxTurns) / state.maxTurns) * 100}%` }} />
        </span>
      </div>
      <button className="topbar-players glass" onClick={onPlayers} aria-label="Players and scores">
        {state.players.map((p) => {
          const seat = summary?.seats[p.id]
          const ready = seat?.ready && phase !== 'replay'
          return (
            <span
              key={p.id}
              className={`chip ${p.id === me ? 'is-me' : ''} ${!p.alive ? 'is-out' : ''} ${seat && !seat.connected && seat.kind === 'human' ? 'is-away' : ''}`}
              style={{ '--c': PLAYERS[p.color]?.base ?? PLAYERS[p.id].base } as CSSProperties}
              title={`${p.name}${ready ? ', ready' : ''}`}
            >
              <span className="chip-dot">{ready ? <Icon name="check" size={13} /> : null}</span>
              <span className="chip-name">{p.id === me ? 'You' : p.name}</span>
            </span>
          )
        })}
      </button>
    </header>
  )
}

function TickDots({ tick }: { tick: number }) {
  return (
    <span className="tick-dots" aria-label={`tick ${Math.min(tick, 6)} of 6`}>
      {[1, 2, 3, 4, 5, 6].map((t) => (
        <span key={t} className={t <= tick ? 'on' : ''} />
      ))}
    </span>
  )
}

export function ActionBar({ phase, idle, waitingFor, onNext, onReady, onUnready, onSkip, onResults, canNext }: {
  phase: Phase
  idle: number
  waitingFor: string[]
  canNext: boolean
  onNext: () => void
  onReady: () => void
  onUnready: () => void
  onSkip: () => void
  onResults: () => void
}) {
  if (phase === 'replay') {
    return (
      <div className="actionbar">
        <button className="btn btn-ghost glass-btn act-wide" onClick={onSkip}>
          <Icon name="skip" size={18} />
          Skip
        </button>
      </div>
    )
  }
  if (phase === 'finished') {
    return (
      <div className="actionbar">
        <button className="btn btn-primary act-ready" onClick={onResults}>
          <Icon name="crown" size={18} />
          Results
        </button>
      </div>
    )
  }
  if (phase === 'watching' || phase === 'out') {
    return (
      <div className="actionbar">
        <div className="act-note glass">
          <Icon name="eyeOpen" size={18} />
          {phase === 'out' ? 'You are out of the game, but you can keep watching.' : 'You are watching. Turns play out here as they resolve.'}
        </div>
      </div>
    )
  }
  if (phase === 'waiting') {
    return (
      <div className="actionbar">
        <div className="act-note glass">
          <span className="pulse" aria-hidden="true" />
          <span className="act-note-text">{waitingFor.length ? `Waiting for ${listNames(waitingFor)}` : 'Resolving the turn…'}</span>
        </div>
        <button className="btn btn-ghost glass-btn act-undo" onClick={onUnready}>
          <Icon name="undo" size={18} />
          Edit orders
        </button>
      </div>
    )
  }
  return (
    <div className="actionbar">
      <button className="btn btn-ghost glass-btn act-next" onClick={onNext} disabled={!canNext} title="Next unit (Tab)">
        <Icon name="next" size={18} />
        <span>Next unit</span>
        {idle > 0 && <span className="count num">{idle}</span>}
      </button>
      <button className="btn btn-primary act-ready" onClick={onReady} title="Ready (Enter)">
        <Icon name="check" size={19} />
        <span className="serif">Ready</span>
      </button>
    </div>
  )
}

