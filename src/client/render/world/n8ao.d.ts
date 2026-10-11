// Minimal types for n8ao (ships without declarations).
declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three'
  import { Pass } from 'postprocessing'
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    configuration: {
      aoRadius: number
      distanceFalloff: number
      intensity: number
      color: Color
      halfRes: boolean
      depthAwareUpsampling: boolean
      gammaCorrection: boolean
      screenSpaceRadius: boolean
      transparencyAware: boolean
      accumulate: boolean
      aoSamples: number
      denoiseSamples: number
      denoiseRadius: number
      biasOffset: number
      biasMultiplier: number
    }
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void
    setSize(width: number, height: number): void
    dispose(): void
  }
}
