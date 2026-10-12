// Camera rig: orbit around a target on the board with damping, grab-the-ground panning, zoom to the
// cursor, inertia, limits, and phone gestures (one finger pan, pinch zoom, twist rotate, two-finger
// vertical drag to tilt). Mouse: left drag pan, right drag (or shift/ctrl + left) rotate and tilt.

import * as THREE from 'three'
import { BOTTOM_Y, type Layout } from './layout.ts'

const TARGET_Y = 0.15
const PITCH_MIN = THREE.MathUtils.degToRad(24)
const PITCH_MAX = THREE.MathUtils.degToRad(80)
const DIST_MIN = 5

interface State { x: number; y: number; z: number; yaw: number; pitch: number; dist: number }

export interface Insets { top: number; bottom: number; left: number; right: number }

/** How tall a unit (about 0.8 world units) should look after focus(..., 'unit'), in CSS px. */
const UNIT_PX = 48

export interface Rig {
  update(dt: number): void
  /** Frame the whole board from the default three-quarter view, or a region around a point. */
  home(animate: boolean, around?: { x: number; y: number; z: number } | null): void
  /** Start pulled back and turned a little, then glide into the home framing. */
  intro(): void
  /** Pan to (x, y, z); with zoom 'unit', also come in to a tactical distance (never zooms out). */
  focus(x: number, y: number, z: number, animate: boolean, zoom?: 'unit' | 'keep'): void
  /** Screen areas covered by UI, in CSS px: framing and focus centre on the rest. */
  setInsets(insets: Insets): void
  resize(): void
  /** Default yaw, chosen from the aspect on the first framing (the light is placed relative to it). */
  readonly defaultYaw: number
  /** False until the container had a real size to frame the board in. */
  readonly framed: boolean
  readonly goal: Readonly<State>
  dispose(): void
}

export function createRig(camera: THREE.PerspectiveCamera, dom: HTMLElement, layout: Layout, surfaceY: (cx: number, cy: number) => number | null): Rig {
  const cx = (layout.minX + layout.maxX) / 2
  const cz = (layout.minZ + layout.maxZ) / 2
  const goal: State = { x: cx, y: TARGET_Y, z: cz, yaw: 0, pitch: 0.95, dist: 30 }
  const cur: State = { ...goal }
  let maxDist = 60
  let rate = 7 // damping rate (1/s); faster while the user is touching
  const vcam = new THREE.PerspectiveCamera()
  const ray = new THREE.Ray()
  const ndc = new THREE.Vector2()
  const tmp = new THREE.Vector3()
  const vel = new THREE.Vector2()

  const portrait = () => dom.clientWidth / Math.max(1, dom.clientHeight) < 0.85
  const sized = () => dom.clientWidth > 1 && dom.clientHeight > 1
  const insets: Insets = { top: 0, bottom: 0, left: 0, right: 0 }

  /** Shift the projection so the look-at point sits in the middle of the uncovered area. */
  function applyView(cam: THREE.PerspectiveCamera) {
    const w = dom.clientWidth, h = dom.clientHeight
    const ox = (insets.right - insets.left) / 2, oy = (insets.bottom - insets.top) / 2
    if (w > 1 && h > 1 && (ox !== 0 || oy !== 0)) cam.setViewOffset(w, h, ox, oy, w, h)
    else cam.clearViewOffset()
  }
  /** The uncovered area in normalised device coordinates. */
  function visibleNdc() {
    const w = Math.max(1, dom.clientWidth), h = Math.max(1, dom.clientHeight)
    return { x0: -1 + (2 * insets.left) / w, x1: 1 - (2 * insets.right) / w, y0: -1 + (2 * insets.bottom) / h, y1: 1 - (2 * insets.top) / h }
  }
  // Portrait screens look along the board's long axis.
  let defaultYaw: number | null = null

  function place(cam: THREE.PerspectiveCamera, s: State) {
    const cp = Math.cos(s.pitch)
    cam.position.set(s.x + Math.sin(s.yaw) * cp * s.dist, s.y + Math.sin(s.pitch) * s.dist, s.z + Math.cos(s.yaw) * cp * s.dist)
    tmp.set(s.x, s.y, s.z)
    cam.lookAt(tmp)
    cam.updateMatrixWorld()
  }

  function syncVcam() {
    vcam.fov = camera.fov
    vcam.aspect = camera.aspect
    vcam.near = camera.near
    vcam.far = camera.far
    applyView(vcam)
    place(vcam, goal)
  }

  /** World point on the plane y = h under a client point, seen from the goal camera. */
  function groundAt(clientX: number, clientY: number, h: number, out: THREE.Vector3): boolean {
    const r = dom.getBoundingClientRect()
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
    syncVcam()
    ray.origin.setFromMatrixPosition(vcam.matrixWorld)
    ray.direction.set(ndc.x, ndc.y, 0.5).unproject(vcam).sub(ray.origin).normalize()
    if (ray.direction.y > -0.02) return false
    const t = (h - ray.origin.y) / ray.direction.y
    if (t < 0 || t > 400) return false
    ray.at(t, out)
    return true
  }

  function clampGoal() {
    goal.pitch = THREE.MathUtils.clamp(goal.pitch, PITCH_MIN, PITCH_MAX)
    goal.dist = THREE.MathUtils.clamp(goal.dist, DIST_MIN, maxDist)
    goal.x = THREE.MathUtils.clamp(goal.x, layout.minX + 1, layout.maxX - 1)
    goal.z = THREE.MathUtils.clamp(goal.z, layout.minZ + 1, layout.maxZ - 1)
  }

  /** Target and distance at which the whole board fits the view, centred, for a yaw and pitch. */
  function fitView(yaw: number, pitch: number): State {
    const s: State = { x: cx, y: TARGET_Y, z: cz, yaw, pitch, dist: 0 }
    vcam.fov = camera.fov
    vcam.aspect = camera.aspect
    applyView(vcam)
    const v = visibleNdc()
    const xc = (v.x0 + v.x1) / 2, halfW = (v.x1 - v.x0) / 2
    const yc = (v.y0 + v.y1) / 2, fullH = v.y1 - v.y0
    const corners: THREE.Vector3[] = []
    for (const x of [layout.minX, layout.maxX]) for (const z of [layout.minZ, layout.maxZ]) for (const y of [BOTTOM_Y, 0.6]) corners.push(new THREE.Vector3(x, y, z))
    const extent = () => {
      place(vcam, s)
      let x = 0, y0 = Infinity, y1 = -Infinity
      for (const c of corners) {
        tmp.copy(c).project(vcam)
        if (tmp.z > 1) return { x: Infinity, y0: -Infinity, y1: Infinity }
        x = Math.max(x, Math.abs(tmp.x - xc))
        y0 = Math.min(y0, tmp.y)
        y1 = Math.max(y1, tmp.y)
      }
      return { x, y0, y1 }
    }
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw)
    for (let pass = 0; pass < 3; pass++) {
      let lo = DIST_MIN, hi = 300
      for (let i = 0; i < 32; i++) {
        s.dist = (lo + hi) / 2
        const e = extent()
        if (e.x <= halfW * 0.93 && e.y1 - e.y0 <= fullH * 0.85) hi = s.dist
        else lo = s.dist
      }
      s.dist = hi
      // Slide the target along the view so the board sits centred (a touch low, for the top bar).
      const e0 = extent()
      const c0 = (e0.y0 + e0.y1) / 2 - yc + 0.01 * fullH
      s.x += fx; s.z += fz
      const e1 = extent()
      const slope = (e1.y0 + e1.y1) / 2 - yc + 0.01 * fullH - c0
      s.x -= fx; s.z -= fz
      if (Math.abs(slope) > 1e-6) {
        const k = -c0 / slope
        s.x += fx * k
        s.z += fz * k
      }
    }
    return s
  }

  const homePitch = () => (portrait() ? 0.92 : 0.76)

  /** View centred on a point, close enough that a disc of `radius` world units fills the visible area. */
  function regionView(px: number, py: number, pz: number, radius: number): State {
    const s: State = { x: px, y: py, z: pz, yaw: defaultYaw ?? 0, pitch: homePitch(), dist: 0 }
    vcam.fov = camera.fov
    vcam.aspect = camera.aspect
    applyView(vcam)
    const v = visibleNdc()
    const xc = (v.x0 + v.x1) / 2, yc = (v.y0 + v.y1) / 2
    const hw = ((v.x1 - v.x0) / 2) * 0.94, hh = ((v.y1 - v.y0) / 2) * 0.9
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      pts.push(new THREE.Vector3(px + Math.cos(a) * radius, py, pz + Math.sin(a) * radius))
    }
    let lo = DIST_MIN, hi = 300
    for (let i = 0; i < 32; i++) {
      s.dist = (lo + hi) / 2
      place(vcam, s)
      let ok = true
      for (const p of pts) {
        tmp.copy(p).project(vcam)
        if (tmp.z > 1 || Math.abs(tmp.x - xc) > hw || Math.abs(tmp.y - yc) > hh) { ok = false; break }
      }
      if (ok) hi = s.dist
      else lo = s.dist
    }
    s.dist = hi
    return s
  }

  let homeAround: { x: number; y: number; z: number } | null = null

  /** Distance at which a unit looks UNIT_PX tall. */
  const unitDist = () => (0.8 * Math.max(1, dom.clientHeight)) / (2 * UNIT_PX * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))

  function home(animate: boolean, around?: { x: number; y: number; z: number } | null) {
    if (around !== undefined) homeAround = around
    if (!sized()) return
    defaultYaw ??= portrait() ? Math.PI / 2 : 0
    const v = fitView(defaultYaw, homePitch())
    maxDist = v.dist * 1.3
    if (homeAround) {
      // A player's own corner of the board: a few hexes around it (more on wide screens).
      const r = (portrait() ? 3.4 : 5.5) * 1.732
      const rv = regionView(homeAround.x, homeAround.y, homeAround.z, r)
      if (rv.dist < v.dist) Object.assign(v, rv)
    } else if (portrait()) {
      // Phones start a little closer than the whole board (pinch out to see it all).
      v.dist = Math.max(DIST_MIN, v.dist * 0.72)
    }
    Object.assign(goal, v)
    rate = 5
    if (!animate) Object.assign(cur, goal)
    place(camera, cur)
  }

  // --------------------------------------------------------------------------------------------
  // Input

  interface Ptr { x: number; y: number; type: string }
  const ptrs = new Map<number, Ptr>()
  let mode: 'none' | 'pan' | 'rotate' | 'touch2' = 'none'
  let grabH = 0
  const grab = new THREE.Vector3()
  const p1 = new THREE.Vector3()
  let downX = 0, downY = 0, moved = 0, suppressClick = false
  let lastMove = 0
  // Two-finger state.
  let t2Mode: 'undecided' | 'tilt' | 'transform' = 'undecided'
  let t2Start = { cx: 0, cy: 0, d: 0, a: 0 }
  let t2Prev = { cx: 0, cy: 0, d: 0, a: 0 }
  let t2Acc = 0

  const twoFinger = () => {
    const [a, b] = [...ptrs.values()]
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x), sep: { x: b.x - a.x, y: b.y - a.y } }
  }

  function startPan(x: number, y: number) {
    mode = 'pan'
    grabH = surfaceY(x, y) ?? TARGET_Y
    if (!groundAt(x, y, grabH, grab)) mode = 'none'
  }

  function onDown(e: PointerEvent) {
    if (ptrs.size === 0) {
      downX = e.clientX
      downY = e.clientY
      moved = 0
      suppressClick = false
    }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    try { dom.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    vel.set(0, 0)
    rate = 18
    if (ptrs.size === 1) {
      const rotate = e.pointerType === 'mouse' && (e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.altKey)
      if (rotate) mode = 'rotate'
      else startPan(e.clientX, e.clientY)
    } else if (ptrs.size === 2) {
      mode = 'touch2'
      suppressClick = true
      const f = twoFinger()
      t2Mode = 'undecided'
      t2Acc = 0
      t2Start = { cx: f.cx, cy: f.cy, d: f.d, a: f.a }
      t2Prev = { cx: f.cx, cy: f.cy, d: f.d, a: f.a }
    }
  }

  function onMove(e: PointerEvent) {
    const p = ptrs.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY))
    if (moved > 6) suppressClick = true
    if (mode === 'pan' && ptrs.size === 1) {
      if (groundAt(e.clientX, e.clientY, grabH, p1)) {
        const ox = goal.x, oz = goal.z
        goal.x += grab.x - p1.x
        goal.z += grab.z - p1.z
        clampGoal()
        const now = performance.now()
        const dtm = Math.max(1, now - lastMove) / 1000
        lastMove = now
        vel.set(vel.x * 0.5 + ((goal.x - ox) / dtm) * 0.5, vel.y * 0.5 + ((goal.z - oz) / dtm) * 0.5)
      }
    } else if (mode === 'rotate') {
      goal.yaw -= dx * 0.006
      goal.pitch += dy * 0.004
      clampGoal()
    } else if (mode === 'touch2' && ptrs.size >= 2) {
      const f = twoFinger()
      const dcx = f.cx - t2Prev.cx, dcy = f.cy - t2Prev.cy
      if (t2Mode === 'undecided') {
        t2Acc += Math.hypot(dcx, dcy) + Math.abs(f.d - t2Prev.d)
        if (t2Acc > 10) {
          const pinch = Math.abs(Math.log(f.d / t2Start.d))
          const twist = Math.abs(angleDiff(f.a, t2Start.a))
          const sideBySide = Math.abs(f.sep.x) > Math.abs(f.sep.y) * 1.2
          const vertical = Math.abs(f.cy - t2Start.cy) > 1.6 * Math.abs(f.cx - t2Start.cx)
          t2Mode = sideBySide && vertical && pinch < 0.1 && twist < 0.14 ? 'tilt' : 'transform'
        }
      }
      if (t2Mode === 'tilt') {
        goal.pitch += dcy * 0.0035
        clampGoal()
      } else if (t2Mode === 'transform') {
        const h = TARGET_Y
        const ok = groundAt(t2Prev.cx, t2Prev.cy, h, grab)
        goal.dist *= t2Prev.d / Math.max(1, f.d)
        goal.yaw += angleDiff(f.a, t2Prev.a)
        clampGoal()
        if (ok && groundAt(f.cx, f.cy, h, p1)) {
          goal.x += grab.x - p1.x
          goal.z += grab.z - p1.z
          clampGoal()
        }
      }
      t2Prev = { cx: f.cx, cy: f.cy, d: f.d, a: f.a }
    }
  }

  function onUp(e: PointerEvent) {
    if (!ptrs.has(e.pointerId)) return
    ptrs.delete(e.pointerId)
    try { dom.releasePointerCapture(e.pointerId) } catch { /* released */ }
    if (moved > 6) suppressClick = true
    if (ptrs.size === 0) {
      if (mode === 'pan' && performance.now() - lastMove > 90) vel.set(0, 0)
      mode = 'none'
      rate = 10
    } else if (ptrs.size === 1) {
      // Lifting one of two fingers: continue as a pan with the remaining finger.
      const [rest] = [...ptrs.values()]
      startPan(rest.x, rest.y)
      vel.set(0, 0)
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    rate = 12
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
    if (e.ctrlKey && Math.abs(dy) < 50) {
      // Trackpad pinch arrives as ctrl + wheel with small deltas.
      zoomAt(e.clientX, e.clientY, Math.exp(dy * 0.012))
    } else {
      zoomAt(e.clientX, e.clientY, Math.exp(THREE.MathUtils.clamp(dy, -120, 120) * 0.0016))
    }
  }

  function zoomAt(x: number, y: number, factor: number) {
    const h = surfaceY(x, y) ?? TARGET_Y
    const ok = groundAt(x, y, h, grab)
    goal.dist *= factor
    clampGoal()
    if (ok && groundAt(x, y, h, p1)) {
      goal.x += grab.x - p1.x
      goal.z += grab.z - p1.z
      clampGoal()
    }
  }

  function onClickCapture(e: MouseEvent) {
    if (suppressClick) {
      e.stopImmediatePropagation()
      e.preventDefault()
      suppressClick = false
    }
  }
  const onContext = (e: Event) => e.preventDefault()

  dom.style.touchAction = 'none'
  dom.addEventListener('pointerdown', onDown)
  dom.addEventListener('pointermove', onMove)
  dom.addEventListener('pointerup', onUp)
  dom.addEventListener('pointercancel', onUp)
  dom.addEventListener('wheel', onWheel, { passive: false })
  dom.addEventListener('click', onClickCapture, true)
  dom.addEventListener('contextmenu', onContext)

  // --------------------------------------------------------------------------------------------

  function update(dt: number) {
    if (mode === 'none' && vel.lengthSq() > 1e-4) {
      goal.x += vel.x * dt
      goal.z += vel.y * dt
      clampGoal()
      vel.multiplyScalar(Math.exp(-dt * 5))
    }
    const k = 1 - Math.exp(-dt * rate)
    cur.x += (goal.x - cur.x) * k
    cur.z += (goal.z - cur.z) * k
    cur.y += (goal.y - cur.y) * k
    cur.yaw += angleDiff(goal.yaw, cur.yaw) * k
    cur.pitch += (goal.pitch - cur.pitch) * k
    cur.dist *= Math.pow(goal.dist / cur.dist, k)
    place(camera, cur)
  }

  return {
    update,
    home,
    focus(x, y, z, animate, zoom = 'keep') {
      goal.x = x
      goal.y = y
      goal.z = z
      if (zoom === 'unit') goal.dist = Math.min(goal.dist, Math.max(DIST_MIN, unitDist()))
      clampGoal()
      vel.set(0, 0)
      rate = 5
      if (!animate) {
        Object.assign(cur, goal)
        place(camera, cur)
      }
    },
    intro() {
      home(false)
      if (defaultYaw === null) return
      cur.dist = goal.dist * 1.32
      cur.yaw = goal.yaw - 0.32
      cur.pitch = Math.min(PITCH_MAX, goal.pitch + 0.16)
      rate = 2.2
      place(camera, cur)
    },
    setInsets(next) {
      const w = Math.max(1, dom.clientWidth), h = Math.max(1, dom.clientHeight)
      insets.top = THREE.MathUtils.clamp(next.top || 0, 0, h * 0.6)
      insets.bottom = THREE.MathUtils.clamp(next.bottom || 0, 0, h * 0.6)
      insets.left = THREE.MathUtils.clamp(next.left || 0, 0, w * 0.6)
      insets.right = THREE.MathUtils.clamp(next.right || 0, 0, w * 0.6)
      this.resize()
    },
    resize() {
      applyView(camera)
      if (defaultYaw === null) return home(false)
      maxDist = fitView(defaultYaw, homePitch()).dist * 1.3
      clampGoal()
    },
    get defaultYaw() {
      return defaultYaw ?? 0
    },
    get framed() {
      return defaultYaw !== null
    },
    goal,
    dispose() {
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('pointermove', onMove)
      dom.removeEventListener('pointerup', onUp)
      dom.removeEventListener('pointercancel', onUp)
      dom.removeEventListener('wheel', onWheel)
      dom.removeEventListener('click', onClickCapture, true)
      dom.removeEventListener('contextmenu', onContext)
    },
  }
}

function angleDiff(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}
