// Ultra tier only: N8AO ambient occlusion (soft contact shading under trees, props and pieces, in
// seams and at cliff feet), SMAA, then tone mapping. Other tiers render straight to the screen,
// where the baked occlusion in the terrain does most of this work for a fraction of the cost.

import * as THREE from 'three'
import { N8AOPostPass } from 'n8ao'
import { Effect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset } from 'postprocessing'
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
  ao.configuration.aoRadius = 0.7
  ao.configuration.distanceFalloff = 1.0
  ao.configuration.intensity = 3.2
  ao.configuration.color = new THREE.Color('#2B2A3A')
  ao.configuration.gammaCorrection = false
  composer.addPass(ao)
  composer.addPass(new EffectPass(camera, new GradeEffect(), new SMAAEffect({ preset: SMAAPreset.HIGH })))
  return {
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
