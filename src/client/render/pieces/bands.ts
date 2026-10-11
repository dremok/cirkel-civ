// Band geometry along the inside of a region's boundary on the tile tops: territory borders,
// tile outlines. uv.x runs along the band (world-space based, continuous across tiles), uv.y is 0 at
// the outer line and 1 at the inner edge. Where the boundary steps between tiles of different
// heights, a short vertical riser keeps the line continuous down the cliff.
import * as THREE from 'three'
import type { TileId } from '../../../engine/types.ts'
import type { Board } from './common.ts'

export interface BandOpts {
  /** Distance of the outer line from the hex edge. */
  inset: number
  /** Band width inwards from the outer line. */
  width: number
  /** Width of the crisp line at the outer edge (for risers). */
  line: number
  lift: number
}

type P2 = { x: number; z: number }

function intersect(p: P2, u: P2, q: P2, w: P2): P2 {
  // p + u t = q + w s
  const den = u.x * w.z - u.z * w.x
  const dx = q.x - p.x
  const dz = q.z - p.z
  const t = Math.abs(den) < 1e-9 ? 0 : (dx * w.z - dz * w.x) / den
  return { x: p.x + u.x * t, z: p.z + u.z * t }
}

/** Build a band along the boundary of `inRegion` for every tile in `tiles`. */
export function buildBand(board: Board, tiles: Iterable<TileId>, inRegion: ((t: TileId) => boolean) | null, o: BandOpts): THREE.BufferGeometry | null {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const R = board.R
  const corners: P2[] = []
  const tmp = new THREE.Vector3()
  const pushQuad = (a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[]) => {
    // a-b outer, c-d inner (a,c at start)
    const base = pos.length / 3
    pos.push(...a, ...b, ...c, ...d)
    uv.push(...ua, ...ub, ...uc, ...ud)
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)
  }
  const U = (x: number, z: number) => x * 0.83 + z * 1.17

  for (const tile of tiles) {
    const top = board.tops[tile]
    for (let i = 0; i < 6; i++) {
      board.corner(tile, i, tmp)
      corners[i] = { x: tmp.x, z: tmp.z }
    }
    const border = [0, 1, 2, 3, 4, 5].map((e) => {
      const nb = board.across(tile, e)
      return inRegion === null || nb === null || !inRegion(nb)
    })
    const y = top.y + o.lift
    for (let e = 0; e < 6; e++) {
      if (!border[e]) continue
      const c0 = corners[e]
      const c1 = corners[(e + 1) % 6]
      const u = { x: (c1.x - c0.x) / R, z: (c1.z - c0.z) / R }
      const nAng = (Math.PI / 180) * (60 * e)
      const n = { x: -Math.cos(nAng), z: -Math.sin(nAng) } // inward
      const prev = (e + 5) % 6
      const next = (e + 1) % 6
      const ends = (off: number) => {
        const p = { x: c0.x + n.x * off, z: c0.z + n.z * off }
        // start: against edge `prev` (which runs corner prev -> corner e)
        const cp = corners[prev]
        const wPrev = { x: (c0.x - cp.x) / R, z: (c0.z - cp.z) / R }
        const nPrevAng = (Math.PI / 180) * (60 * prev)
        const nPrev = { x: -Math.cos(nPrevAng), z: -Math.sin(nPrevAng) }
        const qs = border[prev] ? { x: c0.x + nPrev.x * off, z: c0.z + nPrev.z * off } : c0
        const s = intersect(p, u, qs, wPrev)
        // end: against edge `next` (corner e+1 -> corner e+2)
        const cn = corners[(e + 2) % 6]
        const wNext = { x: (cn.x - c1.x) / R, z: (cn.z - c1.z) / R }
        const nNextAng = (Math.PI / 180) * (60 * next)
        const nNext = { x: -Math.cos(nNextAng), z: -Math.sin(nNextAng) }
        const qe = border[next] ? { x: c1.x + nNext.x * off, z: c1.z + nNext.z * off } : c1
        const en = intersect(p, u, qe, wNext)
        return [s, en]
      }
      const [so, eo] = ends(o.inset)
      const [si, ei] = ends(o.inset + o.width)
      pushQuad(
        [so.x, y, so.z], [eo.x, y, eo.z], [si.x, y, si.z], [ei.x, y, ei.z],
        [U(so.x, so.z), 0], [U(eo.x, eo.z), 0], [U(si.x, si.z), 1], [U(ei.x, ei.z), 1],
      )
      // risers where the line continues onto a neighbour at another height
      const riser = (side: 'start' | 'end') => {
        const edge = side === 'start' ? prev : next
        if (border[edge]) return
        const nb = board.across(tile, edge)
        if (nb === null) return
        const yb = board.tops[nb].y + o.lift
        if (yb >= y - 0.02) return // only the higher tile emits the riser
        const [a, b] = side === 'start' ? [ends(o.inset)[0], ends(o.inset + o.line)[0]] : [ends(o.inset)[1], ends(o.inset + o.line)[1]]
        // push slightly off the cliff face, towards the lower neighbour
        const nAng2 = (Math.PI / 180) * (60 * edge)
        const px = Math.cos(nAng2) * 0.006
        const pz = Math.sin(nAng2) * 0.006
        const fr = o.line / o.width
        pushQuad(
          [a.x + px, y, a.z + pz], [a.x + px, yb, a.z + pz], [b.x + px, y, b.z + pz], [b.x + px, yb, b.z + pz],
          [U(a.x, a.z), 0], [U(a.x, a.z) + (y - yb), 0], [U(b.x, b.z), fr], [U(b.x, b.z) + (y - yb), fr],
        )
      }
      riser('start')
      riser('end')
    }
  }
  if (!idx.length) return null
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

/** Flat hex fills on the tile tops (very light territory tint). */
export function buildFill(board: Board, tiles: Iterable<TileId>, inset: number, lift: number): THREE.BufferGeometry | null {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const tmp = new THREE.Vector3()
  for (const tile of tiles) {
    const t = board.tops[tile]
    const base = pos.length / 3
    pos.push(t.x, t.y + lift, t.z)
    uv.push(0, 0)
    for (let i = 0; i < 6; i++) {
      board.corner(tile, i, tmp)
      const k = 1 - inset / board.R
      pos.push(t.x + (tmp.x - t.x) * k, t.y + lift, t.z + (tmp.z - t.z) * k)
      uv.push(0, 0)
    }
    for (let i = 0; i < 6; i++) idx.push(base, base + 1 + ((i + 1) % 6), base + 1 + i)
  }
  if (!idx.length) return null
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}
