// A tiny modelling kit: primitives are transformed, vertex-coloured and merged into one geometry
// per model. A per-vertex `paint` channel says how the instance colours apply:
//   0 fixed  : the vertex colour as is (skin, wood, steel, stone)
//   1 wall   : vertex colour x the instance's own plaster colour (aWall)
//   2 team   : vertex colour x the instance colour (the player colour, so captures can sweep it)
//   3 glow   : vertex colour, lit from within (warm windows, lanterns)
// Extra channels: `flutter` (cloth, 0 = pinned) and `idle` (how much a figure breathes and sways).
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

export const PAINT_FIXED = 0
export const PAINT_WALL = 1
export const PAINT_TEAM = 2
export const PAINT_GLOW = 3

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpE = new THREE.Euler()

export function placeMatrix(o: Place): THREE.Matrix4 {
  const s = o.s === undefined ? [1, 1, 1] : typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s
  tmpE.set(...(o.r ?? [0, 0, 0]), 'YXZ')
  return new THREE.Matrix4().compose(new THREE.Vector3(...(o.p ?? [0, 0, 0])), tmpQ.setFromEuler(tmpE).clone(), new THREE.Vector3(s[0], s[1], s[2]))
}

export interface Model {
  geo: THREE.BufferGeometry
  /** Geometry for x-ray silhouettes (parts added while `kit.sil` was true). */
  sil: THREE.BufferGeometry
  anchors: Record<string, THREE.Vector3[]>
}

export class Kit {
  private parts: { g: THREE.BufferGeometry; sil: boolean }[] = []
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()]
  readonly anchors: Record<string, THREE.Vector3[]> = {}
  /** Parts added while false are left out of the x-ray silhouette (e.g. the base). */
  sil = true
  /** Idle-motion weight for parts added from now on. */
  idle = 0

  /** Run `fn` with an extra parent transform. */
  group(o: Place, fn: () => void): void {
    const parent = this.stack[this.stack.length - 1]
    this.stack.push(parent.clone().multiply(placeMatrix(o)))
    fn()
    this.stack.pop()
  }

  /** A fixed-colour part. */
  add(g: THREE.BufferGeometry, color: string | THREE.Color, o: Place = {}): void {
    this.push(g, color instanceof THREE.Color ? color : new THREE.Color(color), PAINT_FIXED, o)
  }

  /** A plaster part: `shade` multiplies the instance's wall colour. */
  wall(g: THREE.BufferGeometry, shade = 1, o: Place = {}): void {
    this.push(g, new THREE.Color(shade, shade, shade), PAINT_WALL, o)
  }

  /** A team-coloured part; `shade` multiplies the player colour (1 = base). */
  team(g: THREE.BufferGeometry, shade = 1, o: Place = {}): void {
    this.push(g, new THREE.Color(shade, shade, shade), PAINT_TEAM, o)
  }

  /** A part lit from within. */
  glow(g: THREE.BufferGeometry, color: string, o: Place = {}): void {
    this.push(g, new THREE.Color(color), PAINT_GLOW, o)
  }

  /** Remember a point (in model space) under a name, e.g. chimney tops. */
  anchor(name: string, p: V3): void {
    const v = new THREE.Vector3(...p).applyMatrix4(this.stack[this.stack.length - 1])
    ;(this.anchors[name] ??= []).push(v)
  }

  private push(g: THREE.BufferGeometry, c: THREE.Color, paint: number, o: Place) {
    const geo = g.index ? g.toNonIndexed() : g.clone()
    g.dispose()
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k)
    if (!geo.attributes.normal) geo.computeVertexNormals()
    const pos0 = geo.attributes.position
    const n = pos0.count
    const fl = new Float32Array(n)
    if (o.flutter) for (let i = 0; i < n; i++) fl[i] = o.flutter(pos0.getX(i), pos0.getY(i), pos0.getZ(i))
    tmpM.copy(this.stack[this.stack.length - 1]).multiply(placeMatrix(o))
    geo.applyMatrix4(tmpM)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(n).fill(paint), 1))
    geo.setAttribute('flutter', new THREE.BufferAttribute(fl, 1))
    geo.setAttribute('idle', new THREE.BufferAttribute(new Float32Array(n).fill(this.idle), 1))
    this.parts.push({ g: geo, sil: this.sil })
  }

  build(): Model {
    const merge = (list: THREE.BufferGeometry[]) => {
      const g = list.length ? mergeGeometries(list, false)! : emptyGeometry()
      g.computeBoundingSphere()
      return g
    }
    const geo = merge(this.parts.map((p) => p.g))
    const silParts = this.parts.filter((p) => p.sil)
    const sil = silParts.length === this.parts.length ? geo : merge(silParts.map((p) => p.g.clone()))
    return { geo, sil, anchors: this.anchors }
  }
}

function emptyGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  for (const [k, n] of [['position', 3], ['normal', 3], ['color', 3], ['paint', 1], ['flutter', 1], ['idle', 1]] as const) {
    g.setAttribute(k, new THREE.Float32BufferAttribute([], n))
  }
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
/** A partial open cylinder (cape, hull side): `arc` radians centred on +z. */
export const shell = (rTop: number, rBot: number, h: number, arc: number, seg = 10) =>
  new THREE.CylinderGeometry(rTop, rBot, h, seg, 3, true, -arc / 2, arc)

/** Extrude a 2D outline (x/y) by `depth` along z, centred on z. */
export function slab(points: [number, number][], depth: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6,
  })
  g.translate(0, 0, -depth / 2)
  return g
}

/** A flat polygon lying in the x/z plane at y, facing up. */
export function flat(points: [number, number][], y = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)))
  const g = new THREE.ShapeGeometry(shape)
  g.rotateX(-Math.PI / 2)
  g.translate(0, y, 0)
  return g
}

/** A hip roof over a w x d rectangle (ridge along x), eaves at y = 0, apex height h. */
export function hipRoof(w: number, d: number, h: number, ridge = Math.max(0, w - d)): THREE.BufferGeometry {
  const x = w / 2
  const z = d / 2
  const r = ridge / 2
  const a = [-x, 0, -z], b = [x, 0, -z], c = [x, 0, z], e = [-x, 0, z]
  const p = [-r, h, 0], q = [r, h, 0]
  const tris = [
    ...e, ...c, ...q, ...e, ...q, ...p, // front
    ...b, ...a, ...p, ...b, ...p, ...q, // back
    ...c, ...b, ...q, // right
    ...a, ...e, ...p, // left
    ...a, ...b, ...c, ...a, ...c, ...e, // underside
  ]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3))
  g.computeVertexNormals()
  return g
}

/** A gable roof (ridge along x) as two slabs resting on the eaves (y = 0, z = ±d/2), apex at y = h. */
export function gableRoof(w: number, d: number, h: number, t = 0.012, over = 0.018): THREE.BufferGeometry[] {
  const ang = Math.atan2(h, d / 2)
  const len = Math.hypot(d / 2, h) + over
  const out: THREE.BufferGeometry[] = []
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(w + over * 2, t, len)
    g.translate(0, t / 2, s * len / 2)
    g.rotateX(s * ang)
    g.translate(0, h, 0)
    out.push(g)
  }
  return out
}

/** The triangle that closes a gable end (in the y/z plane, ridge along x), eave at y = 0. */
export function gableEnd(d: number, h: number, thick = 0.004): THREE.BufferGeometry {
  const g = slab([[-d / 2, 0], [d / 2, 0], [0, h]], thick)
  g.rotateY(Math.PI / 2)
  return g
}

// ---------------------------------------------------------------------------------------------
// Material: a standard material that understands the paint channels, cloth flutter and idle motion.

export const pieceUniforms = {
  uPieceTime: { value: 0 },
  uGlowColor: { value: new THREE.Color('#FFB868') },
  uGlowStrength: { value: 1.25 },
}
/** @deprecated use pieceUniforms.uPieceTime */
export const flutterTime = pieceUniforms.uPieceTime

export interface PieceMatOpts {
  roughness?: number
  flatShading?: boolean
  /** Flutter amplitude (world units). */
  flutter?: number
  /** Instances carry `aWall` (plaster colour). */
  wall?: boolean
  /** Instances carry `aPhase` and figures breathe and sway. */
  idle?: boolean
}

export function pieceMaterial(o: PieceMatOpts = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.roughness ?? 0.6, metalness: 0, flatShading: o.flatShading ?? false })
  const amp = (o.flutter ?? 0.012).toFixed(4)
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, pieceUniforms)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float paint;
        attribute float flutter;
        attribute float idle;
        ${o.wall ? 'attribute vec3 aWall;' : ''}
        ${o.idle ? 'attribute float aPhase;' : ''}
        uniform float uPieceTime;
        varying float vGlow;`)
      .replace('#include <color_vertex>', `
        vColor = vec4(1.0);
        vColor.rgb *= color;
        #ifdef USE_INSTANCING_COLOR
        float pTeam = step(1.5, paint) * (1.0 - step(2.5, paint));
        vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, pTeam);
        #endif
        ${o.wall ? 'float pWall = step(0.5, paint) * (1.0 - step(1.5, paint)); vColor.rgb *= mix(vec3(1.0), aWall, pWall);' : ''}
        vGlow = step(2.5, paint);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ph = 0.0;
          #ifdef USE_INSTANCING
          ph = float(gl_InstanceID) * 1.7;
          #endif
          ${o.idle ? 'ph = aPhase;' : ''}
          float t = uPieceTime;
          transformed.z += flutter * ${amp} * (sin(t * 4.3 + ph - transformed.x * 18.0 - transformed.y * 9.0) + 0.45 * sin(t * 7.1 + ph * 1.3 - transformed.x * 31.0));
          ${o.idle ? `
          // breathing and a slow shift of weight, pivoting at the feet
          float hgt = max(0.0, transformed.y - 0.06);
          transformed.y += idle * hgt * 0.016 * sin(t * 1.9 + ph);
          transformed.x += idle * hgt * 0.022 * sin(t * 0.73 + ph * 2.1);
          transformed.z += idle * hgt * 0.012 * sin(t * 0.61 + ph * 3.3);` : ''}
        }`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uGlowColor;
        uniform float uGlowStrength;
        varying float vGlow;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vGlow * diffuseColor.rgb * uGlowColor * uGlowStrength;`)
  }
  m.customProgramCacheKey = () => `piece:${amp}:${o.wall ? 1 : 0}:${o.idle ? 1 : 0}`
  return m
}
