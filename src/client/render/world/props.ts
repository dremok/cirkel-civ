// Instanced vegetation and props: pines, broadleaf trees (a few in autumn colours), meadow tufts,
// tiny flowers, wheat clumps and rocks. Less is more: a handful per tile, centres kept clear.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { WorldQuality } from '../api.ts'
import { BIOME, NATURE } from '../palette.ts'
import { lin, mix3 } from './builder.ts'
import { hash01, hexSdf, type Layout } from './layout.ts'
import { patchMaterial, windDepthMaterial } from './shading.ts'

type Kind = 'pine' | 'broad' | 'autumn' | 'tuft' | 'flower' | 'wheat' | 'rock' | 'blob'

interface Prop {
  tile: number
  m: THREE.Matrix4
  c: THREE.Color
}

const WIND: Record<Kind, number> = { pine: 0.022, broad: 0.026, autumn: 0.026, tuft: 0.018, flower: 0.012, wheat: 0.022, rock: 0, blob: 0 }
/** Radius of the soft contact shadow under a prop, relative to its scale (0 = none). */
const BLOB: Record<Kind, number> = { pine: 0.44, broad: 0.52, autumn: 0.52, tuft: 0, flower: 0, wheat: 0.34, rock: 0.62, blob: 0 }

// ------------------------------------------------------------------------------------------------
// Geometry (authored with the base at y = 0 and about 1 unit tall, coloured per vertex).

function paint(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number, ny: number) => [number, number, number]): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g
  ng.computeVertexNormals()
  const p = ng.attributes.position, n = ng.attributes.normal
  const col = new Float32Array(p.count * 3)
  // One colour per face (flat), from the face centroid.
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3
    const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3
    const ny = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3
    const c = fn(x, y, z, ny)
    for (let k = 0; k < 3; k++) col.set(c, (i + k) * 3)
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3))
  ng.deleteAttribute('uv')
  return ng
}

function jitter(g: THREE.BufferGeometry, amt: number, seed: number) {
  const p = g.attributes.position
  // Move coincident vertices together so the surface stays closed.
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const h = Math.round(x * 1000) * 73856093 ^ Math.round(y * 1000) * 19349663 ^ Math.round(z * 1000) * 83492791
    p.setXYZ(i, x + (hash01(h, seed) - 0.5) * amt, y + (hash01(h, seed + 1) - 0.5) * amt, z + (hash01(h, seed + 2) - 0.5) * amt)
  }
  return g
}

function pineGeometry(): THREE.BufferGeometry {
  const trunkC = lin(NATURE.trunk)
  const dark = lin(NATURE.pine, 0.92), light = lin(NATURE.pineLight)
  const parts: THREE.BufferGeometry[] = []
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.26, 6, 1)
  trunk.translate(0, 0.13, 0)
  parts.push(paint(trunk, () => trunkC))
  const tiers = [
    { r: 0.34, y0: 0.16, y1: 0.6 },
    { r: 0.27, y0: 0.38, y1: 0.8 },
    { r: 0.18, y0: 0.6, y1: 1.0 },
  ]
  tiers.forEach((t, i) => {
    const cone = new THREE.ConeGeometry(t.r, t.y1 - t.y0, 7, 1)
    cone.rotateY(i * 0.45)
    cone.translate(0, (t.y0 + t.y1) / 2, 0)
    parts.push(paint(cone, (_x, _y, _z, ny) => {
      const k = i / 2
      const base = mix3(dark, light, k * 0.7 + (ny < -0.5 ? -0.3 : 0))
      return ny < -0.5 ? mix3(base, dark, 0.6).map((v) => v * 0.7) as [number, number, number] : base
    }))
  })
  return mergeGeometries(parts)
}

function broadGeometry(canopy: string, canopyLight: string): THREE.BufferGeometry {
  const trunkC = lin(NATURE.trunk)
  const c0 = lin(canopy), c1 = lin(canopyLight)
  const parts: THREE.BufferGeometry[] = []
  const trunk = new THREE.CylinderGeometry(0.04, 0.06, 0.5, 6, 1)
  trunk.translate(0, 0.25, 0)
  parts.push(paint(trunk, () => trunkC))
  const blobs = [
    { r: 0.36, x: 0, y: 0.62, z: 0, s: 0.92 },
    { r: 0.24, x: 0.2, y: 0.5, z: 0.1, s: 0.9 },
    { r: 0.2, x: -0.15, y: 0.5, z: -0.14, s: 0.9 },
  ]
  blobs.forEach((bl, i) => {
    const ico = new THREE.IcosahedronGeometry(bl.r, 1)
    jitter(ico, bl.r * 0.22, 11 + i)
    ico.scale(1, bl.s, 1)
    ico.translate(bl.x, bl.y, bl.z)
    parts.push(paint(ico, (_x, y, _z, ny) => {
      const t = THREE.MathUtils.clamp(0.45 + ny * 0.4 + (y - 0.55) * 0.6, 0, 1)
      return mix3(c0, c1, t)
    }))
  })
  return mergeGeometries(parts)
}

function tuftGeometry(): THREE.BufferGeometry {
  const base = lin(BIOME.grass.dark, 0.85), tip = lin(BIOME.grass.light)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 6; i++) {
    const blade = new THREE.ConeGeometry(0.13, 1, 3, 1)
    blade.translate(0, 0.5, 0)
    const a = (i / 6) * Math.PI * 2 + hash01(i, 3) * 0.6
    const lean = 0.25 + hash01(i, 4) * 0.3
    blade.scale(1, 0.65 + hash01(i, 5) * 0.4, 1)
    blade.rotateZ(lean)
    blade.rotateY(a)
    blade.translate(Math.cos(a) * 0.06, 0, -Math.sin(a) * 0.06)
    parts.push(paint(blade, (_x, y) => mix3(base, tip, THREE.MathUtils.clamp(y * 1.2, 0, 1))))
  }
  return mergeGeometries(parts)
}

function flowerGeometry(): THREE.BufferGeometry {
  const stem = lin(BIOME.grass.dark)
  const parts: THREE.BufferGeometry[] = []
  const spots = [
    { x: 0, z: 0, h: 0.85 },
    { x: 0.32, z: 0.18, h: 0.65 },
    { x: -0.22, z: 0.3, h: 0.72 },
  ]
  for (const s of spots) {
    const st = new THREE.CylinderGeometry(0.03, 0.03, s.h, 3, 1)
    st.translate(s.x, s.h / 2, s.z)
    parts.push(paint(st, () => stem))
    const head = new THREE.IcosahedronGeometry(0.16, 0)
    head.translate(s.x, s.h, s.z)
    parts.push(paint(head, (_x, _y, _z, ny) => [1, 1, 1].map((v) => v * (0.88 + ny * 0.12)) as [number, number, number]))
  }
  return mergeGeometries(parts)
}

function wheatGeometry(): THREE.BufferGeometry {
  // A loose sheaf: many thin golden blades, a few carrying ears.
  const base = mix3(lin(BIOME.plains.dark), lin(NATURE.wheat), 0.4), tip = lin(BIOME.plains.light, 1.08), ear = lin(NATURE.wheat, 1.05)
  const parts: THREE.BufferGeometry[] = []
  const n = 16
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash01(i, 9) * 0.7
    const d = 0.04 + hash01(i, 10) * 0.22
    const h = 0.6 + hash01(i, 11) * 0.4
    const blade = new THREE.ConeGeometry(0.11, h, 3, 1)
    blade.translate(0, h / 2, 0)
    blade.rotateZ(0.08 + d * 0.9)
    blade.rotateY(a)
    blade.translate(Math.cos(a) * d * 0.6, 0, -Math.sin(a) * d * 0.6)
    parts.push(paint(blade, (_x, y) => mix3(base, tip, THREE.MathUtils.clamp(y * 1.15, 0, 1))))
    if (i % 3 === 0) {
      const hd = new THREE.OctahedronGeometry(0.075, 0)
      hd.scale(1, 2.8, 1)
      hd.translate(0, h, 0)
      hd.rotateZ(0.08 + d * 0.9)
      hd.rotateY(a)
      hd.translate(Math.cos(a) * d * 0.6, 0, -Math.sin(a) * d * 0.6)
      parts.push(paint(hd, (_x, _y, _z, ny) => mix3(ear, tip, ny > 0 ? 0.5 : 0)))
    }
  }
  return mergeGeometries(parts)
}

function rockGeometry(seed: number): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(0.5, 0)
  jitter(ico, 0.28, seed)
  ico.scale(1, 0.62, 0.9)
  ico.translate(0, 0.18, 0)
  const c = lin(NATURE.rock)
  const light = lin(BIOME.mountain.light)
  return paint(ico, (x, _y, z, ny) => mix3(c, light, THREE.MathUtils.clamp(0.25 + ny * 0.35 + hash01(Math.round((x + z) * 999), seed) * 0.2, 0, 1)))
}

const WHITE = new THREE.Color(1, 1, 1)

/** A soft round contact shadow: white at the rim, grey in the middle, drawn with multiply blending. */
function blobTexture(): THREE.DataTexture {
  const n = 64
  const data = new Uint8Array(n * n * 4)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const dx = (i + 0.5) / n * 2 - 1, dy = (j + 0.5) / n * 2 - 1
    const d = Math.min(1, Math.hypot(dx, dy))
    const k = Math.pow(1 - d * d * (3 - 2 * d), 1.6)
    const v = Math.round(255 * (1 - 0.42 * k))
    data.set([v, v, v, 255], (j * n + i) * 4)
  }
  const t = new THREE.DataTexture(data, n, n)
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

// ------------------------------------------------------------------------------------------------
// Placement

function place(layout: Layout, quality: WorldQuality): Map<Kind, Prop[]> {
  const out = new Map<Kind, Prop[]>()
  const { map, cx, cz, top } = layout
  const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
  const add = (kind: Kind, tile: number, x: number, z: number, s: number, rot: number, c: THREE.Color, sy = 1) => {
    tmpP.set(x, top[tile] - 0.01, z)
    tmpQ.setFromAxisAngle(up, rot)
    tmpS.set(s, s * sy, s)
    const m = new THREE.Matrix4().compose(tmpP, tmpQ, tmpS)
    let list = out.get(kind)
    if (!list) out.set(kind, (list = []))
    list.push({ tile, m, c })
    if (BLOB[kind] > 0) {
      const r = s * BLOB[kind] * (kind === 'rock' ? Math.max(1, sy) : 1)
      tmpP.y = top[tile] + 0.003
      tmpS.set(r, 1, r)
      let blobs = out.get('blob')
      if (!blobs) out.set('blob', (blobs = []))
      blobs.push({ tile, m: new THREE.Matrix4().compose(tmpP, tmpQ, tmpS), c: WHITE })
    }
  }
  const lite = quality === 'low'

  for (const t of map.tiles) {
    const id = t.id
    let k = 0
    const rnd = () => hash01(id, 1000 + k++)
    const spots: { x: number; z: number; r: number }[] = []
    /** A free spot between rMin and the hex edge (minus margin), or null. */
    const spot = (rad: number, rMin: number, margin: number) => {
      // Keep the centre clear for a piece's base (about 0.4 across the hex's middle).
      const r0 = Math.max(rMin, (rad > 0.075 ? 0.42 : 0.38) + rad * 0.5)
      for (let tries = 0; tries < 16; tries++) {
        const a = rnd() * Math.PI * 2
        const d = r0 + rnd() * (0.85 - r0)
        const x = Math.cos(a) * d, z = Math.sin(a) * d
        if (hexSdf(x, z) > -margin - rad) continue
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < (s.r + rad) * 0.9)) continue
        spots.push({ x, z, r: rad })
        return { x: cx[id] + x, z: cz[id] + z }
      }
      return null
    }
    const tint = (base: number, spread: number) => new THREE.Color().setScalar(base + (rnd() - 0.5) * spread)
    const b = t.biome

    if (b === 'forest') {
      const n = 3 + Math.floor(rnd() * 3)
      const piney = t.height >= 4 ? 0.8 : 0.3
      for (let i = 0; i < n; i++) {
        const pine = rnd() < piney
        const s = pine ? 0.48 + rnd() * 0.24 : 0.4 + rnd() * 0.18
        const p = spot(pine ? 0.13 * s / 0.5 : 0.16 * s / 0.45, 0.32, 0.06)
        if (!p) continue
        if (pine) add('pine', id, p.x, p.z, s, rnd() * 6.28, tint(1, 0.16))
        else if (rnd() < 0.07) add('autumn', id, p.x, p.z, s, rnd() * 6.28, rnd() < 0.4 ? new THREE.Color(1, 0.78, 0.74) : tint(1, 0.1))
        else add('broad', id, p.x, p.z, s, rnd() * 6.28, tint(1, 0.16))
      }
      if (!lite) for (let i = 0; i < 4; i++) { const p = spot(0.05, 0.25, 0.05); if (p) add('tuft', id, p.x, p.z, 0.09 + rnd() * 0.04, rnd() * 6.28, tint(0.78, 0.1)) }
    } else if (b === 'grass') {
      if (rnd() < 0.14) {
        const s = 0.34 + rnd() * 0.12
        const p = spot(0.14, 0.42, 0.06)
        if (p) add(rnd() < 0.08 ? 'autumn' : 'broad', id, p.x, p.z, s, rnd() * 6.28, tint(1.02, 0.12))
      }
      const n = (lite ? 3 : 6) + Math.floor(rnd() * 5)
      for (let i = 0; i < n; i++) { const p = spot(0.06, 0.22, 0.04); if (p) add('tuft', id, p.x, p.z, 0.1 + rnd() * 0.08, rnd() * 6.28, tint(1, 0.18)) }
      const f = lite ? 0 : Math.floor(rnd() * 2.6)
      const flowerCols = [NATURE.flowerA, NATURE.flowerB, NATURE.flowerC]
      for (let i = 0; i < f; i++) {
        const p = spot(0.05, 0.28, 0.05)
        if (p) add('flower', id, p.x, p.z, 0.1 + rnd() * 0.03, rnd() * 6.28, new THREE.Color(flowerCols[Math.floor(rnd() * 3)]))
      }
    } else if (b === 'plains') {
      const n = (lite ? 3 : 5) + Math.floor(rnd() * 3)
      for (let i = 0; i < n; i++) { const p = spot(0.1, 0.24, 0.04); if (p) add('wheat', id, p.x, p.z, 0.2 + rnd() * 0.08, rnd() * 6.28, tint(1.05, 0.1)) }
      if (rnd() < 0.2) { const p = spot(0.06, 0.35, 0.06); if (p) add('rock', id, p.x, p.z, 0.08 + rnd() * 0.05, rnd() * 6.28, tint(1, 0.1)) }
    } else if (b === 'hills') {
      // Upland: a boulder or two, dry heath tufts, now and then a wind-bent pine.
      const n = 1 + Math.floor(rnd() * 2.4)
      for (let i = 0; i < n; i++) { const p = spot(0.14, 0.36, 0.05); if (p) add('rock', id, p.x, p.z, 0.16 + rnd() * 0.12, rnd() * 6.28, tint(1, 0.12), 0.7 + rnd() * 0.6) }
      for (let i = 0; i < 2; i++) { const p = spot(0.05, 0.3, 0.05); if (p) add('rock', id, p.x, p.z, 0.05 + rnd() * 0.04, rnd() * 6.28, tint(0.95, 0.1)) }
      if (rnd() < 0.3) { const p = spot(0.13, 0.4, 0.06); if (p) add('pine', id, p.x, p.z, 0.42 + rnd() * 0.14, rnd() * 6.28, tint(1, 0.12)) }
      const nt = lite ? 2 : 5
      for (let i = 0; i < nt; i++) { const p = spot(0.05, 0.24, 0.04); if (p) add('tuft', id, p.x, p.z, 0.09 + rnd() * 0.05, rnd() * 6.28, new THREE.Color(1.12 + rnd() * 0.1, 1.0, 0.62)) }
    } else if (b === 'beach') {
      if (rnd() < 0.4) { const p = spot(0.05, 0.35, 0.08); if (p) add('rock', id, p.x, p.z, 0.05 + rnd() * 0.04, rnd() * 6.28, new THREE.Color(1.08, 1.04, 0.98)) }
      if (!lite && rnd() < 0.3) { const p = spot(0.05, 0.3, 0.06); if (p) add('tuft', id, p.x, p.z, 0.08 + rnd() * 0.03, rnd() * 6.28, new THREE.Color(1.25, 1.15, 0.75)) }
    } else if (b === 'mountain') {
      if (rnd() < 0.6) { const p = spot(0.08, 0.6, 0.04); if (p) add('rock', id, p.x, p.z, 0.08 + rnd() * 0.06, rnd() * 6.28, tint(0.95, 0.1)) }
    }
  }
  return out
}

// ------------------------------------------------------------------------------------------------

export interface Props {
  group: THREE.Group
  setCleared(tiles: Iterable<number>): void
  dispose(): void
}

export function buildProps(layout: Layout, quality: WorldQuality): Props {
  const group = new THREE.Group()
  group.name = 'props'
  const geos: Record<Kind, THREE.BufferGeometry> = {
    pine: pineGeometry(),
    broad: broadGeometry(NATURE.broadleaf, NATURE.broadleafLight),
    autumn: broadGeometry(NATURE.rust, NATURE.amber),
    tuft: tuftGeometry(),
    flower: flowerGeometry(),
    wheat: wheatGeometry(),
    rock: mergeGeometries([rockGeometry(1)]),
    blob: new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
  }
  const blobTex = blobTexture()
  const placed = place(layout, quality)
  const meshes: { kind: Kind; mesh: THREE.InstancedMesh; props: Prop[] }[] = []
  const mats: THREE.Material[] = []
  for (const [kind, props] of placed) {
    const mat = kind === 'blob'
      ? new THREE.MeshBasicMaterial({
        map: blobTex, blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false,
        toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      })
      : patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), { wind: WIND[kind] })
    mats.push(mat)
    const mesh = new THREE.InstancedMesh(geos[kind], mat, props.length)
    mesh.name = `props-${kind}`
    const big = kind === 'pine' || kind === 'broad' || kind === 'autumn' || kind === 'rock' || kind === 'wheat'
    mesh.castShadow = big
    mesh.receiveShadow = kind !== 'blob'
    if (kind === 'blob') mesh.renderOrder = 0.5
    if (WIND[kind] > 0 && big) {
      const dm = windDepthMaterial(WIND[kind])
      mats.push(dm)
      mesh.customDepthMaterial = dm
    }
    meshes.push({ kind, mesh, props })
    group.add(mesh)
  }

  const setCleared = (tiles: Iterable<number>) => {
    const cleared = new Set(tiles)
    for (const { mesh, props } of meshes) {
      let n = 0
      for (const p of props) {
        if (cleared.has(p.tile)) continue
        mesh.setMatrixAt(n, p.m)
        mesh.setColorAt(n, p.c)
        n++
      }
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }
  setCleared([])

  return {
    group,
    setCleared,
    dispose() {
      for (const { mesh } of meshes) mesh.dispose()
      for (const g of Object.values(geos)) g.dispose()
      for (const m of mats) m.dispose()
      blobTex.dispose()
    },
  }
}
