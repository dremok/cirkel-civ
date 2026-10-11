import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { CreateOptions, GameSummary, ServerMessage } from '../../shared/protocol.ts'
import { connection } from '../net/connection.ts'
import { errorText } from '../net/errors.ts'
import { getName, getSeatToken, setName as storeName, setSeatToken } from '../net/storage.ts'
import { PLAYERS } from '../render/palette.ts'
import { Emblem } from './Emblem.tsx'
import { loadPlay } from './GamePage.tsx'
import { Icon } from './icons.tsx'
import { NewGameSheet } from './NewGameSheet.tsx'
import { HelpSheet } from './HelpSheet.tsx'
import { gameHash, go } from './route.ts'
import { possessive } from './strings.ts'
import { toast } from './toast.tsx'

type Pending = { bot: boolean } | null

export function Home() {
  const [name, setName] = useState(getName)
  const [games, setGames] = useState<GameSummary[] | null>(null)
  const [sheet, setSheet] = useState<'new' | 'help' | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const pendingRef = useRef<Pending>(null)
  pendingRef.current = pending
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const conn = connection()
    conn.setHello(() => [{ type: 'list' }])
    const off = conn.subscribe((m: ServerMessage) => {
      if (m.type === 'games') setGames(m.games)
      if (m.type === 'joined' && pendingRef.current) {
        setSeatToken(m.gameId, { token: m.token, seat: m.seat })
        if (pendingRef.current.bot) conn.send({ type: 'start' })
        setPending(null)
        go(gameHash(m.gameId))
      }
      if (m.type === 'error' && pendingRef.current) {
        setPending(null)
        toast(errorText(m) ?? 'Could not create the game.', 'error')
      }
    })
    // The server pushes list changes; the poll is only a safety net.
    const timer = setInterval(() => conn.send({ type: 'list' }), 20000)
    // Fetch the play screen in the background, so starting a game is instant.
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1200))
    idle(() => void loadPlay())
    const slowTimer = setTimeout(() => setSlow(true), 2500)
    return () => {
      off()
      clearInterval(timer)
      clearTimeout(slowTimer)
      conn.setHello(null)
    }
  }, [])

  const playerName = () => {
    const n = name.trim()
    storeName(n)
    return n
  }

  const create = (options: CreateOptions, bot: boolean) => {
    setPending({ bot })
    connection().send({ type: 'create', options, playerName: playerName() || 'Player' })
  }
  // The create request waits in the queue while offline; do not leave the button hanging forever.
  useEffect(() => {
    if (!pending) return
    const id = setTimeout(() => {
      setPending(null)
      toast('The server is not responding. Try again in a moment.', 'error')
    }, 12000)
    return () => clearTimeout(id)
  }, [pending])

  const playBot = () => {
    const n = playerName() || 'Player'
    create({ name: `${n} vs bot`, seats: 2, bots: 1, mapSize: 'small', turnSeconds: null }, true)
  }

  const mine = (games ?? []).filter((g) => getSeatToken(g.id))
  const open = (games ?? []).filter((g) => !getSeatToken(g.id) && g.phase === 'lobby' && g.seats.some((s) => s.kind === 'open'))
  // Someone else's game against bots is not much to watch; games between friends are.
  const live = (games ?? []).filter((g) => !getSeatToken(g.id) && g.phase === 'planning' && g.seats.filter((s) => s.kind === 'human').length >= 2)

  return (
    <div className="home">
      <header className="home-hero">
        <Emblem className="home-emblem" />
        <h1 className="home-title serif">Cirkel-Civ</h1>
        <p className="home-tag serif">Everyone plans at once. Everything happens at once.</p>
      </header>

      <div className="home-side">
      <section className="home-card">
        <label className="field">
          <span className="label">Your name</span>
          <input
            className="input"
            value={name}
            maxLength={24}
            placeholder="What should we call you?"
            autoComplete="nickname"
            enterKeyHint="go"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => storeName(name)}
            onKeyDown={(e) => e.key === 'Enter' && playBot()}
          />
        </label>
        <div className="home-actions">
          <button className="btn btn-primary btn-block" disabled={!!pending} onClick={playBot}>
            {pending?.bot ? 'Building the world…' : 'Play vs bot'}
          </button>
          <button
            className="btn btn-ghost btn-block"
            disabled={!!pending}
            onClick={() => {
              if (!name.trim()) {
                toast('Enter your name first, so the others know who you are.')
                document.querySelector<HTMLInputElement>('.home-card input')?.focus()
                return
              }
              setSheet('new')
            }}
          >
            {pending && !pending.bot ? 'Creating the game…' : 'New online game'}
          </button>
        </div>
      </section>

      <section className="home-games">
        {games === null ? (
          <p className="home-empty muted">{slow ? 'Connecting to the server…' : ' '}</p>
        ) : mine.length + open.length + live.length === 0 ? (
          <p className="home-empty muted">No games right now. Start one and send the link to your friends.</p>
        ) : (
          <>
            <GameList title="Your games" games={mine} action={(g) => (g.phase === 'finished' ? 'Results' : 'Continue')} />
            <GameList title="Open games" games={open} action={() => 'Join'} />
            <GameList title="In progress" games={live} action={() => 'Watch'} />
          </>
        )}
      </section>
      </div>

      <footer className="home-foot">
        <button className="link-btn" onClick={() => setSheet('help')}>How to play</button>
        <span aria-hidden="true">·</span>
        <a href="#/rules">Rules</a>
        <span aria-hidden="true">·</span>
        <a href="#/spec">Spec</a>
      </footer>

      {sheet === 'new' && (
        <NewGameSheet
          defaultName={`${possessive(name.trim())} game`}
          onClose={() => setSheet(null)}
          onCreate={(o) => {
            setSheet(null)
            create(o, false)
          }}
        />
      )}
      {sheet === 'help' && <HelpSheet onClose={() => setSheet(null)} />}
    </div>
  )
}

function GameList({ title, games, action }: { title: string; games: GameSummary[]; action: (g: GameSummary) => string }) {
  if (!games.length) return null
  const sorted = [...games].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6)
  return (
    <div className="game-list">
      <h2 className="label">{title}</h2>
      <ul>
        {sorted.map((g) => (
          <li key={g.id}>
            <a className="game-row" href={gameHash(g.id)}>
              <span className="game-row-seats" aria-hidden="true">
                {g.seats.map((s) => (
                  <span key={s.seat} className={`swatch ${s.kind === 'open' ? 'is-open' : ''}`} style={{ '--c': PLAYERS[s.seat]?.base } as CSSProperties} />
                ))}
              </span>
              <span className="game-row-text">
                <span className="game-row-name serif">{g.name}</span>
                <span className="game-row-meta">{meta(g)}</span>
              </span>
              <span className="game-row-go">
                {action(g)}
                <Icon name="arrowRight" size={16} />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function meta(g: GameSummary): string {
  const humans = g.seats.filter((s) => s.kind === 'human').map((s) => s.name).filter(Boolean)
  const who = humans.length ? humans.join(', ') : 'Only bots'
  if (g.phase === 'lobby') {
    const free = g.seats.filter((s) => s.kind === 'open').length
    return `${who} · ${free === 1 ? '1 open seat' : `${free} open seats`}`
  }
  if (g.phase === 'finished') return `${who} · Finished`
  return `${who} · Turn ${g.turn}`
}
