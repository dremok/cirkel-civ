// A few birds wheeling slowly over the board, flapping and gliding.

import * as THREE from 'three'
import type { Layout } from './layout.ts'
import { shared } from './shading.ts'

interface Bird { cx: number; cz: number; rx: number; rz: number; y: number; speed: number; phase: number; lag: number }

function birdGeometry(): THREE.BufferGeometry {
  // Body along +z (head forward), wings out along ±x. Attribute `wing` = distance out along the wing.
  const pos = [
    // left wing (two tris)
    0, 0, 0.06, -0.5, 0.02, -0.02, 0, 0, -0.06,
    -0.5, 0.02, -0.02, -0.2, 0, -0.1, 0, 0, -0.06,
    // right wing
    0, 0, 0.06, 0, 0, -0.06, 0.5, 0.02, -0.02,
    0.5, 0.02, -0.02, 0, 0, -0.06, 0.2, 0, -0.1,
    // body (thin diamond)
    0, 0.02, 0.2, -0.04, 0, 0, 0.04, 0, 0,
    0.04, 0, 0, -0.04, 0, 0, 0, -0.02, -0.22,
  ]
  const wing = pos.filter((_, i) => i % 3 === 0).map((x) => Math.abs(x))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('wing', new THREE.Float32BufferAttribute(wing, 1))
  g.computeVertexNormals()
  return g
}

const FLAP = /* glsl */ `
  float wingT = uTime * 7.0 + aPhase * 6.2831;
  float glide = smoothstep(-0.2, 0.6, sin(uTime * 0.6 + aPhase * 11.0));
  transformed.y += sin(wingT) * wing * 0.55 * glide + wing * 0.12;
`

export function buildBirds(layout: Layout, count: number) {
  const geo = birdGeometry()
  const phases = new Float32Array(count)
  for (let i = 0; i < count; i++) phases[i] = (i * 0.618) % 1
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1))
  const inject = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = shared.uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float wing;\nattribute float aPhase;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FLAP}`)
  }
  const mat = new THREE.MeshStandardMaterial({ color: '#3E4248', roughness: 0.9, side: THREE.DoubleSide })
  mat.onBeforeCompile = inject
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })
  depth.onBeforeCompile = inject
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.customDepthMaterial = depth
  // Crisp bird shadows read as dark slashes on the tiles up close: birds cast none.
  mesh.castShadow = false
  mesh.frustumCulled = false
  mesh.name = 'birds'

  const cx = (layout.minX + layout.maxX) / 2, cz = (layout.minZ + layout.maxZ) / 2
  const w = layout.maxX - layout.minX, d = layout.maxZ - layout.minZ
  const birds: Bird[] = []
  for (let i = 0; i < count; i++) {
    const flock = i < 3
    birds.push({
      cx: cx + (flock ? -w * 0.12 : ((i * 0.37) % 1 - 0.5) * w * 0.5),
      cz: cz + (flock ? d * 0.05 : ((i * 0.71) % 1 - 0.5) * d * 0.5),
      rx: flock ? w * 0.3 : w * (0.12 + ((i * 0.29) % 1) * 0.15),
      rz: flock ? d * 0.26 : d * (0.12 + ((i * 0.53) % 1) * 0.15),
      y: flock ? 3.6 + i * 0.12 : 3.2 + ((i * 0.41) % 1) * 1.6,
      speed: (flock ? 0.05 : 0.04 + ((i * 0.17) % 1) * 0.03) * (i % 2 === 0 || flock ? 1 : -1),
      phase: flock ? 0 : i * 1.7,
      lag: flock ? i * 0.035 : 0,
    })
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(0.32, 0.32, 0.32)
  const e = new THREE.Euler()

  function update(time: number) {
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i]
      const a = time * b.speed + b.phase - b.lag * Math.sign(b.speed)
      const ox = i < 3 ? (i - 1) * 0.35 : 0
      p.set(b.cx + Math.cos(a) * b.rx + ox, b.y + Math.sin(time * 0.5 + i) * 0.15, b.cz + Math.sin(a) * b.rz + Math.abs(ox) * 0.6)
      // Heading along the path tangent, banking into the turn.
      const tx = -Math.sin(a) * b.rx * Math.sign(b.speed), tz = Math.cos(a) * b.rz * Math.sign(b.speed)
      e.set(0, Math.atan2(tx, tz), 0.28 * Math.sign(b.speed), 'YXZ')
      q.setFromEuler(e)
      m.compose(p, q, s)
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  return { mesh, update, dispose() { geo.dispose(); mat.dispose(); depth.dispose(); mesh.dispose() } }
}
