import { Sheet } from './Sheet.tsx'
import { helpLines } from './strings.ts'

export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="How to play" onClose={onClose} className="help-sheet">
      <ol className="help-list">
        {helpLines().map((l, i) => (
          <li key={i}>
            <span className="help-n serif num">{i + 1}</span>
            <span>{l}</span>
          </li>
        ))}
      </ol>
      <section className="help-fog">
        <h3 className="serif">Fog of war</h3>
        <p>
          Units see two tiles around them and cities three; a unit on a hill sees one further. High ground blocks the
          view, so you can look up at a peak but not into the valley behind a ridge.
        </p>
        <p>
          Land you have never seen lies under the clouds; you can still send units into it. Land you have seen but
          cannot see right now is veiled: you know its terrain, not who is there.
        </p>
      </section>
      <div className="help-actions">
        <button className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
        <a className="btn btn-quiet" href="#/rules" onClick={onClose}>
          Read the rules
        </a>
      </div>
    </Sheet>
  )
}
