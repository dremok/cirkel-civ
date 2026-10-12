// Shared shader patches for the world's materials: drifting cloud shadows on the sun light,
// wind sway for vegetation, and a whisper of low-contrast detail on terrain tops.
// All materials stay three.js standard materials (lights, shadows, fog, tone mapping for free).

import * as THREE from 'three'
import { BOTTOM_Y, WATER_Y } from './layout.ts'

export const shared = {
  uTime: { value: 0 },
  /** Strength of the low mist pooling in valleys and over the sea (0 = none). */
  uMist: { value: 0.26 },
  /** Cloud field offset (drifts slowly). */
  uCloudOffset: { value: new THREE.Vector2(0, 0) },
  /** 0 = no cloud shadows, 1 = full. */
  uCloudStrength: { value: 0.45 },
  uWind: { value: 1 },
}

/** Fog of war, per tile: R = explored (0/1, geometry under clouds collapses), G = in sight
 * (animated, lifts the veil), B = explored (animated, parts the clouds). */
export const fogShared = {
  uFogTiles: { value: null as THREE.Texture | null },
  uFogDims: { value: new THREE.Vector2(1, 1) },
  uFogOn: { value: 0 },
}

/** Where unexplored land collapses to, under the clouds, so nothing of its shape survives. */
export const FOG_FLOOR = -0.3

const FOG_FN = /* glsl */ `
uniform highp sampler2D uFogTiles;
uniform vec2 uFogDims;
uniform float uFogOn;
vec4 fogAt(float id) {
  if (uFogOn < 0.5 || id < -0.5) return vec4(1.0);
  int i = int(id + 0.5);
  int w = int(uFogDims.x + 0.5);
  return texelFetch(uFogTiles, ivec2(i - (i / w) * w, i / w), 0);
}
`

/** Vertex code that hides what lies under the clouds. Terrain collapses to the cloud floor and the
 * sides of known columns facing unknown ones run all the way down, so no neighbour's height shows;
 * instanced props shrink to nothing. Driven by the animated explored amount (B), so as the clouds
 * part the land rises out of them and then its trees and flowers grow in. Sets vFog. */
function fogVertex(mode: FogMode): string {
  const FLOOR = FOG_FLOOR.toFixed(3), BOTTOM = BOTTOM_Y.toFixed(3)
  if (mode === 'terrain') {
    return /* glsl */ `
      vFog = fogAt(aTile);
      {
        float eT = smoothstep(0.0, 0.6, vFog.b);
        if (aLow > 0.5) transformed.y = mix(${FLOOR}, mix(${BOTTOM}, transformed.y, fogAt(aNb).b), eT);
        else transformed.y = mix(${FLOOR}, transformed.y, eT);
      }`
  }
  if (mode === 'instanced') return 'vFog = fogAt(aTile);\ntransformed *= smoothstep(0.55, 1.0, vFog.b);'
  // The plain rock skirt that stands in for unexplored columns at the board's edge (it goes once the
  // real column has fully risen).
  if (mode === 'skirt') return 'vFog = vec4(1.0);\nif (fogAt(aTile).b > 0.999 || uFogOn < 0.5) transformed = vec3(0.0);'
  return 'vFog = fogAt(aTile);'
}

type FogMode = 'terrain' | 'instanced' | 'surface' | 'skirt'

function fogVertexDecl(mode: FogMode): string {
  return `${FOG_FN}\nattribute float aTile;\nvarying vec4 vFog;${mode === 'terrain' ? '\nattribute float aNb;\nattribute float aLow;' : ''}`
}

/** The veil over known land out of sight: evening shade on the same land. Most of the hue stays;
 * it shifts toward blue-lavender, dims a little, loses a little contrast, and a faint mist lies low
 * on the columns. Unexplored surfaces (under the clouds) take the clouds' lilac. Works on the
 * display-encoded colour. */
const FOG_VEIL = /* glsl */ `
{
  #ifdef TONE_MAPPING
    vec3 vc = gl_FragColor.rgb;
  #else
    vec3 vc = pow(max(gl_FragColor.rgb, 0.0), vec3(1.0 / 2.2));
  #endif
  if (vFog.r < 0.5) vc = vec3(0.86, 0.8, 0.86);
  else {
    float vv = 1.0 - vFog.g;
    // Twilight: cool blue-lavender light, a touch dimmer...
    vec3 d = vc * mix(vec3(1.0), vec3(0.74, 0.79, 1.0), vv);
    // ...with the colour kept (a little richer even, so it never greys out)...
    float l = dot(d, vec3(0.299, 0.587, 0.114));
    d = mix(vec3(l), d, 1.0 + 0.18 * vv);
    // ...and the darks lifted toward lavender for slightly softer contrast.
    d = d * (1.0 - 0.1 * vv) + vec3(0.045, 0.035, 0.1) * vv;
    // A faint sheen of mist lying low: on the lower sides of the columns, and a breath on low tops.
    float lowM = 1.0 - smoothstep(-0.7, 0.55, vWorldP.y);
    float side = 1.0 - smoothstep(0.55, 0.95, vUp);
    d = mix(d, vec3(0.8, 0.79, 0.93), lowM * (0.22 * side + 0.07) * vv);
    vc = d;
  }
  #ifdef TONE_MAPPING
    gl_FragColor.rgb = vc;
  #else
    gl_FragColor.rgb = pow(vc, vec3(2.2));
  #endif
}
`

export const GLSL_NOISE = /* glsl */ `
float wHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash12(i), wHash12(i + vec2(1.0, 0.0)), u.x),
             mix(wHash12(i + vec2(0.0, 1.0)), wHash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`

/** Fog, plus soft mist that pools low (valleys, the sea) and drifts slowly. */
const FOG_WITH_MIST = /* glsl */ `
#ifdef USE_FOG
  float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  // Only over the sea and low valley floors: never on the board's sides.
  float mistLow = smoothstep( -0.75, -0.3, vWorldP.y ) * ( 1.0 - smoothstep( -0.14, 0.05, vWorldP.y ) ) * smoothstep( 0.5, 0.9, vUp );
  vec2 mq = vWorldP.xz * 0.23 + vec2( uTime * 0.012, uTime * 0.005 );
  float mistN = wNoise( mq ) * 0.65 + wNoise( mq * 2.7 - vec2( uTime * 0.02, 0.0 ) ) * 0.35;
  float mist = mistLow * smoothstep( 0.35, 0.8, mistN ) * uMist;
  float fogMix = max( fogFactor, mist );
  #ifdef TONE_MAPPING
    // Drawing to the screen: the colour is already display-encoded here.
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogMix );
  #else
    // Drawing linear light into the post chain: mix perceptually so haze lifts darks the same way.
    vec3 fogG = pow( max( gl_FragColor.rgb, 0.0 ), vec3( 1.0 / 2.2 ) );
    gl_FragColor.rgb = pow( mix( fogG, pow( fogColor, vec3( 1.0 / 2.2 ) ), fogMix ), vec3( 2.2 ) );
  #endif
  gl_FragColor.a = max( gl_FragColor.a, mist * 0.8 );
#endif
`

const CLOUD_FN = /* glsl */ `
uniform vec2 uCloudOffset;
uniform float uCloudStrength;
float worldCloud(vec2 xz) {
  vec2 p = xz * 0.075 + uCloudOffset;
  float n = wNoise(p) * 0.62 + wNoise(p * 2.13 + vec2(5.2, 1.3)) * 0.28 + wNoise(p * 4.7 + vec2(1.7, 9.2)) * 0.1;
  return 1.0 - uCloudStrength * smoothstep(0.5, 0.74, n);
}
`

/** Sunlight focused by the waves onto the seabed: a slow, faint web of light, fading with depth. */
const CAUSTICS = /* glsl */ `
{
  float depth = ${WATER_Y.toFixed(3)} - vWorldP.y;
  if (depth > 0.0) {
    vec2 p = vWorldP.xz;
    float t = uTime;
    float a = 1.0 - abs(wNoise(p * 2.4 + vec2(t * 0.23, t * 0.11)) * 2.0 - 1.0);
    float b = 1.0 - abs(wNoise(p * 2.9 + vec2(-t * 0.17, t * 0.2) + 7.3) * 2.0 - 1.0);
    float c = smoothstep(0.82, 0.98, a) + smoothstep(0.84, 0.99, b);
    // Only up close: from afar the fine web would shimmer into noise.
    float near = 1.0 - smoothstep(0.006, 0.014, length(fwidth(p)));
    wCloud *= 1.0 + c * 0.5 * near * smoothstep(0.0, 0.08, depth) * exp(-depth * 1.4);
  }
}
`

export interface PatchOptions {
  /** Sway vertices by local height (geometry is authored with its base at y = 0, about 1 unit tall). */
  wind?: number
  /** Subtle tint variation on upward faces. */
  topDetail?: boolean
  /** Dancing caustics on anything below the sea surface. */
  caustics?: boolean
  /** Fog of war: how this mesh hides under the clouds (it needs an `aTile` attribute; terrain also
   * `aNb` and `aLow`, see builder.ts). Explored land out of sight gets the veil in every mode. */
  fog?: FogMode
  /** Extra code, see water.ts. Give it a `name` so its program is never shared with another patch. */
  extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void
  name?: string
}

const LIGHTS_WITH_CLOUDS = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= wCloud;',
)

/** Adds cloud shadows (and optionally wind / top detail) to a standard material. */
export function patchMaterial<T extends THREE.Material>(material: T, opts: PatchOptions = {}): T {
  const key = `w${opts.wind ?? 0}${opts.topDetail ? 't' : ''}${opts.caustics ? 'c' : ''}${opts.fog ? `f${opts.fog}` : ''}${opts.extra ? `x${opts.name ?? ''}` : ''}`
  material.customProgramCacheKey = () => key
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime
    shader.uniforms.uCloudOffset = shared.uCloudOffset
    shader.uniforms.uCloudStrength = shared.uCloudStrength
    shader.uniforms.uWind = shared.uWind
    shader.uniforms.uMist = shared.uMist
    if (opts.fog) Object.assign(shader.uniforms, fogShared)
    let vs = shader.vertexShader
    let fs = shader.fragmentShader
    vs = vs.replace(
      '#include <common>',
      `#include <common>\nuniform float uTime;\nuniform float uWind;\nvarying vec3 vWorldP;\nvarying float vUp;${opts.topDetail ? '\nattribute float aDetail;\nvarying float vDetail;' : ''}`,
    )
    if (opts.wind) {
      vs = vs.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec3 base = vec3(0.0);
          mat3 im = mat3(1.0);
          #ifdef USE_INSTANCING
            base = instanceMatrix[3].xyz;
            im = mat3(instanceMatrix);
          #endif
          float ph = dot(base.xz, vec2(0.71, 0.53));
          float gust = 0.65 + 0.35 * sin(uTime * 0.37 + base.x * 0.11);
          float s = sin(uTime * 1.35 + ph) * 0.7 + sin(uTime * 2.3 + ph * 1.9) * 0.3;
          float bend = max(transformed.y, 0.0);
          bend *= bend;
          vec3 w = vec3(s * gust, 0.0, cos(uTime * 1.05 + ph * 1.3) * 0.45) * (${opts.wind.toFixed(4)} * uWind * bend);
          // World-space sway back into local space (instances are rotated about y and scaled).
          float sc2 = max(dot(im[0], im[0]), 1e-6);
          transformed += (transpose(im) * w) / sc2;
        }`,
      )
    }
    vs = vs.replace(
      '#include <project_vertex>',
      /* glsl */ `#include <project_vertex>
      {
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        vWorldP = (modelMatrix * wp).xyz;
        vUp = normal.y;
        ${opts.topDetail ? 'vDetail = aDetail;' : ''}
      }`,
    )
    if (opts.fog) {
      vs = vs.replace('#include <common>', `#include <common>\n${fogVertexDecl(opts.fog)}`)
      vs = vs.replace('#include <project_vertex>', `${fogVertex(opts.fog)}\n#include <project_vertex>`)
    }
    fs = fs.replace(
      '#include <common>',
      `#include <common>\nuniform float uTime;\nuniform float uMist;\nvarying vec3 vWorldP;\nvarying float vUp;${opts.topDetail ? '\nvarying float vDetail;' : ''}${opts.fog ? '\nvarying vec4 vFog;' : ''}\n${GLSL_NOISE}\n${CLOUD_FN}`,
    )
    fs = fs.replace('#include <fog_fragment>', `${opts.fog ? FOG_VEIL : ''}\n${FOG_WITH_MIST}`)
    if (opts.fog === 'surface') fs = fs.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFog.b < 0.5) discard;')
    fs = fs.replace(
      '#include <lights_fragment_begin>',
      `float wCloud = worldCloud(vWorldP.xz);\n${opts.caustics ? CAUSTICS : ''}\n${LIGHTS_WITH_CLOUDS}`,
    )
    if (opts.topDetail) {
      fs = fs.replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float tdUp = smoothstep(0.85, 0.98, vUp);
        float tdFw = length(fwidth(vWorldP.xz));
        // Detail grows as the camera comes close; the default zoom stays calm.
        float tdNear = 1.0 - smoothstep(0.005, 0.016, tdFw);
        {
          vec2 p = vWorldP.xz;
          float fw = tdFw;
          float up = tdUp;
          float kind = floor(vDetail + 0.5);
          float sand = 1.0 - step(0.5, abs(kind - 1.0));
          float rock = 1.0 - step(0.5, abs(kind - 2.0));
          float snow = 1.0 - step(0.5, abs(kind - 3.0));
          float plains = 1.0 - step(0.5, abs(kind - 4.0));
          float forest = 1.0 - step(0.5, abs(kind - 5.0));
          float hills = 1.0 - step(0.5, abs(kind - 6.0));
          float meadow = 1.0 - step(0.5, kind);
          float turf = meadow + plains + forest + hills;
          // Broad hue drift and a fine grain that fades out before it can alias.
          float broad = wNoise(p * 0.9 + 7.0) * 0.6 + wNoise(p * 2.3 + 3.7) * 0.4;
          float mid = wNoise(p * 6.0 + 1.3);
          float fine = wNoise(p * 23.0 + 9.1) * (1.0 - smoothstep(0.012, 0.03, fw));
          vec3 warm = diffuseColor.rgb * vec3(1.06, 1.02, 0.9);
          vec3 cool = diffuseColor.rgb * vec3(0.93, 1.0, 1.03);
          vec3 tinted = mix(cool, warm, smoothstep(0.25, 0.75, broad));
          diffuseColor.rgb = mix(diffuseColor.rgb, tinted, up * mix(0.8, 0.35, sand + snow));

          // Painted mottling: soft-edged patches, domain-warped so they look brushed, not noisy.
          vec2 q = p * 1.7 + vec2(wNoise(p * 0.8 + 3.1), wNoise(p * 0.8 + 9.7)) * 1.6;
          float pa = wNoise(q);
          float pb = wNoise(q * 1.9 + 5.3);
          float pc = wNoise(q * 3.4 + 11.0);
          float patchA = smoothstep(0.5, 0.64, pa);          // darker, lusher grass / heather
          float patchB = smoothstep(0.55, 0.68, pb);         // worn earth / bare ground
          float patchC = smoothstep(0.56, 0.7, pc);          // sunlit, bleached grass
          float k = up * mix(0.4, 1.0, tdNear);
          vec3 c = diffuseColor.rgb;
          vec3 lush = c * vec3(0.78, 0.9, 0.8);
          vec3 worn = mix(c, vec3(0.42, 0.3, 0.18), 0.45);
          vec3 bleach = mix(c, c * vec3(1.18, 1.12, 0.86), 1.0);
          vec3 heather = mix(c, vec3(0.36, 0.2, 0.32), 0.42);
          vec3 litter = mix(c, vec3(0.33, 0.22, 0.12), 0.35);
          vec3 stubble = mix(c, c * vec3(1.14, 1.06, 0.84), 1.0);
          vec3 m = c;
          m = mix(m, lush, patchA * (meadow * 0.75 + plains * 0.0 + forest * 0.6));
          m = mix(m, heather, patchA * hills * 0.85);
          m = mix(m, worn, patchB * (meadow * 0.35 + plains * 0.5 + hills * 0.55) * smoothstep(0.58, 0.72, pb));
          m = mix(m, litter, patchB * forest * 0.6);
          m = mix(m, bleach, patchC * (meadow * 0.5 + hills * 0.3));
          m = mix(m, stubble, patchC * plains * 0.7);
          // Plains: faint strips of mown and standing grain, only close up.
          float rows = smoothstep(0.35, 0.65, sin(dot(p, vec2(0.92, 0.38)) * 9.0 + pa * 3.0) * 0.5 + 0.5);
          m *= 1.0 - plains * tdNear * smoothstep(0.4, 0.6, pb) * rows * 0.06;
          diffuseColor.rgb = mix(c, m, k * turf);

          float grain = (mid - 0.5) * mix(0.09, 0.16, rock) + (fine - 0.5) * mix(0.08, 0.12, rock);
          diffuseColor.rgb *= 1.0 + up * grain * (1.0 - 0.7 * snow);
          // Wind ripples in the sand, fading out before they would alias.
          float rip = sin(dot(p, vec2(0.78, 0.62)) * 27.0 + wNoise(p * 1.4) * 7.0);
          float ripFade = 1.0 - smoothstep(0.01, 0.025, fw);
          diffuseColor.rgb *= 1.0 - up * sand * ripFade * (smoothstep(0.3, 1.0, rip) * 0.045);
        }`,
      )
      // Gentle relief on the tops: soft hummocks catch the low sun up close. Lighting only, so
      // pieces still stand on the flat top.
      fs = fs.replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        if (tdUp > 0.0 && tdNear > 0.0) {
          vec2 p = vWorldP.xz * 2.6;
          float e = 0.06;
          float h0 = wNoise(p) + 0.5 * wNoise(p * 2.3 + 4.1);
          float hx = wNoise(p + vec2(e, 0.0)) + 0.5 * wNoise((p + vec2(e, 0.0)) * 2.3 + 4.1);
          float hz = wNoise(p + vec2(0.0, e)) + 0.5 * wNoise((p + vec2(0.0, e)) * 2.3 + 4.1);
          vec2 g = vec2(hx - h0, hz - h0) / e * 0.075 * tdUp * tdNear;
          vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(wn, 0.0)).xyz), tdUp));
        }`,
      )
    }
    shader.vertexShader = vs
    shader.fragmentShader = fs
    opts.extra?.(shader)
  }
  return material
}

/** A depth material for shadow casting that sways like `patchMaterial(..., { wind })` and, with
 * `fog`, collapses what is hidden under the clouds so it casts no telltale shadows. */
export function windDepthMaterial(wind: number, fog?: 'terrain' | 'instanced'): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  m.customProgramCacheKey = () => `wd${wind}${fog ?? ''}`
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime
    shader.uniforms.uWind = shared.uWind
    if (fog) Object.assign(shader.uniforms, fogShared)
    let vs = shader.vertexShader.replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uWind;${fog ? `\n${fogVertexDecl(fog)}` : ''}`)
    if (wind > 0) {
      vs = vs.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec3 base = vec3(0.0);
          mat3 im = mat3(1.0);
          #ifdef USE_INSTANCING
            base = instanceMatrix[3].xyz;
            im = mat3(instanceMatrix);
          #endif
          float ph = dot(base.xz, vec2(0.71, 0.53));
          float gust = 0.65 + 0.35 * sin(uTime * 0.37 + base.x * 0.11);
          float s = sin(uTime * 1.35 + ph) * 0.7 + sin(uTime * 2.3 + ph * 1.9) * 0.3;
          float bend = max(transformed.y, 0.0);
          bend *= bend;
          vec3 w = vec3(s * gust, 0.0, cos(uTime * 1.05 + ph * 1.3) * 0.45) * (${wind.toFixed(4)} * uWind * bend);
          float sc2 = max(dot(im[0], im[0]), 1e-6);
          transformed += (transpose(im) * w) / sc2;
        }`,
      )
    }
    if (fog) vs = vs.replace('#include <project_vertex>', `${fogVertex(fog)}\n#include <project_vertex>`)
    shader.vertexShader = vs
  }
  return m
}

/** Fog for a plain (unlit) instanced material, e.g. the contact shadows under props. */
export function patchFogBasic<T extends THREE.Material>(material: T): T {
  material.customProgramCacheKey = () => 'fogbasic'
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fogShared)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${fogVertexDecl('instanced')}`)
      .replace('#include <project_vertex>', `${fogVertex('instanced')}\n#include <project_vertex>`)
  }
  return material
}
