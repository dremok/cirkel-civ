// The city diorama: renderer, light, camera, the plinth and its neighbours, a model per plot, life,
// selection and placement previews. React drives it through `CityScene` (see CityScreen.tsx).

import * as THREE from 'three'
import { BUILDINGS, type BuildingType, type CityInterior, PLOT_COUNT } from '../../../engine/city.ts'
import type { GameState } from '../../../engine/types.ts'
import { NATURE, PLAYERS } from '../../render/palette.ts'
import { buildBoard, buildStreets } from './board.ts'
import { type BuildCtx, type Model, type Team, buildLotOnly, buildModel, square } from './buildings.ts'
import { Kit, hexPts } from './geo.ts'
import { buildLand } from './land.ts'
import { BOARD_IN, BOARD_R, type CityLayout, LOT_R, SPOTS, buildCityLayout, dirAngle, plotAt } from './layout.ts'
import { createLife, type Life } from './life.ts'
import { U, cityDepthMaterial, cityMaterial } from './mat.ts'
import { createPost } from './post.ts'
import { type View, createRig } from './rig.ts'
import { installGrade } from '../../render/world/grade.ts'
import { BACKDROP, buildBackdrop, buildEnvironment, buildMotes, buildVignette } from './sky.ts'

export type Quality = 'low' | 'medium' | 'high'

const TIERS: Record<Quality, { dpr: number; shadow: number; post: boolean }> = {
  high: { dpr: 2, shadow: 4096, post: true },
  medium: { dpr: 1.5, shadow: 2048, post: false },
  low: { dpr: 1, shadow: 1024, post: false },
}

export interface SceneData {
  interior: CityInterior
  staffed: boolean[]
  pop: number
  idle: number
  /** Building under construction, progress 0..1. */
  construction: { building: BuildingType; plot: number; progress: number } | null
}

export interface CityScene {
  update(d: SceneData): void
  select(plot: number | null): void
  /** Ghost of a building on a plot, or null. */
  preview(p: { building: BuildingType; plot: number } | null): void
  /** Plots whose buildings feed the previewed one (they glow softly). */
  highlight(plots: number[]): void
  /** Screen space covered by panels (CSS px): the scene frames itself in the rest. */
  setInsets(i: { top: number; right: number; bottom: number; left: number }): void
  /** Screen position (CSS px, relative to the container) above a plot, or null if behind. */
  project(plot: number, lift?: number): { x: number; y: number } | null
  onPick: ((plot: number | null) => void) | null
  onHover: ((plot: number | null) => void) | null
  /** Called every frame after rendering (for DOM labels that follow the scene). */
  onFrame: ((dt: number) => void) | null
  enter(): Promise<void>
  exit(): Promise<void>
  resize(): void
  readonly quality: Quality
  /** Force a tier (or go back to detecting and adapting). */
  setQuality(q: Quality | 'auto'): void
  readonly fps: number
  /** Draw calls and triangles of the last frame (for tuning). */
  readonly info: { calls: number; triangles: number }
  dispose(): void
}

export interface CitySceneOptions {
  quality?: Quality | 'auto'
  /** Skip the entrance flight (screenshots). */
  instant?: boolean
  /** Fixed camera for screenshots: zoom factor and yaw. */
  view?: Partial<View>
  /** Gentle tilt-shift on the high tier (default on). */
  tiltShift?: boolean
}

function detectQuality(): Quality {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const small = Math.min(screen.width, screen.height) < 820
  if (coarse && small) return (navigator.hardwareConcurrency ?? 8) <= 4 ? 'low' : 'medium'
  return 'high'
}

const SUN_ELEVATION = THREE.MathUtils.degToRad(30)
const SUN_AZIMUTH = THREE.MathUtils.degToRad(205)

export function createCityScene(container: HTMLElement, state: GameState, cityId: number, opts: CitySceneOptions = {}): CityScene {
  const city = state.cities.find((c) => c.id === cityId)
  if (!city) throw new Error(`no city ${cityId}`)
  const colorIdx = state.players[city.owner]?.color ?? city.owner
  const pc = PLAYERS[((colorIdx % PLAYERS.length) + PLAYERS.length) % PLAYERS.length]
  const team: Team = { base: pc.base, light: pc.light, dark: pc.dark }
  const layout: CityLayout = buildCityLayout(state.map, city.tile)

  let quality: Quality = opts.quality && opts.quality !== 'auto' ? opts.quality : detectQuality()
  let adaptive = !opts.quality || opts.quality === 'auto'

  installGrade()
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, TIERS[quality].dpr))
  renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.CustomToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  // Shadows are refreshed once per frame, not again for every extra pass the AO renders.
  renderer.shadowMap.autoUpdate = false
  renderer.localClippingEnabled = true
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.outline = 'none'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight), 0.3, 400)
  const rig = createRig(camera, renderer.domElement, BOARD_IN * 0.75)

  // Light: a warm low sun from the front left, cool sky fill from the environment.
  const sunDir = new THREE.Vector3(Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION), Math.sin(SUN_ELEVATION), -Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION)).normalize()
  const sun = new THREE.DirectionalLight(NATURE.sun, 3.35)
  sun.position.copy(sunDir).multiplyScalar(40)
  sun.target.position.set(0, 0, 0)
  sun.castShadow = true
  sun.shadow.bias = -0.0003
  sun.shadow.normalBias = 0.012
  scene.add(sun, sun.target)
  fitShadow(sun)
  const envRT = buildEnvironment(renderer, sunDir)
  scene.environment = envRT.texture
  scene.environmentIntensity = 0.6
  const backdrop = buildBackdrop()
  scene.add(backdrop.mesh)
  const fog = new THREE.Fog(new THREE.Color(BACKDROP.haze), 30, 90)
  scene.fog = fog
  const vignette = buildVignette()
  scene.add(vignette.mesh)
  const motes = buildMotes(140, U.uTime)
  scene.add(motes.points)

  // Static ground.
  const mat = cityMaterial()
  const depthMat = cityDepthMaterial()
  const board = buildBoard(layout)
  const boardMesh = new THREE.Mesh(board.geo, mat)
  boardMesh.receiveShadow = true
  boardMesh.castShadow = true
  scene.add(boardMesh)
  const land = buildLand(layout, quality === 'high' ? 1 : quality === 'medium' ? 0.7 : 0.45)
  scene.add(land.group)
  const streets = new THREE.Mesh(new THREE.BufferGeometry(), mat)
  streets.receiveShadow = true
  scene.add(streets)
  let streetKey = ''

  // The square.
  const sq = new Kit()
  square(sq, { capital: city.capital, team, seed: city.id })
  const sqGeo = sq.build()
  const sqMesh = new THREE.Mesh(sqGeo, mat)
  sqMesh.castShadow = true
  sqMesh.receiveShadow = true
  sqMesh.customDepthMaterial = depthMat
  sqMesh.userData.plot = 0
  scene.add(sqMesh)

  // Plots.
  interface PlotVis {
    key: string
    group: THREE.Group
    model: Model | null
    meshes: THREE.Mesh[]
    spin: { obj: THREE.Object3D; axis: THREE.Vector3; speed: number }[]
    bob: { obj: THREE.Object3D; base: THREE.Vector3; seed: number }[]
    /** A second boat out fishing, sailing slow circles on the sea in front of a harbour. */
    sail: { obj: THREE.Mesh; cx: number; cz: number; r: number; speed: number; phase: number; base: number }[]
    clipMat: THREE.Material | null
    ghostMat?: THREE.Material
    rise: number
  }
  const plots: (PlotVis | null)[] = Array(PLOT_COUNT).fill(null)
  const pickables: THREE.Object3D[] = [sqMesh]
  const waterDirs = SPOTS.map((s) => {
    if (s.ring !== 2) return 0
    const wet = s.facing.filter((d) => layout.neighbours[d].water)
    if (!wet.length) return 0
    const a = wet.length === 2 ? s.out : dirAngle(wet[0])
    return Math.atan2(Math.sin(a - s.out), Math.cos(a - s.out))
  })
  const ctxFor = (plot: number, lit: boolean): BuildCtx => ({
    spot: SPOTS[plot], team, seed: city.id * 101 + plot * 7, lit, waterDir: waterDirs[plot], waterY: layout.waterY, capital: city.capital,
  })

  function disposePlot(i: number) {
    const v = plots[i]
    if (!v) return
    scene.remove(v.group)
    for (const m of v.meshes) {
      m.geometry.dispose()
      const ix = pickables.indexOf(m)
      if (ix >= 0) pickables.splice(ix, 1)
    }
    v.clipMat?.dispose()
    v.ghostMat?.dispose()
    for (const b of v.sail) { scene.remove(b.obj); b.obj.geometry.dispose() }
    plots[i] = null
  }

  function buildPlot(i: number, type: BuildingType | 'empty', lit: boolean, site: { progress: number } | null, animate: boolean) {
    disposePlot(i)
    const s = SPOTS[i]
    const group = new THREE.Group()
    // empty lots lie almost flush with the paths: a meadow, not a tile
    group.position.set(s.x, type === 'empty' && !site ? 0.018 : 0.045, s.z)
    group.rotation.y = -s.out
    const meshes: THREE.Mesh[] = []
    const vis: PlotVis = { key: '', group, model: null, meshes, spin: [], bob: [], sail: [], clipMat: null, rise: animate ? 0 : 1 }
    const ctx = ctxFor(i, lit)
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = group) => {
      const mesh = new THREE.Mesh(geo, m)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.customDepthMaterial = depthMat
      mesh.userData.plot = i
      parent.add(mesh)
      meshes.push(mesh)
      pickables.push(mesh)
      return mesh
    }
    if (site) {
      // A construction site: the building rises out of its scaffolding, clipped at its progress.
      const model = buildModel(type, { ...ctx, bare: true })
      vis.model = model
      // wheels and boats come with the finished building
      for (const sp of model.spinners) sp.geo.dispose()
      for (const bb of model.bobbers) bb.geo.dispose()
      add(buildLotOnly(ctx), mat)
      const h = model.height
      const cut = 0.02 + h * Math.min(1, site.progress)
      const cm = cityMaterial({ clipping: [new THREE.Plane(new THREE.Vector3(0, -1, 0), cut + 0.045)], key: 'clip' })
      vis.clipMat = cm
      add(model.geo, cm)
      const gm = ghostMaterial(team, [new THREE.Plane(new THREE.Vector3(0, 1, 0), -(cut + 0.045))])
      vis.ghostMat = gm
      const ghost = add(model.geo.clone(), gm)
      ghost.castShadow = false
      ghost.renderOrder = 4
    } else {
      const model = buildModel(type, ctx)
      vis.model = model
      add(model.geo, mat)
      for (const sp of model.spinners) {
        const pivot = new THREE.Group()
        pivot.position.copy(sp.pivot)
        group.add(pivot)
        add(sp.geo, mat, pivot)
        vis.spin.push({ obj: pivot, axis: sp.axis, speed: sp.speed })
      }
      for (const bb of model.bobbers) {
        const pivot = new THREE.Group()
        pivot.position.copy(bb.pivot)
        group.add(pivot)
        add(bb.geo, mat, pivot)
        vis.bob.push({ obj: pivot, base: bb.pivot.clone(), seed: bb.seed })
        const wet = s.facing.map((d) => layout.neighbours[d]).find((n) => n.water)
        if (wet) {
          const boat = new THREE.Mesh(bb.geo.clone(), mat)
          boat.castShadow = true
          boat.position.y = layout.waterY
          scene.add(boat)
          vis.sail.push({ obj: boat, cx: wet.cx * 0.8, cz: wet.cz * 0.8, r: 1.1 + (i % 3) * 0.25, speed: 0.05 + (i % 2) * 0.015, phase: i * 1.7, base: waterDirs[i] })
        }
      }
    }
    scene.add(group)
    plots[i] = vis
    return vis
  }

  // Ghost material for placement previews and the unbuilt part of construction sites.
  const ghostMat = ghostMaterial(team)
  let previewVis: { group: THREE.Group; geo: THREE.BufferGeometry; plot: number; building: BuildingType } | null = null

  // Selection: a soft luminous hex outline around the lot, and outlines on the tiles it faces.
  const ringGeo = hexRing(LOT_R + 0.06, 0.035)
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFF6E0'), transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false })
  const selRing = new THREE.Mesh(ringGeo, ringMat)
  selRing.visible = false
  selRing.renderOrder = 5
  scene.add(selRing)
  const hoverRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFF6E0'), transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }))
  hoverRing.visible = false
  hoverRing.renderOrder = 5
  scene.add(hoverRing)
  const faceGeo = hexRing(BOARD_R * 0.93, 0.07)
  const faceMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFF6E0'), transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false })
  const faceRings = layout.neighbours.map((n) => {
    const m = new THREE.Mesh(faceGeo, faceMat)
    const y = n.water ? layout.waterY + 0.01 : n.top + 0.02
    m.position.set(n.cx, y, n.cz)
    m.visible = false
    m.renderOrder = 5
    scene.add(m)
    return m
  })
  const glowRings: THREE.Mesh[] = []

  const life: Life = createLife(scene, team, layout)

  // Post and quality.
  const drawSize = new THREE.Vector2()
  let post: ReturnType<typeof createPost> | null = null
  function applyQuality() {
    const t = TIERS[quality]
    if (t.post && !post) post = createPost(renderer, scene, camera, { tiltShift: opts.tiltShift })
    if (!t.post && post) { post.dispose(); post = null }
    renderer.toneMapping = post ? THREE.NoToneMapping : THREE.CustomToneMapping
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, t.dpr))
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight))
    renderer.getDrawingBufferSize(drawSize)
    backdrop.setSize(drawSize.x, drawSize.y)
    vignette.setSize(drawSize.x, drawSize.y)
    motes.setSize(drawSize.y)
    post?.setSize(container.clientWidth, container.clientHeight)
    if (sun.shadow.mapSize.x !== t.shadow) {
      sun.shadow.mapSize.set(t.shadow, t.shadow)
      sun.shadow.map?.dispose()
      sun.shadow.map = null
    }
    sun.shadow.radius = t.shadow >= 4096 ? 2.4 : 1.6
  }
  applyQuality()

  // Start view.
  const home = rig.home()
  const view = { ...home, ...opts.view }
  if (opts.view?.dist) view.dist = home.dist * opts.view.dist
  rig.set(opts.instant ? view : farView(view))

  // Picking.
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  function pickAt(cx: number, cy: number): number | null {
    const r = renderer.domElement.getBoundingClientRect()
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObjects(pickables, false)
    for (const h of hits) if (typeof h.object.userData.plot === 'number') return h.object.userData.plot as number
    // fall back to the ground plane
    const t = -raycaster.ray.origin.y / raycaster.ray.direction.y
    if (t > 0) {
      const p = raycaster.ray.at(t, new THREE.Vector3())
      const i = plotAt(p.x, p.z)
      return i >= 0 ? i : null
    }
    return null
  }
  rig.onTap = (x, y) => api.onPick?.(pickAt(x, y))
  let hovered: number | null = null
  rig.onHover = (x, y) => {
    const p = pickAt(x, y)
    if (p === hovered) return
    hovered = p
    api.onHover?.(p)
    if (p === null || p === 0) hoverRing.visible = false
    else {
      hoverRing.position.set(SPOTS[p].x, 0.05, SPOTS[p].z)
      hoverRing.visible = p !== selected
    }
  }
  renderer.domElement.addEventListener('pointerleave', () => { hoverRing.visible = false; hovered = null })

  // Data.
  let data: SceneData | null = null
  let selected: number | null = null
  function update(d: SceneData) {
    const first = data === null
    data = d
    for (let i = 1; i < PLOT_COUNT; i++) {
      const b = d.interior.plots[i]
      const site = d.construction && d.construction.plot === i && !b ? d.construction : null
      const type: BuildingType | 'empty' = site ? site.building : b ?? 'empty'
      const lit = b ? (BUILDINGS[b].worker ? d.staffed[i] : true) : true
      const key = `${type}|${lit}|${site ? Math.round(site.progress * 100) : -1}`
      if (plots[i]?.key === key) continue
      const prevType = plots[i]?.key.split('|')[0]
      const v = buildPlot(i, type, lit, site, !first && prevType !== type && type !== 'empty' && !site)
      v.key = key
    }
    const built = (p: number) => d.interior.plots[p] !== null || d.construction?.plot === p
    const sk = d.interior.plots.map((_, i) => (built(i) ? 1 : 0)).join('')
    if (sk !== streetKey) {
      streetKey = sk
      streets.geometry.dispose()
      streets.geometry = buildStreets(layout, built)
    }
    life.setCity(d, plots.map((p) => p?.model ?? null))
  }

  function select(plot: number | null) {
    selected = plot
    for (const r of faceRings) r.visible = false
    if (plot === null || plot === 0) { selRing.visible = false; return }
    const s = SPOTS[plot]
    selRing.position.set(s.x, 0.05, s.z)
    selRing.visible = true
    hoverRing.visible = false
    for (const d of s.facing) if (layout.neighbours[d].tile !== null) faceRings[d].visible = true
    rig.lookAt(s.x, s.z)
  }

  function preview(p: { building: BuildingType; plot: number } | null) {
    if (previewVis && (!p || previewVis.plot !== p.plot || previewVis.building !== p.building)) {
      scene.remove(previewVis.group)
      previewVis.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
      previewVis = null
      for (const v of plots) if (v) v.group.visible = true
    }
    if (!p || previewVis) return
    const s = SPOTS[p.plot]
    const model = buildModel(p.building, ctxFor(p.plot, true))
    const group = new THREE.Group()
    group.position.set(s.x, 0.05, s.z)
    group.rotation.y = -s.out
    const m = new THREE.Mesh(model.geo, ghostMat)
    m.renderOrder = 4
    group.add(m)
    for (const sp of model.spinners) { const g = new THREE.Mesh(sp.geo, ghostMat); g.position.copy(sp.pivot); group.add(g) }
    for (const bb of model.bobbers) { const g = new THREE.Mesh(bb.geo, ghostMat); g.position.copy(bb.pivot); group.add(g) }
    scene.add(group)
    previewVis = { group, geo: model.geo, plot: p.plot, building: p.building }
    // hide what is on the lot now (the empty lot)
    const cur = plots[p.plot]
    if (cur) cur.group.visible = false
  }

  function highlight(list: number[]) {
    for (const g of glowRings) scene.remove(g)
    glowRings.length = 0
    for (const p of list) {
      const m = new THREE.Mesh(ringGeo, ringMat)
      m.position.set(SPOTS[p].x, 0.05, SPOTS[p].z)
      m.renderOrder = 5
      scene.add(m)
      glowRings.push(m)
    }
  }

  const insets = { top: 0, right: 0, bottom: 0, left: 0 }
  const offset = { x: 0, y: 0 }
  function applyOffset(dt: number) {
    const W = Math.max(1, container.clientWidth), H = Math.max(1, container.clientHeight)
    const gx = W / 2 - (insets.left + (W - insets.right)) / 2
    const gy = H / 2 - (insets.top + (H - insets.bottom)) / 2
    const k = dt < 0 ? 1 : 1 - Math.exp(-dt * 6)
    offset.x += (gx - offset.x) * k
    offset.y += (gy - offset.y) * k
    if (Math.abs(offset.x) < 0.5 && Math.abs(offset.y) < 0.5 && gx === 0 && gy === 0) {
      if (camera.view?.enabled) camera.clearViewOffset()
      return
    }
    const v = camera.view
    if (v?.enabled && Math.abs(v.offsetX - offset.x) < 0.05 && Math.abs(v.offsetY - offset.y) < 0.05 && v.fullWidth === W && v.fullHeight === H) return
    camera.setViewOffset(W, H, offset.x, offset.y, W, H)
  }

  const v3 = new THREE.Vector3()
  function project(plot: number, lift = 0.6) {
    const s = SPOTS[plot]
    const h = plot === 0 ? 1.2 : (previewVis?.plot === plot ? 0.9 : plots[plot]?.model?.height ?? 0.4)
    v3.set(s.x, h + lift * 0.3, s.z).project(camera)
    if (v3.z > 1) return null
    return { x: (v3.x * 0.5 + 0.5) * container.clientWidth, y: (-v3.y * 0.5 + 0.5) * container.clientHeight }
  }
  function setInsets(i: { top: number; right: number; bottom: number; left: number }) {
    Object.assign(insets, i)
  }

  // Frame loop.
  let last = performance.now()
  let time = 0
  let perfT = 0, perfN = 0, perfWarm = 0
  let fps = 60
  let fpsT = 0, fpsN = 0
  const loop = () => {
    const now = performance.now()
    const raw = (now - last) / 1000
    last = now
    const dt = Math.min(raw, 0.1)
    time += dt
    U.uTime.value = time
    U.uCloudOffset.value.set(time * 0.01, time * 0.005)
    rig.update(dt)
    applyOffset(dt)
    backdrop.mesh.position.copy(camera.position)
    const d = camera.position.length()
    fog.near = d * 1.1
    fog.far = d * 3.6
    // plots rising after they are built, wheels and boats
    for (const v of plots) {
      if (!v) continue
      if (v.rise < 1) {
        v.rise = Math.min(1, v.rise + dt / 0.9)
        const e = 1 - (1 - v.rise) ** 3
        v.group.scale.set(1, Math.max(0.001, e), 1)
      }
      for (const s of v.spin) s.obj.rotateOnWorldAxis(s.axis, s.speed * dt)
      for (const b of v.sail) {
        const a = time * b.speed + b.phase
        b.obj.position.x = b.cx + Math.cos(a) * b.r
        b.obj.position.z = b.cz + Math.sin(a) * b.r * 0.7
        b.obj.position.y = layout.waterY + Math.sin(time * 1.1 + b.phase) * 0.012
        const heading = Math.atan2(Math.cos(a) * 0.7, -Math.sin(a))
        b.obj.rotation.set(Math.sin(time * 0.9 + b.phase) * 0.04, -heading + b.base, Math.sin(time * 0.7) * 0.05 - 0.06, 'YXZ')
      }
      for (const b of v.bob) {
        b.obj.position.y = b.base.y + Math.sin(time * 1.3 + b.seed) * 0.012
        b.obj.rotation.x = Math.sin(time * 0.9 + b.seed) * 0.05
        b.obj.rotation.z = Math.sin(time * 1.1 + b.seed * 2) * 0.03
      }
    }
    if (selRing.visible) ringMat.opacity = 0.7 + 0.25 * Math.sin(time * 3)
    if (previewVis) ghostMat.opacity = 0.62 + 0.08 * Math.sin(time * 2.5)
    faceMat.opacity = 0.45 + 0.2 * Math.sin(time * 2.2)
    land.update(dt, time)
    life.update(dt, time)
    renderer.shadowMap.needsUpdate = true
    if (post) post.render(dt)
    else renderer.render(scene, camera)
    api.onFrame?.(dt)
    fpsT += raw
    fpsN++
    if (fpsT > 1) { fps = fpsN / fpsT; fpsT = 0; fpsN = 0 }
    if (adaptive) adapt(raw)
  }
  function adapt(raw: number) {
    perfWarm += raw
    if (perfWarm < 3) return
    perfT += raw
    perfN++
    if (perfT < 2) return
    const f = perfN / perfT
    perfT = 0
    perfN = 0
    const next: Quality | null = quality === 'high' && f < 45 ? 'medium' : quality === 'medium' && f < 27 ? 'low' : null
    if (next) { quality = next; applyQuality(); perfWarm = 0 }
  }
  renderer.setAnimationLoop(loop)

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => api.resize()) : null
  ro?.observe(container)

  function farView(v: View): View {
    return { x: v.x * 0.3, z: v.z + 1.5, yaw: v.yaw - 0.55, pitch: Math.min(1.32, v.pitch + 0.42), dist: v.dist * 2.6 }
  }

  const api: CityScene = {
    update, select, preview, highlight, project, setInsets,
    onPick: null, onHover: null, onFrame: null,
    async enter() {
      if (opts.instant) return
      await rig.fly(farView(view), view, 1.7)
    },
    async exit() {
      await rig.fly({ ...rig.cur }, farView(rig.cur), 0.75)
    },
    resize() {
      const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight)
      renderer.setSize(w, h)
      renderer.getDrawingBufferSize(drawSize)
      backdrop.setSize(drawSize.x, drawSize.y)
      vignette.setSize(drawSize.x, drawSize.y)
      motes.setSize(drawSize.y)
      post?.setSize(w, h)
      rig.resize()
    },
    get quality() { return quality },
    setQuality(q) {
      adaptive = q === 'auto'
      quality = q === 'auto' ? detectQuality() : q
      perfWarm = 0
      applyQuality()
    },
    get fps() { return fps },
    get info() { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles } },
    dispose() {
      renderer.setAnimationLoop(null)
      ro?.disconnect()
      rig.dispose()
      for (let i = 0; i < PLOT_COUNT; i++) disposePlot(i)
      if (previewVis) { previewVis.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose() }); previewVis = null }
      life.dispose()
      land.dispose()
      board.geo.dispose()
      streets.geometry.dispose()
      sqGeo.dispose()
      mat.dispose()
      depthMat.dispose()
      ghostMat.dispose()
      ringGeo.dispose()
      ringMat.dispose()
      ;(hoverRing.material as THREE.Material).dispose()
      faceGeo.dispose()
      faceMat.dispose()
      backdrop.dispose()
      vignette.dispose()
      motes.dispose()
      post?.dispose()
      envRT.dispose()
      sun.shadow.map?.dispose()
      sun.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
  return api
}

/** A pale, luminous version of a model: its colours washed toward ivory, with a soft rim of light. */
function ghostMaterial(team: Team, clipping?: THREE.Plane[]): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false, roughness: 0.7 })
  if (clipping) m.clippingPlanes = clipping
  const tint = new THREE.Color(team.light)
  m.customProgramCacheKey = () => 'ghost'
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTint = { value: tint }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.97, 0.9), 0.68);')
      .replace('#include <opaque_fragment>', `{
        float rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.0);
        outgoingLight += mix(vec3(1.0, 0.95, 0.85), uTint, 0.18) * rim * 0.5;
        diffuseColor.a = clamp(diffuseColor.a + rim * 0.2, 0.0, 1.0);
      }
      #include <opaque_fragment>`)
  }
  return m
}

/** A flat hex outline (pointy-top, circumradius r) of width w, lying at y = 0. */
function hexRing(r: number, w: number): THREE.BufferGeometry {
  const outer = hexPts(r)
  const inner = hexPts(r - w / (Math.sqrt(3) / 2))
  const pos: number[] = []
  for (let i = 0; i < 6; i++) {
    const a = outer[i], b = outer[(i + 1) % 6], c = inner[(i + 1) % 6], d = inner[i]
    pos.push(a[0], 0, a[1], c[0], 0, c[1], b[0], 0, b[1])
    pos.push(a[0], 0, a[1], d[0], 0, d[1], c[0], 0, c[1])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

function fitShadow(sun: THREE.DirectionalLight) {
  sun.updateMatrixWorld()
  sun.target.updateMatrixWorld()
  const cam = sun.shadow.camera
  cam.position.copy(sun.position)
  cam.lookAt(sun.target.position)
  cam.updateMatrixWorld()
  const inv = cam.matrixWorldInverse
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  const R = BOARD_R + 2.2
  for (const x of [-R, R]) for (const z of [-R, R]) for (const y of [-1.5, 3.5]) box.expandByPoint(v.set(x, y, z).applyMatrix4(inv))
  cam.left = box.min.x
  cam.right = box.max.x
  cam.bottom = box.min.y
  cam.top = box.max.y
  cam.near = Math.max(0.1, -box.max.z - 10)
  cam.far = -box.min.z + 10
  cam.updateProjectionMatrix()
}
