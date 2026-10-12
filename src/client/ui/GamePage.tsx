import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { GameSession, type GameSnapshot } from '../net/session.ts'
import { PLAYERS } from '../render/palette.ts'
import { Icon } from './icons.tsx'
import { clearAutostart, isAutostart } from '../net/storage.ts'
import { Lobby } from './Lobby.tsx'

// The 3D play screen (three.js) is its own chunk, so the home page stays light on phones.
export const loadPlay = () => import('./play/Play.tsx')
const Play = lazy(() => loadPlay().then((m) => ({ default: m.Play })))
import { toast } from './toast.tsx'

export function GamePage({ gameId }: { gameId: string }) {
  const [session, setSession] = useState<GameSession | null>(null)
  useEffect(() => {
    const s = new GameSession(gameId)
    s.onError = (message) => toast(message, 'error')
    setSession(s)
    return () => s.dispose()
  }, [gameId])
  if (!session || session.gameId !== gameId) return <Waiting text="" />
  return <GameScreen session={session} />
}

function GameScreen({ session }: { session: GameSession }) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const started = !!snap.view && (!snap.summary || snap.summary.phase !== 'lobby')
  useEffect(() => {
    if (started) clearAutostart(session.gameId)
  }, [started, session.gameId])
  if (snap.missing) {
    return (
      <div className="center-screen">
        <h1 className="serif">Game not found</h1>
        <p className="muted">The link may be wrong, or the game has been removed.</p>
        <a className="btn btn-primary" href="#/">Home</a>
      </div>
    )
  }
  if (snap.fogHidden && snap.summary && !snap.view) return <FogHidden snap={snap} />
  // A game against bots starts the moment it is created: show the loader, not the lobby.
  const autostart = isAutostart(session.gameId)
  if (started) {
    return (
      <Suspense fallback={<Waiting text="Building the world…" />}>
        <Play session={session} snap={snap} />
      </Suspense>
    )
  }
  // The lobby is only for the lobby phase: once a game has started, its state follows the summary.
  if (snap.summary?.phase === 'lobby' && !autostart) return <Lobby session={session} snap={snap} />
  return <Waiting text={snap.status === 'open' ? 'Loading the game…' : 'Connecting…'} />
}

function Waiting({ text }: { text: string }) {
  return (
    <div className="center-screen">
      <span className="loader" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <p className="muted">{text}</p>
    </div>
  )
}

/** A fog-of-war game cannot be watched while it runs: show who is playing and how far it is. */
function FogHidden({ snap }: { snap: GameSnapshot }) {
  const g = snap.summary!
  const players = g.seats.filter((s) => s.kind !== 'open')
  return (
    <div className="center-screen fog-hidden">
      <span className="fog-hidden-icon" aria-hidden="true">
        <Icon name="cloud" size={30} />
      </span>
      <span className="label">Turn {g.turn}</span>
      <h1 className="serif">{g.name}</h1>
      <p className="muted">This game has fog of war, so it stays hidden while it is played. You can watch the whole game when it ends.</p>
      <ul className="fog-hidden-seats">
        {players.map((s) => (
          <li key={s.seat}>
            <span className="swatch" style={{ '--c': PLAYERS[s.seat]?.base } as CSSProperties} />
            {s.name ?? 'Bot'}
            {s.ready && <Icon name="check" size={14} />}
          </li>
        ))}
      </ul>
      <a className="btn btn-ghost" href="#/">Home</a>
    </div>
  )
}
