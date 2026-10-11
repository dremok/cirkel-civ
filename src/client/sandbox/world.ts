// World sandbox: /sandbox/world.html?seed=aurora&seats=2
import { generateMap } from '../../engine/mapgen.ts'
import { createWorld } from '../render/world/createWorld.ts'

const q = new URLSearchParams(location.search)
const map = generateMap(q.get('seed') ?? 'aurora', Number(q.get('seats') ?? 2))
const world = createWorld(document.getElementById('app')!, map)
addEventListener('resize', () => world.resize())
;(window as unknown as { world: unknown }).world = world
