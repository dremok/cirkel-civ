// Fog of war: a sea of soft, billowing cumulus lying over the unexplored part of the board, lit by
// the low sun (apricot and cream on top, lilac in the hollows) and slowly drifting. It is one
// heightfield driven by a coverage field: full over every unexplored hex, spilling a little onto
// the known land around it and draping over the board's edge into the cloud sea below, so the
// diorama's rim gives nothing away either. As tiles are explored the coverage falls and the
// clouds melt down into the land with a noisy, soft dissolve.

import * as THREE from 'three'
import { neighbors } from '../../../engine/hex.ts'
import type { WorldQuality } from '../api.ts'
import { NATURE } from '../palette.ts'
import { hexSdf, tileAtPoint, type Layout } from './layout.ts'
import { FOG_FLOOR, GLSL_NOISE, fogShared, shared } from './shading.ts'

/** Coverage texels per world unit. */
const RES = 6
/** Radius of each of the two box blurs that soften the unexplored mask into the cover. */
const BLUR_RADIUS = 0.5
/** How far the clouds bulge out past the board's edge. */
const DRAPE = 0.7
/** The cloud sea's mean surface: one flat height for every clouded tile, a little above the
 * typical land, where pieces lay plans, outlines and markers over the unknown. */
export const CLOUD_SURFACE = 0.7
/** How far the unexplored mask is widened before blurring: every unknown hex, even a lone one,
 * sits under full cloud, and soft wisps reach a little onto the known edge tiles. */
const DILATE = 0.34

const COVER_FN = /* glsl */ `
// Shared by the sheet's vertices and the fragment outline, so both agree on where the bank ends.
float coverAt(vec2 p) {
  vec2 w = vec2(wNoise(p * 0.9 + 1.7), wNoise(p * 0.9 + 5.3)) - 0.5;
  float cv = texture2D(uCover, (p + w * 0.24 - uCoverRect.xy) * uCoverRect.zw).r;
  // Where it thins, it breaks up unevenly: a dissolve, not a fade.
  float dn = wNoise(p * 0.7 + vec2(uTime * 0.02, -uTime * 0.015)) - 0.5;
  return smoothstep(0.16 + dn * 0.1, 0.8 + dn * 0.1, cv);
}
`

const VERT = /* glsl */ `
uniform sampler2D uCover;
uniform vec4 uCoverRect;
uniform vec4 uBoard; // minX, minZ, maxX, maxZ
uniform float uTime;
varying vec3 vW;
varying vec3 vN;
uniform vec3 uSunDir;
varying float vS;
varying float vB;
varying float vEdge;
varying float vShadow;
varying float vCrease;
${GLSL_NOISE}
#include <fog_pars_vertex>

vec2 cHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// A field of overlapping rounded puffs, one per cell, blended with a smooth max so they meet in
// soft hollows. The surface has no creases, which the sheet's triangles would draw as zigzags.
float puffs(vec2 p, float scale, float r0, float r1, vec2 drift) {
  vec2 q = p / scale + drift;
  vec2 i = floor(q), f = fract(q);
  float h = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 c = i + g;
    vec2 d = g + 0.15 + 0.7 * cHash(c) - f;
    float rad = mix(r0, r1, wHash12(c + 17.3));
    float u = 1.0 - dot(d, d) / (rad * rad);
    if (u > 0.0) {
      // u^1.5: a round dome whose foot meets the ground tangentially (no crease anywhere).
      float hh = rad * u * sqrt(u) * 1.08;
      float k = 0.18;
      float m = max(k - abs(h - hh), 0.0) / k;
      h = max(h, hh) + m * m * k * 0.25;
    }
  }
  return h * scale;
}

${COVER_FN}

float cloudY(vec2 p, out float s, out float b) {
  s = coverAt(p);
  // The sea of clouds lies in the board like a cushion in a tray, thinning down to meet the rock
  // skirt flush at the rim (measured to the board's straight sides, so the hex teeth leave no ribs).
  float toSide = min(min(p.x - uBoard.x, uBoard.z - p.x), min(p.y - uBoard.y, uBoard.w - p.y));
  // A wide, gentle falloff: no steep roll at the rim (seen edge-on it streaked; from behind it
  // curled up like a lip).
  float rimK = pow(1.0 - smoothstep(0.3, 2.8, toSide), 1.4);
  // How deep inside the clouded area this point lies (a blurred cover, from the mipmaps): the bank
  // stays low and rolling near the known land and swells a little higher deep in the unknown.
  float deep = smoothstep(0.3, 0.95, textureLod(uCover, (p - uCoverRect.xy) * uCoverRect.zw, 3.0).r);
  // Large, soft cumulus with a few smaller heads on them, over slow broad swells. They churn in place.
  vec2 d = vec2(uTime * 0.006, uTime * 0.0025);
  float swell = wNoise(p * 0.08 + d * 0.4) * 0.65 + wNoise(p * 0.19 - d) * 0.35;
  float big = puffs(p, 2.8, 0.6, 0.98, d) * 0.33;
  #ifdef LITE
    float small = puffs(p + 3.7, 1.6, 0.55, 0.95, -d * 1.7) * 0.14;
  #else
    float small = puffs(p + 3.7, 1.25, 0.5, 0.92, -d * 1.7) * 0.18 * mix(0.45, 1.0, smoothstep(0.35, 0.75, wNoise(p * 0.2 + 4.0)));
    // Little heads up close only (from afar they would read as foam).
    float nearCam = 1.0 - smoothstep(8.0, 16.0, distance(cameraPosition.xz, p) + cameraPosition.y * 0.6);
    if (nearCam > 0.0) small += puffs(p + 9.1, 0.6, 0.45, 0.85, d * 2.3) * 0.08 * nearCam;
  #endif
  b = big + small;
  // Near the rim the billows settle out, so the cushion's edge is one smooth roll.
  float calm = 1.0 - smoothstep(0.05, 0.8, rimK);
  float top = mix(-0.05, 0.06, deep) + (swell - 0.5) * 0.28 * deep + b * mix(0.65, 1.0, deep) * calm;
  top = mix(top, ${(FOG_FLOOR + 0.04).toFixed(3)}, rimK);
  // Over the known land the bank rolls over in a rounded shoulder down to a foot just under the
  // ground (and only just under the sea, which would show a deeper foot through its clear shallows).
  return mix(-0.25, top, pow(smoothstep(0.0, 1.0, s), 0.55));
}

void main() {
  vec2 p = position.xz;
  float s, b, s1, b1, s2, b2;
  float y = cloudY(p, s, b);
  float e = 0.12;
  float yx = cloudY(p + vec2(e, 0.0), s1, b1);
  float yz = cloudY(p + vec2(0.0, e), s2, b2);
  vN = normalize(vec3(y - yx, e, y - yz));
  vS = s;
  vB = b;
  // Creases between billows (the surface lies below its surroundings): shaded lilac, so each
  // billow reads as its own rounded form.
  {
    float s3, b3, s4, b4;
    float ec = 0.32;
    float yxm = cloudY(p - vec2(ec, 0.0), s3, b3), yzm = cloudY(p - vec2(0.0, ec), s4, b4);
    float yxp = cloudY(p + vec2(ec, 0.0), s3, b3), yzp = cloudY(p + vec2(0.0, ec), s4, b4);
    vCrease = clamp(((yxm + yxp + yzm + yzp) * 0.25 - y) * 9.0, 0.0, 1.0);
  }
  vEdge = texture2D(uCover, (p - uCoverRect.xy) * uCoverRect.zw).b * 3.0 - 1.5;
  // Gentle self-shadowing: does a billow stand between this point and the low sun?
  vShadow = 0.0;
  #ifndef LITE
  {
    vec2 sd = normalize(uSunDir.xz + 1e-5);
    float rise = uSunDir.y / max(length(uSunDir.xz), 1e-3);
    float ss, sb;
    for (int k = 1; k <= 3; k++) {
      float dk = float(k) * 1.1;
      float hk = cloudY(p + sd * dk, ss, sb);
      vShadow += smoothstep(0.0, 0.25, hk - (y + dk * rise)) / float(k);
    }
    vShadow = clamp(vShadow, 0.0, 1.0);
  }
  #endif
  vW = vec3(p.x, y, p.y);
  vec4 mvPosition = viewMatrix * vec4(vW, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`

const FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D uCover;
uniform vec4 uCoverRect;
uniform vec4 uBoard;
uniform vec3 uSunDir;
uniform vec3 uLit;
uniform vec3 uPeach;
uniform vec3 uShade;
uniform vec3 uDeep;
uniform vec3 uGlow;
uniform vec2 uCloudOffset;
uniform float uCloudStrength;
varying vec3 vW;
varying vec3 vN;
varying float vS;
varying float vB;
varying float vEdge;
varying float vShadow;
varying float vCrease;
${GLSL_NOISE}
#include <fog_pars_fragment>
${COVER_FN}

void main() {
  // The outline is found per pixel (smooth, whatever the sheet's triangles do), thinning into
  // translucent wisps where the bank meets the known land. Nothing beyond the board's edge (a hair
  // of overhang hides the seam with the skirt).
  float fc = coverAt(vW.xz);
  if (fc < 0.01 || vEdge > 0.05) discard;
  vec3 N = normalize(vN);
  // Where the cushion rolls down to the board's edge, light it as if level: a slope facing away
  // from the sun would otherwise run along the whole edge as one long shaded stripe.
  float toSide = min(min(vW.x - uBoard.x, uBoard.z - vW.x), min(vW.z - uBoard.y, uBoard.w - vW.z));
  float rimF = 1.0 - smoothstep(0.4, 3.0, toSide);
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), rimF * 0.85));
  #ifndef LITE
  {
    // Cauliflower detail on the billows, faded out before it can shimmer.
    // Sampled across the surface, not just the ground plane, so steep flanks don't streak.
    vec2 q = (vW.xz + vec2(vW.y * 0.9, -vW.y * 0.7)) * 2.4 + vec2(uTime * 0.03, 0.0);
    float fw = length(fwidth(q)) / 2.4;
    float k = (1.0 - smoothstep(0.012, 0.04, fw)) * smoothstep(0.25, 0.7, N.y);
    float h0 = wNoise(q) + 0.5 * wNoise(q * 2.3 + 5.1);
    float hx = wNoise(q + vec2(0.07, 0.0)) + 0.5 * wNoise((q + vec2(0.07, 0.0)) * 2.3 + 5.1);
    float hz = wNoise(q + vec2(0.0, 0.07)) + 0.5 * wNoise((q + vec2(0.0, 0.07)) * 2.3 + 5.1);
    N = normalize(N + vec3(h0 - hx, 0.0, h0 - hz) / 0.07 * k * 0.09);
  }
  #endif
  vec3 V = normalize(cameraPosition - vW);
  float ndl = dot(N, uSunDir);
  // The low sun from one side, plus light from the sky above: each billow rounds off all around
  // its foot (with the sun alone, terminators line up across the sea into stripes).
  float sunW = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);
  float skyW = smoothstep(0.3, 0.98, N.y);
  float wrap = mix(sunW, skyW, 0.42) * (1.0 - 0.55 * vShadow * (1.0 - rimF));
  // Lilac in the shade, apricot where the low sun reaches, cream where it strikes full on.
  // A gently defined terminator: soft forms, but clear light and shade at any resolution.
  vec3 c = mix(uShade, uPeach, smoothstep(0.12, 0.62, wrap));
  c = mix(c, uLit, smoothstep(0.64, 0.97, wrap));
  // Tops catch the warm sky: a peach blush on upward faces.
  c = mix(c, c * vec3(1.03, 0.97, 0.93), smoothstep(0.6, 1.0, N.y) * 0.6);
  // Lilac pools in the hollows between the billows.
  float hollow = (1.0 - smoothstep(0.05, 0.45, vB)) * (1.0 - rimF);
  #ifdef LITE
    c = mix(c, uDeep, hollow * 0.3 * (1.0 - 0.4 * wrap));
  #else
    c = mix(c, uDeep, hollow * 0.66 * (1.0 - 0.35 * wrap));
  #endif
  c = mix(c, uDeep, vCrease * 0.7 * (1.0 - rimF));
  // Light scattered through the cloud: shade sides stay luminous, never grey.
  c += vec3(0.05, 0.045, 0.08) * (1.0 - wrap);
  // A silver lining where the billows turn against the low sun, and a warm glow looking sunward.
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.5);
  float sunward = clamp(dot(-V, uSunDir), 0.0, 1.0);
  c += uGlow * rim * (0.12 + 0.3 * sunward) * (1.0 - 0.5 * vShadow);
  // The same drifting cloud shadows that cross the land.
  vec2 cp = vW.xz * 0.075 + uCloudOffset;
  float cn = wNoise(cp) * 0.62 + wNoise(cp * 2.13 + vec2(5.2, 1.3)) * 0.28 + wNoise(cp * 4.7 + vec2(1.7, 9.2)) * 0.1;
  c *= 1.0 - 0.6 * uCloudStrength * smoothstep(0.5, 0.74, cn);
  // Opaque body; only a thin translucent wisp right at the outline.
  float a = smoothstep(0.0, 0.12, fc);
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`

export interface FogClouds {
  mesh: THREE.Mesh
  /** Recompute the cover from each tile's explored amount (0 = clouded, 1 = clear). */
  setExplored(explored: ArrayLike<number>): void
  dispose(): void
}

export function buildClouds(layout: Layout, quality: WorldQuality, sunDir: THREE.Vector3): FogClouds {
  const { map, cx, cz } = layout
  const x0 = layout.minX - DRAPE, z0 = layout.minZ - DRAPE
  const w = Math.ceil((layout.maxX - layout.minX + 2 * DRAPE) * RES)
  const h = Math.ceil((layout.maxZ - layout.minZ + 2 * DRAPE) * RES)
  const rimTile = new Uint8Array(map.tiles.length)
  for (let id = 0; id < map.tiles.length; id++) for (let i = 0; i < 6; i++) if (layout.nb[id * 6 + i] < 0) rimTile[id] = 1

  // Per texel, the tile under it (beyond the board's edge: the rim tile nearest to it). The cover is
  // the unexplored mask over these, blurred: it is 1 deep in the unknown, one half on the border
  // between explored and unexplored hexes and fades over about one hex either side, so the bank
  // slopes down gently onto the known land with no hex pattern anywhere inside it.
  const tileOf = new Int32Array(w * h).fill(-1)
  const inside = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = x0 + (i + 0.5) / RES, z = z0 + (j + 0.5) / RES
      const k = j * w + i
      const here = tileAtPoint(map, x, z)
      if (here !== null) {
        inside[k] = 1
        tileOf[k] = here
        continue
      }
      // Beyond the edge: the rim tile whose hexagon is closest.
      const q = tileAtPoint(map, Math.min(layout.maxX - 0.6, Math.max(layout.minX + 0.6, x)), Math.min(layout.maxZ - 0.6, Math.max(layout.minZ + 0.6, z)))
      if (q === null) continue
      let best = q, bd = Infinity
      const ring = new Set<number>([q])
      for (const a of neighbors(map, q)) { ring.add(a); for (const b of neighbors(map, a)) ring.add(b) }
      for (const t of ring) {
        if (!rimTile[t]) continue
        const d = hexSdf(x - cx[t], z - cz[t])
        if (d < bd) { bd = d; best = t }
      }
      tileOf[k] = best
    }
  }
  const mask = new Float32Array(w * h), tmp = new Float32Array(w * h)
  const BLUR = Math.round(BLUR_RADIUS * RES)
  const GROW = Math.round(DILATE * RES)
  const maxFilter = (src: Float32Array, dst: Float32Array, dx: number) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let m = 0
      for (let o = -GROW; o <= GROW; o++) {
        const ii = dx ? Math.min(w - 1, Math.max(0, i + o)) : i
        const jj = dx ? j : Math.min(h - 1, Math.max(0, j + o))
        const v = src[jj * w + ii]
        if (v > m) m = v
      }
      dst[j * w + i] = m
    }
  }
  const boxBlur = (src: Float32Array, dst: Float32Array, dx: number) => {
    const n = dx ? w : h, m = dx ? h : w
    const step = dx ? 1 : w, line = dx ? w : 1
    const inv = 1 / (2 * BLUR + 1)
    for (let a = 0; a < m; a++) {
      const base = a * line
      let acc = 0
      for (let b = -BLUR; b <= BLUR; b++) acc += src[base + Math.min(n - 1, Math.max(0, b)) * step]
      for (let b = 0; b < n; b++) {
        dst[base + b * step] = acc * inv
        acc += src[base + Math.min(n - 1, b + BLUR + 1) * step] - src[base + Math.max(0, b - BLUR) * step]
      }
    }
  }

  // Signed distance to the board's edge (negative inside), by a two-pass chamfer transform.
  const INF = 1e9
  const dIn = new Float32Array(w * h), dOut = new Float32Array(w * h)
  for (let k = 0; k < w * h; k++) { dIn[k] = inside[k] ? INF : 0; dOut[k] = inside[k] ? 0 : INF }
  const chamfer = (d: Float32Array) => {
    const a = 1, b = Math.SQRT2
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i
      if (i > 0) d[k] = Math.min(d[k], d[k - 1] + a)
      if (j > 0) d[k] = Math.min(d[k], d[k - w] + a)
      if (i > 0 && j > 0) d[k] = Math.min(d[k], d[k - w - 1] + b)
      if (i < w - 1 && j > 0) d[k] = Math.min(d[k], d[k - w + 1] + b)
    }
    for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i
      if (i < w - 1) d[k] = Math.min(d[k], d[k + 1] + a)
      if (j < h - 1) d[k] = Math.min(d[k], d[k + w] + a)
      if (i < w - 1 && j < h - 1) d[k] = Math.min(d[k], d[k + w + 1] + b)
      if (i > 0 && j < h - 1) d[k] = Math.min(d[k], d[k + w - 1] + b)
    }
  }
  chamfer(dIn)
  chamfer(dOut)
  const data = new Uint8Array(w * h * 4)
  for (let k = 0; k < w * h; k++) {
    data[k * 4 + 1] = inside[k] * 255
    // Half a texel either side of the edge, in world units, mapped from [-1.5, 1.5] to [0, 255].
    const sd = (inside[k] ? -(dIn[k] - 0.5) : dOut[k] - 0.5) / RES
    data[k * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, sd / 3 + 0.5)))
  }
  const cover = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
  cover.magFilter = THREE.LinearFilter
  cover.minFilter = THREE.LinearMipmapLinearFilter
  cover.generateMipmaps = true
  cover.wrapS = cover.wrapT = THREE.ClampToEdgeWrapping
  cover.needsUpdate = true
  fogShared.uCloudCover.value = cover
  fogShared.uCloudRect.value.set(x0, z0, RES / w, RES / h)

  // The sheet itself: a grid over the board and the drape margin.
  const perUnit = quality === 'low' ? 5 : quality === 'medium' ? 7.5 : 8
  const W = layout.maxX - layout.minX + 2 * DRAPE, H = layout.maxZ - layout.minZ + 2 * DRAPE
  const geo = new THREE.PlaneGeometry(W, H, Math.ceil(W * perUnit), Math.ceil(H * perUnit))
  geo.rotateX(-Math.PI / 2)
  geo.translate(x0 + W / 2, 0, z0 + H / 2)
  geo.deleteAttribute('uv')
  geo.deleteAttribute('normal')

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    // The low tier draws a simpler cloud; medium (phones) keeps the crisp shading and self-shadow.
    defines: quality === 'low' ? { LITE: '' } : {},
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uCover: { value: null },
      uCoverRect: { value: new THREE.Vector4(x0, z0, RES / w, RES / h) },
      uBoard: { value: new THREE.Vector4(layout.minX, layout.minZ, layout.maxX, layout.maxZ) },
      uSunDir: { value: sunDir },
      uLit: { value: new THREE.Color('#FFF8F0') },
      uPeach: { value: new THREE.Color('#FFD8BE') },
      uShade: { value: new THREE.Color('#BDB2DE') },
      uDeep: { value: new THREE.Color('#A39AD0') },
      uGlow: { value: new THREE.Color(NATURE.sun) },
    }]),
    transparent: true,
    depthWrite: true,
    fog: true,
  })
  // Shared live uniforms (merge clones values, so hook these up by reference).
  mat.uniforms.uCover.value = cover
  mat.uniforms.uSunDir.value = sunDir
  mat.uniforms.uTime = shared.uTime
  mat.uniforms.uCloudOffset = shared.uCloudOffset
  mat.uniforms.uCloudStrength = shared.uCloudStrength
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'fog-clouds'
  mesh.frustumCulled = false
  // After the board and the sea, before the sparkles in the air.
  mesh.renderOrder = 3

  return {
    mesh,
    setExplored(explored) {
      for (let k = 0; k < w * h; k++) mask[k] = tileOf[k] < 0 ? 0 : 1 - explored[tileOf[k]]
      // Widen by DILATE (a separable max), then soften with two box blurs.
      maxFilter(mask, tmp, 1)
      maxFilter(tmp, mask, 0)
      boxBlur(mask, tmp, 1)
      boxBlur(tmp, mask, 0)
      boxBlur(mask, tmp, 1)
      boxBlur(tmp, mask, 0)
      for (let k = 0; k < w * h; k++) data[k * 4] = Math.round(mask[k] * 255)
      cover.needsUpdate = true
    },
    dispose() {
      geo.dispose()
      mat.dispose()
      if (fogShared.uCloudCover.value === cover) fogShared.uCloudCover.value = null
      cover.dispose()
    },
  }
}
