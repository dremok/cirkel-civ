// A single WebSocket to the game server with auto-reconnect.
// "Hello" messages (resume / watch / list) are re-sent every time the socket opens, before anything
// queued while offline, so a dropped connection picks up exactly where it was.

import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts'

export type ConnStatus = 'connecting' | 'open' | 'reconnecting'

type Listener = (m: ServerMessage) => void

export interface Transport {
  readonly status: ConnStatus
  send(m: ClientMessage): void
  subscribe(fn: Listener): () => void
  onStatus(fn: (s: ConnStatus) => void): () => void
  /** Messages sent on every (re)open, before the queue. */
  setHello(fn: (() => ClientMessage[]) | null): void
}

const PING_MS = 20_000
const STALE_MS = 50_000

export class WsConnection implements Transport {
  status: ConnStatus = 'connecting'
  private ws: WebSocket | null = null
  private queue: ClientMessage[] = []
  private listeners = new Set<Listener>()
  private statusListeners = new Set<(s: ConnStatus) => void>()
  private hello: (() => ClientMessage[]) | null = null
  private attempt = 0
  private retryTimer = 0
  private pingTimer = 0
  private lastMessage = 0

  constructor(private url: string) {
    this.connect()
    addEventListener('online', () => this.reconnectNow())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.reconnectNow()
    })
  }

  send(m: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(m))
      return
    }
    if (m.type === 'ping') return
    // Only the latest plan matters; only one list request is useful.
    if (m.type === 'orders' || m.type === 'list') this.queue = this.queue.filter((q) => q.type !== m.type)
    this.queue.push(m)
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  onStatus(fn: (s: ConnStatus) => void): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  setHello(fn: (() => ClientMessage[]) | null): void {
    this.hello = fn
    if (fn && this.ws?.readyState === WebSocket.OPEN) for (const m of fn()) this.ws.send(JSON.stringify(m))
  }

  private setStatus(s: ConnStatus) {
    if (s === this.status) return
    this.status = s
    for (const fn of this.statusListeners) fn(s)
  }

  private connect() {
    clearTimeout(this.retryTimer)
    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch {
      this.scheduleRetry()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.lastMessage = Date.now()
      this.setStatus('open')
      for (const m of this.hello?.() ?? []) ws.send(JSON.stringify(m))
      const queued = this.queue
      this.queue = []
      for (const m of queued) ws.send(JSON.stringify(m))
      clearInterval(this.pingTimer)
      this.pingTimer = window.setInterval(() => {
        if (Date.now() - this.lastMessage > STALE_MS) ws.close()
        else this.send({ type: 'ping' })
      }, PING_MS)
    }
    ws.onmessage = (e) => {
      this.lastMessage = Date.now()
      let m: ServerMessage
      try {
        m = JSON.parse(String(e.data)) as ServerMessage
      } catch {
        return
      }
      for (const fn of [...this.listeners]) fn(m)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      clearInterval(this.pingTimer)
      this.ws = null
      this.setStatus('reconnecting')
      this.scheduleRetry()
    }
  }

  private scheduleRetry() {
    clearTimeout(this.retryTimer)
    const base = Math.min(8000, 400 * 2 ** this.attempt)
    this.attempt++
    this.retryTimer = window.setTimeout(() => this.connect(), base * (0.75 + Math.random() * 0.5))
  }

  private reconnectNow() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    this.attempt = 0
    this.connect()
  }
}

let shared: Transport | null = null

export function setTransport(t: Transport): void {
  shared = t
}

/** The app's one connection, created on first use. */
export function connection(): Transport {
  if (!shared) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    shared = new WsConnection(`${proto}://${location.host}/ws`)
  }
  return shared
}
