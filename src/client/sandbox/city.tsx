// City screen sandbox: /sandbox/city.html?variant=capital|small|coastal|walled|mountain&seed=aurora
//   &quality=low|medium|high   &instant=1 (skip the entrance)   &zoom=<factor> &yaw=<rad> &pitch=<rad>
//   &select=<plot> (open a plot)   &choose=<building> (preview it there)   &me=<seat|none>
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/inter/index.css'
import '../styles/base.css'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { type BuildingType, type CityInterior, PLOTS, canPlace, newInterior, neighborInDir } from '../../engine/city.ts'
import { createGame, newCity } from '../../engine/game.ts'
import { distance } from '../../engine/hex.ts'
import type { City, GameState, TileId } from '../../engine/types.ts'
import { CityScreen } from '../city/index.ts'
import type { CityConstruction } from '../city/api.ts'
import type { Quality } from '../city/scene/scene.ts'

const q = new URLSearchParams(location.search)
const variant = q.get('variant') ?? 'capital'
const state: GameState = createGame({ seed: q.get('seed') ?? 'aurora', players: [{ name: 'Anna', kind: 'human' }, { name: 'Lars', kind: 'bot' }] })
const map = state.map

const water = (t: TileId | null) => t !== null && map.tiles[t].height < 2
const landOk = (t: number) => map.tiles[t].height >= 2 && map.tiles[t].biome !== 'mountain' && map.tiles[t].biome !== 'snow'
const farFromCities = (t: number) => state.cities.every((c) => distance(map, c.tile, t) >= 3)
const around = (t: number) => [0, 1, 2, 3, 4, 5].map((d) => neighborInDir(map, t, d))

function findTile(score: (t: number) => number): number {
  let best = -1, bestS = -Infinity
  for (const t of map.tiles) {
    if (!landOk(t.id) || !farFromCities(t.id)) continue
    if (around(t.id).some((n) => n === null)) continue
    const s = score(t.id)
    if (s > bestS) { bestS = s; best = t.id }
  }
  return best
}

function place(city: City, interior: CityInterior, wish: [BuildingType, number][]) {
  const order = [...PLOTS].sort((a, b) => a.ring - b.ring || a.index - b.index).map((p) => p.index)
  for (const [type, n] of wish) {
    let left = n
    for (const p of order) {
      if (left <= 0) break
      if (canPlace(map, city.tile, interior, type, p).ok) { interior.plots[p] = type; left-- }
    }
  }
}

let city: City
const interior = newInterior()
let construction: CityConstruction = null
const biomeCount = (t: number, bs: string[]) => around(t).filter((n) => n !== null && bs.includes(map.tiles[n].biome)).length

if (variant === 'small') {
  const tile = findTile((t) => biomeCount(t, ['grass', 'plains']) * 2 + biomeCount(t, ['forest']) - (water(neighborInDir(map, t, 0)) ? 1 : 0))
  city = newCity(state, 0, tile)
  state.cities.push(city)
  city.pop = 1
  place(city, interior, [['house', 1], ['farm', 1]])
  construction = { building: 'house', plot: 3, progress: 6, cost: 15 }
  if (interior.plots[3]) construction = null
} else if (variant === 'coastal') {
  const tile = findTile((t) => {
    const w = around(t).filter(water).length
    return (w >= 2 && w <= 3 ? 10 : 0) + biomeCount(t, ['grass', 'plains']) * 2 + biomeCount(t, ['forest', 'hills'])
  })
  city = newCity(state, 0, tile)
  state.cities.push(city)
  city.pop = 4
  place(city, interior, [['harbor', 2], ['house', 3], ['farm', 1], ['market', 1], ['workshop', 1], ['sawmill', 1]])
} else if (variant === 'mountain') {
  const tile = findTile((t) => biomeCount(t, ['mountain', 'snow']) * 3 + biomeCount(t, ['forest', 'hills']) + (around(t).some(water) ? 2 : 0))
  city = newCity(state, 0, tile)
  state.cities.push(city)
  city.pop = 3
  place(city, interior, [['sawmill', 2], ['house', 3], ['workshop', 2], ['harbor', 1], ['farm', 1], ['tower', 1]])
} else if (variant === 'walled') {
  const tile = findTile((t) => biomeCount(t, ['forest', 'hills']) * 2 + biomeCount(t, ['grass', 'plains']) + (around(t).some(water) ? -3 : 0))
  city = newCity(state, 0, tile)
  state.cities.push(city)
  city.pop = 4
  place(city, interior, [['wall', 6], ['tower', 2], ['house', 3], ['barracks', 1], ['sawmill', 1], ['workshop', 1], ['temple', 1]])
} else {
  city = state.cities.find((c) => c.owner === 0)!
  city.pop = 4
  city.food = 14
  // keep one inner plot for the barracks going up
  interior.plots[4] = 'barracks'
  place(city, interior, [['market', 1], ['workshop', 1], ['temple', 1], ['farm', 3], ['sawmill', 1], ['harbor', 1], ['wall', 2], ['tower', 1], ['house', 6]])
  interior.plots[4] = null
  construction = { building: 'barracks', plot: 4, progress: 18, cost: 30 }
}
city.prod = construction?.progress ?? 0
interior.focus = (q.get('focus') as CityInterior['focus']) ?? 'balance'

const me = q.get('me') === 'none' ? null : Number(q.get('me') ?? 0)
const view = {
  ...(q.has('zoom') ? { dist: Number(q.get('zoom')) } : {}),
  ...(q.has('yaw') ? { yaw: Number(q.get('yaw')) } : {}),
  ...(q.has('pitch') ? { pitch: Number(q.get('pitch')) } : {}),
  ...(q.has('x') ? { x: Number(q.get('x')) } : {}),
  ...(q.has('z') ? { z: Number(q.get('z')) } : {}),
}

function App() {
  const [open, setOpen] = useState(true)
  const [ints, setInts] = useState<CityInterior>(interior)
  const [cons, setCons] = useState<CityConstruction>(construction)
  if (!open) return <button id="reopen" onClick={() => setOpen(true)}>Enter {city.name}</button>
  return (
    <CityScreen
      state={state}
      cityId={city.id}
      interior={ints}
      me={me}
      construction={cons}
      onBuild={(o) => setCons(o ? { building: o.building, plot: o.plot, progress: city.prod, cost: { house: 15, farm: 20, sawmill: 20, workshop: 30, market: 35, harbor: 25, barracks: 30, temple: 40, tower: 25, wall: 20 }[o.building] } : null)}
      onFocus={(f) => setInts({ ...ints, focus: f })}
      onClose={() => setOpen(false)}
      sceneOptions={{ quality: (q.get('quality') as Quality | null) ?? 'auto', instant: q.has('instant'), view, tiltShift: q.get('tilt') !== '0' }}
    />
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

// screenshot helpers: open a plot and preview a building there
const sel = q.get('select')
if (sel !== null) {
  setTimeout(() => {
    const s = (window as unknown as { cityScene?: { onPick: ((p: number | null) => void) | null } }).cityScene
    s?.onPick?.(Number(sel))
    const choose = q.get('choose')
    if (choose) setTimeout(() => {
      const btn = [...document.querySelectorAll<HTMLButtonElement>('.cv-option')].find((b) => b.querySelector('.cv-option-name')?.textContent?.toLowerCase().startsWith(choose.toLowerCase()))
      btn?.click()
    }, 150)
  }, 400)
}
;(window as unknown as { cityState: unknown }).cityState = { state, city, interior }
if (q.has('debug')) console.warn(`plots ${interior.plots.map((b, i) => `${i}:${b ?? '-'}`).join(' ')} | tile ${city.tile} h${map.tiles[city.tile].height} ${map.tiles[city.tile].biome}`)
