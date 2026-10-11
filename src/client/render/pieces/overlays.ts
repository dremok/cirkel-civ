// Planning overlays: plan ribbons with tick dots and end markers, the selection ring, reachable
// tiles, the hover outline and the ghost preview path.
import * as THREE from 'three'
import type { TileId } from '../../../engine/types.ts'
import type { PlanStep, Selection, UnitPlan } from '../api.ts'
import { buildBand } from './bands.ts'
import { ATTACK_RED, type Board, IVORY, teamColors } from './common.ts'
import { Batch, bandMaterial, flatQuad, ribbonMaterial, spriteMaterial, swordsTexture, textures } from './gfx.ts'
import type { Label, Labels } from './labels.ts'
import { flagPole } from './models.ts'
import type { UnitLayer } from './units.ts'
import type { CityLayer } from './cities.ts'

const RIBBON_W = 0.15
const LIFT = 0.035
const RED = new THREE.Color(ATTACK_RED)

interface Flag { cloth: THREE.Mesh; base: Float32Array; phase: number }
interface Built { group: THREE.Group; decals: Batch; mats: THREE.ShaderMaterial[]; flags: Flag[]; swords: THREE.Sprite[]; labels: Label[] }

/** A smooth ribbon through hex centres, draped over the terrain. */
function pathGeometry(board: Board, tiles: TileId[], segFade: number[], o: { startTrim: number; endTrim: number; width: number }): THREE.BufferGeometry | null {
  if (tiles.length < 2) return null
  const pts = tiles.map((t) => new THREE.Vector3(board.tops[t].x, 0, board.tops[t].z))
  const curve: THREE.Curve<THREE.Vector3> = pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5) : new THREE.LineCurve3(pts[0], pts[1])
  const total = curve.getLength()
  const step = 0.045
  const N = Math.max(6, Math.ceil(total / step))
  const P: THREE.Vector3[] = []
  const S: number[] = []
  const seg: number[] = []
  const H: number[] = []
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const p = curve.getPointAt(u)
    P.push(p)
    S.push(u * total)
    const t = pts.length > 2 ? curve.getUtoTmapping(u, 0) : u
    seg.push(Math.min(tiles.length - 2, Math.floor(t * (tiles.length - 1) + 1e-6)))
    const tile = board.tileAtXZ(p.x, p.z)
    H.push(tile !== null ? board.tops[tile].y : board.tops[tiles[Math.min(tiles.length - 1, Math.round(t * (tiles.length - 1)))]].y)
  }
  // drape: rise before an edge (max filter), then smooth
  const k = Math.ceil(0.2 / (total / N))
  const Hm = H.map((_, i) => {
    let m = -Infinity
    for (let j = Math.max(0, i - k); j <= Math.min(N, i + k); j++) m = Math.max(m, H[j])
    return m
  })
  let Hs = Hm
  for (let pass = 0; pass < 2; pass++) {
    const kk = Math.ceil(0.12 / (total / N))
    Hs = Hs.map((_, i) => {
      let s = 0
      let c = 0
      for (let j = Math.max(0, i - kk); j <= Math.min(N, i + kk); j++) { s += Hs[j]; c++ }
      return Math.max(H[i], s / c)
    })
  }
  const pos: number[] = []
  const uv: number[] = []
  const fade: number[] = []
  const idx: number[] = []
  const t0 = o.startTrim
  const t1 = total - o.endTrim
  if (t1 - t0 < 0.05) return null
  let rows = 0
  for (let i = 0; i <= N; i++) {
    if (S[i] < t0 - 1e-6 || S[i] > t1 + 1e-6) continue
    const a = P[Math.max(0, i - 1)]
    const b = P[Math.min(N, i + 1)]
    let tx = b.x - a.x
    let tz = b.z - a.z
    const l = Math.hypot(tx, tz) || 1
    tx /= l; tz /= l
    const nx = -tz * o.width * 0.5
    const nz = tx * o.width * 0.5
    const y = Hs[i] + LIFT
    pos.push(P[i].x + nx, y, P[i].z + nz, P[i].x - nx, y, P[i].z - nz)
    uv.push(S[i], 0, S[i], 1)
    const edge = Math.min(1, (S[i] - t0) / 0.12, (t1 - S[i]) / 0.1)
    const f = segFade[seg[i]] * Math.max(0, edge)
    fade.push(f, f)
    if (rows > 0) {
      const r = (rows - 1) * 2
      idx.push(r, r + 2, r + 1, r + 1, r + 2, r + 3)
    }
    rows++
  }
  if (rows < 2) return null
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

export class Overlays {
  readonly root = new THREE.Group()
  private plans: Built | null = null
  private preview: Built | null = null
  private sel: Batch
  private selUnit: number | null = null
  private selCity: number | null = null
  private selCityMesh: THREE.Mesh | null = null
  private reach: THREE.Mesh | null = null
  private reachKey = ''
  private hover: THREE.Mesh | null = null
  private hoverTile: TileId | null = null
  private previewKey = ''
  private lastPlans: UnitPlan[] = []
  private selectedPlanUnit: number | null = null
  private poleGeo = flagPole()
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()
  private axisY = new THREE.Vector3(0, 1, 0)
  private reachMat = bandMaterial({ color: '#FFF8EA', glow: '#FFF3DC', lineFrac: 0.03 / 0.2, lineAlpha: 0.85, glowAlpha: 0.26 })
  private hoverMat = bandMaterial({ color: '#FFFFFF', glow: '#FFF6E6', lineFrac: 0.04 / 0.16, lineAlpha: 0.95, glowAlpha: 0.32 })
  private selCityMat = bandMaterial({ color: '#FFFFFF', glow: '#FFF6E6', lineFrac: 0.05 / 0.24, lineAlpha: 1, glowAlpha: 0.4 })
  private visible = true

  constructor(private board: Board, parent: THREE.Object3D, private units: UnitLayer, private cities: CityLayer, private labels: Labels) {
    this.root.name = 'overlays'
    parent.add(this.root)
    for (const m of [this.reachMat, this.hoverMat, this.selCityMat]) m.side = THREE.DoubleSide
    this.sel = new Batch(this.root, [{
      geo: flatQuad(), mat: spriteMaterial({ map: textures().decals, tritone: true, atlas: true, depthBias: 0.01 }), order: 2,
    }], 2, { aAlpha: 1, aUv: 4 })
    this.sel.alloc()
    this.sel.setExtra('aUv', 0, 0.5, 0, 0.25, 1)
  }

  setVisible(v: boolean) {
    this.visible = v
    this.root.visible = v
    this.units.liftEnabled = v
    for (const b of [this.plans, this.preview]) if (b) for (const l of b.labels) l.hidden = !v
  }

  setPlans(plans: UnitPlan[]) {
    this.lastPlans = plans
    this.rebuildPlans()
  }

  /** Re-anchor plans after units moved (e.g. after a replay). */
  refresh() {
    this.rebuildPlans()
  }

  private rebuildPlans() {
    if (this.plans) this.drop(this.plans)
    this.plans = this.build(this.lastPlans.map((p) => ({ unit: p.unit, steps: p.steps, kind: p.kind })), false)
  }

  setSelection(sel: Selection) {
    this.selUnit = sel.unit
    this.units.selected = sel.unit
    this.units.hoverTile = sel.hover
    if (this.selectedPlanUnit !== sel.unit) {
      this.selectedPlanUnit = sel.unit
      this.rebuildPlans()
    }
    // selected city outline
    if (this.selCity !== sel.city) {
      this.selCity = sel.city
      this.selCityMesh?.geometry.dispose()
      this.selCityMesh?.removeFromParent()
      this.selCityMesh = null
      const c = sel.city !== null ? this.cities.cities.get(sel.city) : undefined
      if (c) {
        const g = buildBand(this.board, [c.tile], null, { inset: 0.04, width: 0.24, line: 0.05, lift: 0.03 })
        if (g) {
          this.selCityMesh = new THREE.Mesh(g, this.selCityMat)
          this.selCityMesh.renderOrder = 3
          this.root.add(this.selCityMesh)
        }
      }
    }
    // reachable tiles
    const rk = sel.reachable.join(',')
    if (rk !== this.reachKey) {
      this.reachKey = rk
      this.reach?.geometry.dispose()
      this.reach?.removeFromParent()
      this.reach = null
      const g = sel.reachable.length ? buildBand(this.board, sel.reachable, null, { inset: 0.085, width: 0.2, line: 0.03, lift: 0.02 }) : null
      if (g) {
        this.reach = new THREE.Mesh(g, this.reachMat)
        this.reach.renderOrder = 2
        this.root.add(this.reach)
      }
    }
    // hover
    if (sel.hover !== this.hoverTile) {
      this.hoverTile = sel.hover
      this.hover?.geometry.dispose()
      this.hover?.removeFromParent()
      this.hover = null
      if (sel.hover !== null) {
        const g = buildBand(this.board, [sel.hover], null, { inset: 0.05, width: 0.16, line: 0.04, lift: 0.025 })
        if (g) {
          this.hover = new THREE.Mesh(g, this.hoverMat)
          this.hover.renderOrder = 3
          this.root.add(this.hover)
        }
      }
    }
    // preview path (ghost)
    const pk = sel.preview && sel.unit !== null ? `${sel.unit}:${sel.preview.kind}:${sel.preview.steps.map((s) => `${s.tile}.${s.turn}.${s.tick}`).join(',')}` : ''
    if (pk !== this.previewKey) {
      this.previewKey = pk
      if (this.preview) this.drop(this.preview)
      this.preview = sel.preview && sel.unit !== null ? this.build([{ unit: sel.unit, steps: sel.preview.steps, kind: sel.preview.kind }], true) : null
    }
  }

  private build(plans: { unit: number; steps: PlanStep[]; kind: UnitPlan['kind'] }[], ghost: boolean): Built {
    const group = new THREE.Group()
    const decals = new Batch(group, [{
      geo: flatQuad(), mat: spriteMaterial({ map: textures().decals, tritone: true, atlas: true, depthBias: 0.03 }), order: 11,
    }], 256, { aAlpha: 1, aUv: 4 })
    const built: Built = { group, decals, mats: [], flags: [], swords: [], labels: [] }
    const decal = (tile: TileId, cell: number, size: number, color: THREE.Color, alpha: number, lift = LIFT + 0.004) => {
      const slot = decals.alloc()
      if (slot < 0) return
      const t = this.board.tops[tile]
      this.m.compose(this.v.set(t.x, t.y + lift, t.z), this.q.identity(), this.s.set(size, 1, size))
      decals.setMatrix(slot, this.m)
      decals.setColor(slot, color)
      decals.setExtra('aAlpha', slot, alpha)
      decals.setExtra('aUv', slot, cell * 0.25, 0, 0.25, 1)
    }
    for (const plan of plans) {
      const vis = this.units.get(plan.unit)
      if (!vis || !plan.steps.length) continue
      const tc = teamColors(vis.colorIdx)
      const tiles = [vis.tile, ...plan.steps.map((s) => s.tile)]
      const later = (turn: number) => (turn > 0 ? 0.32 : 1)
      const fades = plan.steps.map((s) => later(s.turn) * (ghost ? 0.85 : 1))
      const last = plan.steps[plan.steps.length - 1]
      const endTrim = plan.kind === 'attack' ? 0.42 : plan.kind === 'found' ? 0.12 : 0.36
      const geo = pathGeometry(this.board, tiles, fades, { startTrim: 0.34, endTrim, width: RIBBON_W })
      if (geo) {
        const mat = ribbonMaterial({ color: tc.base, opacity: ghost ? 0.85 : 1, width: RIBBON_W })
        mat.side = THREE.DoubleSide
        const xray = ribbonMaterial({ color: tc.base, opacity: 0.28, xray: true, width: RIBBON_W })
        xray.side = THREE.DoubleSide
        const mesh = new THREE.Mesh(geo, mat)
        mesh.renderOrder = 10
        const ghostMesh = new THREE.Mesh(geo, xray)
        ghostMesh.renderOrder = 9
        group.add(mesh, ghostMesh)
        built.mats.push(mat, xray)
      }
      const detailed = ghost || plan.unit === this.selectedPlanUnit
      plan.steps.forEach((s, i) => {
        const isLast = i === plan.steps.length - 1
        if (isLast) return
        if (detailed && s.turn === 0) this.tickLabel(built, s.tile, s.tick, tc.css.base, ghost, false)
        else if (s.turn === 0) decal(s.tile, 0, 0.2, tc.base, 1)
        else decal(s.tile, 3, 0.15, tc.base, 0.45)
      })
      // end marker
      const alpha = last.turn > 0 ? 0.45 : ghost ? 0.85 : 1
      if (plan.kind === 'attack') {
        decal(last.tile, 1, 0.98, RED, alpha)
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: swordsTexture(ATTACK_RED), transparent: true, depthWrite: false, opacity: alpha }))
        sp.scale.setScalar(0.5)
        const t = this.board.tops[last.tile]
        const y = t.y + (this.units.unitAt(last.tile) ? 1.12 : 0.62)
        sp.position.set(t.x, y, t.z)
        sp.renderOrder = 12
        sp.userData.y = y
        group.add(sp)
        built.swords.push(sp)
      } else if (plan.kind === 'found') {
        decal(last.tile, 1, 0.7, tc.base, alpha * 0.8)
        this.flag(built, last.tile, tc.base, alpha)
      } else {
        decal(last.tile, 1, 0.9, tc.base, alpha)
      }
      if (detailed && last.turn === 0) this.tickLabel(built, last.tile, last.tick, tc.css.base, ghost, true)
    }
    decals.commit()
    this.root.add(group)
    for (const l of built.labels) l.hidden = !this.visible
    return built
  }

  private tickLabel(b: Built, tile: TileId, tick: number, color: string, ghost: boolean, end: boolean) {
    const el = document.createElement('div')
    el.className = `cc-tick${ghost ? ' ghost' : ''}`
    el.style.setProperty('--team', color)
    el.textContent = String(tick)
    const t = this.board.tops[tile]
    // the end numeral sits at the near edge of the ring so it never hides the unit standing there
    const at = new THREE.Vector3(t.x, t.y + LIFT, t.z)
    b.labels.push(this.labels.add(el, at, { toward: end ? this.board.R * 0.46 : 0, zoom: 'float' }))
  }

  private flag(b: Built, tile: TileId, color: THREE.Color, alpha: number) {
    const t = this.board.tops[tile]
    const g = new THREE.Group()
    g.position.set(t.x, t.y, t.z)
    const pole = new THREE.Mesh(this.poleGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, transparent: alpha < 1, opacity: alpha }))
    pole.castShadow = true
    const clothGeo = new THREE.PlaneGeometry(0.26, 0.16, 10, 3)
    clothGeo.translate(0.13 + 0.012, 0.5, 0)
    const cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.6, side: THREE.DoubleSide, transparent: alpha < 1, opacity: alpha }))
    cloth.castShadow = true
    g.add(pole, cloth)
    g.rotation.y = -0.5
    b.group.add(g)
    b.flags.push({ cloth, base: (clothGeo.attributes.position.array as Float32Array).slice(), phase: Math.random() * 6 })
  }

  private drop(b: Built) {
    for (const m of b.decals.meshes) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
    b.decals.dispose()
    b.group.removeFromParent()
    b.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry !== this.poleGeo) o.geometry.dispose()
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) m.dispose()
      }
    })
    for (const l of b.labels) this.labels.remove(l)
  }

  update(time: number) {
    for (const b of [this.plans, this.preview]) {
      if (!b) continue
      for (const m of b.mats) m.uniforms.uTime.value = time
      for (const f of b.flags) {
        const pos = f.cloth.geometry.attributes.position as THREE.BufferAttribute
        const arr = pos.array as Float32Array
        for (let i = 0; i < pos.count; i++) {
          const x = f.base[i * 3] - 0.012
          arr[i * 3 + 2] = f.base[i * 3 + 2] + Math.sin(x * 22 - time * 4.2 + f.phase) * 0.022 * (x / 0.26)
        }
        pos.needsUpdate = true
        f.cloth.geometry.computeVertexNormals()
      }
      for (const s of b.swords) s.position.y = s.userData.y + Math.sin(time * 2.2) * 0.03
    }
    // selection ring follows the unit
    const vis = this.selUnit !== null ? this.units.get(this.selUnit) : undefined
    if (vis) {
      const pulse = 0.85 + 0.15 * Math.sin(time * 3.1)
      const size = 1.12 + 0.03 * Math.sin(time * 3.1)
      this.q.setFromAxisAngle(this.axisY, time * 0.25)
      this.m.compose(this.v.set(vis.pos.x, vis.ground + 0.012, vis.pos.z), this.q, this.s.set(size, 1, size))
      this.sel.setMatrix(0, this.m)
      this.sel.setColor(0, IVORY)
      this.sel.setExtra('aAlpha', 0, pulse)
    } else {
      this.sel.setMatrix(0, this.m.makeScale(0, 0, 0))
    }
    this.sel.commit()
    if (this.selCityMesh) this.selCityMat.uniforms.opacity.value = 0.8 + 0.2 * Math.sin(time * 3.1)
  }

  dispose() {
    if (this.plans) this.drop(this.plans)
    if (this.preview) this.drop(this.preview)
    this.sel.dispose()
    for (const m of [this.reach, this.hover, this.selCityMesh]) m?.geometry.dispose()
    this.root.removeFromParent()
  }
}
