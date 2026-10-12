import { useEffect, useState, type CSSProperties } from 'react'
import { audio } from '../audio/index.ts'
import type { SeatInfo } from '../../shared/protocol.ts'
import type { GameSession, GameSnapshot } from '../net/session.ts'
import { getName, setName as storeName } from '../net/storage.ts'
import { PLAYERS } from '../render/palette.ts'
import { HelpSheet } from './HelpSheet.tsx'
import { Icon } from './icons.tsx'
import { gameUrl } from './route.ts'
import { canShare, copyText, shareLink } from './share.ts'
import { COLOR_NAME } from './strings.ts'
import { toast } from './toast.tsx'

function timerText(s: number | null): string {
  if (!s) return 'No turn timer'
  if (s >= 86400) return s === 86400 ? 'One day per turn' : `${Math.round(s / 86400)} days per turn`
  return s % 60 === 0 ? `${s / 60} min per turn` : `${s} s per turn`
}

export function Lobby({ session, snap }: { session: GameSession; snap: GameSnapshot }) {
  const g = snap.summary!
  const [name, setName] = useState(getName)
  const [copied, setCopied] = useState(false)
  const [help, setHelp] = useState(false)
  useEffect(() => {
    audio.music(null)
    audio.ambience('meadow')
  }, [])
  const url = gameUrl(g.id)
  const seated = snap.seat !== null && g.seats[snap.seat]?.kind === 'human'
  const openSeats = g.seats.filter((s) => s.kind === 'open').length
  const humans = g.seats.filter((s) => s.kind === 'human').length

  const join = () => {
    const n = name.trim()
    if (!n) {
      toast('Enter your name first.')
      return
    }
    storeName(n)
    audio.ui('confirm')
    session.join(n)
  }

  const copy = async () => {
    if (await copyText(url)) {
      audio.ui('tap')
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } else toast('Could not copy the link.')
  }

  return (
    <div className="lobby">
      <nav className="lobby-nav">
        <a href="#/" className="doc-back">
          <Icon name="home" size={18} />
          <span className="serif">Cirkel-Civ</span>
        </a>
      </nav>

      <header className="lobby-head">
        <span className="label">Lobby</span>
        <h1 className="serif">{g.name}</h1>
        <p className="muted">
          {openSeats === 0 ? 'All seats are taken.' : openSeats === 1 ? 'One seat is open.' : `${openSeats} seats are open.`} {timerText(g.turnSeconds)}.
          {g.fog ? ' Fog of war: the map is discovered as you go.' : ' No fog: the whole map is visible.'}
        </p>
      </header>

      <section className="lobby-card invite">
        <span className="label">Invite</span>
        <div className="invite-row">
          <code className="invite-url" title={url}>{url.replace(/^https?:\/\//, '')}</code>
          <button className="btn btn-sm btn-ghost" onClick={copy}>
            <Icon name={copied ? 'check' : 'copy'} size={17} />
            {copied ? 'Copied' : 'Copy'}
          </button>
          {canShare() && (
            <button className="btn btn-sm btn-primary" onClick={() => void shareLink(url, g.name)}>
              <Icon name="share" size={17} />
              Share
            </button>
          )}
        </div>
      </section>

      <section className="lobby-card">
        <span className="label">Seats</span>
        <ul className="seats">
          {g.seats.map((s) => (
            <SeatRow key={s.seat} s={s} me={snap.seat} host={snap.host} onSet={(kind) => session.setSeat(s.seat, kind)} />
          ))}
        </ul>
      </section>

      <footer className="lobby-foot">
        {!seated && openSeats > 0 && (
          <div className="join">
            <input
              className="input"
              value={name}
              maxLength={24}
              placeholder="Your name"
              autoComplete="nickname"
              enterKeyHint="go"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && join()}
            />
            <button className="btn btn-primary" onClick={join}>Take a seat</button>
          </div>
        )}
        {!seated && openSeats === 0 && <p className="muted center">The game is full. You can watch once it starts.</p>}
        {seated && snap.host && (
          <>
            <button
              className="btn btn-primary btn-block"
              onClick={() => {
                audio.ui('confirm')
                session.start()
              }}
            >
              Start game
            </button>
            <p className="muted center small">
              {openSeats ? 'Open seats become bots when you start.' : humans === 1 ? 'You are playing against bots.' : 'Everyone is here.'}
            </p>
          </>
        )}
        {seated && !snap.host && (
          <p className="waiting-host">
            <span className="pulse" aria-hidden="true" />
            Waiting for the host to start the game.
          </p>
        )}
        <p className="center small">
          <button className="link-btn" onClick={() => setHelp(true)}>How to play</button>
        </p>
      </footer>
      {help && <HelpSheet onClose={() => setHelp(false)} />}
    </div>
  )
}

function SeatRow({ s, me, host, onSet }: { s: SeatInfo; me: number | null; host: boolean; onSet: (kind: 'bot' | 'open') => void }) {
  const color = PLAYERS[s.seat]
  const isMe = s.seat === me && s.kind === 'human'
  return (
    <li className={`seat seat-${s.kind}`} style={{ '--c': color?.base, '--c-light': color?.light } as CSSProperties}>
      <span className="seat-hex" aria-hidden="true">
        <Icon name={s.kind === 'bot' ? 'bot' : s.kind === 'human' ? 'person' : 'plus'} size={16} />
      </span>
      <span className="seat-text">
        <span className="seat-name">
          {s.kind === 'open' ? 'Open seat' : s.name ?? (s.kind === 'bot' ? 'Bot' : 'Player')}
          {isMe && <span className="tag">You</span>}
        </span>
        <span className="seat-meta">
          {COLOR_NAME[s.seat] ?? color?.name}
          {s.kind === 'human' && !isMe && (s.connected ? ' · Connected' : ' · Not connected')}
          {s.kind === 'bot' && ' · Bot'}
        </span>
      </span>
      {host && s.kind !== 'human' && (
        <div className="seg seat-seg">
          <button aria-pressed={s.kind === 'open'} onClick={() => onSet('open')}>Open</button>
          <button aria-pressed={s.kind === 'bot'} onClick={() => onSet('bot')}>Bot</button>
        </div>
      )}
    </li>
  )
}
