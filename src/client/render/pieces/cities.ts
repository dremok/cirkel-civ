// Cities: a ring of houses around a small plaza (a circle, as the game is called), a tower for the
// capital, a hall for other towns, an optional round wall, chimney smoke and a name plaque.
import * as THREE from 'three'
import { CITY_MAX_HP } from '../../../engine/config.ts'
import type { City, CityId, GameState, PlayerId, TileId } from '../../../engine/types.ts'
import { type Board, clamp01, colorIndexOf, easeOutBack, easeOutCubic, hash01, smoothstep, teamColors } from './common.ts'
import type { Fx } from './fx.ts'
import { Batch } from './gfx.ts'
import { withFlutter } from './kit.ts'
import type { Label, Labels } from './labels.ts'
import { CHIMNEY_TOP, PAINT, TOWER_TOP, hallModel, houseModel, plazaModel, towerModel, wallModel } from './models.ts'

const HOUSE_WALLS = ['#F4ECDD', '#ECE1CB', '#E7D7BB', '#F2E7D2', '#E0D2BA', '#EFE3CF']
/** Ring slots (angle in degrees, 0 = east, 90 = towards the viewer). Filled in this order. */
const RING = [-138, -42, 180, 0, 146, 34, -163, -17, 118, 62, -113, -67]
const RING_R = 0.585
export const PLAZA_Y = 0.014

interface Piece {
  kind: 'house' | 'hall' | 'tower'
  slot: number
  x: number
  z: number
  yaw: number
  scale: number
  wall: THREE.Color
  /** 0 = below ground, 1 = standing. */
  rise: number
  riseDelay: number
  roofDelay: number
}

export interface CityVis {
  id: CityId
  owner: PlayerId
  colorIdx: number
  tile: TileId
  name: string
  pop: number
  hp: number
  walls: boolean
  capital: boolean
  pieces: Piece[]
  wallSlot: number
  wallRise: number
  plazaSlot: number
  rise: number
  /** Roof colour transition (capture sweep). */
  fromColor: THREE.Color
  toColor: THREE.Color
  sweep: number
  smokeT: number[]
  plaque: Label
  popEl: HTMLElement
  hpEl: HTMLElement
  dirty: boolean
}

export class CityLayer {
  readonly cities = new Map<CityId, CityVis>()
  private houses: Batch
  private halls: Batch
  private towers: Batch
  private walls: Batch
  private plazas: Batch
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()
  private c = new THREE.Color()
  private stone = new THREE.Color(PAINT.stone)
  private plazaCol = new THREE.Color(PAINT.plaza)
  private towerCol = new THREE.Color('#E6DCCB')
  private axisY = new THREE.Vector3(0, 1, 0)

  constructor(private board: Board, root: THREE.Object3D, private labels: Labels, private fx: Fx) {
    const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })
    const roofMat = withFlutter(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true }), 0.009)
    const h = houseModel()
    const hall = hallModel()
    const t = towerModel()
    this.houses = new Batch(root, [
      { geo: h.neutral, mat: wallMat, shadow: true, receive: true },
      { geo: h.team, mat: roofMat, shadow: true, receive: true },
    ], 320)
    this.halls = new Batch(root, [
      { geo: hall.neutral, mat: wallMat, shadow: true, receive: true },
      { geo: hall.team, mat: roofMat, shadow: true, receive: true },
    ], 48)
    this.towers = new Batch(root, [
      { geo: t.neutral, mat: wallMat, shadow: true, receive: true },
      { geo: t.team, mat: roofMat, shadow: true, receive: true },
    ], 16)
    this.walls = new Batch(root, [{ geo: wallModel(), mat: wallMat, shadow: true, receive: true }], 48)
    this.plazas = new Batch(root, [{ geo: plazaModel(), mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), receive: true }], 48)
  }

  cityAt(tile: TileId): CityVis | undefined {
    for (const c of this.cities.values()) if (c.tile === tile) return c
    return undefined
  }

  /** Make the displayed cities match `state` exactly (no animation). */
  sync(state: GameState): void {
    const seen = new Set<CityId>()
    for (const city of state.cities) {
      seen.add(city.id)
      const ci = colorIndexOf(state, city.owner)
      let vis = this.cities.get(city.id)
      if (!vis || vis.tile !== city.tile) {
        if (vis) this.remove(city.id)
        vis = this.create(city, ci, false)
        continue
      }
      if (vis.owner !== city.owner || vis.colorIdx !== ci) this.setOwner(city.id, city.owner, ci, false)
      if (vis.capital !== city.capital) {
        this.remove(city.id)
        this.create(city, ci, false)
        continue
      }
      if (vis.pop !== city.pop) this.setPop(city.id, city.pop, false)
      if (vis.walls !== city.walls) this.setWalls(city.id, city.walls, false)
      if (vis.name !== city.name) { vis.name = city.name; this.updatePlaque(vis) }
      if (vis.hp !== city.hp) { vis.hp = city.hp; this.updatePlaque(vis) }
      for (const p of vis.pieces) { p.rise = 1; p.riseDelay = 0 }
      vis.rise = 1
      vis.sweep = 1
      vis.wallRise = vis.walls ? 1 : 0
      vis.dirty = true
    }
    for (const id of [...this.cities.keys()]) if (!seen.has(id)) this.remove(id)
  }

  create(city: City, colorIdx: number, animate: boolean): CityVis {
    const tc = teamColors(colorIdx)
    const popEl = document.createElement('span')
    popEl.className = 'pop'
    const hpEl = document.createElement('i')
    const el = document.createElement('div')
    el.className = 'cc-plaque'
    const name = document.createElement('span')
    name.className = 'name'
    const hpBar = document.createElement('span')
    hpBar.className = 'hp'
    hpBar.appendChild(hpEl)
    el.append(popEl, name, hpBar)
    const top = this.board.tops[city.tile]
    const plaque = this.labels.add(el, top.clone(), { dy: 4, zoom: 'plaque', toward: this.board.R * 0.8 })
    const vis: CityVis = {
      id: city.id, owner: city.owner, colorIdx, tile: city.tile, name: city.name, pop: 0, hp: city.hp,
      walls: false, capital: city.capital, pieces: [], wallSlot: -1, wallRise: 0, plazaSlot: this.plazas.alloc(),
      rise: animate ? 0 : 1, fromColor: tc.base.clone(), toColor: tc.base.clone(), sweep: 1,
      smokeT: [hash01(city.id, 3) * 2, hash01(city.id, 4) * 2 + 0.7], plaque, popEl, hpEl, dirty: true,
    }
    this.cities.set(city.id, vis)
    this.plazas.setColor(vis.plazaSlot, this.plazaCol)
    // the heart of the town
    this.addPiece(vis, city.capital ? 'tower' : 'hall', animate ? 0 : 1, 0)
    this.setPop(city.id, city.pop, animate)
    if (city.walls) this.setWalls(city.id, true, animate)
    this.updatePlaque(vis)
    return vis
  }

  remove(id: CityId): void {
    const vis = this.cities.get(id)
    if (!vis) return
    for (const p of vis.pieces) this.batchOf(p).release(p.slot)
    if (vis.wallSlot >= 0) this.walls.release(vis.wallSlot)
    this.plazas.release(vis.plazaSlot)
    this.labels.remove(vis.plaque)
    this.cities.delete(id)
  }

  private batchOf(p: Piece): Batch {
    return p.kind === 'house' ? this.houses : p.kind === 'hall' ? this.halls : this.towers
  }

  private addPiece(vis: CityVis, kind: Piece['kind'], rise: number, delay: number) {
    const batch = kind === 'house' ? this.houses : kind === 'hall' ? this.halls : this.towers
    const idx = vis.pieces.filter((p) => p.kind === 'house').length
    const seed = vis.id * 31 + vis.pieces.length
    const turn = (hash01(vis.id, 11) - 0.5) * 0.35
    let x = 0
    let z = 0
    let yaw = 0
    let scale = 1
    const R = this.board.R
    if (kind === 'house') {
      const a = (RING[idx % RING.length] * Math.PI) / 180 + turn + (hash01(seed, 1) - 0.5) * 0.12
      const r = (idx >= RING.length ? RING_R - 0.06 : RING_R) * R
      x = Math.cos(a) * r
      z = Math.sin(a) * r
      // door towards the plaza
      yaw = Math.atan2(-x, -z) + (hash01(seed, 2) - 0.5) * 0.25
      scale = (0.88 + hash01(seed, 3) * 0.22) * (idx >= RING.length ? 0.85 : 1)
    } else {
      const a = -Math.PI / 2 + turn
      const r = (kind === 'tower' ? 0.52 : 0.5) * R
      x = Math.cos(a) * r
      z = Math.sin(a) * r
      yaw = Math.atan2(-x, -z)
      scale = kind === 'tower' ? 1.05 : 1
    }
    const wall = kind === 'tower' ? this.towerCol.clone() : new THREE.Color(HOUSE_WALLS[Math.floor(hash01(seed, 5) * HOUSE_WALLS.length)])
    const p: Piece = { kind, slot: batch.alloc(), x, z, yaw, scale, wall, rise, riseDelay: delay, roofDelay: 0 }
    p.roofDelay = ((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 0.6
    batch.setColor(p.slot, wall, 0)
    vis.pieces.push(p)
    vis.dirty = true
  }

  /** Number of houses for a population. */
  private housesFor(pop: number) {
    return Math.min(RING.length + 2, 2 + pop)
  }

  setPop(id: CityId, pop: number, animate: boolean): void {
    const vis = this.cities.get(id)
    if (!vis) return
    const want = this.housesFor(pop)
    let have = vis.pieces.filter((p) => p.kind === 'house').length
    let k = 0
    while (have < want) {
      this.addPiece(vis, 'house', animate ? 0 : 1, animate ? 0.12 + k * 0.11 : 0)
      have++
      k++
    }
    while (have > want) {
      const i = vis.pieces.map((p) => p.kind).lastIndexOf('house')
      const [p] = vis.pieces.splice(i, 1)
      this.batchOf(p).release(p.slot)
      have--
    }
    vis.pop = pop
    this.updatePlaque(vis)
    vis.dirty = true
  }

  setWalls(id: CityId, walls: boolean, animate: boolean): void {
    const vis = this.cities.get(id)
    if (!vis) return
    vis.walls = walls
    if (walls && vis.wallSlot < 0) {
      vis.wallSlot = this.walls.alloc()
      this.walls.setColor(vis.wallSlot, this.stone)
      vis.wallRise = animate ? 0 : 1
    } else if (!walls && vis.wallSlot >= 0) {
      this.walls.release(vis.wallSlot)
      vis.wallSlot = -1
    }
    vis.dirty = true
  }

  setOwner(id: CityId, owner: PlayerId, colorIdx: number, animate: boolean): void {
    const vis = this.cities.get(id)
    if (!vis) return
    const tc = teamColors(colorIdx)
    vis.fromColor.copy(this.currentRoof(vis, 1))
    vis.toColor.copy(tc.base)
    vis.sweep = animate ? 0 : 1
    vis.owner = owner
    vis.colorIdx = colorIdx
    this.updatePlaque(vis)
    vis.dirty = true
  }

  setHp(id: CityId, hp: number): void {
    const vis = this.cities.get(id)
    if (!vis) return
    vis.hp = hp
    this.updatePlaque(vis)
  }

  /** Play the founding: houses rise one after another. */
  found(city: City, colorIdx: number): CityVis {
    this.remove(city.id)
    const vis = this.create(city, colorIdx, true)
    vis.pieces.forEach((p, i) => { p.rise = 0; p.riseDelay = 0.05 + i * 0.13 })
    vis.rise = 0
    vis.plaque.el.style.opacity = '0'
    return vis
  }

  private currentRoof(vis: CityVis, t: number): THREE.Color {
    return this.c.copy(vis.fromColor).lerp(vis.toColor, smoothstep(0, 1, t))
  }

  private updatePlaque(vis: CityVis) {
    const tc = teamColors(vis.colorIdx)
    const el = vis.plaque.el
    el.style.setProperty('--team', tc.css.base)
    el.style.setProperty('--team-dark', tc.css.dark)
    vis.popEl.textContent = String(vis.pop)
    const name = el.querySelector('.name')!
    if (name.textContent !== vis.name) name.textContent = vis.name
    const hpBar = el.querySelector('.hp') as HTMLElement
    const f = vis.hp / CITY_MAX_HP
    hpBar.style.display = f < 0.999 ? '' : 'none'
    vis.hpEl.style.width = `${Math.max(0, Math.min(1, f)) * 100}%`
  }

  /** World position of a city's highest point (for shots and labels). */
  topOf(id: CityId, out = new THREE.Vector3()): THREE.Vector3 {
    const vis = this.cities.get(id)
    if (!vis) return out.set(0, 0, 0)
    const t = this.board.tops[vis.tile]
    const tower = vis.pieces[0]
    if (tower) return out.set(t.x + tower.x, t.y + (tower.kind === 'tower' ? TOWER_TOP * 0.8 : 0.32), t.z + tower.z)
    return out.copy(t).setY(t.y + 0.3)
  }

  update(dt: number): void {
    for (const vis of this.cities.values()) {
      const top = this.board.tops[vis.tile]
      let animating = false
      if (vis.rise < 1) {
        vis.rise = Math.min(1, vis.rise + dt)
        animating = true
      }
      for (const p of vis.pieces) {
        if (p.rise < 1) {
          if (p.riseDelay > 0) p.riseDelay -= dt
          else {
            const before = p.rise
            p.rise = Math.min(1, p.rise + dt / 0.55)
            if (before === 0) this.fx.dust(this.v.set(top.x + p.x, top.y + 0.04, top.z + p.z), 3, 0.16)
          }
          animating = true
        }
      }
      if (vis.wallRise < 1 && vis.walls) {
        vis.wallRise = Math.min(1, vis.wallRise + dt / 0.8)
        animating = true
      }
      if (vis.sweep < 1) {
        vis.sweep = Math.min(1, vis.sweep + dt / 0.85)
        animating = true
      }
      if (vis.rise >= 1 && vis.plaque.el.style.opacity === '0') vis.plaque.el.style.opacity = ''
      if (vis.dirty || animating) this.write(vis)
      // chimney smoke from the first two houses
      for (let i = 0; i < vis.smokeT.length; i++) {
        vis.smokeT[i] -= dt
        if (vis.smokeT[i] <= 0) {
          vis.smokeT[i] = 1.5 + hash01(vis.id * 7 + Math.floor(performance.now() / 997), i) * 1.4
          const house = vis.pieces.filter((p) => p.kind === 'house')[i]
          if (house && house.rise >= 1) this.fx.smoke(this.chimneyTop(vis, house, this.v))
        }
      }
    }
    this.houses.commit()
    this.halls.commit()
    this.towers.commit()
    this.walls.commit()
    this.plazas.commit()
  }

  private chimneyTop(vis: CityVis, p: Piece, out: THREE.Vector3): THREE.Vector3 {
    const top = this.board.tops[vis.tile]
    out.copy(CHIMNEY_TOP).multiplyScalar(p.scale).applyAxisAngle(this.axisY, p.yaw)
    return out.add(this.s.set(top.x + p.x, top.y, top.z + p.z))
  }

  private write(vis: CityVis) {
    vis.dirty = false
    const top = this.board.tops[vis.tile]
    const { m, q, v, s } = this
    // plaza
    const pr = easeOutCubic(clamp01(vis.rise * 2))
    m.compose(v.set(top.x, top.y + 0.001, top.z), q.identity(), s.set(pr * this.board.R, 1, pr * this.board.R))
    this.plazas.setMatrix(vis.plazaSlot, m)
    for (const p of vis.pieces) {
      const r = p.riseDelay > 0 ? 0 : p.rise
      const e = easeOutBack(r, 0.9)
      // capture: each house hops as its roof flips to the new colour, in a sweep around the ring
      const t = clamp01((vis.sweep - p.roofDelay) / 0.32)
      const hop = t > 0 && t < 1 ? Math.sin(t * Math.PI) : 0
      const y = top.y - (1 - Math.min(1, e)) * 0.42 * p.scale + (e > 1 ? (e - 1) * 0.1 : 0) + hop * 0.06
      q.setFromAxisAngle(this.axisY, p.yaw)
      m.compose(v.set(top.x + p.x, y, top.z + p.z), q, s.setScalar(p.scale * this.board.R * (1 + hop * 0.08)))
      const b = this.batchOf(p)
      b.setMatrix(p.slot, r <= 0 ? m.makeScale(0, 0, 0) : m)
      b.setColor(p.slot, t < 0.5 ? vis.fromColor : vis.toColor, 1)
    }
    if (vis.wallSlot >= 0) {
      const w = easeOutCubic(vis.wallRise)
      q.identity()
      m.compose(v.set(top.x, top.y - (1 - w) * 0.2, top.z), q, s.set(this.board.R, Math.max(0.001, w) * this.board.R, this.board.R))
      this.walls.setMatrix(vis.wallSlot, m)
    }
  }

  /** The city whose plaque is under a client point (plaques ignore pointer events so panning works). */
  plaqueAt(clientX: number, clientY: number): CityVis | null {
    for (const c of this.cities.values()) {
      if (c.plaque.hidden || c.plaque.el.style.display === 'none') continue
      const r = c.plaque.el.getBoundingClientRect()
      if (clientX >= r.left - 2 && clientX <= r.right + 2 && clientY >= r.top - 2 && clientY <= r.bottom + 2) return c
    }
    return null
  }

  /** Approximate pick against the city volumes. */
  pick(ray: THREE.Ray, maxDist: number): CityVis | null {
    let best: CityVis | null = null
    let bestD = maxDist
    const p = this.v
    for (const vis of this.cities.values()) {
      const t = this.board.tops[vis.tile]
      for (let i = 0; i <= 2; i++) {
        p.copy(t).setY(t.y + 0.15 * i)
        if (ray.distanceSqToPoint(p) < 0.6 * 0.6) {
          const along = p.sub(ray.origin).dot(ray.direction)
          if (along < bestD) { bestD = along; best = vis }
          break
        }
      }
    }
    return best
  }

  dispose(): void {
    for (const id of [...this.cities.keys()]) this.remove(id)
    this.houses.dispose()
    this.halls.dispose()
    this.towers.dispose()
    this.walls.dispose()
    this.plazas.dispose()
  }
}
