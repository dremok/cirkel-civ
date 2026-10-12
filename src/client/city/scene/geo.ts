// Modelling kit for the city diorama. Primitives are placed, coloured and merged into one geometry
// per model with four attributes: position, normal, color (linear RGB) and `aux`:
//   aux.x  window glow (0..1, warm emissive in the evening light)
//   aux.y  flutter weight (flags, awnings, leaves sway by this many world units)
//   aux.z  surface pattern, see PATTERN (cobbles, flagstones, roof courses, masonry, boards)
// Everything is flat-shaded unless asked otherwise, which suits the painted-miniature look.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

export type V3 = [number, number, number]
export type RGB = [number, number, number]
export interface Place { p?: V3; r?: V3; s?: V3 | number }

export const PATTERN = { none: 0, cobble: 1, flags: 2, roof: 3, stone: 4, boards: 5, grass: 6, sand: 7, plaster: 8, pavers: 9 } as const
export type Pattern = keyof typeof PATTERN

export interface PartOpts {
  glow?: number
  /** Constant weight, or a function of the part-local position (before placement). */
  flutter?: number | ((x: number, y: number, z: number) => number)
  pattern?: Pattern
  /** Keep smooth normals (figures, foliage blobs). */
  smooth?: boolean
  /** Per-face brightness jitter (0.08 = ±4 %). */
  jit?: number
  seed?: number
}

const tmpE = new THREE.Euler()
const tmpQ = new THREE.Quaternion()

export function placeMatrix(o: Place): THREE.Matrix4 {
  const s = o.s === undefined ? [1, 1, 1] : typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s
  tmpE.set(...(o.r ?? [0, 0, 0]), 'YXZ')
  return new THREE.Matrix4().compose(new THREE.Vector3(...(o.p ?? [0, 0, 0])), tmpQ.setFromEuler(tmpE).clone(), new THREE.Vector3(s[0], s[1], s[2]))
}

const colorCache = new Map<string, RGB>()
/** Linear RGB from an sRGB hex string. */
export function lin(hex: string, k = 1): RGB {
  let c = colorCache.get(hex)
  if (!c) {
    const t = new THREE.Color(hex)
    c = [t.r, t.g, t.b]
    colorCache.set(hex, c)
  }
  return [c[0] * k, c[1] * k, c[2] * k]
}
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const shade = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k]

/** Small deterministic hash in [0, 1). */
export function hash(a: number, b = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  return (h >>> 0) / 4294967296
}

/** Seeded random stream. */
export function rng(seed: number) {
  let i = 0
  return () => hash(seed, i++)
}

export type Anchor = { name: string; p: THREE.Vector3; dir?: THREE.Vector3 }

export class Kit {
  private parts: THREE.BufferGeometry[] = []
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()]
  readonly anchors: Anchor[] = []

  /** Run `fn` with an extra parent transform. */
  group(o: Place, fn: () => void): void {
    const parent = this.stack[this.stack.length - 1]
    this.stack.push(parent.clone().multiply(placeMatrix(o)))
    fn()
    this.stack.pop()
  }

  get matrix(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1]
  }

  /** Remember a point (chimney top, work spot, ...) in model space. */
  anchor(name: string, p: V3, dir?: V3): void {
    const v = new THREE.Vector3(...p).applyMatrix4(this.matrix)
    const d = dir ? new THREE.Vector3(...dir).transformDirection(this.matrix) : undefined
    this.anchors.push({ name, p: v, dir: d })
  }

  add(g: THREE.BufferGeometry, color: string | RGB, o: Place = {}, f: PartOpts = {}): void {
    const c: RGB = typeof color === 'string' ? lin(color) : color
    let geo = g
    if (f.smooth) {
      if (!geo.attributes.normal) geo.computeVertexNormals()
      geo = geo.index ? geo.toNonIndexed() : geo.clone()
    } else {
      geo = geo.index ? geo.toNonIndexed() : geo.clone()
      geo.deleteAttribute('normal')
      geo.computeVertexNormals()
    }
    g.dispose()
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k)
    const pos = geo.attributes.position
    const n = pos.count
    const aux = new Float32Array(n * 3)
    const flut = f.flutter
    for (let i = 0; i < n; i++) {
      aux[i * 3] = f.glow ?? 0
      aux[i * 3 + 1] = typeof flut === 'function' ? flut(pos.getX(i), pos.getY(i), pos.getZ(i)) : flut ?? 0
      aux[i * 3 + 2] = PATTERN[f.pattern ?? 'none']
    }
    geo.applyMatrix4(this.matrix.clone().multiply(placeMatrix(o)))
    const col = new Float32Array(n * 3)
    const seed = f.seed ?? this.parts.length * 7 + 3
    for (let i = 0; i < n; i += 3) {
      const j = f.jit ? 1 + (hash(i / 3, seed) - 0.5) * f.jit : 1
      for (let k = 0; k < 3; k++) {
        col[(i + k) * 3] = c[0] * j
        col[(i + k) * 3 + 1] = c[1] * j
        col[(i + k) * 3 + 2] = c[2] * j
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('aux', new THREE.BufferAttribute(aux, 3))
    this.parts.push(geo)
  }

  get empty(): boolean {
    return this.parts.length === 0
  }

  build(): THREE.BufferGeometry {
    const g = this.parts.length ? mergeGeometries(this.parts, false)! : emptyGeometry()
    for (const p of this.parts) p.dispose()
    this.parts = []
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }
}

export function emptyGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute([], 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute([], 3))
  g.setAttribute('aux', new THREE.Float32BufferAttribute([], 3))
  return g
}

// ---------------------------------------------------------------------------------------------
// Primitive shorthands (centred like three's own, y up).

export const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z)
/** Box with chamfered edges that catch the light. */
export const rbox = (x: number, y: number, z: number, r = 0.012) => new RoundedBoxGeometry(x, y, z, 1, Math.min(r, x / 2.01, y / 2.01, z / 2.01))
export const cyl = (rTop: number, rBot: number, h: number, seg = 12, open = false) => new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open)
export const cone = (r: number, h: number, seg = 12) => new THREE.CylinderGeometry(0, r, h, seg)
export const sphere = (r: number, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h)
export const ico = (r: number, detail = 0) => new THREE.IcosahedronGeometry(r, detail)
export const torus = (r: number, tube: number, radial = 6, tubular = 20, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, radial, tubular, arc)
export const lathe = (pts: [number, number][], seg = 14) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg)

/** Extrude a 2D outline (x/y) by `depth` along z, centred on z. */
export function slab(points: [number, number][], depth: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 })
  g.translate(0, 0, -depth / 2)
  return g
}

/** A flat polygon (x/z outline by increasing angle atan2(z, x)) at height y, facing up. */
export function flat(points: [number, number][], y = 0): THREE.BufferGeometry {
  const pos: number[] = []
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[0], b = points[i], c = points[i + 1]
    pos.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

/** A prism with a polygonal (x/z) cross-section from y0 to y1, with top and side faces. */
export function prism(points: [number, number][], y0: number, y1: number, top = true, bottom = false): THREE.BufferGeometry {
  const pos: number[] = []
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n]
    pos.push(a[0], y1, a[1], b[0], y0, b[1], a[0], y0, a[1])
    pos.push(a[0], y1, a[1], b[0], y1, b[1], b[0], y0, b[1])
  }
  if (top) for (let i = 1; i < n - 1; i++) {
    const a = points[0], b = points[i], c = points[i + 1]
    pos.push(a[0], y1, a[1], c[0], y1, c[1], b[0], y1, b[1])
  }
  if (bottom) for (let i = 1; i < n - 1; i++) {
    const a = points[0], b = points[i], c = points[i + 1]
    pos.push(a[0], y0, a[1], b[0], y0, b[1], c[0], y0, c[1])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

/** Pointy-top hexagon outline (circumradius r) as x/z points, by increasing angle (the winding
 * `flat` and `prism` expect). */
export function hexPts(r: number, rot = 0): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < 6; i++) {
    const a = rot + (Math.PI / 180) * (-30 + 60 * i)
    out.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return out
}

/** Gable roof: two slabs meeting at a ridge along x. Width w (x), depth d (z), rise h. */
export function gableRoof(k: Kit, w: number, d: number, h: number, color: string | RGB, o: Place = {}, opts: { over?: number; t?: number; ridge?: string | RGB; pattern?: Pattern } = {}) {
  const over = opts.over ?? 0.03
  const t = opts.t ?? 0.025
  const half = d / 2 + over
  const ang = Math.atan2(h, d / 2)
  const len = Math.hypot(half, h * (half / (d / 2)))
  k.group(o, () => {
    for (const s of [-1, 1]) {
      k.add(box(w + over * 2, t, len), color, {
        p: [0, h - Math.sin(ang) * len / 2 + t * 0.3, s * Math.cos(ang) * len / 2],
        r: [s * ang, 0, 0],
      }, { pattern: opts.pattern ?? 'roof', jit: 0.05 })
    }
    if (opts.ridge) k.add(box(w + over * 2 + 0.01, t * 1.2, t * 1.6), opts.ridge, { p: [0, h + t * 0.55, 0] })
  })
}

/** Triangular gable ends for a gable roof (wall colour), on the x ends. */
export function gableEnds(k: Kit, w: number, d: number, h: number, color: string | RGB, o: Place = {}, pattern: Pattern = 'plaster') {
  k.group(o, () => {
    const tri = slab([[-d / 2, 0], [d / 2, 0], [0, h]], 0.02)
    // slab is in x/y; rotate so its plane is y/z and sits at both ends
    const g = tri.clone()
    k.add(tri, color, { p: [w / 2 - 0.01, 0, 0], r: [0, Math.PI / 2, 0] }, { pattern })
    k.add(g, color, { p: [-w / 2 + 0.01, 0, 0], r: [0, Math.PI / 2, 0] }, { pattern })
  })
}

/** Pyramid / cone roof with n sides. */
export function spire(r: number, h: number, n = 4) {
  const g = cone(r, h, n)
  if (n === 4) g.rotateY(Math.PI / 4)
  g.translate(0, h / 2, 0)
  return g
}
