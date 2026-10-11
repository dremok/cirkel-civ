// STUB: owned by the pieces agent, who replaces it with the real GameView (units, cities,
// overlays, replay). Shows the bare world so the UI can be built against it meanwhile.
import { createWorld } from './world/createWorld.ts'
import type { CreateGameView, GameView } from './api.ts'

export const createGameView: CreateGameView = (container, map, handlers) => {
  const world = createWorld(container, map)
  const el = world.renderer.domElement
  el.addEventListener('click', (e) => {
    const tile = world.pick(e.clientX, e.clientY)
    if (tile !== null) handlers.onTileClick(tile, { button: e.button, shift: e.shiftKey })
  })
  el.addEventListener('pointermove', (e) => handlers.onTileHover(world.pick(e.clientX, e.clientY)))
  const view: GameView = {
    world,
    setState() {},
    setPlans() {},
    setSelection() {},
    async playEvents() {},
    skipPlayback() {},
    focusTile(tile, animate = true) { world.focus(tile, animate) },
    resize() { world.resize() },
    dispose() { world.dispose() },
  }
  return view
}
