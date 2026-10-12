// An in-process client of the hub: collects what the hub sends it.
import type { Conn, Hub } from '../../src/server/hub.ts'
import type { ClientMessage, ServerMessage } from '../../src/shared/protocol.ts'

export type Msg<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>

export class Peer {
  inbox: ServerMessage[] = []
  conn: Conn
  constructor(private hub: Hub) {
    this.conn = hub.open((data) => this.inbox.push(JSON.parse(data)))
  }
  send(msg: ClientMessage) {
    this.hub.receive(this.conn, JSON.stringify(msg))
  }
  /** Removes and returns every message of `type` received so far. */
  take<T extends ServerMessage['type']>(type: T): Msg<T>[] {
    const out = this.inbox.filter((m) => m.type === type) as Msg<T>[]
    this.inbox = this.inbox.filter((m) => m.type !== type)
    return out
  }
  last<T extends ServerMessage['type']>(type: T): Msg<T> {
    const all = this.take(type)
    if (!all.length) throw new Error(`no '${type}' in inbox`)
    return all[all.length - 1]
  }
}
