// Tiny flat-shaded geometry accumulator with per-vertex colour (linear RGB or RGBA).

import * as THREE from 'three'

export class GeoBuilder {
  pos: number[] = []
  nor: number[] = []
  col: number[] = []
  det: number[] = []
  tl: number[] = []
  nbr: number[] = []
  low: number[] = []
  /** Surface kind stamped on the vertices emitted next (see the terrain shader's top detail). */
  detail = 0
  /** For fog of war: the tile the next vertices belong to, the tile across a side face (or -1), and
   * the height of that face's lower edge (vertices there are flagged so the shader can move them). */
  tile = -1
  across = -1
  lowY = NaN
  readonly alpha: boolean

  constructor(alpha = false) {
    this.alpha = alpha
  }

  private v(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: ArrayLike<number>) {
    this.pos.push(x, y, z)
    this.nor.push(nx, ny, nz)
    this.det.push(this.detail)
    this.tl.push(this.tile)
    this.nbr.push(this.across)
    this.low.push(Math.abs(y - this.lowY) < 1e-5 ? 1 : 0)
    if (this.alpha) this.col.push(c[0], c[1], c[2], c.length > 3 ? c[3] : 1)
    else this.col.push(c[0], c[1], c[2])
  }

  /** Triangle a, b, c (counter-clockwise seen from the front) with an explicit normal. */
  triN(a: Vec, b: Vec, c: Vec, n: Vec, ca: ArrayLike<number>, cb: ArrayLike<number> = ca, cc: ArrayLike<number> = ca) {
    this.v(a[0], a[1], a[2], n[0], n[1], n[2], ca)
    this.v(b[0], b[1], b[2], n[0], n[1], n[2], cb)
    this.v(c[0], c[1], c[2], n[0], n[1], n[2], cc)
  }

  /** Triangle with its face normal. */
  tri(a: Vec, b: Vec, c: Vec, ca: ArrayLike<number>, cb: ArrayLike<number> = ca, cc: ArrayLike<number> = ca) {
    this.triN(a, b, c, faceNormal(a, b, c), ca, cb, cc)
  }

  /** Quad a, b, c, d (counter-clockwise) as two triangles sharing the face normal of a, b, c. */
  quad(a: Vec, b: Vec, c: Vec, d: Vec, ca: ArrayLike<number>, cb: ArrayLike<number> = ca, cc: ArrayLike<number> = cb, cd: ArrayLike<number> = ca) {
    const n = faceNormal(a, b, c)
    this.triN(a, b, c, n, ca, cb, cc)
    this.triN(a, c, d, n, ca, cc, cd)
  }

  get vertexCount() {
    return this.pos.length / 3
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, this.alpha ? 4 : 3))
    if (this.det.some((d) => d !== 0)) g.setAttribute('aDetail', new THREE.Float32BufferAttribute(this.det, 1))
    if (this.tl.some((t) => t >= 0)) {
      g.setAttribute('aTile', new THREE.Float32BufferAttribute(this.tl, 1))
      g.setAttribute('aNb', new THREE.Float32BufferAttribute(this.nbr, 1))
      g.setAttribute('aLow', new THREE.Float32BufferAttribute(this.low, 1))
    }
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }
}

export type Vec = [number, number, number]

export function faceNormal(a: Vec, b: Vec, c: Vec): Vec {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
  let nx = uy * vz - uz * vy
  let ny = uz * vx - ux * vz
  let nz = ux * vy - uy * vx
  const l = Math.hypot(nx, ny, nz) || 1
  nx /= l; ny /= l; nz /= l
  return [nx, ny, nz]
}

/** Linear RGB triple from an sRGB hex string, optionally scaled. */
export function lin(hex: string, k = 1): [number, number, number] {
  const c = new THREE.Color(hex)
  return [c.r * k, c.g * k, c.b * k]
}

export function mix3(a: ArrayLike<number>, b: ArrayLike<number>, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export function scale3(a: ArrayLike<number>, k: number): [number, number, number] {
  return [a[0] * k, a[1] * k, a[2] * k]
}
