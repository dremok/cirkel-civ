// Atmosphere: pollen and dust motes drifting in the sunlit air above the board, and a gentle
// vignette that draws the eye to the middle of the frame.

import * as THREE from 'three'
import { NATURE } from '../palette.ts'
import type { Layout } from './layout.ts'
import { shared } from './shading.ts'

const MOTE_VERT = /* glsl */ `
uniform float uTime;
uniform float uPx;
attribute vec4 aSeed;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = uTime * (0.05 + aSeed.x * 0.05) + aSeed.y * 6.2831;
  // Slow wandering drift, a lazy rise and fall.
  p.x += sin(t * 1.3 + aSeed.z * 4.0) * 0.9 + uTime * 0.03;
  p.z += cos(t * 1.1 + aSeed.w * 5.0) * 0.9;
  p.y += sin(t * 0.7 + aSeed.x * 3.0) * 0.35;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  gl_PointSize = clamp(uPx * (0.6 + aSeed.w * 0.8) / depth, 1.0, 9.0);
  float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed.z) + aSeed.y * 20.0);
  // Fade very close to the camera so motes never become blobs.
  vAlpha = twinkle * smoothstep(3.0, 9.0, depth);
}`

const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  float a = smoothstep(0.5, 0.0, r);
  gl_FragColor = vec4(uColor * a * vAlpha, 1.0);
}`

export function buildMotes(layout: Layout, count: number) {
  const pos = new Float32Array(count * 3)
  const seed = new Float32Array(count * 4)
  let s = 12345
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < count; i++) {
    pos[i * 3] = layout.minX + rnd() * (layout.maxX - layout.minX)
    pos[i * 3 + 1] = 0.4 + rnd() * 2.6
    pos[i * 3 + 2] = layout.minZ + rnd() * (layout.maxZ - layout.minZ)
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd()
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
  const mat = new THREE.ShaderMaterial({
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    uniforms: {
      uTime: shared.uTime,
      uPx: { value: 60 },
      uColor: { value: new THREE.Color(NATURE.sun).multiplyScalar(0.55) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.renderOrder = 5
  points.name = 'motes'
  return {
    points,
    /** Point size scales with the drawing buffer height. */
    setSize(h: number) { mat.uniforms.uPx.value = h * 0.05 },
    dispose() { geo.dispose(); mat.dispose() },
  }
}

const VIGNETTE_FRAG = /* glsl */ `
uniform vec2 uRes;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 q = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float v = 1.0 - 0.16 * smoothstep(0.35, 1.05, length(q));
  // Slightly warm in the falloff so the corners go dusky rather than grey.
  gl_FragColor = vec4(v, v * 0.985 + 0.012, v * 0.97 + 0.02, 1.0);
}`

/** A full-screen multiply pass drawn last. Cheap enough for every tier. */
export function buildVignette() {
  const geo = new THREE.PlaneGeometry(2, 2)
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: VIGNETTE_FRAG,
    uniforms: { uRes: { value: new THREE.Vector2(1, 1) } },
    blending: THREE.MultiplyBlending,
    premultipliedAlpha: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 1000
  mesh.name = 'vignette'
  return {
    mesh,
    setSize(w: number, h: number) { mat.uniforms.uRes.value.set(w, h) },
    dispose() { geo.dispose(); mat.dispose() },
  }
}

const PUFF_VERT = /* glsl */ `
uniform float uTime;
attribute vec4 aPuff; // centre offset x, y, z and size
attribute float aShade;
varying vec2 vUv;
varying float vShade;
varying float vFade;
void main() {
  vUv = uv;
  vShade = aShade;
  vec3 c = aPuff.xyz + vec3(sin(uTime * 0.03 + aPuff.x) * 0.6, 0.0, cos(uTime * 0.025 + aPuff.z) * 0.4);
  vec4 mv = viewMatrix * vec4(c, 1.0);
  // Camera-facing quad.
  mv.xy += position.xy * aPuff.w;
  gl_Position = projectionMatrix * mv;
  vFade = smoothstep(4.0, 12.0, -mv.z);
}`

const PUFF_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLit;
uniform vec3 uShade;
varying vec2 vUv;
varying float vShade;
varying float vFade;
void main() {
  float a = texture2D(uMap, vUv).r;
  // Lit cream on top, rose-lilac underneath.
  vec3 c = mix(uShade, uLit, clamp(vUv.y * 1.1 - 0.05 + vShade, 0.0, 1.0));
  gl_FragColor = vec4(c, a * 0.92 * vFade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

/** A soft, lumpy round puff (painterly edges), for the cloud billboards. */
function puffTexture(): THREE.DataTexture {
  const n = 128
  const data = new Uint8Array(n * n * 4)
  let s = 7
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const blobs = Array.from({ length: 9 }, () => ({ x: 0.3 + rnd() * 0.4, y: 0.3 + rnd() * 0.35, r: 0.16 + rnd() * 0.14 }))
  blobs.push({ x: 0.5, y: 0.45, r: 0.3 })
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n, y = (j + 0.5) / n
    let v = 0
    for (const b of blobs) {
      const d = Math.hypot(x - b.x, (y - b.y) * 1.25) / b.r
      v = Math.max(v, 1 - THREE.MathUtils.smoothstep(d, 0.6, 1.0))
    }
    // Flatter base, as clouds have.
    v *= THREE.MathUtils.smoothstep(y, 0.12, 0.3)
    const a = Math.round(255 * v)
    data.set([a, a, a, 255], (j * n + i) * 4)
  }
  const t = new THREE.DataTexture(data, n, n)
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

/** A few soft cloud puffs drifting around and below the floating board. One draw call. */
export function buildPuffs(layout: Layout, bottomY: number) {
  const base = new THREE.PlaneGeometry(1, 0.62)
  base.translate(0, 0.31, 0)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = base.index
  geo.setAttribute('position', base.attributes.position)
  geo.setAttribute('uv', base.attributes.uv)
  const cx = (layout.minX + layout.maxX) / 2, cz = (layout.minZ + layout.maxZ) / 2
  const hx = (layout.maxX - layout.minX) / 2, hz = (layout.maxZ - layout.minZ) / 2
  const puffs: number[] = [], shades: number[] = []
  let s = 99
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  // Clouds gather in a few banks around the rim, below the board's underside.
  const banks = [[-1.05, 0.55], [1.08, -0.35], [0.35, 1.12], [-0.55, -1.1], [1.0, 0.9]]
  for (const [bx, bz] of banks) {
    const n = 5 + Math.floor(rnd() * 3)
    for (let i = 0; i < n; i++) {
      puffs.push(
        cx + bx * hx + (rnd() - 0.5) * 6,
        bottomY - 2.2 - rnd() * 2.6 + (i === 0 ? 0.8 : 0),
        cz + bz * hz + (rnd() - 0.5) * 4,
        4 + rnd() * 5,
      )
      shades.push((rnd() - 0.5) * 0.3)
    }
  }
  geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(puffs), 4))
  geo.setAttribute('aShade', new THREE.InstancedBufferAttribute(new Float32Array(shades), 1))
  geo.instanceCount = shades.length
  const map = puffTexture()
  const mat = new THREE.ShaderMaterial({
    vertexShader: PUFF_VERT,
    fragmentShader: PUFF_FRAG,
    uniforms: {
      uTime: shared.uTime,
      uMap: { value: map },
      uLit: { value: new THREE.Color('#FFF2E2') },
      uShade: { value: new THREE.Color('#D6BFD6') },
    },
    transparent: true,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = -5
  mesh.name = 'puffs'
  return { mesh, dispose() { base.dispose(); geo.dispose(); mat.dispose(); map.dispose() } }
}
