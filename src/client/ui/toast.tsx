import { useSyncExternalStore } from 'react'

interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

let toasts: Toast[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export function toast(text: string, kind: Toast['kind'] = 'info', ms = 2600): void {
  // The same message twice in a row is shown once.
  if (toasts.some((t) => t.text === text)) return
  const t = { id: ++seq, text, kind }
  toasts = [...toasts, t].slice(-3)
  emit()
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id)
    emit()
  }, ms)
}

export function Toasts() {
  const list = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => toasts,
  )
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast glass ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
