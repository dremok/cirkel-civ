// Effects: soft billboard particles (dust, smoke, sparks), ground rings and arrows in flight.
import * as THREE from 'three'
import { easeOutCubic } from './common.ts'
import { Batch, FX_CELL, billboardQuad, flatQuad, spriteMaterial, textures } from './gfx.ts'
import { arrowModel } from './models.ts'

interface Particle {
  slot: number
  cell: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  size0: number
  size1: number
  alpha: number
  age: number
  life: number
  rot: number
  vrot: number
  drag: number
  grav: number
  fadeIn: number
}

interface Ring { slot: number; pos: THREE.Vector3; size0: number; size1: number; age: number; life: number; alpha: number }

interface Arrow {
  slot: number
  from: THREE.Vector3
  to: THREE.Vector3
  apex: number
  age: number
  dur: number
  onHit?: () => void
  trail: number
}

const DUST = new THREE.Color('#E6D8BC')
const SMOKE = new THREE.Color('#EEE8DE')
const SPARK = new THREE.Color('#FFF1C4')
const TRAIL = new THREE.Color('#FFFDF6')

export class Fx {
  private sprites: Batch
  private rings: Batch
  private arrows: Batch
  private parts: Particle[] = []
  private ringList: Ring[] = []
  private flights: Arrow[] = []
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()
  private bx = new THREE.Vector3()
  private by = new THREE.Vector3()
  private bz = new THREE.Vector3()
  private up = new THREE.Vector3(0, 1, 0)

  constructor(root: THREE.Object3D) {
    const tex = textures()
    this.sprites = new Batch(root, [{
      geo: billboardQuad(), mat: spriteMaterial({ map: tex.fx, billboard: true, atlas: true, rot: true, depthBias: 0.05 }), order: 8,
    }], 700, { aAlpha: 1, aUv: 4, aRot: 1 })
    this.rings = new Batch(root, [{
      geo: flatQuad(), mat: spriteMaterial({ map: tex.fx, atlas: true, depthBias: 0.02 }), order: 4,
    }], 48, { aAlpha: 1, aUv: 4 })
    for (let i = 0; i < 48; i++) this.rings.setExtra('aUv', i, FX_CELL.ring * 0.25, 0, 0.25, 1)
    this.arrows = new Batch(root, [{
      geo: arrowModel(), mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), shadow: true,
    }], 64)
  }

  private emit(p: Omit<Particle, 'slot' | 'age'>, color: THREE.Color) {
    const slot = this.sprites.alloc()
    if (slot < 0) return
    this.sprites.setColor(slot, color)
    this.sprites.setExtra('aUv', slot, p.cell * 0.25, 0, 0.25, 1)
    this.parts.push({ ...p, slot, age: 0, pos: p.pos.clone(), vel: p.vel.clone() })
  }

  /** A low ring of dust kicked up on the ground. */
  dust(at: THREE.Vector3, n = 6, size = 0.22, color = DUST) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.8
      const sp = 0.35 + Math.random() * 0.5
      this.emit({
        cell: Math.random() < 0.5 ? FX_CELL.dust : FX_CELL.puff,
        pos: this.v.set(at.x + Math.cos(a) * 0.08, at.y + 0.04, at.z + Math.sin(a) * 0.08),
        vel: this.s.set(Math.cos(a) * sp, 0.18 + Math.random() * 0.25, Math.sin(a) * sp),
        size0: size * 0.5, size1: size * (1.3 + Math.random() * 0.6), alpha: 0.6, life: 0.7 + Math.random() * 0.5,
        rot: Math.random() * 6, vrot: (Math.random() - 0.5) * 2, drag: 3.2, grav: -0.05, fadeIn: 0.08,
      }, color)
    }
  }

  /** A bright clash spark with a few streaks. */
  spark(at: THREE.Vector3, size = 0.5) {
    this.emit({
      cell: FX_CELL.spark, pos: at, vel: this.s.set(0, 0.05, 0), size0: size * 0.4, size1: size,
      alpha: 1, life: 0.32, rot: Math.random(), vrot: 1.5, drag: 0, grav: 0, fadeIn: 0.02,
    }, SPARK)
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2
      this.emit({
        cell: FX_CELL.puff, pos: at, vel: this.s.set(Math.cos(a) * 1.6, 0.8 + Math.random() * 0.8, Math.sin(a) * 1.6),
        size0: 0.05, size1: 0.02, alpha: 1, life: 0.35 + Math.random() * 0.2, rot: 0, vrot: 0, drag: 2.5, grav: 4, fadeIn: 0.01,
      }, SPARK)
    }
  }

  /** One soft chimney puff drifting with the wind. */
  smoke(at: THREE.Vector3) {
    this.emit({
      cell: FX_CELL.puff, pos: at, vel: this.s.set(0.035 + Math.random() * 0.02, 0.13 + Math.random() * 0.04, -0.02),
      size0: 0.05, size1: 0.26 + Math.random() * 0.08, alpha: 0.32, life: 3.6 + Math.random(),
      rot: Math.random() * 6, vrot: 0.2, drag: 0.15, grav: -0.005, fadeIn: 0.25,
    }, SMOKE)
  }

  /** An expanding ring on the ground (spawns, captures). */
  ring(at: THREE.Vector3, color: THREE.Color, size0 = 0.4, size1 = 1.6, life = 0.8, alpha = 0.9) {
    const slot = this.rings.alloc()
    if (slot < 0) return
    this.rings.setColor(slot, color)
    this.ringList.push({ slot, pos: at.clone(), size0, size1, age: 0, life, alpha })
  }

  /** Fly an arrow in an arc; `onHit` fires on impact. */
  arrow(from: THREE.Vector3, to: THREE.Vector3, dur: number, onHit?: () => void) {
    const slot = this.arrows.alloc()
    if (slot < 0) { onHit?.(); return }
    const apex = 0.35 + from.distanceTo(to) * 0.16
    this.flights.push({ slot, from: from.clone(), to: to.clone(), apex, age: 0, dur, onHit, trail: 0 })
  }

  update(dt: number) {
    const { m, q, v, s } = this
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]
      p.age += dt
      if (p.age >= p.life) {
        this.sprites.release(p.slot)
        this.parts.splice(i, 1)
        continue
      }
      const t = p.age / p.life
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt))
      p.vel.y -= p.grav * dt
      p.pos.addScaledVector(p.vel, dt)
      p.rot += p.vrot * dt
      const size = p.size0 + (p.size1 - p.size0) * easeOutCubic(t)
      const fade = Math.min(1, t / Math.max(1e-3, p.fadeIn)) * (1 - t) ** 1.6
      m.compose(p.pos, q.identity(), s.setScalar(size))
      this.sprites.setMatrix(p.slot, m)
      this.sprites.setExtra('aAlpha', p.slot, p.alpha * fade)
      this.sprites.setExtra('aRot', p.slot, p.rot)
    }
    for (let i = this.ringList.length - 1; i >= 0; i--) {
      const r = this.ringList[i]
      r.age += dt
      if (r.age >= r.life) {
        this.rings.release(r.slot)
        this.ringList.splice(i, 1)
        continue
      }
      const t = r.age / r.life
      const size = r.size0 + (r.size1 - r.size0) * easeOutCubic(t)
      m.compose(v.copy(r.pos).setY(r.pos.y + 0.02), q.identity(), s.set(size, 1, size))
      this.rings.setMatrix(r.slot, m)
      this.rings.setExtra('aAlpha', r.slot, r.alpha * (1 - t) ** 1.5)
    }
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i]
      f.age += dt
      const t = Math.min(1, f.age / f.dur)
      if (t >= 1) {
        this.arrows.release(f.slot)
        this.flights.splice(i, 1)
        f.onHit?.()
        continue
      }
      const pos = v.lerpVectors(f.from, f.to, t)
      pos.y += f.apex * 4 * t * (1 - t)
      // tangent of the arc
      this.bz.subVectors(f.to, f.from)
      this.bz.y += f.apex * 4 * (1 - 2 * t)
      this.bz.normalize()
      this.bx.crossVectors(this.up, this.bz).normalize()
      this.by.crossVectors(this.bz, this.bx)
      m.makeBasis(this.bx, this.by, this.bz).setPosition(pos)
      m.scale(s.setScalar(1.7))
      this.arrows.setMatrix(f.slot, m)
      // a faint streak behind the arrow
      f.trail -= dt
      if (f.trail <= 0) {
        f.trail = 0.018
        this.emit({
          cell: FX_CELL.puff, pos, vel: this.s.set(0, 0, 0), size0: 0.05, size1: 0.02, alpha: 0.55, life: 0.22,
          rot: 0, vrot: 0, drag: 0, grav: 0, fadeIn: 0.01,
        }, TRAIL)
      }
    }
    this.sprites.commit()
    this.rings.commit()
    this.arrows.commit()
  }

  /** Drop everything in flight (when skipping a replay). Arrows still deliver their hits. */
  clear() {
    for (const p of this.parts) this.sprites.release(p.slot)
    for (const r of this.ringList) this.rings.release(r.slot)
    const hits = this.flights.map((f) => f.onHit)
    for (const f of this.flights) this.arrows.release(f.slot)
    this.parts = []
    this.ringList = []
    this.flights = []
    for (const h of hits) h?.()
    this.sprites.commit()
    this.rings.commit()
    this.arrows.commit()
  }

  dispose() {
    this.sprites.dispose()
    this.rings.dispose()
    this.arrows.dispose()
  }
}
