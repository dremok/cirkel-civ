// High tier: N8AO ambient occlusion (soft contact shade under eaves, at wall feet, between stalls),
// MSAA, tone mapping, then a gentle tilt-shift and vignette for the miniature feel. Lower tiers
// render straight to the screen.

import * as THREE from 'three'
import { N8AOPostPass } from 'n8ao'
import { EffectComposer, EffectPass, KernelSize, RenderPass, TiltShiftEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing'

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: { tiltShift?: boolean } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 4 })
  composer.addPass(new RenderPass(scene, camera))
  const ao = new N8AOPostPass(scene, camera, size.x, size.y)
  ao.setQualityMode('Low')
  ao.configuration.halfRes = true
  ao.configuration.aoRadius = 0.35
  ao.configuration.distanceFalloff = 0.6
  ao.configuration.intensity = 2.6
  ao.configuration.color = new THREE.Color('#2B2A3A')
  ao.configuration.gammaCorrection = false
  if (typeof location === 'undefined' || !location.search.includes('noao')) composer.addPass(ao)
  // one merged pass: blur the edges in linear light, then tone map, then the vignette
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL })
  const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.32 })
  const tilt = opts.tiltShift !== false ? new TiltShiftEffect({ focusArea: 0.74, feather: 0.3, kernelSize: KernelSize.SMALL, offset: 0.03 }) : null
  composer.addPass(tilt ? new EffectPass(camera, tilt, tone, vignette) : new EffectPass(camera, tone, vignette))
  return {
    render(dt: number) { composer.render(dt) },
    setSize(w: number, h: number) { composer.setSize(w, h) },
    dispose() { composer.dispose() },
  }
}
