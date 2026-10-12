// Crisp HTML labels positioned from 3D: city plaques, floating damage numbers, tick numerals.
import * as THREE from 'three'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/inter'
import { UI } from '../palette.ts'

const CSS = `
.cc-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 1;
  font-family: 'Fraunces Variable', 'Fraunces', Georgia, serif; color: ${UI.ink}; -webkit-font-smoothing: antialiased; }
.cc-labels > * { position: absolute; left: 0; top: 0; will-change: transform; white-space: nowrap; }
.cc-plaque { display: flex; align-items: center; gap: 7px; padding: 3px 11px 3px 3px; border-radius: 999px;
  background: rgba(250, 246, 238, 0.93); border: 1px solid rgba(42, 38, 34, 0.14);
  box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset, 0 8px 22px -10px rgba(42, 38, 34, 0.55), 0 2px 5px -2px rgba(42,38,34,0.25);
  font-size: 14.5px; font-weight: 520; letter-spacing: 0.01em; line-height: 1; transition: opacity 240ms cubic-bezier(.2,.7,.2,1); }
.cc-plaque .pop { min-width: 21px; height: 21px; border-radius: 999px; display: grid; place-items: center; padding: 0 4px; box-sizing: border-box;
  background: var(--team); color: #FFFDF8; font: 600 11.5px/1 'Inter Variable', 'Inter', system-ui, sans-serif; font-variant-numeric: tabular-nums;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25); transition: background 400ms cubic-bezier(.2,.7,.2,1); }
.cc-plaque .name { padding-bottom: 1px; }
.cc-plaque.compact { padding: 3px; gap: 0; }
.cc-plaque.memory { background: rgba(240, 238, 240, 0.8); color: rgba(42, 38, 34, 0.78); box-shadow: 0 6px 16px -10px rgba(42, 38, 34, 0.4); }
.cc-plaque.memory .pop { filter: saturate(0.6) brightness(1.08); }
.cc-plaque.memory .name { font-style: italic; }
.cc-plaque.compact .name, .cc-plaque.compact .hp { display: none; }
.cc-plaque .cap { width: 10px; height: 10px; margin-left: -2px; color: var(--team-dark); }
.cc-plaque .hp { position: absolute; left: 30px; right: 12px; bottom: -4px; height: 3px; border-radius: 3px; background: rgba(42,38,34,0.18); overflow: hidden; }
.cc-plaque .hp > i { display: block; height: 100%; background: #D2432B; border-radius: 3px; transition: width 300ms cubic-bezier(.2,.7,.2,1); }
.cc-float { font-weight: 660; font-size: 30px; letter-spacing: -0.01em; font-variant-numeric: lining-nums tabular-nums;
  paint-order: stroke fill; -webkit-text-stroke: 4px rgba(250, 246, 238, 0.96); }
.cc-float.dmg { color: #B8321F; }
.cc-float.heal { color: #4F7F3A; font-size: 19px; }
.cc-float.note { color: ${UI.ink}; font-size: 15px; font-weight: 560; -webkit-text-stroke: 3.5px rgba(250, 246, 238, 0.96); }
.cc-tick { width: 19px; height: 19px; border-radius: 999px; display: grid; place-items: center; box-sizing: border-box;
  background: ${UI.paper}; border: 2px solid var(--team); color: ${UI.ink};
  font: 650 11px/1 'Inter Variable', 'Inter', system-ui, sans-serif; font-variant-numeric: tabular-nums;
  box-shadow: 0 3px 8px -3px rgba(42,38,34,0.5); }
.cc-tick.ghost { opacity: 0.82; }
.cc-tick.later { width: 15px; height: 15px; font-size: 9px; opacity: 0.6; }
`

let cssInjected = false

export interface Label {
  el: HTMLElement
  /** World position, or a function returning it (evaluated each frame). */
  at: THREE.Vector3 | (() => THREE.Vector3)
  /** Screen offset in px after projection. */
  dx: number
  dy: number
  /** Shift this many world units towards the camera (in the ground plane) before projecting. */
  toward: number
  /** Scale with the on-screen size of the board: plaques get a compact form when tiny. */
  zoom: 'plaque' | 'float' | null
  hidden: boolean
  compact?: boolean
  /** Extra scale (pop-in). */
  pop?: number
}

interface Float { label: Label; age: number; life: number; rise: number; base: THREE.Vector3; key: number | null; stack: number }

export class Labels {
  readonly root: HTMLDivElement
  private items = new Set<Label>()
  private floats: Float[] = []
  private v = new THREE.Vector3()
  private w = new THREE.Vector3()
  private right = new THREE.Vector3()
  private dir = new THREE.Vector3()

  constructor(container: HTMLElement) {
    if (!cssInjected) {
      const s = document.createElement('style')
      s.textContent = CSS
      document.head.appendChild(s)
      cssInjected = true
    }
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
    this.root = document.createElement('div')
    this.root.className = 'cc-labels'
    container.appendChild(this.root)
  }

  add(el: HTMLElement, at: Label['at'], o: { dx?: number; dy?: number; zoom?: Label['zoom']; toward?: number } = {}): Label {
    const label: Label = { el, at, dx: o.dx ?? 0, dy: o.dy ?? 0, toward: o.toward ?? 0, zoom: o.zoom ?? null, hidden: false }
    el.style.transform = 'translate3d(-9999px,-9999px,0)'
    this.root.appendChild(el)
    this.items.add(label)
    return label
  }

  remove(label: Label | null | undefined) {
    if (!label) return
    label.el.remove()
    this.items.delete(label)
  }

  /** A number or word that rises and fades above a point. Floats with the same key stack upwards. */
  float(text: string, cls: string, at: THREE.Vector3, o: { life?: number; rise?: number; delay?: number; key?: number } = {}) {
    const el = document.createElement('div')
    el.className = `cc-float ${cls}`
    el.textContent = text
    el.style.opacity = '0'
    const key = o.key ?? null
    const stack = key === null ? 0 : this.floats.filter((f) => f.key === key && f.age < f.life * 0.6).length
    const label = this.add(el, at.clone(), { zoom: 'float' })
    this.floats.push({ label, age: -(o.delay ?? 0), life: o.life ?? 1.4, rise: o.rise ?? 0.5, base: at.clone(), key, stack })
  }

  clearFloats() {
    for (const f of this.floats) this.remove(f.label)
    this.floats = []
  }

  /** Age floating labels (part of the simulation, so a frozen replay freezes them too). */
  step(dt: number) {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]
      f.age += dt
      if (f.age >= f.life) {
        this.remove(f.label)
        this.floats.splice(i, 1)
        continue
      }
      const t = Math.max(0, f.age) / f.life
      const rise = 1 - (1 - t) ** 3
      ;(f.label.at as THREE.Vector3).copy(f.base).setY(f.base.y + rise * f.rise)
      const fadeIn = Math.min(1, Math.max(0, f.age) / 0.1)
      const fadeOut = 1 - Math.max(0, (t - 0.65) / 0.35)
      f.label.el.style.opacity = f.age < 0 ? '0' : String(fadeIn * fadeOut)
      // a small pop on arrival
      const pop = f.age < 0 ? 0 : Math.max(0, 1 - f.age / 0.22)
      f.label.dy = -pop * 7 - f.stack * 26
      f.label.pop = 1 + pop * 0.18
    }
  }

  /** Position every label from 3D. */
  layout(camera: THREE.PerspectiveCamera, width: number, height: number) {
    camera.updateMatrixWorld()
    camera.getWorldDirection(this.dir)
    const tx = -this.dir.x
    const tz = -this.dir.z
    const tl = Math.hypot(tx, tz) || 1
    this.right.setFromMatrixColumn(camera.matrixWorld, 0)
    for (const l of this.items) {
      if (l.hidden) {
        if (l.el.style.display !== 'none') l.el.style.display = 'none'
        continue
      }
      const at = typeof l.at === 'function' ? l.at() : l.at
      const p = this.w.copy(at)
      if (l.toward) { p.x += (tx / tl) * l.toward; p.z += (tz / tl) * l.toward }
      const v = this.v.copy(p).project(camera)
      if (v.z > 1 || v.x < -1.3 || v.x > 1.3 || v.y < -1.3 || v.y > 1.3) {
        if (l.el.style.display !== 'none') l.el.style.display = 'none'
        continue
      }
      if (l.el.style.display === 'none') l.el.style.display = ''
      const x = (v.x * 0.5 + 0.5) * width
      const y = (-v.y * 0.5 + 0.5) * height
      let s = 1
      if (l.zoom) {
        // on-screen pixels per world unit at this point
        const q = this.v.copy(p).add(this.right).project(camera)
        const ppu = Math.hypot((q.x * 0.5 + 0.5) * width - x, (-q.y * 0.5 + 0.5) * height - y)
        if (l.zoom === 'plaque') {
          s = Math.min(1.08, Math.max(0.6, ppu / 52))
          const compact = ppu < 27
          if (compact !== !!l.compact) {
            l.compact = compact
            l.el.classList.toggle('compact', compact)
          }
        } else s = Math.min(1.1, Math.max(0.55, ppu / 48))
      }
      l.el.style.transform = `translate3d(${(x + l.dx * s).toFixed(1)}px, ${(y + l.dy * s).toFixed(1)}px, 0) translate(-50%, -50%) scale(${(s * (l.pop ?? 1)).toFixed(3)})`
    }
  }

  dispose() {
    this.root.remove()
    this.items.clear()
    this.floats = []
  }
}
