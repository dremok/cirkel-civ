// The sea: a translucent surface with depth colour, foam along the shore, moving wave normals and
// sun glints; plus the glassy water walls along the board's rim.

import * as THREE from 'three'
import { hexCorner } from '../../../engine/hex.ts'
import { BIOME, NATURE } from '../palette.ts'
import { GeoBuilder, lin, mix3 } from './builder.ts'
import { WATER_Y, hexSdf, tileAtPoint, type Layout } from './layout.ts'
import { patchMaterial } from './shading.ts'

const FIELD_RES = 10 // texels per world unit
const SHORE_RANGE = 2
const DEPTH_RANGE = 1.4

/** Shore distance (R) and smoothed depth (G) over the board, sampled by the water shader. */
function buildField(layout: Layout) {
  const { map, cx, cz, top, water } = layout
  const x0 = layout.minX - 1, z0 = layout.minZ - 1
  const w = Math.ceil((layout.maxX - layout.minX + 2) * FIELD_RES)
  const h = Math.ceil((layout.maxZ - layout.minZ + 2) * FIELD_RES)
  const shore = new Float32Array(w * h)
  const depth = new Float32Array(w * h)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + (i + 0.5) / FIELD_RES
      const z = z0 + (j + 0.5) / FIELD_RES
      const id = tileAtPoint(map, x, z)
      const k = j * w + i
      if (id === null) {
        // Off the board: continue the nearest edge tile so filtering at the rim stays clean.
        shore[k] = SHORE_RANGE
        depth[k] = 1
        continue
      }
      if (!water[id]) {
        shore[k] = 0
        depth[k] = 0
        continue
      }
      depth[k] = WATER_Y - top[id]
      let best = SHORE_RANGE
      for (let o = 0; o < 6; o++) {
        const n1 = layout.nb[id * 6 + o]
        if (n1 < 0) continue
        if (!water[n1]) best = Math.min(best, hexSdf(x - cx[n1], z - cz[n1]))
        for (let p = 0; p < 6; p++) {
          const n2 = layout.nb[n1 * 6 + p]
          if (n2 >= 0 && !water[n2]) best = Math.min(best, hexSdf(x - cx[n2], z - cz[n2]))
        }
      }
      shore[k] = Math.max(0, best)
    }
  }
  // Soften the depth so colour flows across tiles instead of stepping.
  const blur = (src: Float32Array, rad: number) => {
    const tmp = new Float32Array(src.length)
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let s = 0, n = 0
      for (let d = -rad; d <= rad; d++) { const ii = i + d; if (ii >= 0 && ii < w) { s += src[j * w + ii]; n++ } }
      tmp[j * w + i] = s / n
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let s = 0, n = 0
      for (let d = -rad; d <= rad; d++) { const jj = j + d; if (jj >= 0 && jj < h) { s += tmp[jj * w + i]; n++ } }
      src[j * w + i] = s / n
    }
  }
  blur(depth, 4)
  blur(depth, 4)
  const data = new Uint8Array(w * h * 4)
  for (let k = 0; k < w * h; k++) {
    const d = Math.min(depth[k], shore[k] * 0.8 + 0.06)
    data[k * 4] = Math.round(255 * Math.min(1, shore[k] / SHORE_RANGE))
    data[k * 4 + 1] = Math.round(255 * Math.min(1, d / DEPTH_RANGE))
    data[k * 4 + 2] = 0
    data[k * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  const rect = new THREE.Vector4(x0, z0, 1 / (w / FIELD_RES), 1 / (h / FIELD_RES))
  return { tex, rect }
}

export function buildWater(layout: Layout) {
  const { map, cx, cz, top, water, nb } = layout
  const field = buildField(layout)

  // Surface: a flat hexagon per water tile at sea level.
  const pos: number[] = []
  for (const t of map.tiles) {
    if (!water[t.id]) continue
    const x0 = cx[t.id], z0 = cz[t.id]
    for (let i = 0; i < 6; i++) {
      const a = hexCorner(i), c = hexCorner((i + 1) % 6)
      pos.push(x0, WATER_Y, z0, x0 + c.x, WATER_Y, z0 + c.z, x0 + a.x, WATER_Y, z0 + a.z)
    }
  }
  const sGeo = new THREE.BufferGeometry()
  sGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  sGeo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  sGeo.computeBoundingSphere()

  const uniforms = {
    uField: { value: field.tex },
    uFieldRect: { value: field.rect },
    uShallow: { value: new THREE.Color(BIOME.shallow.light) },
    uMid: { value: new THREE.Color(BIOME.shallow.base) },
    uDeep: { value: new THREE.Color(BIOME.deep.base) },
    uFoam: { value: new THREE.Color(NATURE.foam) },
  }
  const sMat = patchMaterial(
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: 0.55 }),
    {
      name: 'sea',
      extra(shader) {
        Object.assign(shader.uniforms, uniforms)
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>\nuniform sampler2D uField;\nuniform vec4 uFieldRect;\nuniform vec3 uShallow;\nuniform vec3 uMid;\nuniform vec3 uDeep;\nuniform vec3 uFoam;`,
          )
          .replace(
            '#include <color_fragment>',
            /* glsl */ `#include <color_fragment>
            vec4 wFld = texture2D(uField, (vWorldP.xz - uFieldRect.xy) * uFieldRect.zw);
            float wShore = wFld.r * ${SHORE_RANGE.toFixed(2)};
            float wDepth = wFld.g * ${DEPTH_RANGE.toFixed(2)};
            vec3 wCol = mix(uShallow, uMid, smoothstep(0.02, 0.4, wDepth));
            wCol = mix(wCol, uDeep, smoothstep(0.4, 1.1, wDepth));
            // Clear in the shallows, then quickly a body of colour: the stepped seabed never shows.
            float wAlpha = mix(0.3, 0.97, smoothstep(0.04, 0.5, wDepth));
            float wN = wNoise(vWorldP.xz * 2.6 + vec2(uTime * 0.11, -uTime * 0.08));
            float wN2 = wNoise(vWorldP.xz * 5.0 - vec2(uTime * 0.05, uTime * 0.09));
            float wAA = max(fwidth(wShore), 0.004);
            // A crisp line hugging the shore, its width breathing a little.
            float wW = 0.03 + 0.018 * wN;
            float wEdge = 1.0 - smoothstep(wW - wAA, wW + wAA, wShore);
            // A thin broken line that rolls in from offshore and fades as it arrives.
            float wPh = fract(uTime * 0.11 + wN * 0.35);
            float wD = 0.06 + 0.2 * (1.0 - wPh);
            float wBand = (1.0 - smoothstep(0.009, 0.009 + wAA * 1.5, abs(wShore - wD))) * smoothstep(0.42, 0.6, wN2) * sin(wPh * 3.1416);
            // and a soft wet glow right at the waterline.
            float wGlow = (1.0 - smoothstep(0.0, 0.16, wShore)) * 0.22;
            float wFoam = clamp(wEdge + wBand * 0.7 + wGlow, 0.0, 1.0);
            diffuseColor.rgb = mix(wCol, uFoam, wFoam);
            diffuseColor.a = mix(wAlpha, 1.0, wFoam);`,
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, wFoam);`,
          )
          .replace(
            '#include <normal_fragment_maps>',
            /* glsl */ `#include <normal_fragment_maps>
            {
              vec2 p = vWorldP.xz;
              float t = uTime;
              vec2 g = vec2(0.0);
              g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 2.3 + t * 1.1) * 0.05;
              g += vec2(-0.47, 0.88) * cos(dot(p, vec2(-0.47, 0.88)) * 3.7 + t * 1.45) * 0.035;
              g += vec2(0.96, -0.28) * cos(dot(p, vec2(0.96, -0.28)) * 6.1 + t * 2.0) * 0.022;
              vec2 q = p * 2.2 + vec2(t * 0.09, t * 0.06);
              float e = 0.08;
              float n0 = wNoise(q);
              g += vec2(wNoise(q + vec2(e, 0.0)) - n0, wNoise(q + vec2(0.0, e)) - n0) / e * 0.035;
              g *= 1.0 - wFoam * 0.7;
              vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
              normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
            }`,
          )
          .replace(
            '#include <opaque_fragment>',
            /* glsl */ `{
              vec3 wSpec = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
              float fres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 5.0);
              float a = clamp(diffuseColor.a + fres * 0.25, 0.0, 1.0);
              outgoingLight = outgoingLight - wSpec + wSpec / max(a, 0.5);
              // A few sun sparkles twinkling on the open water.
              vec2 sp = vWorldP.xz * 27.0;
              float tw = wNoise(sp + vec2(uTime * 0.7, -uTime * 0.45)) * wNoise(sp * 1.73 - vec2(uTime * 0.55, uTime * 0.35)) * wNoise(vWorldP.xz * 0.6 + uTime * 0.03);
              float spark = smoothstep(0.56, 0.62, tw) * (1.0 - wFoam) * smoothstep(0.15, 0.5, wDepth) * wCloud
                * (1.0 - smoothstep(0.018, 0.03, length(fwidth(vWorldP.xz))));
              #if NUM_DIR_LIGHTS > 0
                outgoingLight += directionalLights[0].color * spark * 0.9;
              #endif
              a = max(a, spark);
              diffuseColor.a = a;
            }
            #include <opaque_fragment>`,
          )
      },
    },
  )
  const surface = new THREE.Mesh(sGeo, sMat)
  surface.receiveShadow = true
  surface.renderOrder = 1
  surface.name = 'sea'
  // For N8AO: the surface occludes like a solid (soft darkening where it meets the shore).
  surface.userData.treatAsOpaque = true

  // Rim walls: where the sea meets the board edge, a slab of clear tinted glass down to the seabed:
  // a bright meniscus at the surface, a luminous top band, deepening colour below.
  const b = new GeoBuilder(true)
  const cLip = [...lin('#EFFCF8'), 0.9]
  const cBand = [...lin('#A9E9DE'), 0.32]
  const cMid = [...mix3(lin(BIOME.shallow.base), lin(BIOME.shallow.light), 0.3), 0.46]
  const cLow = [...mix3(lin(BIOME.deep.base), lin(BIOME.shallow.dark), 0.5), 0.72]
  const BAND = 0.16
  for (const t of map.tiles) {
    if (!water[t.id]) continue
    const x0 = cx[t.id], z0 = cz[t.id]
    for (let i = 0; i < 6; i++) {
      if (nb[t.id * 6 + i] >= 0) continue
      const a = hexCorner(i), c = hexCorner((i + 1) % 6)
      const yb = top[t.id]
      const yl = WATER_Y - 0.014
      const yBand = Math.max(yb, yl - BAND)
      const P = (p: { x: number; z: number }, y: number): [number, number, number] => [x0 + p.x, y, z0 + p.z]
      b.quad(P(a, WATER_Y), P(c, WATER_Y), P(c, yl), P(a, yl), cLip)
      b.quad(P(a, yl), P(c, yl), P(c, yBand), P(a, yBand), cBand, cBand, cMid, cMid)
      if (yBand > yb) {
        const k = Math.min(1, (yBand - yb) / 1.1)
        const cBot = cMid.map((v, n) => v + (cLow[n] - v) * k)
        b.quad(P(a, yBand), P(c, yBand), P(c, yb), P(a, yb), cMid, cMid, cBot, cBot)
      }
    }
  }
  const rGeo = b.build()
  // Double-sided: through the surface you see the inside of the far walls, which closes the volume.
  const rMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.08, metalness: 0, envMapIntensity: 1.0, side: THREE.DoubleSide }), {
    name: 'rim',
    extra(shader) {
      shader.uniforms.uInnerTop = { value: new THREE.Color(BIOME.shallow.light).lerp(new THREE.Color(BIOME.shallow.base), 0.4) }
      shader.uniforms.uInner = { value: new THREE.Color(BIOME.deep.light).lerp(new THREE.Color(BIOME.shallow.dark), 0.4) }
      shader.uniforms.uGlow = { value: new THREE.Color(NATURE.sun) }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uInnerTop;\nuniform vec3 uInner;\nuniform vec3 uGlow;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float rimD = ${WATER_Y.toFixed(3)} - vWorldP.y;
          // Seen from inside, the far walls are just more water: lighter near the surface.
          if (!gl_FrontFacing) diffuseColor.a = mix(0.55, 0.8, smoothstep(0.0, 0.9, rimD));`,
        )
        .replace(
          '#include <opaque_fragment>',
          `if (!gl_FrontFacing) outgoingLight = mix(uInnerTop, uInner, smoothstep(0.0, 0.9, rimD)) * (0.82 + 0.18 * wCloud);
          else {
            // Sunlight carried down through the water: a soft glow in the top band of the glass.
            outgoingLight += uGlow * (1.0 - smoothstep(0.0, 0.35, rimD)) * 0.16 * wCloud;
            // Glassy edge: the slab brightens toward grazing angles.
            float fr = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 3.0);
            outgoingLight += vec3(0.85, 0.95, 0.95) * fr * 0.18;
            diffuseColor.a = min(1.0, diffuseColor.a + fr * 0.2);
          }
          #include <opaque_fragment>`,
        )
    },
  })
  const rim = new THREE.Mesh(rGeo, rMat)
  rim.renderOrder = 2
  rim.name = 'sea-rim'
  rim.userData.treatAsOpaque = true

  return {
    surface,
    rim,
    dispose() {
      sGeo.dispose(); sMat.dispose(); rGeo.dispose(); rMat.dispose(); field.tex.dispose()
    },
  }
}
