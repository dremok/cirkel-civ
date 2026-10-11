// Static files: the built client (dist/, SPA fallback, immutable /assets/), SPEC.md and docs/*.md.
// Files are cached in memory (keyed by mtime) and compressed once, since phones are the main audience.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm', '.map': 'application/json',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.webmanifest', '.md', '.txt', '.map', '.glb'])
const IMMUTABLE = 'public, max-age=31536000, immutable'
const REVALIDATE = 'no-cache'
const DOC = /^\/docs\/[\w-][\w.-]*\.md$/

const br = promisify(brotliCompress)
const gz = promisify(gzip)

interface Entry {
  mtimeMs: number
  size: number
  body: Buffer
  etag: string
  br?: Promise<Buffer>
  gz?: Promise<Buffer>
}

export function staticFiles(root: string) {
  const dist = join(root, 'dist')
  const cache = new Map<string, Entry>()

  async function load(path: string): Promise<Entry | null> {
    const st = await stat(path).catch(() => null)
    if (!st?.isFile()) return null
    const hit = cache.get(path)
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit
    const entry: Entry = { mtimeMs: st.mtimeMs, size: st.size, body: await readFile(path), etag: `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"` }
    cache.set(path, entry)
    return entry
  }

  async function send(req: IncomingMessage, res: ServerResponse, path: string, cacheControl: string): Promise<boolean> {
    const entry = await load(path)
    if (!entry) return false
    const ext = extname(path)
    const headers: Record<string, string> = {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': cacheControl,
      etag: entry.etag,
      'x-content-type-options': 'nosniff',
    }
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers).end()
      return true
    }
    let body = entry.body
    if (COMPRESSIBLE.has(ext) && body.length > 1024) {
      headers.vary = 'accept-encoding'
      const accept = String(req.headers['accept-encoding'] ?? '')
      if (/\bbr\b/.test(accept)) {
        entry.br ??= br(entry.body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })
        body = await entry.br
        headers['content-encoding'] = 'br'
      } else if (/\bgzip\b/.test(accept)) {
        entry.gz ??= gz(entry.body, { level: 9 })
        body = await entry.gz
        headers['content-encoding'] = 'gzip'
      }
    }
    headers['content-length'] = String(body.length)
    res.writeHead(200, headers)
    res.end(req.method === 'HEAD' ? undefined : body)
    return true
  }

  function notFound(res: ServerResponse) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
  }

  return async function serve(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (pathname === '/SPEC.md') {
      if (!(await send(req, res, join(root, 'SPEC.md'), REVALIDATE))) notFound(res)
      return
    }
    if (pathname.startsWith('/docs/')) {
      if (!DOC.test(pathname) || !(await send(req, res, join(root, pathname), REVALIDATE))) notFound(res)
      return
    }
    const file = resolve(dist, `.${pathname}`)
    if (file !== dist && !file.startsWith(dist + sep)) return notFound(res)
    if (file !== dist && (await send(req, res, file, pathname.startsWith('/assets/') ? IMMUTABLE : REVALIDATE))) return
    // Client-side routes get the app; a missing file never does (an HTML body cached as JS is a bad day).
    if (pathname.startsWith('/assets/') || extname(pathname)) return notFound(res)
    if (!(await send(req, res, join(dist, 'index.html'), REVALIDATE))) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('client not built (run npm run build)')
    }
  }
}
