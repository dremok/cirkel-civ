// Territory: tiles within CITY_WORK_RADIUS of a player's cities (nearest city wins, older city on
// ties). Drawn as a soft ink line along the outer edge with a gentle inner glow and a faint tint.
import * as THREE from 'three'
import { CITY_WORK_RADIUS } from '../../../engine/config.ts'
import { distance, tilesInRange } from '../../../engine/hex.ts'
import type { PlayerId, TileId } from '../../../engine/types.ts'
import { buildBand, buildFill } from './bands.ts'
import { type Board, teamColors } from './common.ts'
import { bandMaterial } from './gfx.ts'

export interface TerritoryCity { id: number; owner: PlayerId; colorIdx: number; tile: TileId; founded: number }

interface Layer { group: THREE.Group; mats: THREE.ShaderMaterial[]; fade: number; dir: 1 | -1 }

export class Territory {
  private layers: Layer[] = []
  private key = ''

  constructor(private board: Board, private root: THREE.Object3D) {}

  /** Owner per tile (null = nobody). */
  owners(cities: TerritoryCity[]): (TerritoryCity | null)[] {
    const map = this.board.map
    const best: (TerritoryCity | null)[] = new Array(map.tiles.length).fill(null)
    const bestD: number[] = new Array(map.tiles.length).fill(Infinity)
    const sorted = [...cities].sort((a, b) => a.founded - b.founded || a.id - b.id)
    for (const c of sorted) {
      for (const t of tilesInRange(map, c.tile, CITY_WORK_RADIUS)) {
        const d = distance(map, c.tile, t)
        if (d < bestD[t]) { bestD[t] = d; best[t] = c }
      }
    }
    return best
  }

  /** Rebuild if the city set changed; `animate` crossfades from the old borders. */
  set(cities: TerritoryCity[], animate: boolean, explored: Uint8Array | null = null, visible: Uint8Array | null = null): void {
    const owners = this.owners(cities)
    // under fog only explored tiles carry borders (nothing may draw over the cloud sea)
    let fogKey = ''
    if (explored) {
      let h = 0
      owners.forEach((c, t) => { if (c && explored[t]) h = (h * 31 + t + 1 + (visible && visible[t] ? 7919 : 0)) | 0 })
      fogKey = String(h)
    }
    const key = cities.map((c) => `${c.id}:${c.owner}:${c.colorIdx}:${c.tile}`).sort().join('|') + '#' + fogKey
    if (key === this.key) return
    this.key = key
    const byOwner = new Map<PlayerId, { tiles: TileId[]; colorIdx: number }>()
    owners.forEach((c, t) => {
      if (!c || (explored && !explored[t])) return
      let e = byOwner.get(c.owner)
      if (!e) byOwner.set(c.owner, (e = { tiles: [], colorIdx: c.colorIdx }))
      e.tiles.push(t)
    })
    const group = new THREE.Group()
    group.name = 'territory'
    const mats: THREE.ShaderMaterial[] = []
    for (const [owner, { tiles, colorIdx }] of byOwner) {
      const tc = teamColors(colorIdx)
      // an unexplored neighbour of the same owner is still inside (no false border along the clouds)
      const inRegion = (t: TileId) => owners[t]?.owner === owner
      const veil = (t: TileId) => (visible && !visible[t] ? 1 : 0)
      const band = buildBand(this.board, tiles, inRegion, { inset: 0.075, width: 0.42, line: 0.068, lift: 0.014, allowed: explored, veil })
      if (band) {
        const mat = bandMaterial({ color: tc.dark.clone().lerp(tc.base, 0.55), glow: tc.base, lineFrac: 0.068 / 0.42, lineAlpha: 0.94, glowAlpha: 0.2, ink: true, veil: true })
        mat.side = THREE.DoubleSide
        const mesh = new THREE.Mesh(band, mat)
        mesh.renderOrder = 1
        group.add(mesh)
        mats.push(mat)
      }
      const fill = buildFill(this.board, tiles, 0.0, 0.01, veil)
      if (fill) {
        const mat = bandMaterial({ color: tc.base, lineFrac: 0, lineAlpha: 0, glowAlpha: 0.055, veil: true })
        mat.side = THREE.DoubleSide
        const mesh = new THREE.Mesh(fill, mat)
        mesh.renderOrder = 0
        group.add(mesh)
        mats.push(mat)
      }
    }
    for (const l of this.layers) l.dir = -1
    if (!animate) {
      for (const l of this.layers) this.drop(l)
      this.layers = []
    }
    const layer: Layer = { group, mats, fade: animate ? 0 : 1, dir: 1 }
    for (const m of mats) m.uniforms.opacity.value = layer.fade
    this.root.add(group)
    this.layers.push(layer)
  }

  update(dt: number): void {
    for (const l of [...this.layers]) {
      l.fade = Math.min(1, Math.max(0, l.fade + l.dir * dt / 0.6))
      for (const m of l.mats) m.uniforms.opacity.value = l.fade
      if (l.dir < 0 && l.fade <= 0) {
        this.drop(l)
        this.layers.splice(this.layers.indexOf(l), 1)
      }
    }
  }

  private drop(l: Layer) {
    l.group.removeFromParent()
    l.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
    for (const m of l.mats) m.dispose()
  }

  dispose(): void {
    for (const l of this.layers) this.drop(l)
    this.layers = []
  }
}
