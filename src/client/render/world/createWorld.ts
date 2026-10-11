// SKELETON: a plain, working world so other parts can be built against it.
// The world agent replaces the look entirely (see ART.md); keep the World interface.

import * as THREE from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { hexCenter } from '../../../engine/hex.ts'
import type { Biome, GameMap, TileId } from '../../../engine/types.ts'
import type { World } from '../api.ts'

export const HEIGHT_STEP = 0.32

const BIOME_COLOR: Record<Biome, number> = {
  deep: 0x1d5b79, shallow: 0x3aa6b9, beach: 0xe8d8a8, grass: 0x8cbf5a, plains: 0xc9b86a,
  forest: 0x3f7d4a, hills: 0x9a8a6a, mountain: 0x8a8790, snow: 0xf2f4f7,
}

export function tileHeightY(map: GameMap, tile: TileId): number {
  return Math.max(map.tiles[tile].height, 1) * HEIGHT_STEP
}

export function createWorld(container: HTMLElement, map: GameMap): World {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight)
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xdfe8ec)
  const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 500)
  const span = hexCenter(map.width - 1, map.height - 1)
  const center = new THREE.Vector3(span.x / 2, 0, span.z / 2)
  camera.position.set(center.x, 22, center.z + 20)
  const controls = new MapControls(camera, renderer.domElement)
  controls.target.copy(center)
  controls.enableDamping = true
  controls.maxPolarAngle = Math.PI * 0.42
  controls.update()

  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.2))
  const sun = new THREE.DirectionalLight(0xffffff, 2)
  sun.position.set(10, 20, 8)
  scene.add(sun)

  const geo = new THREE.CylinderGeometry(1, 1, 1, 6)
  geo.translate(0, 0.5, 0)
  const mat = new THREE.MeshStandardMaterial({ flatShading: true })
  const mesh = new THREE.InstancedMesh(geo, mat, map.tiles.length)
  const m = new THREE.Matrix4()
  const color = new THREE.Color()
  for (const t of map.tiles) {
    const { x, z } = hexCenter(t.col, t.row)
    const h = tileHeightY(map, t.id)
    m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(0.98, h, 0.98))
    mesh.setMatrixAt(t.id, m)
    mesh.setColorAt(t.id, color.setHex(BIOME_COLOR[t.biome]))
  }
  scene.add(mesh)

  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const frameCbs = new Set<(dt: number, time: number) => void>()
  const clock = new THREE.Clock()
  let raf = 0
  const loop = () => {
    raf = requestAnimationFrame(loop)
    const dt = Math.min(clock.getDelta(), 0.1)
    controls.update()
    for (const cb of frameCbs) cb(dt, clock.elapsedTime)
    renderer.render(scene, camera)
  }
  loop()

  return {
    renderer, scene, camera, map,
    tileTop(tile) {
      const t = map.tiles[tile]
      const { x, z } = hexCenter(t.col, t.row)
      return new THREE.Vector3(x, tileHeightY(map, tile), z)
    },
    pick(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObject(mesh)[0]
      return hit?.instanceId ?? null
    },
    onFrame(cb) {
      frameCbs.add(cb)
      return () => frameCbs.delete(cb)
    },
    setCleared() {},
    focus(tile) {
      const p = this.tileTop(tile)
      const d = p.clone().sub(controls.target)
      controls.target.add(d)
      camera.position.add(d)
    },
    resize() {
      camera.aspect = container.clientWidth / container.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(container.clientWidth, container.clientHeight)
    },
    dispose() {
      cancelAnimationFrame(raf)
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
