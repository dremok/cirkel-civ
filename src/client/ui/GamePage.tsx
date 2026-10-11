import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { GameSession } from '../net/session.ts'
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
  if (snap.missing) {
    return (
      <div className="center-screen">
        <h1 className="serif">Game not found</h1>
        <p className="muted">The link may be wrong, or the game has been removed.</p>
        <a className="btn btn-primary" href="#/">Home</a>
      </div>
    )
  }
  const started = snap.view && (!snap.summary || snap.summary.phase !== 'lobby')
  if (started) {
    return (
      <Suspense fallback={<Waiting text="Building the world…" />}>
        <Play session={session} snap={snap} />
      </Suspense>
    )
  }
  if (snap.summary) return <Lobby session={session} snap={snap} />
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
