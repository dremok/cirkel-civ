// Exact, allocation-free picking: the ray is clipped against hex prisms (column footprint from the
// board's underside up to where a piece stands). Candidates are the cells sampled along the ray's
// planar path plus their neighbours, which covers every cell the ray can cross.

import type * as THREE from 'three'
import { BOTTOM_Y, INRADIUS, tileAtPoint, type Layout } from './layout.ts'

const NX = [1, 0.5, -0.5, -1, -0.5, 0.5]
const NZ = [0, 0.8660254, 0.8660254, 0, -0.8660254, -0.8660254]

export function createPicker(layout: Layout) {
  const n = layout.map.tiles.length
  const stamp = new Uint32Array(n)
  let gen = 0

  /** Entry distance of the ray into a hex prism (scaled by `s`, from the underside to `yTop`), or Infinity. */
  function prismHit(id: number, s: number, yTop: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    let tIn = 0
    let tOut = Infinity
    const cx = layout.cx[id], cz = layout.cz[id]
    if (dy === 0) {
      if (oy > yTop || oy < BOTTOM_Y) return Infinity
    } else {
      const t1 = (yTop - oy) / dy
      const t2 = (BOTTOM_Y - oy) / dy
      tIn = Math.max(tIn, Math.min(t1, t2))
      tOut = Math.min(tOut, Math.max(t1, t2))
    }
    for (let i = 0; i < 6; i++) {
      const denom = NX[i] * dx + NZ[i] * dz
      const num = INRADIUS * s - (NX[i] * (ox - cx) + NZ[i] * (oz - cz))
      if (denom === 0) {
        if (num < 0) return Infinity
        continue
      }
      const t = num / denom
      if (denom < 0) tIn = Math.max(tIn, t)
      else tOut = Math.min(tOut, t)
      if (tIn > tOut) return Infinity
    }
    return tIn <= tOut ? tIn : Infinity
  }

  /** Nearest tile hit by the ray, with its distance along the (normalised) direction. */
  function pick(ray: THREE.Ray): { tile: number; t: number } | null {
    const { origin: o, direction: d } = ray
    const ox = o.x, oy = o.y, oz = o.z, dx = d.x, dy = d.y, dz = d.z
    // Clip the ray to the slab between the underside and the tallest top.
    let t0 = 0, t1 = 400
    if (dy !== 0) {
      const a = (layout.maxY - oy) / dy, b = (BOTTOM_Y - oy) / dy
      t0 = Math.max(t0, Math.min(a, b))
      t1 = Math.min(t1, Math.max(a, b))
    } else if (oy > layout.maxY || oy < BOTTOM_Y) return null
    if (t0 > t1) return null
    const planar = Math.hypot(dx, dz)
    const step = planar > 1e-6 ? 0.35 / planar : t1 - t0 + 1
    gen++
    let best = Infinity, bestId = -1
    const test = (id: number) => {
      if (stamp[id] === gen) return
      stamp[id] = gen
      let t = prismHit(id, 1, layout.pickTop[id], ox, oy, oz, dx, dy, dz)
      // Crags: a narrower inner volume above the column.
      if (layout.cragTop[id] > 0) t = Math.min(t, prismHit(id, 0.55, layout.cragTop[id], ox, oy, oz, dx, dy, dz))
      if (t < best) { best = t; bestId = id }
    }
    for (let t = t0; ; t += step) {
      const tt = Math.min(t, t1)
      // Once a hit is closer than everything still ahead (minus a cell), stop.
      if (tt - step * 3 > best) break
      const id = tileAtPoint(layout.map, ox + dx * tt, oz + dz * tt)
      if (id !== null) {
        test(id)
        for (let i = 0; i < 6; i++) {
          const nb = layout.nb[id * 6 + i]
          if (nb >= 0) test(nb)
        }
      } else {
        // Off the board, but a board cell may still be adjacent: probe the six neighbour positions.
        const px = ox + dx * tt, pz = oz + dz * tt
        for (let i = 0; i < 6; i++) {
          const nb = tileAtPoint(layout.map, px + NX[i] * 1.2, pz + NZ[i] * 1.2)
          if (nb !== null) test(nb)
        }
      }
      if (tt >= t1) break
    }
    return bestId >= 0 ? { tile: bestId, t: best } : null
  }

  return { pick }
}
