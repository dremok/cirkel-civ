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
