// Camera for the city: a turntable around the square. Drag to turn (and tilt a little), wheel or
// pinch to lean in close enough to see the people, two-finger drag or right drag to slide around.
// Taps are told apart from drags. Entrance and exit are scripted camera moves.

import * as THREE from 'three'

export interface View { x: number; z: number; yaw: number; pitch: number; dist: number }

const PITCH_MIN = THREE.MathUtils.degToRad(26)
const PITCH_MAX = THREE.MathUtils.degToRad(78)
const TARGET_Y = 0.25

export interface Rig {
  update(dt: number): void
  /** The default framing for the current aspect. */
  home(): View
  /** Fly from `from` to the default framing over `sec` seconds. */
  fly(from: View, to: View, sec: number): Promise<void>
  readonly cur: View
  set(v: View): void
  resize(): void
  dispose(): void
  /** Ease the target toward a point (when a plot is selected), keeping the current zoom. */
  lookAt(x: number, z: number): void
  onTap: ((x: number, y: number) => void) | null
  onHover: ((x: number, y: number) => void) | null
  /** True while the user is dragging. */
  readonly busy: boolean
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

export function createRig(camera: THREE.PerspectiveCamera, dom: HTMLElement, radius: number): Rig {
  const goal: View = { x: 0, z: 0.3, yaw: 0, pitch: 0.9, dist: 20 }
  const cur: View = { ...goal }
  let flight: { from: View; to: View; t: number; sec: number; done: () => void; last: number } | null = null
  const tmp = new THREE.Vector3()

  function homeView(): View {
    const aspect = dom.clientWidth / Math.max(1, dom.clientHeight)
    const portrait = aspect < 0.85
    // Fit the town (about 2 * 4.6 units across) to the screen, leaving room for the panels.
    const vfov = THREE.MathUtils.degToRad(camera.fov)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect)
    const span = portrait ? 8.7 : 9.8
    const pitch = portrait ? 0.86 : 0.74
    const distW = span / 2 / Math.tan(hfov / 2)
    const distH = (span * 0.82) / 2 / Math.tan(vfov / 2)
    const dist = Math.max(portrait ? distW : Math.max(distW * 0.86, distH), 8) * (portrait ? 1.02 : 1.0)
    return { x: 0, z: portrait ? 0.55 : 0.35, yaw: 0, pitch, dist }
  }

  function place(v: View) {
    const cp = Math.cos(v.pitch)
    camera.position.set(v.x + Math.sin(v.yaw) * cp * v.dist, TARGET_Y + Math.sin(v.pitch) * v.dist, v.z + Math.cos(v.yaw) * cp * v.dist)
    tmp.set(v.x, TARGET_Y, v.z)
    camera.lookAt(tmp)
    camera.updateMatrixWorld()
  }

  // ---- input
  const pointers = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>()
  let moved = false
  let pinch0 = 0, dist0 = 0, mid0 = { x: 0, y: 0 }
  let busy = false
  const rig: Rig = {
    update, home: homeView, fly, cur, set, resize, dispose, lookAt, onTap: null, onHover: null,
    get busy() { return busy },
  }

  function maxDist() { return homeView().dist * 1.25 }
  function minDist() { return Math.max(3.2, homeView().dist * 0.3) }

  function clampGoal() {
    goal.pitch = THREE.MathUtils.clamp(goal.pitch, PITCH_MIN, PITCH_MAX)
    goal.dist = THREE.MathUtils.clamp(goal.dist, minDist(), maxDist())
    const r = Math.hypot(goal.x, goal.z)
    const lim = radius * (1 - (goal.dist - minDist()) / (maxDist() - minDist()) * 0.6)
    if (r > lim) { goal.x *= lim / r; goal.z *= lim / r }
  }

  function pan(dx: number, dy: number) {
    const k = (goal.dist * 1.1) / Math.max(1, dom.clientHeight)
    const cy = Math.cos(goal.yaw), sy = Math.sin(goal.yaw)
    const fx = -dx * k, fz = -dy * k / Math.max(0.4, Math.sin(goal.pitch))
    goal.x += fx * cy + fz * sy
    goal.z += -fx * sy + fz * cy
  }

  const onDown = (e: PointerEvent) => {
    if (flight) return
    dom.setPointerCapture?.(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() })
    if (pointers.size === 1) moved = false
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y)
      dist0 = goal.dist
      mid0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      moved = true
    }
  }
  const onMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId)
    if (!p) {
      if (e.pointerType === 'mouse') rig.onHover?.(e.clientX, e.clientY)
      return
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 7) moved = true
    if (!moved) return
    busy = true
    if (pointers.size === 1) {
      if (e.buttons === 2 || e.shiftKey) pan(dx, dy)
      else {
        goal.yaw -= dx * 0.006
        goal.pitch += dy * 0.004
      }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch0 > 0) goal.dist = dist0 * (pinch0 / Math.max(1, d))
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      pan(mid.x - mid0.x, mid.y - mid0.y)
      mid0 = mid
    }
    clampGoal()
  }
  const onUp = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId)
    pointers.delete(e.pointerId)
    if (p && !moved && pointers.size === 0 && performance.now() - p.t0 < 600) rig.onTap?.(e.clientX, e.clientY)
    if (pointers.size < 2) pinch0 = 0
    if (pointers.size === 0) busy = false
    if (pointers.size === 1) {
      const [q] = [...pointers.values()]
      q.x0 = q.x
      q.y0 = q.y
    }
  }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (flight) return
    goal.dist *= Math.exp(e.deltaY * 0.0012)
    clampGoal()
  }
  const onContext = (e: Event) => e.preventDefault()
  dom.addEventListener('pointerdown', onDown)
  dom.addEventListener('pointermove', onMove)
  dom.addEventListener('pointerup', onUp)
  dom.addEventListener('pointercancel', onUp)
  dom.addEventListener('wheel', onWheel, { passive: false })
  dom.addEventListener('contextmenu', onContext)
  dom.style.touchAction = 'none'

  function update(dt: number) {
    if (flight) {
      // wall-clock, so it ends on time however slow the frames are; the first frame (when the
      // shaders compile) does not count, and no frame skips more than a quarter of the move
      const now = performance.now()
      if (flight.last > 0) flight.t += Math.min((now - flight.last) / 1000, flight.sec * 0.25)
      flight.last = now
      const t = ease(Math.min(1, flight.t / flight.sec))
      const f = flight.from, to = flight.to
      cur.x = f.x + (to.x - f.x) * t
      cur.z = f.z + (to.z - f.z) * t
      cur.yaw = f.yaw + (to.yaw - f.yaw) * t
      cur.pitch = f.pitch + (to.pitch - f.pitch) * t
      // distance in log space feels like a steady glide
      cur.dist = Math.exp(Math.log(f.dist) + (Math.log(to.dist) - Math.log(f.dist)) * t)
      if (flight.t >= flight.sec) {
        Object.assign(goal, to)
        const done = flight.done
        flight = null
        done()
      }
    } else {
      const k = 1 - Math.exp(-dt * (busy ? 14 : 7))
      cur.x += (goal.x - cur.x) * k
      cur.z += (goal.z - cur.z) * k
      cur.yaw += (goal.yaw - cur.yaw) * k
      cur.pitch += (goal.pitch - cur.pitch) * k
      cur.dist += (goal.dist - cur.dist) * k
    }
    place(cur)
  }

  function fly(from: View, to: View, sec: number): Promise<void> {
    Object.assign(cur, from)
    return new Promise((done) => { flight = { from: { ...from }, to: { ...to }, t: 0, sec, done, last: 0 } })
  }

  function set(v: View) {
    Object.assign(goal, v)
    Object.assign(cur, v)
    flight = null
    place(cur)
  }

  function lookAt(x: number, z: number) {
    // only drift a little toward the point, so the town stays framed
    goal.x += (x * 0.35 - goal.x) * 0.6
    goal.z += (z * 0.35 + homeView().z * 0.65 - goal.z) * 0.6
    clampGoal()
  }

  function resize() {
    camera.aspect = dom.clientWidth / Math.max(1, dom.clientHeight)
    camera.updateProjectionMatrix()
    if (!busy && !flight) {
      const h = homeView()
      goal.dist = THREE.MathUtils.clamp(goal.dist, minDist(), h.dist * 1.25)
    }
  }

  function dispose() {
    dom.removeEventListener('pointerdown', onDown)
    dom.removeEventListener('pointermove', onMove)
    dom.removeEventListener('pointerup', onUp)
    dom.removeEventListener('pointercancel', onUp)
    dom.removeEventListener('wheel', onWheel)
    dom.removeEventListener('contextmenu', onContext)
  }

  return rig
}
