// Units: instanced painted miniatures with contact shadows, health arcs and stance glyphs.
import * as THREE from 'three'
import { UNIT_MAX_HP } from '../../../engine/config.ts'
import type { GameState, PlayerId, Stance, TileId, Unit, UnitId, UnitType } from '../../../engine/types.ts'
import { type Board, colorIndexOf, hash01, teamColors } from './common.ts'
import { Batch, GLYPH_CELL, arcGeometry, arcMaterial, billboardQuad, flatQuad, silhouetteMaterial, spriteMaterial, textures } from './gfx.ts'
import { pieceMaterial } from './kit.ts'
import { BASE_R, unitModel } from './models.ts'

const TYPES: UnitType[] = ['spear', 'archer', 'rider', 'settler']
const CAP = 192

export interface UnitVis {
  id: UnitId
  type: UnitType
  owner: PlayerId
  colorIdx: number
  slot: number
  deco: number
  hp: number
  hpShown: number
  stance: Stance
  tile: TileId
  /** Base position in world space (includes hops and sinking). */
  pos: THREE.Vector3
  /** Terrain height under the unit (for the contact shadow). */
  ground: number
  yaw: number
  /** Tilt in radians about a horizontal axis, pivoting on the base edge in direction (tdx, tdz). */
  tilt: number
  tdx: number
  tdz: number
  scale: number
  /** 0..1, decorations (shadow, arc, glyph) fade with this. */
  deco01: number
  glyphOverride: number | null
  glyphPulse: number
  /** Picked-up lift for hover/selection (animated towards `liftTo`). */
  lift: number
  dirty: boolean
}

export class UnitLayer {
  readonly units = new Map<UnitId, UnitVis>()
  /** Units on this tile / with this id lift slightly (hover, selection). */
  hoverTile: TileId | null = null
  selected: UnitId | null = null
  liftEnabled = true
  private batches = new Map<UnitType, Batch>()
  private shadows: Batch
  private arcs: Batch
  private glyphs: Batch
  private camDir = new THREE.Vector3()
  private lastCamAz = NaN
  private m = new THREE.Matrix4()
  private m2 = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private v2 = new THREE.Vector3()
  private base = new THREE.Matrix4()
  private faced = false
  private axis = new THREE.Vector3()

  constructor(private board: Board, root: THREE.Object3D, private standY: (tile: TileId) => number, private faceYaw: () => number = () => 0) {
    const body = pieceMaterial({ roughness: 0.58, idle: true })
    body.side = THREE.DoubleSide
    const sil = silhouetteMaterial()
    for (const type of TYPES) {
      const g = unitModel(type)
      const b = new Batch(root, [
        { geo: g.geo, mat: body, shadow: true, receive: true },
        { geo: g.sil, mat: sil, order: 7 },
      ], CAP, { aSil: 1, aPhase: 1 })
      // the silhouette takes the team colour
      b.meshes[1].instanceColor = b.meshes[0].instanceColor
      this.batches.set(type, b)
    }
    const tex = textures()
    this.shadows = new Batch(root, [{
      geo: flatQuad(), mat: spriteMaterial({ map: tex.blob, tint: '#2A2018' }), order: 2,
    }], CAP * 2, { aAlpha: 1 })
    this.arcs = new Batch(root, [{ geo: arcGeometry(BASE_R + 0.012, BASE_R + 0.058), mat: arcMaterial(), order: 3 }], CAP * 2, { aHp: 1 })
    this.glyphs = new Batch(root, [{
      geo: billboardQuad(),
      mat: spriteMaterial({ map: tex.glyphs, billboard: true, tritone: true, atlas: true, depthBias: 0.12 }),
      order: 6,
    }], CAP * 2, { aAlpha: 1, aUv: 4 })
  }

  unitAt(tile: TileId): UnitVis | undefined {
    for (const v of this.units.values()) if (v.tile === tile) return v
    return undefined
  }

  get(id: UnitId): UnitVis | undefined {
    return this.units.get(id)
  }

  /** Make the displayed units match `state` exactly (no animation). */
  sync(state: GameState): void {
    const seen = new Set<UnitId>()
    for (const u of state.units) {
      seen.add(u.id)
      const vis = this.units.get(u.id)
      if (!vis || vis.type !== u.type) {
        if (vis) this.remove(u.id)
        this.create(u, colorIndexOf(state, u.owner))
        continue
      }
      const ci = colorIndexOf(state, u.owner)
      if (vis.owner !== u.owner || vis.colorIdx !== ci) {
        vis.owner = u.owner
        vis.colorIdx = ci
        this.paint(vis)
      }
      if (vis.tile !== u.tile) this.place(vis, u.tile)
      if (vis.hp !== u.hp) { vis.hp = u.hp; vis.dirty = true }
      if (vis.stance !== u.stance) { vis.stance = u.stance; vis.dirty = true }
      // Settle any leftover animation state (e.g. a skipped replay).
      if (vis.tilt !== 0 || vis.scale !== 1 || vis.deco01 !== 1 || vis.glyphOverride !== null || vis.pos.distanceToSquared(this.standAt(vis.tile, this.v)) > 1e-8) {
        vis.tilt = 0; vis.scale = 1; vis.deco01 = 1; vis.glyphOverride = null
        this.place(vis, vis.tile)
      }
    }
    for (const id of [...this.units.keys()]) if (!seen.has(id)) this.remove(id)
  }

  create(u: Unit, colorIdx: number): UnitVis {
    const batch = this.batches.get(u.type)!
    const vis: UnitVis = {
      id: u.id, type: u.type, owner: u.owner, colorIdx,
      slot: batch.alloc(), deco: this.shadows.alloc(),
      hp: u.hp, hpShown: u.hp, stance: u.stance, tile: u.tile,
      pos: new THREE.Vector3(), ground: 0,
      yaw: this.faceYaw() + (hash01(u.id, 7) - 0.5) * 0.5,
      tilt: 0, tdx: 1, tdz: 0, scale: 1, deco01: 1,
      glyphOverride: null, glyphPulse: 0, lift: 0, dirty: true,
    }
    // decorations share one slot index across their batches
    this.arcs.alloc()
    this.glyphs.alloc()
    this.units.set(u.id, vis)
    this.paint(vis)
    this.place(vis, u.tile)
    return vis
  }

  remove(id: UnitId): void {
    const vis = this.units.get(id)
    if (!vis) return
    this.batches.get(vis.type)!.release(vis.slot)
    this.shadows.release(vis.deco)
    this.arcs.release(vis.deco)
    this.glyphs.release(vis.deco)
    this.units.delete(id)
  }

  /** Standing position on a tile. */
  standAt(tile: TileId, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.board.tops[tile]).setY(this.standY(tile))
  }

  /** Standing height of the terrain under a world point (-Infinity off the board). */
  groundAt(x: number, z: number): number {
    const t = this.board.tileAtXZ(x, z)
    return t === null ? -Infinity : this.standY(t)
  }

  place(vis: UnitVis, tile: TileId): void {
    vis.tile = tile
    this.standAt(tile, vis.pos)
    vis.ground = vis.pos.y
    vis.dirty = true
  }

  private paint(vis: UnitVis) {
    const tc = teamColors(vis.colorIdx)
    const b = this.batches.get(vis.type)!
    b.setColor(vis.slot, tc.base, 0)
    b.setExtra('aPhase', vis.slot, hash01(vis.id, 13) * 40)
    this.glyphs.setColor(vis.deco, tc.base)
    vis.dirty = true
  }

  update(dt: number, camera: THREE.Camera): void {
    if (!this.faced) {
      // units made before the camera settled turn to face it on the first frame
      this.faced = true
      for (const vis of this.units.values()) { vis.yaw = this.faceYaw() + (hash01(vis.id, 7) - 0.5) * 0.5; vis.dirty = true }
    }
    camera.getWorldDirection(this.camDir)
    const az = Math.atan2(this.camDir.x, this.camDir.z)
    const camMoved = Math.abs(az - this.lastCamAz) > 1e-4 || Number.isNaN(this.lastCamAz)
    this.lastCamAz = az
    for (const vis of this.units.values()) {
      if (vis.hpShown !== vis.hp) {
        const d = vis.hp - vis.hpShown
        vis.hpShown = Math.abs(d) < 0.02 ? vis.hp : vis.hpShown + d * Math.min(1, dt * 7)
        vis.dirty = true
      }
      if (vis.glyphOverride !== null) {
        vis.glyphPulse += dt
        vis.dirty = true
      }
      const want = this.liftEnabled ? (vis.id === this.selected ? 0.07 : vis.tile === this.hoverTile ? 0.035 : 0) : 0
      if (vis.lift !== want) {
        const d = want - vis.lift
        vis.lift = Math.abs(d) < 0.001 ? want : vis.lift + d * Math.min(1, dt * 14)
        vis.dirty = true
      }
      if (vis.dirty || camMoved) this.write(vis, az)
    }
    for (const b of this.batches.values()) b.commit()
    this.shadows.commit()
    this.arcs.commit()
    this.glyphs.commit()
  }

  private write(vis: UnitVis, camAz: number) {
    vis.dirty = false
    const { m, m2, q, v, axis, base } = this
    // base transform: T(pos) * [tilt about the base edge]
    base.makeTranslation(vis.pos.x, vis.pos.y + vis.lift, vis.pos.z)
    if (vis.tilt !== 0) {
      const px = vis.tdx * BASE_R
      const pz = vis.tdz * BASE_R
      axis.set(vis.tdz, 0, -vis.tdx).normalize()
      base.multiply(m2.makeTranslation(px, 0, pz))
      base.multiply(m2.makeRotationAxis(axis, vis.tilt))
      base.multiply(m2.makeTranslation(-px, 0, -pz))
    }
    // figure = base * Ry(yaw) * S
    m.copy(base).multiply(m2.makeRotationY(vis.yaw))
    if (vis.scale !== 1) m.scale(v.setScalar(Math.max(vis.scale, 1e-4)))
    const batch = this.batches.get(vis.type)!
    batch.setMatrix(vis.slot, m)

    const d = vis.deco01 * Math.min(1, vis.scale)
    batch.setExtra('aSil', vis.slot, d)
    // contact shadow, shrinking and fading as the unit lifts off the ground
    const lift = Math.max(0, vis.pos.y + vis.lift - vis.ground)
    const sh = 0.98 * (1 - Math.min(0.35, lift * 0.8)) * Math.max(vis.scale, 0.001)
    m.compose(v.set(vis.pos.x, vis.ground + 0.006, vis.pos.z), q.identity(), this.v2.set(sh, 1, sh))
    this.shadows.setMatrix(vis.deco, m)
    this.shadows.setExtra('aAlpha', vis.deco, 0.42 * d * (1 - Math.min(0.6, lift)))

    // health arc hugging the foot of the base (hidden at full health)
    const hpf = vis.hpShown / UNIT_MAX_HP
    if (hpf < 0.995 && d > 0.01) {
      m.copy(base).multiply(m2.makeTranslation(0, 0.004, 0)).scale(v.setScalar(d))
      this.arcs.setMatrix(vis.deco, m)
      this.arcs.setExtra('aHp', vis.deco, hpf)
    } else this.arcs.setMatrix(vis.deco, m.makeScale(0, 0, 0))

    // stance glyph on the rim, front-right as seen from the camera
    const a = camAz + Math.PI + 0.75
    const pulse = vis.glyphOverride !== null ? 1 + 0.18 * Math.sin(vis.glyphPulse * 10) * Math.exp(-vis.glyphPulse * 2) : 1
    const gs = 0.145 * d * pulse * (vis.glyphOverride !== null ? 1.3 : 1)
    v.set(Math.sin(a) * (BASE_R + 0.005), 0.085, Math.cos(a) * (BASE_R + 0.005)).applyMatrix4(base)
    m.compose(v, q.identity(), this.v2.setScalar(gs))
    this.glyphs.setMatrix(vis.deco, m)
    this.glyphs.setExtra('aAlpha', vis.deco, d)
    const cell = vis.glyphOverride ?? GLYPH_CELL[vis.stance]
    this.glyphs.setExtra('aUv', vis.deco, cell * 0.25, 0, 0.25, 1)
  }

  /** Approximate pick: the unit whose figure the ray passes through first. */
  pick(ray: THREE.Ray, maxDist: number): UnitVis | null {
    let best: UnitVis | null = null
    let bestD = maxDist
    const p = this.v
    for (const vis of this.units.values()) {
      // test a vertical capsule-ish cylinder: sample the closest approach to the axis
      const top = vis.type === 'rider' ? 0.75 : 0.6
      for (let i = 0; i <= 3; i++) {
        p.copy(vis.pos).setY(vis.pos.y + (top * i) / 3)
        const d2 = ray.distanceSqToPoint(p)
        if (d2 < 0.24 * 0.24) {
          const along = p.sub(ray.origin).dot(ray.direction)
          if (along < bestD) { bestD = along; best = vis }
          break
        }
      }
    }
    return best
  }

  dispose(): void {
    for (const b of this.batches.values()) b.dispose()
    this.shadows.dispose()
    this.arcs.dispose()
    this.glyphs.dispose()
  }
}
