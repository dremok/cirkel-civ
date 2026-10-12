// The world: a floating diorama of bevelled hex columns in warm late-afternoon light, a luminous
// sea, swaying trees, drifting cloud shadows and a few birds. Knows nothing about game pieces.
// See ART.md for the look and api.ts for the contract.

import * as THREE from 'three'
import type { GameMap, TileId } from '../../../engine/types.ts'
import type { World, WorldQuality } from '../api.ts'
import { NATURE } from '../palette.ts'
import { buildMotes, buildPuffs, buildVignette } from './atmosphere.ts'
import { buildBirds } from './birds.ts'
import { CLOUD_SURFACE, buildClouds, type FogClouds } from './clouds.ts'
import { BOTTOM_Y, buildLayout } from './layout.ts'
import { createPicker } from './pick.ts'
import { installGrade } from './grade.ts'
import { createPost } from './post.ts'
import { buildProps } from './props.ts'
import { createRig } from './rig.ts'
import { fogShared, shared } from './shading.ts'
import { BACKDROP, buildEnvironment, buildSky } from './sky.ts'
import { buildTerrain } from './terrain.ts'
import { buildWater } from './water.ts'

/** post: 'full' = bloom, tilt-shift, grade, SMAA and N8AO; 'glow' = the same without AO; null = direct. */
const TIERS: Record<WorldQuality, { dpr: number; shadow: number; birds: boolean; post: 'full' | 'glow' | null; minFps: number }> = {
  ultra: { dpr: 2, shadow: 4096, birds: true, post: 'full', minFps: 45 },
  high: { dpr: 2, shadow: 4096, birds: true, post: 'glow', minFps: 42 },
  medium: { dpr: 1.75, shadow: 2048, birds: true, post: null, minFps: 26 },
  low: { dpr: 1.25, shadow: 1024, birds: false, post: null, minFps: 0 },
}
const ORDER: WorldQuality[] = ['ultra', 'high', 'medium', 'low']

/** Sun direction in the frame of the default view (x = screen right, z = toward the viewer). */
const SUN_ELEVATION = THREE.MathUtils.degToRad(32)
const SUN_AZIMUTH = THREE.MathUtils.degToRad(165) // from the left, a little behind

export interface WorldOptions {
  quality?: WorldQuality | 'auto'
  /** Override the sun azimuth (degrees, in the default view frame). For tuning. */
  sunAzimuth?: number
  /** Force the post chain on ('glow', or 'full' with AO) or off regardless of tier. For tuning. */
  post?: 'full' | 'glow' | false
  /** Glide the camera in on load (default true). */
  intro?: boolean
}

function detectQuality(renderer?: THREE.WebGLRenderer): WorldQuality {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const small = Math.min(screen.width, screen.height) < 820
  if (coarse && small) return (navigator.hardwareConcurrency ?? 8) <= 4 ? 'low' : 'medium'
  // Clearly strong GPUs start with the full post chain; the frame-time check steps down if needed.
  const gl = renderer?.getContext()
  const info = gl?.getExtension('WEBGL_debug_renderer_info')
  const name = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
  if (/Apple M\d|GeForce|RTX|Radeon RX|Radeon Pro/i.test(name)) return 'high'
  return 'medium'
}

export function createWorld(container: HTMLElement, map: GameMap, opts: WorldOptions = {}): World {
  installGrade()
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false })
  let quality: WorldQuality = opts.quality && opts.quality !== 'auto' ? opts.quality : detectQuality(renderer)
  let adaptive = !opts.quality || opts.quality === 'auto'
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

  // Fog of war hides heights under the clouds: picking, tileTop and the camera use these.
  const effStand = layout.stand.slice()
  const effPick = layout.pickTop.slice()
  const effCrag = layout.cragTop.slice()
  const picker = createPicker({ ...layout, pickTop: effPick, cragTop: effCrag })
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
    return hit ? effStand[hit.tile] : null
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
  // Props are rebuilt when the tier changes how dense they are (lite on low, extra flowers on high).
  const density = (q: WorldQuality) => (q === 'low' ? 0 : q === 'medium' ? 1 : 2)
  let props = buildProps(layout, quality)
  let propsDensity = density(quality)
  let cleared: TileId[] = []
  scene.add(props.group)
  const birds = buildBirds(layout, 6)
  scene.add(birds.mesh)
  const motes = buildMotes(layout, 220)
  scene.add(motes.points)
  const vignette = buildVignette()
  scene.add(vignette.mesh)
  const puffs = buildPuffs(layout, BOTTOM_Y)
  scene.add(puffs.mesh)

  // Fog of war. Per tile: the target (explored, in sight) and the animated amounts.
  const nTiles = map.tiles.length
  const fogE = new Uint8Array(nTiles).fill(1)
  const fogV = new Uint8Array(nTiles).fill(1)
  const fogEa = new Float32Array(nTiles).fill(1)
  const fogVa = new Float32Array(nTiles).fill(1)
  const fogData = new Uint8Array(map.width * map.height * 4).fill(255)
  const fogTex = new THREE.DataTexture(fogData, map.width, map.height, THREE.RGBAFormat)
  fogTex.magFilter = fogTex.minFilter = THREE.NearestFilter
  fogTex.needsUpdate = true
  fogShared.uFogTiles.value = fogTex
  fogShared.uFogDims.value.set(map.width, map.height)
  fogShared.uFogOn.value = 0
  let fogOn = false
  let fogAnimating = false
  let clouds: FogClouds | null = null
  let cloudsDensity = -1
  const FOG_SECONDS = 0.8
  function syncFogTex() {
    for (let t = 0; t < nTiles; t++) {
      fogData[t * 4] = fogE[t] * 255
      fogData[t * 4 + 1] = Math.round(fogVa[t] * 255)
      fogData[t * 4 + 2] = Math.round(fogEa[t] * 255)
    }
    fogTex.needsUpdate = true
  }
  function ensureClouds() {
    if (!fogOn) return
    if (clouds && cloudsDensity === density(quality)) return
    if (clouds) { scene.remove(clouds.mesh); clouds.dispose() }
    clouds = buildClouds(layout, quality, sunDir)
    cloudsDensity = density(quality)
    clouds.setExplored(fogEa)
    scene.add(clouds.mesh)
  }
  function stepFog(dt: number) {
    if (!fogAnimating) return
    const k = dt / FOG_SECONDS
    let moving = false
    for (let t = 0; t < nTiles; t++) {
      const e = fogEa[t], v = fogVa[t]
      if (e !== fogE[t]) { fogEa[t] = e < fogE[t] ? Math.min(fogE[t], e + k) : Math.max(fogE[t], e - k); moving = true }
      if (v !== fogV[t]) { fogVa[t] = v < fogV[t] ? Math.min(fogV[t], v + k) : Math.max(fogV[t], v - k); moving = true }
    }
    syncFogTex()
    clouds?.setExplored(fogEa)
    fogAnimating = moving
  }

  const drawSize = new THREE.Vector2()
  let post: ReturnType<typeof createPost> | null = null
  let postKind: 'full' | 'glow' | null = null
  function applyQuality() {
    const t = TIERS[quality]
    ensureClouds()
    if (density(quality) !== propsDensity) {
      scene.remove(props.group)
      props.dispose()
      props = buildProps(layout, quality)
      props.setCleared(cleared)
      propsDensity = density(quality)
      scene.add(props.group)
    }
    const want = opts.post === undefined ? t.post : opts.post || null
    if (want !== postKind) {
      post?.dispose()
      post = want ? createPost(renderer, scene, camera, want === 'full') : null
      postKind = want
    }
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
    post?.setZoom(rig.goal.dist)
    sky.update(camera, time)
    // A gentle haze toward the far side: at most ~12 % at the far rim, at any zoom.
    const d = camera.position.distanceTo(center)
    fog.near = d + boardR * 0.3
    fog.far = d + boardR * 6
    if (birds.mesh.visible) birds.update(time, camera.position)
    stepFog(dt)
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
    if (perfT < 3) return
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
      return new THREE.Vector3(layout.cx[tile], effStand[tile], layout.cz[tile])
    },
    pick(clientX, clientY) {
      return picker.pick(rayFromClient(clientX, clientY))?.tile ?? null
    },
    onFrame(cb) {
      frameCbs.add(cb)
      return () => { frameCbs.delete(cb) }
    },
    setCleared(tiles) {
      cleared = [...tiles]
      props.setCleared(cleared)
    },
    focus(tile, animate, focusOpts) {
      rig.focus(layout.cx[tile], effStand[tile], layout.cz[tile], animate, focusOpts?.zoom)
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
      quality = q === 'auto' ? detectQuality(renderer) : q
      perfWarm = 0
      applyQuality()
    },
    home(animate = true, homeOpts) {
      const t = homeOpts?.around
      rig.home(animate, t === undefined ? undefined : t === null ? null : { x: layout.cx[t], y: effStand[t], z: layout.cz[t] })
    },
    setFog(fog, fogOpts) {
      const wasOn = fogOn
      if (!fog) {
        fogOn = false
        fogAnimating = false
        fogShared.uFogOn.value = 0
        fogE.fill(1); fogV.fill(1); fogEa.fill(1); fogVa.fill(1)
        effStand.set(layout.stand); effPick.set(layout.pickTop); effCrag.set(layout.cragTop)
        if (clouds) clouds.mesh.visible = false
        syncFogTex()
        return
      }
      fogOn = true
      fogShared.uFogOn.value = 1
      for (let t = 0; t < nTiles; t++) {
        const v = fog.visible[t] ? 1 : 0
        fogV[t] = v
        fogE[t] = fog.explored[t] || v ? 1 : 0
      }
      // Under the clouds a tile has no height of its own: tileTop and picking use one flat cloud
      // surface for every clouded tile, so nothing drawn or picked there reveals the land.
      for (let t = 0; t < nTiles; t++) {
        const known = fogE[t] === 1
        effStand[t] = known ? layout.stand[t] : CLOUD_SURFACE
        effPick[t] = known ? layout.pickTop[t] : CLOUD_SURFACE
        effCrag[t] = known ? layout.cragTop[t] : 0
      }
      const animate = !!fogOpts?.animate && wasOn
      if (!animate) { for (let t = 0; t < nTiles; t++) { fogEa[t] = fogE[t]; fogVa[t] = fogV[t] } }
      fogAnimating = animate
      syncFogTex()
      ensureClouds()
      if (clouds) { clouds.mesh.visible = true; clouds.setExplored(fogEa) }
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
      puffs.dispose()
      clouds?.dispose()
      fogTex.dispose()
      fogShared.uFogOn.value = 0
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
