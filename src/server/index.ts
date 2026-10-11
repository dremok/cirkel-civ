// Cirkel-Civ server: static client, WebSocket game protocol at /ws, games persisted in DATA_DIR.
// Env: PORT (8787), DATA_DIR (./data), HEARTBEAT_MS (30000), LOBBY_TTL_HOURS (72).
import { existsSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { Hub } from './hub.ts'
import { staticFiles } from './static.ts'
import { Store } from './store.ts'

/** The repo root: the nearest directory with a package.json (this file runs from src/server or dist-server). */
function findRoot(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir
    if (dirname(dir) === dir) return resolve(from, '..')
  }
}

const ROOT = findRoot(import.meta.dirname)
const PORT = Number(process.env.PORT ?? 8787)
const DATA_DIR = resolve(ROOT, process.env.DATA_DIR ?? 'data')
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS ?? 30_000)
const LOBBY_TTL_MS = Number(process.env.LOBBY_TTL_HOURS ?? 72) * 3600_000
const MAX_BUFFERED = 16 * 1024 * 1024

const store = new Store(DATA_DIR)
const hub = new Hub(store, { lobbyTtlMs: LOBBY_TTL_MS })
await hub.load()
const serveStatic = staticFiles(ROOT)

function json(res: ServerResponse, body: unknown) {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, { allow: 'GET, HEAD' }).end()
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/health') return void res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('ok')
    if (url.pathname === '/api/games') return json(res, hub.list())
    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      return void res.writeHead(400).end('bad path')
    }
    if (pathname.includes('\0')) return void res.writeHead(400).end('bad path')
    await serveStatic(req, res, pathname)
  } catch (e) {
    console.error('http:', e)
    if (res.headersSent) res.destroy()
    else res.writeHead(500, { 'content-type': 'text/plain' }).end('server error')
  }
})

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: { threshold: 1024 } })
const alive = new Map<WebSocket, boolean>()

server.on('upgrade', (req, socket, head) => {
  const onError = (e: Error) => console.warn('upgrade:', e.message)
  socket.on('error', onError)
  if (new URL(req.url ?? '/', 'http://x').pathname !== '/ws') {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    socket.removeListener('error', onError)
    wss.emit('connection', ws, req)
  })
})

wss.on('connection', (ws: WebSocket) => {
  alive.set(ws, true)
  const conn = hub.open((data) => {
    if (ws.readyState !== WebSocket.OPEN) return
    if (ws.bufferedAmount > MAX_BUFFERED) return void ws.terminate() // the client stopped reading
    ws.send(data)
  })
  ws.on('pong', () => alive.set(ws, true))
  ws.on('message', (data, isBinary) => {
    alive.set(ws, true)
    if (isBinary) return conn.send(JSON.stringify({ type: 'error', code: 'bad_request', message: 'binary frames are not supported' }))
    hub.receive(conn, data.toString())
  })
  ws.on('close', () => {
    alive.delete(ws)
    hub.close(conn)
  })
  ws.on('error', (e) => console.warn('ws:', e.message))
})

// Phones drop sockets without a goodbye: ping everyone, terminate whoever missed the last ping.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) {
      ws.terminate()
      continue
    }
    alive.set(ws, false)
    ws.ping()
  }
}, HEARTBEAT_MS)
const sweep = setInterval(() => hub.cleanup(), 3600_000)

server.listen(PORT, () => console.log(`cirkel-civ on :${PORT} (root ${ROOT}, data ${DATA_DIR})`))

let stopping = false
async function shutdown(reason: string, code: number) {
  if (stopping) return
  stopping = true
  console.log(`${reason}: shutting down`)
  clearInterval(heartbeat)
  clearInterval(sweep)
  hub.stop()
  server.close()
  for (const ws of wss.clients) ws.close(1012, 'server restarting') // 1012: come back soon
  const grace = Date.now() + 1000
  while (wss.clients.size && Date.now() < grace) await new Promise((r) => setTimeout(r, 25))
  await store.flush()
  process.exit(code)
}
process.on('SIGTERM', () => void shutdown('SIGTERM', 0))
process.on('SIGINT', () => void shutdown('SIGINT', 0))
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e))
process.on('uncaughtException', (e) => {
  console.error('uncaught exception:', e)
  void shutdown('crash', 1)
})
