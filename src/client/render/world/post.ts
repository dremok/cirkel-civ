// Ultra tier only: N8AO ambient occlusion (soft contact shading under trees, props and pieces, in
// seams and at cliff feet), a gentle tilt-shift at close zoom, bloom, tone mapping and grade, SMAA. Other tiers render straight to the screen,
// where the baked occlusion in the terrain does most of this work for a fraction of the cost.

import * as THREE from 'three'
import { N8AOPostPass } from 'n8ao'
import { BloomEffect, Effect, EffectComposer, EffectPass, KernelSize, RenderPass, SMAAEffect, SMAAPreset, TiltShiftEffect } from 'postprocessing'
import { GRADE_GLSL } from './grade.ts'

/** Neutral tone mapping and the world's grade, identical to the direct path's CustomToneMapping. */
class GradeEffect extends Effect {
  constructor() {
    super('WorldGrade', /* glsl */ `
      vec3 neutralTM(vec3 color) {
        const float StartCompression = 0.8 - 0.04;
        const float Desaturation = 0.15;
        float x = min(color.r, min(color.g, color.b));
        float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
        color -= offset;
        float peak = max(color.r, max(color.g, color.b));
        if (peak < StartCompression) return color;
        float d = 1. - StartCompression;
        float newPeak = 1. - d * d / (peak + d - StartCompression);
        color *= newPeak / peak;
        float g = 1. - 1. / (Desaturation * (peak - newPeak) + 1.);
        return mix(color, vec3(newPeak), g);
      }
      ${GRADE_GLSL}
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(worldGrade(neutralTM(inputColor.rgb)), inputColor.a);
      }
    `)
  }
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 })
  composer.addPass(new RenderPass(scene, camera))
  const ao = new N8AOPostPass(scene, camera, size.x, size.y)
  ao.setQualityMode('Low')
  ao.configuration.halfRes = true
  ao.configuration.aoRadius = 0.32
  ao.configuration.distanceFalloff = 0.6
  ao.configuration.intensity = 1.3
  // Transparent things (sea, contact shadows) never occlude; skipping the extra pass saves a lot.
  ao.configuration.transparencyAware = false
  ao.configuration.color = new THREE.Color('#2E3A3A')
  ao.configuration.gammaCorrection = false
  composer.addPass(ao)
  // A very gentle tilt-shift, faded in only at close zoom (see setZoom): the miniature dream.
  const tilt = new TiltShiftEffect({ offset: 0.04, focusArea: 0.62, feather: 0.32, kernelSize: KernelSize.SMALL, resolutionScale: 0.5 })
  tilt.blendMode.opacity.value = 0
  const tiltPass = new EffectPass(camera, tilt)
  composer.addPass(tiltPass)
  // A gentle glow on the brightest highlights and water glints (no bloom soup).
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.82, luminanceSmoothing: 0.2, intensity: 0.55, radius: 0.7 })
  composer.addPass(new EffectPass(camera, bloom, new GradeEffect(), new SMAAEffect({ preset: SMAAPreset.HIGH })))
  return {
    /** Debug: the passes, for toggling while tuning. */
    passes: { ao, bloom, tilt },
    /** Camera distance to the target: the tilt-shift fades in below about 14 units. */
    setZoom(dist: number) {
      const k = 1 - THREE.MathUtils.smoothstep(dist, 9, 16)
      tilt.blendMode.opacity.value = k * 0.85
      tiltPass.enabled = k > 0.01
    },
    render(dt: number) {
      composer.render(dt)
    },
    setSize(w: number, h: number) {
      composer.setSize(w, h)
    },
    dispose() {
      composer.dispose()
    },
  }
}
