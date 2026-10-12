// World sandbox: /sandbox/world.html?seed=aurora&seats=2
// Extra params: size=small|medium|large, quality=low|medium|high|ultra, view=start|close|coast,
// focus=<tile>, zoom=<wheel notches>, yaw=<px of right-drag>, tilt=<px>, sun=<azimuth deg>,
// post=0|glow|full (force the post chain), intro=0 (no camera glide), home=start (frame the first start area),
// hud=1 (a mock phone HUD with view insets). Debug: world.__bench(n) -> ms per frame.
import * as THREE from 'three'
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
