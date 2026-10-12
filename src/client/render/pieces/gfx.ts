// Materials, canvas textures and instanced batches for the pieces layer.
import * as THREE from 'three'
import { UI } from '../palette.ts'

// ---------------------------------------------------------------------------------------------
// Canvas textures. "Tritone" textures are masks: R = team colour, G = ivory, B = ink, A = coverage.

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = false): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  draw(g)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.anisotropy = 4
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.needsUpdate = true
  return t
}

const TEAM = '#FF0000'
const IVORY = '#00FF00'
const INK = '#0000FF'

let texCache: ReturnType<typeof makeTextures> | null = null
export function textures() {
  return (texCache ??= makeTextures())
}

/** Atlas cells for the FX sheet (4 cells in a row). */
export const FX_CELL = { puff: 0, spark: 1, ring: 2, dust: 3 } as const
/** Atlas cells for the glyph sheet (4 cells in a row). */
export const GLYPH_CELL = { cautious: 0, aggressive: 1, hold: 2, halt: 3 } as const

function makeTextures() {
  const blob = canvasTexture(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    gr.addColorStop(0, 'rgba(255,255,255,1)')
    gr.addColorStop(0.45, 'rgba(255,255,255,0.75)')
    gr.addColorStop(0.75, 'rgba(255,255,255,0.25)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, 128, 128)
  })

  const fx = canvasTexture(512, 128, (g) => {
    // puff: soft round cloud
    let gr = g.createRadialGradient(64, 64, 0, 64, 64, 62)
    gr.addColorStop(0, 'rgba(255,255,255,0.95)')
    gr.addColorStop(0.5, 'rgba(255,255,255,0.6)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill()
    // spark: four-pointed star with a hot core
    g.save()
    g.translate(192, 64)
    gr = g.createRadialGradient(0, 0, 0, 0, 0, 60)
    gr.addColorStop(0, 'rgba(255,255,255,1)')
    gr.addColorStop(0.25, 'rgba(255,255,255,0.8)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const r = i % 2 === 0 ? 60 : 9
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    g.closePath(); g.fill()
    g.restore()
    // ring: soft thin ring
    g.save()
    g.translate(320, 64)
    g.lineWidth = 7
    g.strokeStyle = 'rgba(255,255,255,1)'
    g.shadowColor = 'rgba(255,255,255,0.9)'
    g.shadowBlur = 10
    g.beginPath(); g.arc(0, 0, 50, 0, Math.PI * 2); g.stroke()
    g.restore()
    // dust: lumpy cloud
    g.save()
    g.translate(448, 64)
    for (const [x, y, r] of [[-14, 6, 34], [16, 4, 30], [0, -10, 32], [6, 14, 26]] as const) {
      gr = g.createRadialGradient(x, y, 0, x, y, r)
      gr.addColorStop(0, 'rgba(255,255,255,0.7)')
      gr.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = gr
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
    }
    g.restore()
  })

  // Stance glyph badges (tritone): ink disc, ivory glyph, thin team ring.
  const glyphs = canvasTexture(512, 128, (g) => {
    const badge = (cx: number) => {
      g.fillStyle = TEAM
      g.beginPath(); g.arc(cx, 64, 60, 0, Math.PI * 2); g.fill()
      g.fillStyle = INK
      g.beginPath(); g.arc(cx, 64, 51, 0, Math.PI * 2); g.fill()
      g.strokeStyle = IVORY
      g.fillStyle = IVORY
      g.lineWidth = 9
      g.lineCap = 'round'
      g.lineJoin = 'round'
    }
    // eye (cautious)
    badge(64)
    g.beginPath()
    g.moveTo(30, 64); g.quadraticCurveTo(64, 30, 98, 64); g.quadraticCurveTo(64, 98, 30, 64); g.closePath()
    g.stroke()
    g.beginPath(); g.arc(64, 64, 10, 0, Math.PI * 2); g.fill()
    // double chevron (aggressive)
    badge(192)
    g.beginPath(); g.moveTo(166, 66); g.lineTo(192, 42); g.lineTo(218, 66); g.stroke()
    g.beginPath(); g.moveTo(166, 90); g.lineTo(192, 66); g.lineTo(218, 90); g.stroke()
    // shield (hold)
    badge(320)
    g.beginPath()
    g.moveTo(320, 32); g.lineTo(346, 42); g.lineTo(345, 66); g.quadraticCurveTo(342, 86, 320, 98)
    g.quadraticCurveTo(298, 86, 295, 66); g.lineTo(294, 42); g.closePath()
    g.stroke()
    // halt: exclamation chip
    badge(448)
    g.lineWidth = 12
    g.beginPath(); g.moveTo(448, 36); g.lineTo(448, 72); g.stroke()
    g.beginPath(); g.arc(448, 92, 7, 0, Math.PI * 2); g.fill()
  })

  // Decals (tritone), 4 cells: tick dot, move ring, selection ring, hollow dot.
  const decals = canvasTexture(512, 128, (g) => {
    // dot: ivory fill, team ring
    g.fillStyle = TEAM
    g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill()
    g.fillStyle = IVORY
    g.beginPath(); g.arc(64, 64, 38, 0, Math.PI * 2); g.fill()
    // move ring: team ring with ivory edges
    g.fillStyle = IVORY
    g.beginPath(); g.arc(192, 64, 62, 0, Math.PI * 2); g.arc(192, 64, 44, 0, Math.PI * 2, true); g.fill()
    g.fillStyle = TEAM
    g.beginPath(); g.arc(192, 64, 58, 0, Math.PI * 2); g.arc(192, 64, 48, 0, Math.PI * 2, true); g.fill()
    // selection ring: soft ivory glow with a crisp ivory line
    g.save()
    g.translate(320, 64)
    const gr = g.createRadialGradient(0, 0, 36, 0, 0, 63)
    gr.addColorStop(0, 'rgba(0,255,0,0)')
    gr.addColorStop(0.55, 'rgba(0,255,0,0.55)')
    gr.addColorStop(0.7, 'rgba(0,255,0,0.25)')
    gr.addColorStop(1, 'rgba(0,255,0,0)')
    g.fillStyle = gr
    g.beginPath(); g.arc(0, 0, 63, 0, Math.PI * 2); g.fill()
    g.lineWidth = 7
    g.strokeStyle = IVORY
    g.beginPath(); g.arc(0, 0, 49, 0, Math.PI * 2); g.stroke()
    g.lineWidth = 3
    g.setLineDash([10, 9])
    g.beginPath(); g.arc(0, 0, 58, 0, Math.PI * 2); g.stroke()
    g.setLineDash([])
    g.restore()
    // hollow dot (later turns)
    g.lineWidth = 16
    g.strokeStyle = TEAM
    g.beginPath(); g.arc(448, 64, 40, 0, Math.PI * 2); g.stroke()
  })

  return { blob, fx, glyphs, decals }
}

/** Crossed swords icon (colour texture) for attack markers. */
let swordsTex: THREE.CanvasTexture | null = null
export function swordsTexture(color: string): THREE.CanvasTexture {
  if (swordsTex) return swordsTex
  swordsTex = canvasTexture(256, 256, (g) => {
    g.translate(128, 128)
    const sword = (flip: number) => {
      g.save()
      g.scale(flip, 1)
      g.rotate(-Math.PI / 4)
      // blade
      g.beginPath()
      g.moveTo(-9, 34); g.lineTo(-9, -70); g.lineTo(0, -88); g.lineTo(9, -70); g.lineTo(9, 34); g.closePath()
      g.fill(); g.stroke()
      // guard
      g.beginPath(); g.roundRect(-30, 34, 60, 13, 6); g.fill(); g.stroke()
      // grip + pommel
      g.beginPath(); g.roundRect(-6, 47, 12, 30, 4); g.fill(); g.stroke()
      g.beginPath(); g.arc(0, 84, 9, 0, Math.PI * 2); g.fill(); g.stroke()
      g.restore()
    }
    g.lineJoin = 'round'
    // soft shadow and ivory outline under the red
    g.shadowColor = 'rgba(42,38,34,0.45)'
    g.shadowBlur = 14
    g.shadowOffsetY = 6
    g.fillStyle = UI.paper
    g.strokeStyle = UI.paper
    g.lineWidth = 16
    sword(1); sword(-1)
    g.shadowColor = 'transparent'
    g.fillStyle = color
    g.strokeStyle = color
    g.lineWidth = 2
    sword(1); sword(-1)
    // blade highlight
    g.globalAlpha = 0.35
    g.fillStyle = '#FFFFFF'
    for (const f of [1, -1]) {
      g.save(); g.scale(f, 1); g.rotate(-Math.PI / 4)
      g.beginPath(); g.moveTo(-2, 30); g.lineTo(-2, -68); g.lineTo(0, -80); g.lineTo(3, -68); g.lineTo(3, 30); g.closePath(); g.fill()
      g.restore()
    }
  }, true)
  return swordsTex
}

/** Volley target reticle (colour texture): a warm red ring with four ticks and a centre dot on ivory. */
let reticleTex: THREE.CanvasTexture | null = null
export function reticleTexture(): THREE.CanvasTexture {
  if (reticleTex) return reticleTex
  reticleTex = canvasTexture(256, 256, (g) => {
    g.translate(128, 128)
    const stroke = (w: number, color: string) => {
      g.lineWidth = w
      g.strokeStyle = color
      g.lineCap = 'round'
      g.beginPath(); g.arc(0, 0, 78, 0, Math.PI * 2); g.stroke()
      g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.stroke()
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        g.beginPath(); g.moveTo(Math.cos(a) * 92, Math.sin(a) * 92); g.lineTo(Math.cos(a) * 112, Math.sin(a) * 112); g.stroke()
      }
    }
    stroke(22, 'rgba(250,246,238,0.95)')
    stroke(9, '#D2432B')
    g.fillStyle = 'rgba(250,246,238,0.95)'
    g.beginPath(); g.arc(0, 0, 15, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#D2432B'
    g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill()
  }, true)
  return reticleTex
}

// ---------------------------------------------------------------------------------------------
// Shaders

const SPRITE_VS = /* glsl */ `
attribute float aAlpha;
#ifdef ATLAS
attribute vec4 aUv;
#endif
#ifdef ROT
attribute float aRot;
#endif
uniform float uDepthBias;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTeam;
void main() {
  vec2 uv0 = uv;
  #ifdef ATLAS
  uv0 = aUv.xy + uv * aUv.zw;
  #endif
  vUv = uv0;
  vAlpha = aAlpha;
  #ifdef USE_INSTANCING_COLOR
  vTeam = instanceColor;
  #else
  vTeam = vec3(1.0);
  #endif
  #ifdef BILLBOARD
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float sc = length(instanceMatrix[0].xyz);
  vec2 p = position.xy;
  #ifdef ROT
  float cr = cos(aRot); float sr = sin(aRot);
  p = mat2(cr, sr, -sr, cr) * p;
  #endif
  c.xy += p * sc;
  c.xyz += normalize(-c.xyz) * uDepthBias;
  gl_Position = projectionMatrix * c;
  #else
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  mv.xyz += normalize(-mv.xyz) * uDepthBias;
  gl_Position = projectionMatrix * mv;
  #endif
}
`

const SPRITE_FS = /* glsl */ `
uniform sampler2D map;
uniform vec3 uIvory;
uniform vec3 uInk;
uniform vec3 uTint;
uniform float opacity;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTeam;
void main() {
  vec4 t = texture2D(map, vUv);
  #ifdef TRITONE
  float s = t.r + t.g + t.b;
  vec3 col = (vTeam * t.r + uIvory * t.g + uInk * t.b) / max(s, 1e-3);
  #else
  vec3 col = uTint * vTeam * t.rgb;
  #endif
  float a = t.a * vAlpha * opacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export interface SpriteMatOpts {
  map: THREE.Texture
  billboard?: boolean
  tritone?: boolean
  atlas?: boolean
  rot?: boolean
  depthTest?: boolean
  depthFunc?: THREE.DepthModes
  depthBias?: number
  tint?: THREE.ColorRepresentation
  opacity?: number
  blending?: THREE.Blending
}

export function spriteMaterial(o: SpriteMatOpts): THREE.ShaderMaterial {
  const defines: Record<string, string> = {}
  if (o.billboard) defines.BILLBOARD = ''
  if (o.tritone) defines.TRITONE = ''
  if (o.atlas) defines.ATLAS = ''
  if (o.rot) defines.ROT = ''
  const m = new THREE.ShaderMaterial({
    defines,
    uniforms: {
      map: { value: o.map },
      uIvory: { value: new THREE.Color(UI.paper) },
      uInk: { value: new THREE.Color(UI.ink) },
      uTint: { value: new THREE.Color(o.tint ?? 0xffffff) },
      opacity: { value: o.opacity ?? 1 },
      uDepthBias: { value: o.depthBias ?? 0 },
    },
    vertexShader: SPRITE_VS,
    fragmentShader: SPRITE_FS,
    transparent: true,
    depthWrite: false,
    depthTest: o.depthTest ?? true,
    blending: o.blending ?? THREE.NormalBlending,
  })
  if (o.depthFunc !== undefined) m.depthFunc = o.depthFunc
  return m
}

/** A unit-size quad lying flat on the ground (XZ plane, facing up). */
export function flatQuad(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1)
  g.rotateX(-Math.PI / 2)
  return g
}

/** A unit-size quad in the XY plane (for billboards). */
export function billboardQuad(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1)
}

// Health arc: a ring strip; uv.x = 0..1 clockwise from the back (seen from above), uv.y = 0 inner .. 1 outer.
export function arcGeometry(rIn: number, rOut: number, seg = 72): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= seg; i++) {
    const t = i / seg
    const a = t * Math.PI * 2
    const sx = Math.sin(a)
    const sz = -Math.cos(a)
    pos.push(sx * rIn, 0, sz * rIn, sx * rOut, 0, sz * rOut)
    uv.push(t, 0, t, 1)
    if (i < seg) {
      const j = i * 2
      idx.push(j, j + 2, j + 1, j + 1, j + 2, j + 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

export function arcMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHi: { value: new THREE.Color('#FBF4E4') },
      uLow: { value: new THREE.Color('#E8553C') },
      uTrack: { value: new THREE.Color('#2A2622') },
      uOutline: { value: new THREE.Color('#2A2622') },
    },
    vertexShader: /* glsl */ `
      attribute float aHp;
      varying vec2 vUv;
      varying float vHp;
      void main() {
        vUv = uv; vHp = aHp;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHi; uniform vec3 uLow; uniform vec3 uTrack; uniform vec3 uOutline;
      varying vec2 vUv; varying float vHp;
      void main() {
        float y = vUv.y;
        float wy = fwidth(y) * 1.2;
        float band = smoothstep(0.0, wy, y) * (1.0 - smoothstep(1.0 - wy, 1.0, y));
        float core = smoothstep(0.26 - wy, 0.26 + wy, y) * (1.0 - smoothstep(0.74 - wy, 0.74 + wy, y));
        float wx = fwidth(vUv.x) * 1.2;
        float filled = 1.0 - smoothstep(vHp - wx, vHp + wx, vUv.x);
        vec3 fill = mix(uLow, uHi, smoothstep(0.3, 0.55, vHp));
        vec3 col = mix(uOutline, mix(uTrack, fill, filled), core);
        float a = band * mix(0.42, 0.95, filled);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  })
}

// Bands: territory borders and tile outlines. uv.x = distance along (world units), uv.y = 0 at the
// outer edge .. 1 at the inner edge of the band. A crisp line at the outer edge and a soft glow inwards.
export function bandMaterial(o: {
  color: THREE.ColorRepresentation
  glow?: THREE.ColorRepresentation
  lineFrac: number
  lineAlpha: number
  glowAlpha: number
  ink?: boolean
  depthFunc?: THREE.DepthModes
}): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    defines: o.ink ? { INK: '' } : {},
    uniforms: {
      uColor: { value: new THREE.Color(o.color) },
      uGlow: { value: new THREE.Color(o.glow ?? o.color) },
      uLineFrac: { value: o.lineFrac },
      uLineAlpha: { value: o.lineAlpha },
      uGlowAlpha: { value: o.glowAlpha },
      opacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uGlow; uniform float uLineFrac; uniform float uLineAlpha; uniform float uGlowAlpha; uniform float opacity;
      varying vec2 vUv;
      void main() {
        float y = vUv.y;
        float w = fwidth(y) * 1.1;
        float line = smoothstep(0.0, w + 0.02, y) * (1.0 - smoothstep(uLineFrac - w, uLineFrac + w, y));
        #ifdef INK
        float n = 0.86 + 0.14 * sin(vUv.x * 9.1) * sin(vUv.x * 3.7 + 1.3);
        line *= n;
        #endif
        float g = 1.0 - smoothstep(uLineFrac, 1.0, y);
        g = g * g;
        float a = max(line * uLineAlpha, g * uGlowAlpha);
        vec3 col = mix(uGlow, uColor, line);
        a *= opacity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  if (o.depthFunc !== undefined) m.depthFunc = o.depthFunc
  return m
}

// Path ribbons: uv.x = distance along (world units), uv.y = 0..1 across. aFade per vertex.
export function ribbonMaterial(o: { color: THREE.ColorRepresentation; opacity?: number; xray?: boolean; dash?: number; width?: number }): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(o.color) },
      uEdge: { value: new THREE.Color(UI.paper) },
      uTime: { value: 0 },
      uDash: { value: o.dash ?? 0.2 },
      uWidth: { value: o.width ?? 0.14 },
      opacity: { value: o.opacity ?? 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aFade;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        vUv = uv; vFade = aFade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uEdge; uniform float uTime; uniform float uDash; uniform float uWidth; uniform float opacity;
      varying vec2 vUv; varying float vFade;
      void main() {
        // rounded dashes flowing towards the destination, on a faint ivory underlay
        float across = (vUv.y - 0.5) * uWidth;
        float phase = vUv.x / uDash - uTime * 0.9;
        float px = (fract(phase) - 0.5) * uDash;
        float r = uWidth * 0.5;
        float halfLen = uDash * 0.2;
        float d = length(vec2(max(abs(px) - halfLen, 0.0), across)) - r * 0.9;
        float aa = fwidth(d) * 1.1;
        float dash = 1.0 - smoothstep(-aa, aa, d);
        float core = 1.0 - smoothstep(-aa, aa, d + r * 0.2);
        float under = 1.0 - smoothstep(r * 0.4 - aa, r * 0.4 + aa, abs(across));
        vec3 col = mix(uEdge, uColor, core);
        float a = max(dash, under * 0.3);
        col = mix(uEdge, col, dash);
        a *= vFade * opacity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  })
  if (o.xray) m.depthFunc = THREE.GreaterDepth
  return m
}

/** X-ray silhouette for pieces hidden behind terrain or trees: drawn only where something at least
 * `margin` world units in front covers it (so a figure never ghosts through itself). */
export function silhouetteMaterial(opacity = 0.42, margin = 0.75): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { opacity: { value: opacity } },
    vertexShader: /* glsl */ `
      attribute float aSil;
      varying float vSil;
      varying vec3 vCol;
      void main() {
        vSil = aSil;
        #ifdef USE_INSTANCING_COLOR
        vCol = instanceColor;
        #else
        vCol = vec3(1.0);
        #endif
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vec4 pushed = projectionMatrix * (mv + vec4(0.0, 0.0, ${margin.toFixed(3)}, 0.0));
        gl_Position.z = pushed.z / pushed.w * gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float opacity;
      varying float vSil;
      varying vec3 vCol;
      void main() {
        float a = opacity * vSil;
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(vCol, vec3(1.0), 0.18), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
  })
}

// ---------------------------------------------------------------------------------------------
// Instanced batches with slot allocation.

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)

export class Batch {
  readonly meshes: THREE.InstancedMesh[]
  private freeSlots: number[] = []
  private used = 0
  private dirtyM = false
  private dirtyC = false
  private extra: Map<string, THREE.InstancedBufferAttribute> = new Map()

  constructor(
    parent: THREE.Object3D,
    parts: { geo: THREE.BufferGeometry; mat: THREE.Material; shadow?: boolean; receive?: boolean; order?: number }[],
    readonly capacity: number,
    extras: Record<string, number> = {},
  ) {
    this.meshes = parts.map((p) => {
      const m = new THREE.InstancedMesh(p.geo, p.mat, capacity)
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3)
      m.instanceColor.setUsage(THREE.DynamicDrawUsage)
      m.count = 0
      m.frustumCulled = false
      m.castShadow = !!p.shadow
      m.receiveShadow = !!p.receive
      if (p.order !== undefined) m.renderOrder = p.order
      parent.add(m)
      return m
    })
    for (const [name, size] of Object.entries(extras)) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size)
      attr.setUsage(THREE.DynamicDrawUsage)
      this.extra.set(name, attr)
      for (const m of this.meshes) m.geometry.setAttribute(name, attr)
    }
  }

  alloc(): number {
    const s = this.freeSlots.length ? this.freeSlots.pop()! : this.used < this.capacity ? this.used++ : -1
    if (s < 0) return -1
    for (const m of this.meshes) m.count = this.used
    return s
  }

  release(slot: number): void {
    if (slot < 0) return
    for (const m of this.meshes) m.setMatrixAt(slot, ZERO)
    this.freeSlots.push(slot)
    this.dirtyM = true
  }

  setMatrix(slot: number, m: THREE.Matrix4): void {
    if (slot < 0) return
    for (const mesh of this.meshes) mesh.setMatrixAt(slot, m)
    this.dirtyM = true
  }

  setColor(slot: number, c: THREE.Color, mesh = -1): void {
    if (slot < 0) return
    if (mesh < 0) for (const m of this.meshes) m.setColorAt(slot, c)
    else this.meshes[mesh].setColorAt(slot, c)
    this.dirtyC = true
  }

  setExtra(name: string, slot: number, ...v: number[]): void {
    const a = this.extra.get(name)
    if (!a || slot < 0) return
    const arr = a.array as Float32Array
    for (let i = 0; i < v.length; i++) arr[slot * a.itemSize + i] = v[i]
    a.needsUpdate = true
  }

  commit(): void {
    if (this.dirtyM) for (const m of this.meshes) m.instanceMatrix.needsUpdate = true
    if (this.dirtyC) for (const m of this.meshes) if (m.instanceColor) m.instanceColor.needsUpdate = true
    this.dirtyM = this.dirtyC = false
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.removeFromParent()
      m.dispose()
    }
  }
}
