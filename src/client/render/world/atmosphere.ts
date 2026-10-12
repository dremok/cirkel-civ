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
