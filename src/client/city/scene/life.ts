// Life in the town: citizens walking the streets, workers at the buildings that have a worker,
// idle folk chatting on the square, shoppers at the market, soldiers drilling, guards on the walls,
// chimney smoke and a few birds. Calm and slow.

import * as THREE from 'three'
import type { BuildingType } from '../../../engine/city.ts'
import { PLOTS } from '../../../engine/city.ts'
import type { Model, Team } from './buildings.ts'
import { Kit, cone, cyl, hash, lathe, rng, sphere } from './geo.ts'
import { type CityLayout, SPOTS } from './layout.ts'
import { cityMaterial } from './mat.ts'
import type { SceneData } from './scene.ts'

const CLOTHES = ['#D9C49C', '#A07E5E', '#7F9C7C', '#6F88A6', '#B86E52', '#EFE6D4', '#8E6E8E', '#C9AA5E', '#5E7E8E', '#E3D3B2', '#F2EEE6']
const SKIN = ['#EBB896', '#D9A07A', '#F1C7A6', '#B97E5A', '#E4AE88']

type Act = 'walk' | 'work' | 'idle' | 'crowd' | 'drill' | 'guard'

interface Person {
  act: Act
  x: number
  z: number
  y: number
  yaw: number
  seed: number
  // walking
  from?: number
  to?: number
  t?: number
  speed?: number
  side?: number
  // stationary
  hx?: number
  hz?: number
  face?: number
  range?: number
  soldier?: boolean
}

function bodyGeometry(): THREE.BufferGeometry {
  const k = new Kit()
  k.add(lathe([[0, 0], [0.03, 0], [0.034, 0.01], [0.029, 0.05], [0.025, 0.084], [0.029, 0.1], [0.021, 0.114], [0, 0.118]], 10), '#FFFFFF', {}, { smooth: true })
  // arms
  for (const s of [-1, 1]) k.add(cyl(0.008, 0.009, 0.06, 5), '#FFFFFF', { p: [s * 0.03, 0.075, 0], r: [0, 0, s * 0.12] }, { smooth: true })
  return k.build()
}

function headGeometry(): THREE.BufferGeometry {
  const k = new Kit()
  k.add(sphere(0.022, 10, 8), '#FFFFFF', { p: [0, 0.138, 0] }, { smooth: true })
  k.add(sphere(0.0235, 10, 6), '#5C3F2E', { p: [-0.003, 0.143, 0], s: [1, 0.8, 1] }, { smooth: true })
  return k.build()
}

function soldierGeometry(team: Team): THREE.BufferGeometry {
  const k = new Kit()
  k.add(lathe([[0, 0], [0.031, 0], [0.035, 0.01], [0.03, 0.05], [0.026, 0.084], [0.03, 0.1], [0.021, 0.114], [0, 0.118]], 10), team.base, {}, { smooth: true })
  k.add(cyl(0.031, 0.031, 0.01, 10), '#5E3D29', { p: [0, 0.06, 0] })
  k.add(sphere(0.022, 10, 8), '#EBB896', { p: [0, 0.138, 0] }, { smooth: true })
  k.add(sphere(0.024, 10, 5, ), '#A7AEB7', { p: [0, 0.145, 0], s: [1, 0.75, 1] }, { smooth: true })
  k.add(cyl(0.0035, 0.0035, 0.24, 4), '#8E5E3B', { p: [0.0, 0.12, 0.036] })
  k.add(cone(0.007, 0.02, 4), '#C9CED4', { p: [0.0, 0.25, 0.036] })
  k.add(cyl(0.022, 0.022, 0.006, 10), team.light, { p: [0.03, 0.075, -0.012], r: [0, 0, Math.PI / 2] })
  return k.build()
}

function birdGeometry(): THREE.BufferGeometry {
  const pos = [
    0, 0, 0.06, -0.5, 0.02, -0.02, 0, 0, -0.06,
    -0.5, 0.02, -0.02, -0.2, 0, -0.1, 0, 0, -0.06,
    0, 0, 0.06, 0, 0, -0.06, 0.5, 0.02, -0.02,
    0.5, 0.02, -0.02, 0, 0, -0.06, 0.2, 0, -0.1,
    0, 0.02, 0.2, -0.04, 0, 0, 0.04, 0, 0,
    0.04, 0, 0, -0.04, 0, 0, 0, -0.02, -0.22,
  ]
  const wing = pos.filter((_, i) => i % 3 === 0).map((x) => Math.abs(x))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('wing', new THREE.Float32BufferAttribute(wing, 1))
  g.computeVertexNormals()
  return g
}

/** Street graph: corners of all plot hexes, joined along the hex edges (the streets). */
function streetGraph() {
  const nodes: { x: number; z: number }[] = []
  const key = (x: number, z: number) => `${x.toFixed(2)},${z.toFixed(2)}`
  const index = new Map<string, number>()
  const adj: Set<number>[] = []
  const node = (x: number, z: number) => {
    const k = key(x, z)
    let i = index.get(k)
    if (i === undefined) {
      i = nodes.length
      nodes.push({ x, z })
      adj.push(new Set())
      index.set(k, i)
    }
    return i
  }
  for (const p of PLOTS) {
    const ids: number[] = []
    for (let c = 0; c < 6; c++) {
      const a = (Math.PI / 180) * (-30 + 60 * c)
      ids.push(node(p.x + Math.cos(a), p.z + Math.sin(a)))
    }
    for (let c = 0; c < 6; c++) {
      adj[ids[c]].add(ids[(c + 1) % 6])
      adj[ids[(c + 1) % 6]].add(ids[c])
    }
  }
  return { nodes, adj: adj.map((s) => [...s]) }
}

export interface Life {
  setCity(d: SceneData, models: (Model | null)[]): void
  update(dt: number, time: number): void
  dispose(): void
}

export function createLife(scene: THREE.Scene, team: Team, _layout: CityLayout): Life {
  const group = new THREE.Group()
  group.name = 'life'
  scene.add(group)
  const mat = cityMaterial({ roughness: 0.75 })
  const MAX = 90
  const bodyGeo = bodyGeometry(), headGeo = headGeometry(), soldierGeo = soldierGeometry(team)
  const bodies = new THREE.InstancedMesh(bodyGeo, mat, MAX)
  const heads = new THREE.InstancedMesh(headGeo, mat, MAX)
  const soldiers = new THREE.InstancedMesh(soldierGeo, mat, 24)
  for (const m of [bodies, heads, soldiers]) {
    m.castShadow = true
    m.receiveShadow = true
    m.frustumCulled = false
    m.count = 0
    group.add(m)
  }
  const graph = streetGraph()
  const people: Person[] = []
  const col = new THREE.Color()

  // Smoke: a pool of soft round billboards that rise, swell, drift and fade.
  const puffGeo = new THREE.PlaneGeometry(1, 1)
  const PUFFS = 220
  const fade = new Float32Array(PUFFS)
  puffGeo.setAttribute('aFade', new THREE.InstancedBufferAttribute(fade, 1))
  const puffMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSun: { value: new THREE.Color('#FFF1DC') }, uShade: { value: new THREE.Color('#B9B6BC') } }]),
    vertexShader: /* glsl */ `
      attribute float aFade;
      varying float vFade;
      varying vec2 vUv;
      varying vec3 vTint;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vFade = aFade;
        vTint = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #endif
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(instanceMatrix[0].xyz);
        mvPosition.xy += position.xy * s;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform vec3 uShade;
      varying float vFade;
      varying vec2 vUv;
      varying vec3 vTint;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 d = vUv - 0.5;
        float r = length(d) * 2.0;
        float a = pow(max(0.0, 1.0 - r * r), 2.2) * vFade;
        if (a < 0.003) discard;
        // lit from the upper left, soft shade below
        float lit = clamp(0.55 + dot(normalize(vec2(-0.6, 0.8)), d) * 1.2, 0.0, 1.0);
        vec3 c = mix(uShade, uSun, lit) * vTint;
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  })
  const puffs = new THREE.InstancedMesh(puffGeo, puffMat, PUFFS)
  puffs.frustumCulled = false
  puffs.renderOrder = 6
  puffs.count = 0
  group.add(puffs)
  let sources: { p: THREE.Vector3; dark: boolean; seed: number }[] = []

  // Birds.
  const birdGeo = birdGeometry()
  const NB = 5
  const phases = new Float32Array(NB)
  for (let i = 0; i < NB; i++) phases[i] = (i * 0.618) % 1
  birdGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1))
  const birdUniform = { value: 0 }
  const inject = (sh: THREE.WebGLProgramParametersWithUniforms) => {
    sh.uniforms.uBirdTime = birdUniform
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uBirdTime;\nattribute float wing;\nattribute float aPhase;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float wingT = uBirdTime * 7.0 + aPhase * 6.2831;
        float glide = smoothstep(-0.2, 0.6, sin(uBirdTime * 0.6 + aPhase * 11.0));
        transformed.y += sin(wingT) * wing * 0.55 * glide + wing * 0.12;`)
  }
  const birdMat = new THREE.MeshStandardMaterial({ color: '#3E4248', roughness: 0.9, side: THREE.DoubleSide })
  birdMat.onBeforeCompile = inject
  birdMat.customProgramCacheKey = () => 'bird'
  const birdDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })
  birdDepth.onBeforeCompile = inject
  const birds = new THREE.InstancedMesh(birdGeo, birdMat, NB)
  birds.customDepthMaterial = birdDepth
  birds.castShadow = true
  birds.frustumCulled = false
  group.add(birds)

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), e = new THREE.Euler()
  const FIG = 1.18

  function localToWorld(plot: number, p: THREE.Vector3): THREE.Vector3 {
    const sp = SPOTS[plot]
    const a = -sp.out
    const x = p.x * Math.cos(a) + p.z * Math.sin(a)
    const z = -p.x * Math.sin(a) + p.z * Math.cos(a)
    return new THREE.Vector3(sp.x + x, p.y + 0.045, sp.z + z)
  }

  function setCity(d: SceneData, models: (Model | null)[]) {
    people.length = 0
    sources = []
    const r = rng(17)
    let seed = 1
    // workers at staffed buildings (and builders at the construction site)
    for (let i = 1; i < models.length; i++) {
      const m = models[i]
      if (!m) continue
      const b = d.interior.plots[i] as BuildingType | null
      const site = d.construction?.plot === i && !b
      const works = m.anchors.filter((a) => a.name === 'work')
      if ((b && d.staffed[i]) || site) {
        const n = site ? Math.min(2, works.length) : b === 'market' ? Math.min(3, works.length) : 1
        for (let j = 0; j < n && j < works.length; j++) {
          const w = localToWorld(i, works[j].p)
          people.push({ act: 'work', x: w.x, z: w.z, y: w.y, yaw: r() * 6.28, seed: seed++, hx: w.x, hz: w.z, range: b === 'farm' ? 0.12 : 0.04, face: Math.atan2(-w.z, -w.x) })
        }
      }
      if (b === 'market') {
        const c = m.anchors.find((a) => a.name === 'crowd')
        if (c) {
          const w = localToWorld(i, c.p)
          for (let j = 0; j < 3 + Math.min(3, d.pop); j++) people.push({ act: 'crowd', x: w.x, z: w.z, y: w.y, yaw: r() * 6.28, seed: seed++, hx: w.x, hz: w.z, range: 0.22 + r() * 0.12 })
        }
      }
      if (b === 'barracks') {
        const c = m.anchors.find((a) => a.name === 'drill')
        if (c) {
          const w = localToWorld(i, c.p)
          const sp = SPOTS[i]
          for (let j = 0; j < 4; j++) {
            const ox = (j % 2) * 0.1 - 0.05, oz = Math.floor(j / 2) * 0.1 - 0.05
            const a = -sp.out
            const x = ox * Math.cos(a) + oz * Math.sin(a), z = -ox * Math.sin(a) + oz * Math.cos(a)
            people.push({ act: 'drill', x: w.x + x, z: w.z + z, y: w.y, yaw: 0, seed: j, hx: w.x + x, hz: w.z + z, face: sp.out + Math.PI / 2, soldier: true })
          }
        }
      }
      for (const g of m.anchors.filter((a) => a.name === 'guard')) {
        const w = localToWorld(i, g.p)
        people.push({ act: 'guard', x: w.x, z: w.z, y: w.y, yaw: SPOTS[i].out, seed: seed++, hx: w.x, hz: w.z, range: 0.05, face: SPOTS[i].out, soldier: true })
      }
      if (site) continue
      for (const c of m.anchors.filter((a) => a.name === 'chimney' || a.name === 'smoke')) {
        const lit = !b || b === 'house' || b === 'barracks' || d.staffed[i]
        if (lit) sources.push({ p: localToWorld(i, c.p), dark: c.name === 'smoke', seed: seed++ })
      }
    }
    // idle citizens on the square, in little groups around the tree
    const idle = Math.min(12, d.idle + 1)
    for (let j = 0; j < idle; j++) {
      const a = (j / Math.max(1, idle)) * Math.PI * 2 + 0.4 + (j % 2) * 0.25
      const rad = 0.42 + (j % 3) * 0.12
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad
      people.push({ act: 'idle', x, z, y: 0.03, yaw: 0, seed: seed++, hx: x, hz: z, face: a + Math.PI + (r() - 0.5) * 1.2 })
    }
    // walkers in the streets
    const walkers = Math.min(20, 5 + Math.round(d.pop * 2))
    for (let j = 0; j < walkers; j++) {
      const from = Math.floor(r() * graph.nodes.length)
      const nb = graph.adj[from]
      const to = nb[Math.floor(r() * nb.length)]
      people.push({ act: 'walk', x: 0, z: 0, y: 0.012, yaw: 0, seed: seed++, from, to, t: r(), speed: 0.13 + r() * 0.08, side: r() < 0.5 ? -1 : 1 })
    }
    // colours
    let nb = 0
    for (const p of people) {
      if (p.soldier) continue
      const c = hash(p.seed, 5) < 0.18 ? team.base : CLOTHES[Math.floor(hash(p.seed, 6) * CLOTHES.length)]
      bodies.setColorAt(nb, col.set(c))
      heads.setColorAt(nb, col.set(SKIN[Math.floor(hash(p.seed, 7) * SKIN.length)]))
      nb++
    }
    bodies.count = heads.count = Math.min(MAX, nb)
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true
    for (let i = 0; i < 24; i++) soldiers.setColorAt(i, col.set('#FFFFFF'))
    puffT = sources.map((src) => hash(src.seed, 3) * 0.8)
  }

  // puff state: each source cycles through its slice of the pool
  let puffT: number[] = []
  const PUFF_LIFE = 4.6
  const PER = 10

  function update(dt: number, time: number) {
    let nb = 0, ns = 0
    for (const p of people) {
      let bob = 0, roll = 0
      if (p.act === 'walk') {
        const a = graph.nodes[p.from!], b = graph.nodes[p.to!]
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
        p.t! += (dt * p.speed!) / len
        if (p.t! >= 1) {
          const nbs = graph.adj[p.to!].filter((n) => n !== p.from)
          p.from = p.to
          p.to = nbs.length ? nbs[Math.floor(hash(p.seed, Math.floor(time * 10)) * nbs.length)] : p.from
          p.t = 0
        }
        const a2 = graph.nodes[p.from!], b2 = graph.nodes[p.to!]
        const dx = b2.x - a2.x, dz = b2.z - a2.z
        const l2 = Math.hypot(dx, dz) || 1
        const off = 0.07 * p.side!
        p.x = a2.x + dx * p.t! + (-dz / l2) * off
        p.z = a2.z + dz * p.t! + (dx / l2) * off
        p.yaw = Math.atan2(dx, dz)
        bob = Math.abs(Math.sin(time * 9 + p.seed)) * 0.008
        roll = Math.sin(time * 9 + p.seed) * 0.06
      } else if (p.act === 'work') {
        const k = Math.sin(time * 0.45 + p.seed)
        const ang = p.face! + Math.PI / 2
        p.x = p.hx! + Math.cos(ang) * k * p.range!
        p.z = p.hz! + Math.sin(ang) * k * p.range!
        const moving = Math.abs(Math.cos(time * 0.45 + p.seed)) > 0.3
        p.yaw = moving ? Math.atan2(Math.cos(ang) * Math.sign(Math.cos(time * 0.45 + p.seed)), Math.sin(ang) * Math.sign(Math.cos(time * 0.45 + p.seed))) : Math.atan2(Math.cos(p.face!), Math.sin(p.face!))
        bob = Math.max(0, Math.sin(time * 4 + p.seed)) * 0.006
        roll = Math.sin(time * 2 + p.seed) * 0.08
      } else if (p.act === 'idle') {
        p.yaw = Math.atan2(Math.cos(p.face!), Math.sin(p.face!)) + Math.sin(time * 0.3 + p.seed) * 0.4
        bob = Math.max(0, Math.sin(time * 1.6 + p.seed * 2)) * 0.004
        roll = Math.sin(time * 0.8 + p.seed) * 0.05
      } else if (p.act === 'crowd') {
        const a = time * 0.06 * (p.seed % 2 ? 1 : -1) + p.seed * 1.7
        const rr = p.range! * (0.75 + 0.25 * Math.sin(time * 0.2 + p.seed))
        const nx = p.hx! + Math.cos(a) * rr, nz = p.hz! + Math.sin(a) * rr
        const dx = nx - p.x, dz = nz - p.z
        p.x = nx
        p.z = nz
        if (Math.hypot(dx, dz) > 1e-5) p.yaw = Math.atan2(dx, dz)
        bob = Math.abs(Math.sin(time * 6 + p.seed)) * 0.005
      } else if (p.act === 'drill') {
        // march out and back together, turning about at each end
        const ph = (time * 0.12) % 2
        const k = ph < 1 ? ph : 2 - ph
        const ang = p.face!
        p.x = p.hx! + Math.cos(ang) * (k - 0.5) * 0.36
        p.z = p.hz! + Math.sin(ang) * (k - 0.5) * 0.36
        const dir = ph < 1 ? 1 : -1
        p.yaw = Math.atan2(Math.cos(ang) * dir, Math.sin(ang) * dir)
        bob = Math.abs(Math.sin(time * 7)) * 0.007
      } else if (p.act === 'guard') {
        const k = Math.sin(time * 0.25 + p.seed)
        const ang = p.face! + Math.PI / 2
        p.x = p.hx! + Math.cos(ang) * k * p.range!
        p.z = p.hz! + Math.sin(ang) * k * p.range!
        p.yaw = Math.atan2(Math.cos(p.face!), Math.sin(p.face!))
      }
      e.set(0, p.yaw, roll * 0.3, 'YXZ')
      q.setFromEuler(e)
      m4.compose(v.set(p.x, p.y + bob, p.z), q, s.setScalar(FIG))
      if (p.soldier) { if (ns < 24) soldiers.setMatrixAt(ns++, m4) }
      else if (nb < MAX) { bodies.setMatrixAt(nb, m4); heads.setMatrixAt(nb, m4); nb++ }
    }
    soldiers.count = ns
    bodies.instanceMatrix.needsUpdate = true
    heads.instanceMatrix.needsUpdate = true
    soldiers.instanceMatrix.needsUpdate = true

    // smoke
    let np = 0
    for (let si = 0; si < sources.length; si++) {
      const src = sources[si]
      puffT[si] += dt
      for (let j = 0; j < PER; j++) {
        if (np >= PUFFS) break
        const age = (puffT[si] + (j * PUFF_LIFE) / PER) % PUFF_LIFE
        const t = age / PUFF_LIFE
        const rise = t * (src.dark ? 0.85 : 0.7)
        const drift = t * t * 0.55
        const size = (src.dark ? 0.09 : 0.075) + t * (src.dark ? 0.26 : 0.22)
        v.set(src.p.x + drift + Math.sin(time * 0.7 + j + src.seed) * 0.025 * t, src.p.y + rise, src.p.z - drift * 0.35)
        m4.compose(v, q.identity(), s.setScalar(size))
        puffs.setMatrixAt(np, m4)
        puffs.setColorAt(np, col.setScalar(src.dark ? 0.6 : 1))
        fade[np] = Math.min(1, t * 5) * (1 - t) ** 1.4 * (src.dark ? 0.46 : 0.36)
        np++
      }
    }
    s.set(1, 1, 1)
    puffs.count = np
    puffs.instanceMatrix.needsUpdate = true
    if (puffs.instanceColor) puffs.instanceColor.needsUpdate = true
    ;(puffGeo.attributes.aFade as THREE.InstancedBufferAttribute).needsUpdate = true

    // birds wheel slowly over the town
    birdUniform.value = time
    for (let i = 0; i < NB; i++) {
      const flock = i < 3
      const sp = (flock ? 0.06 : 0.045 + i * 0.01) * (i % 2 === 0 || flock ? 1 : -1)
      const a = time * sp + (flock ? 0 : i * 1.9) - (flock ? i * 0.05 : 0)
      const rx = flock ? 6.5 : 4 + i, rz = flock ? 5 : 3.5 + i * 0.6
      const ox = flock ? (i - 1) * 0.35 : 0
      v.set(Math.cos(a) * rx + ox, 3.2 + i * 0.25 + Math.sin(time * 0.5 + i) * 0.15, Math.sin(a) * rz + Math.abs(ox) * 0.6)
      const tx = -Math.sin(a) * rx * Math.sign(sp), tz = Math.cos(a) * rz * Math.sign(sp)
      e.set(0, Math.atan2(tx, tz), 0.28 * Math.sign(sp), 'YXZ')
      q.setFromEuler(e)
      m4.compose(v, q, s.setScalar(0.26))
      birds.setMatrixAt(i, m4)
    }
    s.set(1, 1, 1)
    birds.instanceMatrix.needsUpdate = true
  }

  return {
    setCity,
    update,
    dispose() {
      scene.remove(group)
      bodyGeo.dispose(); headGeo.dispose(); soldierGeo.dispose(); puffGeo.dispose(); birdGeo.dispose()
      mat.dispose(); puffMat.dispose(); birdMat.dispose(); birdDepth.dispose()
      bodies.dispose(); heads.dispose(); soldiers.dispose(); puffs.dispose(); birds.dispose()
    },
  }
}
