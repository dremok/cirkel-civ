import { useState } from 'react'
import type { CreateOptions } from '../../shared/protocol.ts'
import { Sheet } from './Sheet.tsx'

const TIMERS: { label: string; value: number | null }[] = [
  { label: 'None', value: null },
  { label: '1 min', value: 60 },
  { label: '2 min', value: 120 },
  { label: '5 min', value: 300 },
  { label: '1 day', value: 86400 },
]

const SIZES: { label: string; value: NonNullable<CreateOptions['mapSize']> }[] = [
  { label: 'Small', value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large', value: 'large' },
]

export function NewGameSheet({ defaultName, onClose, onCreate }: { defaultName: string; onClose: () => void; onCreate: (o: CreateOptions) => void }) {
  const [name, setName] = useState(defaultName)
  const [seats, setSeats] = useState(2)
  const [bots, setBots] = useState(0)
  const [mapSize, setMapSize] = useState<NonNullable<CreateOptions['mapSize']>>('small')
  const [timer, setTimer] = useState<number | null>(null)
  const [fog, setFog] = useState(true)

  const setSeatCount = (n: number) => {
    setSeats(n)
    setBots((b) => Math.min(b, n - 1))
    setMapSize(n === 2 ? 'small' : 'medium')
  }

  return (
    <Sheet title="New online game" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          onCreate({ name: name.trim() || defaultName, seats, bots, mapSize, turnSeconds: timer, fog })
        }}
      >
        <label className="field">
          <span className="label">Game name</span>
          <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="field">
          <span className="label">Players</span>
          <div className="seg">
            {[2, 3, 4].map((n) => (
              <button type="button" key={n} aria-pressed={seats === n} onClick={() => setSeatCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Bots</span>
          <div className="seg">
            {Array.from({ length: seats }, (_, n) => (
              <button type="button" key={n} aria-pressed={bots === n} onClick={() => setBots(n)}>
                {n === 0 ? 'None' : n}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Map</span>
          <div className="seg">
            {SIZES.map((s) => (
              <button type="button" key={s.value} aria-pressed={mapSize === s.value} onClick={() => setMapSize(s.value)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Turn timer</span>
          <div className="seg">
            {TIMERS.map((t) => (
              <button type="button" key={t.label} aria-pressed={timer === t.value} onClick={() => setTimer(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="switch-row" role="switch" aria-checked={fog} onClick={() => setFog(!fog)}>
          <span className="switch-text">
            <span className="switch-title">Fog of war</span>
            <span className="switch-hint">Discover the map as you go</span>
          </span>
          <span className="switch" aria-hidden="true" />
        </button>

        <p className="form-note muted">
          {seats - bots - 1 === 0
            ? 'Just you and bots. The game can start right away.'
            : `You will get a link to send to ${seats - bots - 1 === 1 ? 'a friend' : `${seats - bots - 1} friends`}. Empty seats can be filled with bots.`}
        </p>

        <button className="btn btn-primary btn-block" type="submit">
          Create game
        </button>
      </form>
    </Sheet>
  )
}
