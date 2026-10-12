// The city's materials: three.js standard materials patched with drifting cloud shadows, warm
// window glow, a gentle flutter for flags, awnings and leaves, and crisp procedural surface
// patterns (cobbles, flagstones, roof courses, masonry, boards) that fade out before they alias.
// The uniforms are the city's own, so the world renderer behind it is never disturbed.

import * as THREE from 'three'

export const U = {
  uTime: { value: 0 },
  uCloudOffset: { value: new THREE.Vector2() },
  uCloudStrength: { value: 0.3 },
  uGlow: { value: 1 },
  uGlowColor: { value: new THREE.Color('#FFB35C').multiplyScalar(2.3) },
  uWind: { value: 1 },
}

const NOISE = /* glsl */ `
float cHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 cHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float cNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash12(i), cHash12(i + vec2(1.0, 0.0)), u.x), mix(cHash12(i + vec2(0.0, 1.0)), cHash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`

const PATTERNS = /* glsl */ `
// Returns a brightness multiplier for the surface pattern at world point p with world normal n.
float cPattern(int pat, vec3 p, vec3 n) {
  if (pat == 0) return 1.0;
  float fwXZ = length(fwidth(p.xz));
  float fwY = length(fwidth(p));
  if (pat == 1) {
    // Cobbles: Voronoi cells with darker joints.
    vec2 q = p.xz * 24.0;
    vec2 ip = floor(q), fp = fract(q);
    float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = cHash22(ip + g) * 0.75 + 0.125;
      vec2 r = g + o - fp;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = ip + g; } else if (d < d2) d2 = d;
    }
    float e = sqrt(d2) - sqrt(d1);
    float fw = fwXZ * 24.0;
    float fade = 1.0 - smoothstep(0.35, 0.9, fw);
    float joint = 1.0 - smoothstep(0.05, 0.12 + fw, e);
    float tone = 0.93 + cHash12(id) * 0.12;
    // a soft dome per cobble: lighter in the middle
    tone *= 0.97 + 0.05 * smoothstep(0.0, 0.5, e);
    return mix(1.0, mix(tone, 0.8, joint), fade);
  }
  if (pat == 2) {
    // Flagstones in rings around the square (world origin).
    float r = length(p.xz);
    float a = atan(p.z, p.x);
    float rw = 0.15;
    float ring = r / rw;
    float ri = floor(ring);
    float circ = max(0.3, (ri + 0.5) * rw);
    float sw = 0.2;
    float seg = a * circ / sw + cHash12(vec2(ri, 3.0)) * 7.0;
    float si = floor(seg);
    float jr = min(fract(ring), 1.0 - fract(ring)) * rw;
    float js = min(fract(seg), 1.0 - fract(seg)) * sw;
    float j = min(jr, js);
    float fade = 1.0 - smoothstep(0.012, 0.03, fwXZ);
    float joint = 1.0 - smoothstep(0.004, 0.009 + fwXZ, j);
    float tone = 0.92 + cHash12(vec2(ri, si)) * 0.13;
    if (r < 0.05) return 1.0;
    return mix(1.0, mix(tone, 0.74, joint), fade);
  }
  vec2 hn = n.xz;
  float hl = length(hn);
  vec2 tng = hl > 0.05 ? vec2(-hn.y, hn.x) / hl : vec2(1.0, 0.0);
  float along = dot(p.xz, tng);
  if (pat == 3) {
    // Roof tile courses: rows by height, staggered joints along the slope.
    float rowH = 0.032;
    float row = p.y / rowH;
    float ri = floor(row);
    float t = (along / 0.042) + (mod(ri, 2.0) * 0.5);
    float ti = floor(t);
    float fr = fract(row);
    float fade = 1.0 - smoothstep(0.006, 0.016, fwY);
    float lip = smoothstep(0.0, 0.2, fr) * (1.0 - 0.18 * smoothstep(0.55, 1.0, fr));
    float side = min(fract(t), 1.0 - fract(t)) * 0.042;
    float jv = 1.0 - smoothstep(0.002, 0.004 + fwY, side);
    float tone = (0.93 + cHash12(vec2(ri, ti)) * 0.12) * mix(0.8, 1.0, lip);
    return mix(1.0, tone * (1.0 - jv * 0.12), fade);
  }
  if (pat == 4) {
    // Masonry: courses of stones with mortar joints.
    float rowH = 0.05;
    float row = p.y / rowH;
    float ri = floor(row);
    float sl = 0.085 + cHash12(vec2(ri, 1.0)) * 0.03;
    float t = along / sl + cHash12(vec2(ri, 7.0)) * 3.0;
    float ti = floor(t);
    float jr = min(fract(row), 1.0 - fract(row)) * rowH;
    float jt = min(fract(t), 1.0 - fract(t)) * sl;
    float j = min(jr, jt);
    float fade = 1.0 - smoothstep(0.006, 0.016, fwY);
    float joint = 1.0 - smoothstep(0.003, 0.006 + fwY, j);
    float tone = 0.9 + cHash12(vec2(ri, ti)) * 0.16;
    return mix(1.0, mix(tone, 0.8, joint), fade);
  }
  if (pat == 5) {
    // Vertical boards.
    float bw = 0.04;
    float t = along / bw;
    float ti = floor(t);
    float j = min(fract(t), 1.0 - fract(t)) * bw;
    float fade = 1.0 - smoothstep(0.005, 0.014, fwY);
    float joint = 1.0 - smoothstep(0.002, 0.004 + fwY, j);
    float tone = 0.93 + cHash12(vec2(ti, 5.0)) * 0.12;
    return mix(1.0, mix(tone, 0.72, joint), fade);
  }
  if (pat == 6) {
    // Grass: broad warm and cool patches, very low contrast.
    float b = cNoise(p.xz * 0.9 + 7.0) * 0.6 + cNoise(p.xz * 2.6 + 3.7) * 0.4;
    float m = cNoise(p.xz * 9.0 + 1.3);
    float fine = (1.0 - smoothstep(0.01, 0.03, fwXZ));
    return 0.95 + b * 0.09 + (m - 0.5) * 0.06 * fine;
  }
  if (pat == 9) {
    // Square pavers in staggered rows.
    float sz = 0.085;
    float row = p.z / sz;
    float ri = floor(row);
    float t = p.x / sz + mod(ri, 2.0) * 0.5;
    float ti = floor(t);
    float j = min(min(fract(row), 1.0 - fract(row)), min(fract(t), 1.0 - fract(t))) * sz;
    float fade = 1.0 - smoothstep(0.01, 0.025, fwXZ);
    float joint = 1.0 - smoothstep(0.003, 0.006 + fwXZ, j);
    float tone = 0.93 + cHash12(vec2(ri, ti)) * 0.12;
    return mix(1.0, mix(tone, 0.78, joint), fade);
  }
  if (pat == 7) {
    float b = cNoise(p.xz * 1.4 + 2.0);
    return 0.97 + b * 0.06;
  }
  if (pat == 8) {
    float b = cNoise(vec2(along, p.y) * 7.0 + 4.0);
    return 0.975 + b * 0.05;
  }
  return 1.0;
}
`

const CLOUDS = /* glsl */ `
uniform vec2 uCloudOffset;
uniform float uCloudStrength;
float cCloud(vec2 xz) {
  vec2 p = xz * 0.05 + uCloudOffset;
  float n = cNoise(p) * 0.62 + cNoise(p * 2.13 + vec2(5.2, 1.3)) * 0.28 + cNoise(p * 4.7 + vec2(1.7, 9.2)) * 0.1;
  return 1.0 - uCloudStrength * smoothstep(0.52, 0.76, n);
}
`

const LIGHTS_WITH_CLOUDS = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= cCloudK;',
)

export interface CityMatOptions {
  transparent?: boolean
  opacity?: number
  roughness?: number
  /** Disable the flutter displacement (e.g. for static ghost previews). */
  still?: boolean
  side?: THREE.Side
  clipping?: THREE.Plane[]
  /** Extra shader code (water). */
  extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void
  key?: string
}

/** A vertex-coloured standard material with the city's shader patches. */
export function cityMaterial(o: CityMatOptions = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: o.roughness ?? 0.84,
    metalness: 0,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
  })
  if (o.clipping) {
    m.clippingPlanes = o.clipping
    m.clipShadows = true
  }
  m.customProgramCacheKey = () => `city${o.still ? 's' : ''}${o.key ?? ''}`
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 aux;\nuniform float uTime;\nuniform float uWind;\nvarying vec3 vAux;\nvarying vec3 vWorldP;\nvarying vec3 vWorldN;`)
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vAux = aux;
        ${o.still ? '' : /* glsl */ `
        if (aux.y > 0.0) {
          vec4 wq = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wq = instanceMatrix * wq;
          #endif
          wq = modelMatrix * wq;
          float ph = dot(wq.xz, vec2(1.9, 1.3));
          float gust = 0.7 + 0.3 * sin(uTime * 0.41 + wq.x * 0.13);
          float s = sin(uTime * 2.2 + ph) * 0.65 + sin(uTime * 3.9 + ph * 1.7) * 0.35;
          float u = cos(uTime * 2.9 + ph * 1.3);
          transformed += vec3(s, u * 0.35, s * 0.5 + u * 0.2) * (aux.y * gust * uWind);
        }`}`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          vec3 wn = objectNormal;
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
            wn = mat3(instanceMatrix) * wn;
          #endif
          vWorldP = (modelMatrix * wp).xyz;
          vWorldN = normalize(mat3(modelMatrix) * wn);
        }`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uGlow;\nuniform vec3 uGlowColor;\nvarying vec3 vAux;\nvarying vec3 vWorldP;\nvarying vec3 vWorldN;\n${NOISE}\n${CLOUDS}\n${PATTERNS}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\ndiffuseColor.rgb *= cPattern(int(vAux.z + 0.5), vWorldP, normalize(vWorldN));`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          float fl = 0.9 + 0.1 * sin(uTime * 3.1 + vWorldP.x * 7.0) * sin(uTime * 4.7 + vWorldP.z * 5.0);
          totalEmissiveRadiance += uGlowColor * vAux.x * uGlow * fl;
        }`,
      )
      .replace('#include <lights_fragment_begin>', `float cCloudK = cCloud(vWorldP.xz);\n${LIGHTS_WITH_CLOUDS}`)
    o.extra?.(shader)
  }
  return m
}

/** Depth material for shadows that keeps the flutter (trees, flags) in step with the surface. */
export function cityDepthMaterial(): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  m.customProgramCacheKey = () => 'cityDepth'
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime
    shader.uniforms.uWind = U.uWind
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aux;\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        if (aux.y > 0.0) {
          vec4 wq = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wq = instanceMatrix * wq;
          #endif
          wq = modelMatrix * wq;
          float ph = dot(wq.xz, vec2(1.9, 1.3));
          float gust = 0.7 + 0.3 * sin(uTime * 0.41 + wq.x * 0.13);
          float s = sin(uTime * 2.2 + ph) * 0.65 + sin(uTime * 3.9 + ph * 1.7) * 0.35;
          float u = cos(uTime * 2.9 + ph * 1.3);
          transformed += vec3(s, u * 0.35, s * 0.5 + u * 0.2) * (aux.y * gust * uWind);
        }`,
      )
  }
  return m
}
