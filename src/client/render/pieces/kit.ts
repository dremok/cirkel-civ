// A tiny modelling kit: primitives are transformed, vertex-coloured and merged into two
// geometries per model: `neutral` (fixed colours: skin, wood, steel, stone) and `team` (vertex
// colour is a shade multiplier; the instance colour supplies the player colour).
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export type V3 = [number, number, number]
export interface Place {
  p?: V3
  r?: V3
  s?: V3 | number
  /** Cloth: flutter weight per vertex from its local (pre-transform) position, 0 = pinned. */
  flutter?: (x: number, y: number, z: number) => number
}

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpE = new THREE.Euler()

export function placeMatrix(o: Place): THREE.Matrix4 {
  const s = o.s === undefined ? [1, 1, 1] : typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s
  tmpE.set(...(o.r ?? [0, 0, 0]), 'YXZ')
  return new THREE.Matrix4().compose(new THREE.Vector3(...(o.p ?? [0, 0, 0])), tmpQ.setFromEuler(tmpE).clone(), new THREE.Vector3(s[0], s[1], s[2]))
}

export class Kit {
  private parts: { g: THREE.BufferGeometry; team: boolean; sil: boolean }[] = []
  /** Parts added while false are left out of the x-ray silhouette (e.g. the base). */
  sil = true
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()]

  /** Run `fn` with an extra parent transform. */
  group(o: Place, fn: () => void): void {
    const parent = this.stack[this.stack.length - 1]
    this.stack.push(parent.clone().multiply(placeMatrix(o)))
    fn()
    this.stack.pop()
  }

  /** Add a neutral part with a fixed colour. */
  add(g: THREE.BufferGeometry, color: string | THREE.Color, o: Place = {}): void {
    this.push(g, color instanceof THREE.Color ? color : new THREE.Color(color), false, o)
  }

  /** Add a team-coloured part; `shade` multiplies the player colour (1 = base). */
  team(g: THREE.BufferGeometry, shade = 1, o: Place = {}): void {
    this.push(g, new THREE.Color(shade, shade, shade), true, o)
  }

  private push(g: THREE.BufferGeometry, c: THREE.Color, team: boolean, o: Place) {
    let geo = g.index ? g.toNonIndexed() : g.clone()
    g.dispose()
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k)
    if (!geo.attributes.normal) geo.computeVertexNormals()
    const pos0 = geo.attributes.position
    const fl = new Float32Array(pos0.count)
    if (o.flutter) for (let i = 0; i < pos0.count; i++) fl[i] = o.flutter(pos0.getX(i), pos0.getY(i), pos0.getZ(i))
    geo.setAttribute('flutter', new THREE.BufferAttribute(fl, 1))
    tmpM.copy(this.stack[this.stack.length - 1]).multiply(placeMatrix(o))
    geo.applyMatrix4(tmpM)
    const n = geo.attributes.position.count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    this.parts.push({ g: geo, team, sil: this.sil })
  }

  build(): { neutral: THREE.BufferGeometry; team: THREE.BufferGeometry; sil: THREE.BufferGeometry } {
    const merge = (team: boolean | null) => {
      const list = this.parts.filter((p) => (team === null ? p.sil : p.team === team)).map((p) => p.g)
      const g = list.length ? mergeGeometries(list, false)! : emptyGeometry()
      g.computeBoundingSphere()
      return g
    }
    return { neutral: merge(false), team: merge(true), sil: merge(null) }
  }
}

function emptyGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute([], 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute([], 3))
  g.setAttribute('flutter', new THREE.Float32BufferAttribute([], 1))
  return g
}

// ---------------------------------------------------------------------------------------------
// Primitive shorthands (all centred like three's own, y up).

export const lathe = (pts: [number, number][], seg = 18) =>
  new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg)
export const sphere = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h)
export const dome = (r: number, w = 14, h = 6, cover = 0.5) => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI * cover)
export const cyl = (rTop: number, rBot: number, h: number, seg = 12, open = false) => new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open)
export const cone = (r: number, h: number, seg = 12) => new THREE.CylinderGeometry(0, r, h, seg)
export const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z)
export const torus = (r: number, tube: number, radial = 6, tubular = 24, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, radial, tubular, arc)
export const capsule = (r: number, len: number, cap = 4, radial = 12) => new THREE.CapsuleGeometry(r, len, cap, radial)

/** Extrude a 2D outline (x/y) by `depth` along z, centred on z. */
export function slab(points: [number, number][], depth: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6,
  })
  g.translate(0, 0, -depth / 2)
  return g
}

// ---------------------------------------------------------------------------------------------
// Cloth flutter: a gentle wave on vertices with a `flutter` weight, phase-shifted per instance.

export const flutterTime = { value: 0 }

export function withFlutter<T extends THREE.Material>(m: T, amp = 0.012): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlutterTime = flutterTime
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float flutter;\nuniform float uFlutterTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ph = 0.0;
          #ifdef USE_INSTANCING
          ph = float(gl_InstanceID) * 1.7;
          #endif
          float w = flutter;
          transformed.z += w * ${amp.toFixed(4)} * (sin(uFlutterTime * 4.3 + ph - transformed.x * 18.0 - transformed.y * 9.0) + 0.45 * sin(uFlutterTime * 7.1 + ph * 1.3 - transformed.x * 31.0));
        }`)
  }
  m.customProgramCacheKey = () => `flutter${amp}`
  return m
}
