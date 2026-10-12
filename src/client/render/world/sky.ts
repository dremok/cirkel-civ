// Backdrop and image-based light. The board floats high above a soft sea of clouds in a peach and
// lilac haze; the environment map (lilac sky above, bright cloud bounce below) gives the cool,
// lifted fill and the sea its reflections.

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

/** Backdrop colours. `haze` tints the distance fog and the mist. */
export const BACKDROP = {
  top: '#C9CDEB', // periwinkle-lilac
  mid: '#F8D9C3', // apricot blush
  bottom: '#F3C9B6', // rose peach
  cloudLit: '#FFF3E3',
  cloudShade: '#D9C3D8',
  haze: '#F1DED6',
}

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
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec2 uRes;
uniform vec3 uCam;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec4 uBoard; // minX, minZ, maxX, maxZ
uniform float uBoardY;
varying vec3 vDir;

float bHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float bNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bHash(i), bHash(i + vec2(1, 0)), u.x), mix(bHash(i + vec2(0, 1)), bHash(i + vec2(1, 1)), u.x), u.y);
}
float bFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * bNoise(p); p = p * 2.02 + vec2(3.1, 1.7); a *= 0.5; }
  return s;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = uv.y > 0.55 ? mix(uMid, uTop, smoothstep(0.55, 1.0, uv.y)) : mix(uBottom, uMid, smoothstep(0.0, 0.55, uv.y));
  vec3 d = normalize(vDir);
  // A soft sea of clouds far below the floating board.
  float yc = uBoardY - 11.0;
  if (d.y < -0.02) {
    float t = (yc - uCam.y) / d.y;
    vec3 p = uCam + d * t;
    vec2 q = p.xz * 0.045 + vec2(uTime * 0.0035, uTime * 0.0012);
    float n = bFbm(q);
    float n2 = bFbm(q * 2.3 + vec2(n * 1.5, 4.0));
    float h = n * 0.72 + n2 * 0.28;
    float dens = smoothstep(0.32, 0.5, h);
    // Billows lit from the sun's side: compare the height field a step toward the sun.
    vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.06;
    float hs = bFbm(q + toSun) * 0.72 + n2 * 0.28;
    float lit = clamp(0.68 + (hs - h) * 8.0 + (h - 0.45) * 1.2, 0.0, 1.0);
    vec3 cloud = mix(uCloudShade, uCloudLit, lit);
    // The board's own soft shadow on the clouds.
    vec3 sp = p + uSunDir * ((uBoardY - p.y) / max(uSunDir.y, 0.05));
    vec2 inside = min(sp.xz - uBoard.xy, uBoard.zw - sp.xz);
    float sh = smoothstep(-4.0, 3.0, min(inside.x, inside.y));
    cloud *= 1.0 - 0.18 * sh;
    // Far clouds dissolve into the haze.
    float far = smoothstep(90.0, 260.0, t);
    c = mix(c, cloud, dens * (1.0 - far) * 0.85);
    c *= 1.0 - 0.08 * sh * (1.0 - far);
  }
  // A gentle fall-off to the corners.
  vec2 r2 = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  c *= 1.0 - 0.08 * smoothstep(0.45, 1.2, length(r2));
  // Fine dither so the gradient never bands.
  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export interface BackdropBoard { minX: number; minZ: number; maxX: number; maxZ: number; y: number }

/** The visible backdrop: a soft gradient over a sea of clouds far below, drawn first. */
export function buildSky(board: BackdropBoard, sunDir: THREE.Vector3) {
  const geo = new THREE.SphereGeometry(1, 16, 8)
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: BACKDROP_FRAG,
    uniforms: {
      uTop: { value: new THREE.Color(BACKDROP.top) },
      uMid: { value: new THREE.Color(BACKDROP.mid) },
      uBottom: { value: new THREE.Color(BACKDROP.bottom) },
      uCloudLit: { value: new THREE.Color(BACKDROP.cloudLit) },
      uCloudShade: { value: new THREE.Color(BACKDROP.cloudShade) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uSunDir: { value: sunDir },
      uBoard: { value: new THREE.Vector4(board.minX, board.minZ, board.maxX, board.maxZ) },
      uBoardY: { value: board.y },
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
    update(camera: THREE.Camera, time: number) {
      mesh.position.copy(camera.position)
      mat.uniforms.uCam.value.copy(camera.position)
      mat.uniforms.uTime.value = time
    },
    dispose() { geo.dispose(); mat.dispose() },
  }
}

/** Prefiltered environment: blue sky above, warm haze at the horizon, ground bounce below. */
export function buildEnvironment(renderer: THREE.WebGLRenderer, sunDir: THREE.Vector3): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene()
  const geo = new THREE.SphereGeometry(1, 48, 24)
  const mat = makeSkyMaterial({ zenith: NATURE.skyFill, horizon: '#F3D9C6', low: NATURE.groundBounce, deep: '#B9B0CF' }, sunDir, 0.6)
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
