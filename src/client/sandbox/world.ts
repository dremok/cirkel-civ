// World sandbox: /sandbox/world.html?seed=aurora&seats=2
// Extra params: size=small|medium|large, quality=low|medium|high|ultra, view=start|close|coast,
// focus=<tile>, zoom=<wheel notches>, yaw=<px of right-drag>, tilt=<px>, sun=<azimuth deg>,
// post=0|glow|full (force the post chain), intro=0 (no camera glide), home=start (frame the first start area),
// hud=1 (a mock phone HUD with view insets), fog=start|mid (fog of war presets; the panel at the
// bottom left toggles fog, scouts by clicking a tile and resets). Debug: world.__bench(n) -> ms.
import * as THREE from 'three'
import { distance, tilesInRange } from '../../engine/hex.ts'
import { generateMap } from '../../engine/mapgen.ts'
import type { WorldQuality } from '../render/api.ts'
import { createWorld } from '../render/world/createWorld.ts'

const q = new URLSearchParams(location.search)
const seats = Number(q.get('seats') ?? 2)
const size = (q.get('size') ?? (seats > 2 ? 'medium' : 'small')) as 'small' | 'medium' | 'large'
const map = generateMap(q.get('seed') ?? 'aurora', seats, size)
const world = createWorld(document.getElementById('app')!, map, {
  quality: (q.get('quality') as WorldQuality | null) ?? 'auto',
  sunAzimuth: q.has('sun') ? Number(q.get('sun')) : undefined,
  post: q.has('post') ? ((q.get('post') === '0' ? false : q.get('post')) as 'full' | 'glow' | false) : undefined,
  intro: q.get('intro') !== '0',
})
addEventListener('resize', () => world.resize())
Object.assign(window as unknown as Record<string, unknown>, { world, map, THREE })

if (q.get('hud') === '1') {
  // A stand-in for the game's HUD: a top bar and a bottom panel covering 45 % of the screen.
  const bar = (css: string) => Object.assign(document.body.appendChild(document.createElement('div')).style, { cssText: `position:fixed;left:0;right:0;background:rgba(247,242,232,.82);z-index:9;${css}` })
  bar('top:0;height:70px')
  bar('bottom:0;height:45%')
  world.setViewInsets?.({ top: 70, bottom: innerHeight * 0.45, left: 0, right: 0 })
}
if (q.get('home') === 'start') world.home?.(false, { around: map.starts[0] })

// ---------------------------------------------------------------------------------------------
// Fog of war playground: our side's sight is the capital (3) plus a scout (2) we move by clicking.
const n = map.tiles.length
const explored = new Uint8Array(n)
let scout: number | null = null
const disc = (t: number, r: number) => tilesInRange(map, t, r)
function fogPush(animate: boolean) {
  const visible = new Uint8Array(n)
  for (const t of disc(map.starts[0], 3)) visible[t] = 1
  if (scout !== null) for (const t of disc(scout, 2)) visible[t] = 1
  for (let t = 0; t < n; t++) if (visible[t]) explored[t] = 1
  world.setFog?.({ explored, visible }, { animate })
}
function fogReset() {
  explored.fill(0)
  scout = null
  fogPush(false)
}
/** A mid-game view: we scouted a corridor toward the middle; the scout now stands at its end. */
function fogMid() {
  explored.fill(0)
  const a = map.tiles[map.starts[0]], b = map.tiles[map.starts[1] ?? map.starts[0]]
  const steps = Math.max(1, distance(map, a.id, b.id))
  let last = a.id
  for (let i = 0; i <= Math.ceil(steps * 0.62); i++) {
    const f = i / steps
    const t = map.tiles.reduce((best, c) => {
      const want = { x: a.col + (b.col - a.col) * f, y: a.row + (b.row - a.row) * f + Math.sin(f * 5) * 2.2 }
      const d = Math.hypot(c.col - want.x, c.row - want.y)
      return d < best.d ? { id: c.id, d } : best
    }, { id: a.id, d: Infinity }).id
    for (const u of disc(t, 2)) explored[u] = 1
    last = t
  }
  scout = last
  fogPush(false)
}
const fogMode = q.get('fog')
if (fogMode === 'start') fogReset()
if (fogMode === 'mid') fogMid()
Object.assign(window as unknown as Record<string, unknown>, { fogDemo: { reset: fogReset, mid: fogMid, scoutTo: (t: number) => { scout = t; fogPush(true) } } })

// A small control panel.
const panel = document.body.appendChild(document.createElement('div'))
panel.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:10;display:flex;gap:6px;font:13px system-ui;'
const button = (label: string, fn: () => void) => {
  const el = panel.appendChild(document.createElement('button'))
  el.textContent = label
  el.style.cssText = 'padding:6px 10px;border-radius:8px;border:1px solid #d9cfbf;background:rgba(247,242,232,.9);cursor:pointer'
  el.onclick = fn
  return el
}
let scouting = false
const fogBtn = button(fogMode ? 'Fog: on' : 'Fog: off', () => {
  const on = fogBtn.textContent === 'Fog: off'
  fogBtn.textContent = on ? 'Fog: on' : 'Fog: off'
  if (on) fogReset()
  else world.setFog?.(null)
})
const scoutBtn = button('Scout: off', () => {
  scouting = !scouting
  scoutBtn.textContent = scouting ? 'Scout: click a tile' : 'Scout: off'
})
button('Reset', () => { if (fogBtn.textContent === 'Fog: on') fogReset() })
world.renderer.domElement.addEventListener('click', (e) => {
  if (!scouting || fogBtn.textContent !== 'Fog: on') return
  const t = world.pick(e.clientX, e.clientY)
  if (t !== null) { scout = t; fogPush(true) }
})
if (q.get('panel') === '0') panel.remove()

const view = q.get('view')
if (view === 'close' || view === 'start') world.focus(map.starts[0], false)
if (view === 'coast') {
  // The beach nearest the first start, looking along the shore.
  const s0 = map.tiles[map.starts[0]]
  const beach = map.tiles.filter((t) => t.biome === 'beach').sort((a, b) => Math.hypot(a.col - s0.col, a.row - s0.row) - Math.hypot(b.col - s0.col, b.row - s0.row))[0]
  if (beach) world.focus(beach.id, false)
}
if (q.has('focus')) world.focus(Number(q.get('focus')), false)

// Zoom in like a user would (wheel over the centre of the canvas): &zoom=<notches>
const notches = Number(q.get('zoom') ?? (view === 'close' || view === 'coast' ? 9 : 0))
if (notches) {
  const el = world.renderer.domElement
  const r = el.getBoundingClientRect()
  for (let i = 0; i < Math.abs(notches); i++) {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: notches > 0 ? -100 : 100, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
  }
}
const yaw = Number(q.get('yaw') ?? 0)
if (yaw) {
  const el = world.renderer.domElement
  el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, button: 2, clientX: 400, clientY: 300, pointerType: 'mouse', bubbles: true }))
  el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, button: 2, clientX: 400 + yaw, clientY: 300 + Number(q.get('tilt') ?? 0), pointerType: 'mouse', bubbles: true }))
  el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, button: 2, clientX: 400 + yaw, clientY: 300, pointerType: 'mouse', bubbles: true }))
}
