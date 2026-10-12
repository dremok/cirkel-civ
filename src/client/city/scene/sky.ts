// Backdrop and image-based light for the city, matching the world's warm gradient and sky fill.

import * as THREE from 'three'
import { NATURE } from '../../render/palette.ts'
import { BACKDROP as WORLD_BACKDROP } from '../../render/world/sky.ts'

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`

const ENV_FRAG = /* glsl */ `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uLow; uniform vec3 uDeep; uniform vec3 uSunDir; uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  vec3 c;
  if (e > 0.0) c = mix(uHorizon, uZenith, pow(smoothstep(0.0, 1.0, e), 0.6));
  else c = mix(mix(uHorizon, uLow, smoothstep(0.0, 0.45, -e)), uDeep, smoothstep(0.35, 1.0, -e));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(s, 6.0) * 0.18 + pow(s, 64.0) * 0.35) * 0.6;
  gl_FragColor = vec4(c, 1.0);
}`

/** Backdrop gradient, top to bottom of the screen: the world's own, so the two views belong together. */
export const BACKDROP = { top: WORLD_BACKDROP.top, mid: WORLD_BACKDROP.mid, bottom: WORLD_BACKDROP.bottom, haze: WORLD_BACKDROP.haze }

const BACKDROP_FRAG = /* glsl */ `
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; uniform vec2 uRes;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = uv.y > 0.55 ? mix(uMid, uTop, smoothstep(0.55, 1.0, uv.y)) : mix(uBottom, uMid, smoothstep(0.0, 0.55, uv.y));
  vec2 q = (uv - vec2(0.5, 0.48)) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(q);
  c *= 1.0 + 0.05 * (1.0 - smoothstep(0.0, 0.7, r)) - 0.07 * smoothstep(0.55, 1.25, r);
  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export function buildBackdrop() {
  const geo = new THREE.SphereGeometry(1, 16, 8)
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: BACKDROP_FRAG,
    uniforms: {
      uTop: { value: new THREE.Color(BACKDROP.top) },
      uMid: { value: new THREE.Color(BACKDROP.mid) },
      uBottom: { value: new THREE.Color(BACKDROP.bottom) },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    side: THREE.BackSide, depthWrite: false, depthTest: false, toneMapped: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.scale.setScalar(400)
  mesh.frustumCulled = false
  mesh.renderOrder = -10
  return {
    mesh,
    setSize(w: number, h: number) { mat.uniforms.uRes.value.set(w, h) },
    dispose() { geo.dispose(); mat.dispose() },
  }
}

export function buildEnvironment(renderer: THREE.WebGLRenderer, sunDir: THREE.Vector3): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene()
  const geo = new THREE.SphereGeometry(1, 48, 24)
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: ENV_FRAG,
    uniforms: {
      uZenith: { value: new THREE.Color(NATURE.skyFill) },
      uHorizon: { value: new THREE.Color('#F3D9C6') },
      uLow: { value: new THREE.Color(NATURE.groundBounce) },
      uDeep: { value: new THREE.Color('#B9B0CF') },
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: new THREE.Color(NATURE.sun) },
    },
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.scale.setScalar(10)
  scene.add(mesh)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(scene, 0, 0.1, 100)
  pmrem.dispose()
  geo.dispose()
  mat.dispose()
  return rt
}

const VIGNETTE_FRAG = /* glsl */ `
uniform vec2 uRes;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 q = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float v = 1.0 - 0.18 * smoothstep(0.35, 1.05, length(q));
  // warm in the falloff, so the corners go dusky rather than grey
  gl_FragColor = vec4(v, v * 0.985 + 0.012, v * 0.97 + 0.02, 1.0);
}`

/** A full-screen multiply drawn last, on every tier (as the world's). */
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
  return {
    mesh,
    setSize(w: number, h: number) { mat.uniforms.uRes.value.set(w, h) },
    dispose() { geo.dispose(); mat.dispose() },
  }
}

const MOTE_VERT = /* glsl */ `
uniform float uTime;
uniform float uPx;
attribute vec4 aSeed;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = uTime * (0.05 + aSeed.x * 0.05) + aSeed.y * 6.2831;
  p.x += sin(t * 1.3 + aSeed.z * 4.0) * 0.6 + sin(uTime * 0.02) * 0.4;
  p.z += cos(t * 1.1 + aSeed.w * 5.0) * 0.6;
  p.y += sin(t * 0.7 + aSeed.x * 3.0) * 0.25;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  gl_PointSize = clamp(uPx * (0.5 + aSeed.w * 0.7) / depth, 1.0, 7.0);
  float twinkle = 0.5 + 0.5 * sin(uTime * (0.8 + aSeed.z) + aSeed.y * 20.0);
  vAlpha = twinkle * smoothstep(2.0, 6.0, depth);
}`

const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, r);
  gl_FragColor = vec4(uColor * a * vAlpha, 1.0);
}`

/** Pollen and dust motes drifting in the sunlit air over the town. */
export function buildMotes(count: number, time: { value: number }) {
  const pos = new Float32Array(count * 3)
  const seed = new Float32Array(count * 4)
  let s = 4711
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 6.5
    pos[i * 3] = Math.cos(a) * d
    pos[i * 3 + 1] = 0.25 + rnd() * 2.2
    pos[i * 3 + 2] = Math.sin(a) * d
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd()
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
  const mat = new THREE.ShaderMaterial({
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    uniforms: { uTime: time, uPx: { value: 60 }, uColor: { value: new THREE.Color(NATURE.sun).multiplyScalar(0.6) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.renderOrder = 7
  return {
    points,
    setSize(h: number) { mat.uniforms.uPx.value = h * 0.05 },
    dispose() { geo.dispose(); mat.dispose() },
  }
}
