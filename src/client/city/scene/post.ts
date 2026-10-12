// High tier: N8AO ambient occlusion (soft contact shade under eaves, at wall feet, between stalls),
// a gentle tilt-shift at the screen edges for the miniature feel, a soft bloom on windows, lanterns
// and water glints, then the world's picture-book grade and SMAA. Lower tiers render straight to the
// screen with the same grade as three's custom tone mapping.

import * as THREE from 'three'
import { N8AOPostPass } from 'n8ao'
import { BloomEffect, Effect, EffectComposer, EffectPass, KernelSize, RenderPass, SMAAEffect, SMAAPreset, TiltShiftEffect } from 'postprocessing'
import { GRADE_GLSL } from '../../render/world/grade.ts'

/** Neutral tone mapping followed by the world's grade (same as the direct path's CustomToneMapping). */
class GradeEffect extends Effect {
  constructor() {
    super('CityGrade', /* glsl */ `
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

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: { tiltShift?: boolean } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 })
  composer.addPass(new RenderPass(scene, camera))
  const ao = new N8AOPostPass(scene, camera, size.x, size.y)
  ao.setQualityMode('Low')
  ao.configuration.halfRes = true
  ao.configuration.aoRadius = 0.3
  ao.configuration.distanceFalloff = 0.6
  ao.configuration.intensity = 1.8
  // transparent things (sea, smoke, ghosts) never occlude; skipping the extra passes saves a lot
  ao.configuration.transparencyAware = false
  ao.configuration.color = new THREE.Color('#2E3346')
  ao.configuration.gammaCorrection = false
  if (typeof location === 'undefined' || !location.search.includes('noao')) composer.addPass(ao)
  if (opts.tiltShift !== false) {
    const tilt = new TiltShiftEffect({ focusArea: 0.74, feather: 0.3, kernelSize: KernelSize.SMALL, offset: 0.03, resolutionScale: 0.5 })
    composer.addPass(new EffectPass(camera, tilt))
  }
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.8, luminanceSmoothing: 0.22, intensity: 0.7, radius: 0.62 })
  composer.addPass(new EffectPass(camera, bloom, new GradeEffect(), new SMAAEffect({ preset: SMAAPreset.HIGH })))
  return {
    render(dt: number) { composer.render(dt) },
    setSize(w: number, h: number) { composer.setSize(w, h) },
    dispose() { composer.dispose() },
  }
}
