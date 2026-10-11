// Backdrop and image-based light. The board floats in a soft, warm gradient; the environment map
// (sky above, warm ground bounce below) gives the cool fill and the sea its reflections.

import * as THREE from 'three'
import { NATURE } from '../palette.ts'

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uLow;
uniform vec3 uDeep;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunGlow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  vec3 c;
  if (e > 0.0) c = mix(uHorizon, uZenith, pow(smoothstep(0.0, 1.0, e), 0.6));
  else c = mix(mix(uHorizon, uLow, smoothstep(0.0, 0.45, -e)), uDeep, smoothstep(0.35, 1.0, -e));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(s, 6.0) * 0.18 + pow(s, 64.0) * 0.35) * uSunGlow;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export interface SkyColors {
  zenith: string
  horizon: string
  low: string
  deep: string
}

/** Backdrop gradient, top to bottom of the screen. `haze` tints the fog toward it. */
export const BACKDROP = { top: '#E9EEEA', mid: '#F4E9D9', bottom: '#E8D2BB', haze: '#EFE3D2' }

export function makeSkyMaterial(colors: SkyColors, sunDir: THREE.Vector3, sunGlow: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uZenith: { value: new THREE.Color(colors.zenith) },
      uHorizon: { value: new THREE.Color(colors.horizon) },
      uLow: { value: new THREE.Color(colors.low) },
      uDeep: { value: new THREE.Color(colors.deep) },
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: new THREE.Color(NATURE.sun) },
      uSunGlow: { value: sunGlow },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  })
}

const BACKDROP_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uBottom;
uniform vec2 uRes;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = uv.y > 0.55 ? mix(uMid, uTop, smoothstep(0.55, 1.0, uv.y)) : mix(uBottom, uMid, smoothstep(0.0, 0.55, uv.y));
  // A soft glow behind the board and a gentle fall-off to the corners.
  vec2 q = (uv - vec2(0.5, 0.48)) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(q);
  c *= 1.0 + 0.05 * (1.0 - smoothstep(0.0, 0.7, r)) - 0.07 * smoothstep(0.55, 1.25, r);
  // Fine dither so the gradient never bands.
  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

/** The visible backdrop: a soft screen-space gradient, drawn first behind everything. */
export function buildSky() {
  const geo = new THREE.SphereGeometry(1, 16, 8)
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: BACKDROP_FRAG,
    uniforms: {
      uTop: { value: new THREE.Color(BACKDROP.top) },
      uMid: { value: new THREE.Color(BACKDROP.mid) },
      uBottom: { value: new THREE.Color(BACKDROP.bottom) },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.scale.setScalar(400)
  mesh.frustumCulled = false
  mesh.renderOrder = -10
  mesh.name = 'backdrop'
  return {
    mesh,
    material: mat,
    setSize(w: number, h: number) { mat.uniforms.uRes.value.set(w, h) },
    dispose() { geo.dispose(); mat.dispose() },
  }
}

/** Prefiltered environment: blue sky above, warm haze at the horizon, ground bounce below. */
export function buildEnvironment(renderer: THREE.WebGLRenderer, sunDir: THREE.Vector3): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene()
  const geo = new THREE.SphereGeometry(1, 48, 24)
  const mat = makeSkyMaterial({ zenith: NATURE.skyFill, horizon: '#E9DFD0', low: NATURE.groundBounce, deep: '#A8946F' }, sunDir, 0.6)
  mat.toneMapped = false
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
