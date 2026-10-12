// Shared shader patches for the world's materials: drifting cloud shadows on the sun light,
// wind sway for vegetation, and a whisper of low-contrast detail on terrain tops.
// All materials stay three.js standard materials (lights, shadows, fog, tone mapping for free).

import * as THREE from 'three'
import { WATER_Y } from './layout.ts'

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
  const key = `w${opts.wind ?? 0}${opts.topDetail ? 't' : ''}${opts.caustics ? 'c' : ''}${opts.extra ? `x${opts.name ?? ''}` : ''}`
  material.customProgramCacheKey = () => key
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime
    shader.uniforms.uCloudOffset = shared.uCloudOffset
    shader.uniforms.uCloudStrength = shared.uCloudStrength
    shader.uniforms.uWind = shared.uWind
    shader.uniforms.uMist = shared.uMist
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
    fs = fs.replace(
      '#include <common>',
      `#include <common>\nuniform float uTime;\nuniform float uMist;\nvarying vec3 vWorldP;\nvarying float vUp;${opts.topDetail ? '\nvarying float vDetail;' : ''}\n${GLSL_NOISE}\n${CLOUD_FN}`,
    )
    fs = fs.replace('#include <fog_fragment>', FOG_WITH_MIST)
    fs = fs.replace(
      '#include <lights_fragment_begin>',
      `float wCloud = worldCloud(vWorldP.xz);\n${opts.caustics ? CAUSTICS : ''}\n${LIGHTS_WITH_CLOUDS}`,
    )
    if (opts.topDetail) {
      fs = fs.replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          // Low-contrast detail on the tops: broad patches that shift hue a little, plus a fine
          // grain that fades out before it can alias.
          float up = smoothstep(0.85, 0.98, vUp);
          vec2 p = vWorldP.xz;
          float fw = length(fwidth(p));
          float broad = wNoise(p * 0.9 + 7.0) * 0.6 + wNoise(p * 2.3 + 3.7) * 0.4;
          float mid = wNoise(p * 6.0 + 1.3);
          float fine = wNoise(p * 23.0 + 9.1) * (1.0 - smoothstep(0.012, 0.03, fw));
          vec3 warm = diffuseColor.rgb * vec3(1.06, 1.02, 0.9);
          vec3 cool = diffuseColor.rgb * vec3(0.93, 1.0, 1.03);
          vec3 tinted = mix(cool, warm, smoothstep(0.25, 0.75, broad));
          float kind = floor(vDetail + 0.5);
          float sand = 1.0 - step(0.5, abs(kind - 1.0));
          float rock = 1.0 - step(0.5, abs(kind - 2.0));
          float snow = 1.0 - step(0.5, abs(kind - 3.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, tinted, up * mix(0.8, 0.35, sand + snow));
          float grain = (mid - 0.5) * mix(0.09, 0.16, rock) + (fine - 0.5) * mix(0.08, 0.12, rock);
          diffuseColor.rgb *= 1.0 + up * grain * (1.0 - 0.7 * snow);
          // Wind ripples in the sand, fading out before they would alias.
          float rip = sin(dot(p, vec2(0.78, 0.62)) * 27.0 + wNoise(p * 1.4) * 7.0);
          float ripFade = 1.0 - smoothstep(0.01, 0.025, fw);
          diffuseColor.rgb *= 1.0 - up * sand * ripFade * (smoothstep(0.3, 1.0, rip) * 0.045);
        }`,
      )
    }
    shader.vertexShader = vs
    shader.fragmentShader = fs
    opts.extra?.(shader)
  }
  return material
}

/** A depth material for shadow casting that sways like `patchMaterial(..., { wind })`. */
export function windDepthMaterial(wind: number): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  m.customProgramCacheKey = () => `wd${wind}`
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime
    shader.uniforms.uWind = shared.uWind
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
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
  return m
}
