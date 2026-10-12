// The world: a floating diorama of bevelled hex columns in warm late-afternoon light, a luminous
// sea, swaying trees, drifting cloud shadows and a few birds. Knows nothing about game pieces.
// See ART.md for the look and api.ts for the contract.

import * as THREE from 'three'
import type { GameMap } from '../../../engine/types.ts'
import type { World, WorldQuality } from '../api.ts'
import { NATURE } from '../palette.ts'
import { buildMotes, buildVignette } from './atmosphere.ts'
import { buildBirds } from './birds.ts'
import { BOTTOM_Y, buildLayout } from './layout.ts'
import { createPicker } from './pick.ts'
import { installGrade } from './grade.ts'
import { createPost } from './post.ts'
import { buildProps } from './props.ts'
import { createRig } from './rig.ts'
import { shared } from './shading.ts'
import { BACKDROP, buildEnvironment, buildSky } from './sky.ts'
import { buildTerrain } from './terrain.ts'
import { buildWater } from './water.ts'

const TIERS: Record<WorldQuality, { dpr: number; shadow: number; birds: boolean; post: boolean; minFps: number }> = {
  ultra: { dpr: 2, shadow: 4096, birds: true, post: true, minFps: 52 },
  high: { dpr: 2, shadow: 4096, birds: true, post: false, minFps: 45 },
  medium: { dpr: 1.75, shadow: 2048, birds: true, post: false, minFps: 27 },
  low: { dpr: 1.25, shadow: 1024, birds: false, post: false, minFps: 0 },
}
const ORDER: WorldQuality[] = ['ultra', 'high', 'medium', 'low']

/** Sun direction in the frame of the default view (x = screen right, z = toward the viewer). */
const SUN_ELEVATION = THREE.MathUtils.degToRad(32)
const SUN_AZIMUTH = THREE.MathUtils.degToRad(165) // from the left, a little behind

export interface WorldOptions {
  quality?: WorldQuality | 'auto'
  /** Override the sun azimuth (degrees, in the default view frame). For tuning. */
  sunAzimuth?: number
  /** Force post-processing (AO) on or off regardless of tier. For tuning. */
  post?: boolean
  /** Glide the camera in on load (default true). */
  intro?: boolean
}

function detectQuality(): WorldQuality {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const small = Math.min(screen.width, screen.height) < 820
  if (coarse && small) return (navigator.hardwareConcurrency ?? 8) <= 4 ? 'low' : 'medium'
  return 'high'
}

export function createWorld(container: HTMLElement, map: GameMap, opts: WorldOptions = {}): World {
  let quality: WorldQuality = opts.quality && opts.quality !== 'auto' ? opts.quality : detectQuality()
  let adaptive = !opts.quality || opts.quality === 'auto'

  installGrade()
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, TIERS[quality].dpr))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.CustomToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.outline = 'none'
  container.appendChild(renderer.domElement)

  const layout = buildLayout(map)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight), 0.5, 900)

  const picker = createPicker(layout)
  const ray = new THREE.Ray()
  const ndc = new THREE.Vector2()
  function rayFromClient(clientX: number, clientY: number, cam: THREE.Camera = camera) {
    const r = renderer.domElement.getBoundingClientRect()
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
    ray.origin.setFromMatrixPosition(cam.matrixWorld)
    ray.direction.set(ndc.x, ndc.y, 0.5).unproject(cam).sub(ray.origin).normalize()
    return ray
  }
  const rig = createRig(camera, renderer.domElement, layout, (x, y) => {
    const hit = picker.pick(rayFromClient(x, y))
    return hit ? layout.stand[hit.tile] : null
  })

  // Light, placed relative to the default view so every screen gets the same key light.
  const az = opts.sunAzimuth !== undefined ? THREE.MathUtils.degToRad(opts.sunAzimuth) : SUN_AZIMUTH
  const sunDir = new THREE.Vector3()
  const center = new THREE.Vector3((layout.minX + layout.maxX) / 2, 0, (layout.minZ + layout.maxZ) / 2)
  const boardR = Math.hypot(layout.maxX - layout.minX, layout.maxZ - layout.minZ) / 2
  const sun = new THREE.DirectionalLight(NATURE.sun, 3.35)
  sun.castShadow = true
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.025
  scene.add(sun, sun.target)
  let env: THREE.WebGLRenderTarget | null = null
  scene.environmentIntensity = 0.55
  function placeSun() {
    sunDir.set(Math.cos(az) * Math.cos(SUN_ELEVATION), Math.sin(SUN_ELEVATION), -Math.sin(az) * Math.cos(SUN_ELEVATION))
    sunDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), rig.defaultYaw).normalize()
    sun.position.copy(center).addScaledVector(sunDir, 60)
    sun.target.position.copy(center)
    fitShadow(sun, layout)
    env?.dispose()
    env = buildEnvironment(renderer, sunDir)
    scene.environment = env.texture
  }

  const sky = buildSky({ minX: layout.minX, minZ: layout.minZ, maxX: layout.maxX, maxZ: layout.maxZ, y: BOTTOM_Y }, sunDir)
  scene.add(sky.mesh)
  const fog = new THREE.Fog(new THREE.Color(BACKDROP.haze), 30, 90)
  scene.fog = fog

  const terrain = buildTerrain(layout)
  scene.add(terrain.mesh)
  const water = buildWater(layout)
  scene.add(water.surface, water.rim)
  const props = buildProps(layout, quality)
  scene.add(props.group)
  const birds = buildBirds(layout, 6)
  scene.add(birds.mesh)
  const motes = buildMotes(layout, 220)
  scene.add(motes.points)
  const vignette = buildVignette()
  scene.add(vignette.mesh)

  const drawSize = new THREE.Vector2()
  let post: ReturnType<typeof createPost> | null = null
  function applyQuality() {
    const t = TIERS[quality]
    const wantPost = opts.post ?? t.post
    if (wantPost && !post) post = createPost(renderer, scene, camera)
    if (!wantPost && post) { post.dispose(); post = null }
    renderer.toneMapping = post ? THREE.NoToneMapping : THREE.CustomToneMapping
    // three mixes fog after the output transform when drawing straight to the screen, and in
    // linear space when drawing into the composer: hand it the matching encoding of the haze.
    const haze = new THREE.Color(BACKDROP.haze)
    if (post) fog.color.copy(haze)
    else fog.color.setRGB(...haze.convertLinearToSRGB().toArray() as [number, number, number], THREE.LinearSRGBColorSpace)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, t.dpr))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.getDrawingBufferSize(drawSize)
    sky.setSize(drawSize.x, drawSize.y)
    vignette.setSize(drawSize.x, drawSize.y)
    motes.setSize(drawSize.y)
    motes.points.visible = t.birds
    post?.setSize(container.clientWidth, container.clientHeight)
    if (sun.shadow.mapSize.x !== t.shadow) {
      sun.shadow.mapSize.set(t.shadow, t.shadow)
      sun.shadow.map?.dispose()
      sun.shadow.map = null
    }
    sun.shadow.radius = t.shadow >= 4096 ? 2.6 : t.shadow >= 2048 ? 1.8 : 1.2
    birds.mesh.visible = t.birds
  }
  applyQuality()
  if (opts.intro === false) rig.home(false)
  else rig.intro()
  // If the container has no size yet, the board is framed (and lit again) on the first real resize.
  placeSun()

  // Frame loop.
  const frameCbs = new Set<(dt: number, time: number) => void>()
  let last = performance.now()
  let time = 0
  let perfT = 0, perfN = 0, perfWarm = 0
  const loop = () => {
    const now = performance.now()
    const raw = (now - last) / 1000
    last = now
    const dt = Math.min(raw, 0.1)
    // Before drawing: a tier change resizes the canvas, which would blank an already drawn frame.
    if (adaptive) adapt(raw)
    time += dt
    shared.uTime.value = time
    shared.uCloudOffset.value.set(time * 0.012, time * 0.006)
    rig.update(dt)
    sky.update(camera, time)
    // A gentle haze toward the far side: at most ~12 % at the far rim, at any zoom.
    const d = camera.position.distanceTo(center)
    fog.near = d + boardR * 0.3
    fog.far = d + boardR * 6
    if (birds.mesh.visible) birds.update(time)
    for (const cb of frameCbs) cb(dt, time)
    draw(dt)
  }
  function draw(dt = 0) {
    if (post) post.render(dt)
    else renderer.render(scene, camera)
  }
  function adapt(raw: number) {
    // A hidden tab or a one-off hitch says nothing about the GPU: start measuring again.
    if (raw > 0.25) {
      perfWarm = 0
      perfT = 0
      perfN = 0
      return
    }
    perfWarm += raw
    if (perfWarm < 2.5) return
    perfT += raw
    perfN++
    if (perfT < 2) return
    const fps = perfN / perfT
    perfT = 0
    perfN = 0
    const next = fps < TIERS[quality].minFps ? ORDER[ORDER.indexOf(quality) + 1] : undefined
    if (next) {
      quality = next
      applyQuality()
      perfWarm = 0
    }
  }
  renderer.setAnimationLoop(loop)

  // Debug: run n full frames synchronously (GPU flushed each frame) and report ms per frame.
  const bench = (n = 60) => {
    const gl = renderer.getContext()
    const px = new Uint8Array(4)
    renderer.setAnimationLoop(null)
    const t0 = performance.now()
    for (let i = 0; i < n; i++) {
      loop()
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    }
    const ms = (performance.now() - t0) / n
    renderer.setAnimationLoop(loop)
    return { ms, quality, post: !!post, dpr: renderer.getPixelRatio(), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => world.resize()) : null
  ro?.observe(container)

  const world: World = {
    renderer,
    scene,
    camera,
    map,
    tileTop(tile) {
      return new THREE.Vector3(layout.cx[tile], layout.stand[tile], layout.cz[tile])
    },
    pick(clientX, clientY) {
      return picker.pick(rayFromClient(clientX, clientY))?.tile ?? null
    },
    onFrame(cb) {
      frameCbs.add(cb)
      return () => { frameCbs.delete(cb) }
    },
    setCleared(tiles) {
      props.setCleared(tiles)
    },
    focus(tile, animate, focusOpts) {
      rig.focus(layout.cx[tile], layout.stand[tile], layout.cz[tile], animate, focusOpts?.zoom)
    },
    setViewInsets(insets) {
      rig.setInsets(insets)
      draw()
    },
    resize() {
      const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      renderer.getDrawingBufferSize(drawSize)
      sky.setSize(drawSize.x, drawSize.y)
      vignette.setSize(drawSize.x, drawSize.y)
      motes.setSize(drawSize.y)
      post?.setSize(w, h)
      const wasFramed = rig.framed
      rig.resize()
      if (!wasFramed && rig.framed) placeSun()
      // Resizing clears the canvas; ResizeObserver runs after this frame was drawn, so draw again.
      draw()
    },
    get quality() {
      return quality
    },
    setQuality(q) {
      adaptive = q === 'auto'
      quality = q === 'auto' ? detectQuality() : q
      perfWarm = 0
      applyQuality()
    },
    home(animate = true, homeOpts) {
      const t = homeOpts?.around
      rig.home(animate, t === undefined ? undefined : t === null ? null : { x: layout.cx[t], y: layout.stand[t], z: layout.cz[t] })
    },
    dispose() {
      renderer.setAnimationLoop(null)
      ro?.disconnect()
      rig.dispose()
      frameCbs.clear()
      terrain.dispose()
      water.dispose()
      props.dispose()
      birds.dispose()
      motes.dispose()
      vignette.dispose()
      sky.dispose()
      post?.dispose()
      env?.dispose()
      sun.shadow.map?.dispose()
      sun.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
  Object.defineProperty(world, '__bench', { value: bench })
  Object.defineProperty(world, '__shared', { value: shared })
  Object.defineProperty(world, '__post', { get: () => post })
  return world
}

/** Fit the sun's orthographic shadow camera tightly around the board. */
function fitShadow(sun: THREE.DirectionalLight, layout: ReturnType<typeof buildLayout>) {
  sun.updateMatrixWorld()
  sun.target.updateMatrixWorld()
  const cam = sun.shadow.camera
  cam.position.copy(sun.position)
  cam.lookAt(sun.target.position)
  cam.updateMatrixWorld()
  const inv = cam.matrixWorldInverse
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (const x of [layout.minX, layout.maxX]) for (const z of [layout.minZ, layout.maxZ]) for (const y of [BOTTOM_Y, layout.maxY + 1.4]) {
    box.expandByPoint(v.set(x, y, z).applyMatrix4(inv))
  }
  const pad = 0.5
  cam.left = box.min.x - pad
  cam.right = box.max.x + pad
  cam.bottom = box.min.y - pad
  cam.top = box.max.y + pad
  cam.near = Math.max(0.1, -box.max.z - 6)
  cam.far = -box.min.z + 6
  cam.updateProjectionMatrix()
}
