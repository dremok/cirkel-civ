// GameView: units, cities, territory, overlays and the replay of a resolved turn, on top of the
// World. See ART.md ("Pieces") for the look and api.ts for the contract.
import * as THREE from 'three'
import type { GameState, PlayerId, TileId } from '../../engine/types.ts'
import type { CreateGameView, GameView, Selection, UnitPlan } from './api.ts'
import { CityLayer, PLAZA_Y } from './pieces/cities.ts'
import { colorIndexOf, makeBoard } from './pieces/common.ts'
import { Fx } from './pieces/fx.ts'
import { flutterTime } from './pieces/kit.ts'
import { Labels } from './pieces/labels.ts'
import { Overlays } from './pieces/overlays.ts'
import { type Timeline, buildReplay } from './pieces/replay.ts'
import { Territory, type TerritoryCity } from './pieces/territory.ts'
import { UnitLayer } from './pieces/units.ts'
import { createWorld } from './world/createWorld.ts'

export interface GameViewDebug {
  /** Multiplies playback time (0 freezes a replay, for screenshots). */
  timeScale: number
  /** Step a running replay to `t` seconds in fixed frames, then freeze it. */
  seek(t: number): void
  /** Current replay time in seconds (-1 when idle). */
  time(): number
  /** Smoothed CPU time of the pieces' per-frame work, in ms. */
  frameMs: number
}

export const createGameView: CreateGameView = (container, map, handlers) => {
  const world = createWorld(container, map)
  const board = makeBoard(world)
  const root = new THREE.Group()
  root.name = 'pieces'
  world.scene.add(root)

  const labels = new Labels(container)
  const fx = new Fx(root)
  const cities = new CityLayer(board, root, labels, fx)
  const standY = (tile: TileId) => board.tops[tile].y + (cities.cityAt(tile) ? PLAZA_Y : 0)
  const camDir = new THREE.Vector3()
  const faceCamera = () => {
    world.camera.getWorldDirection(camDir)
    return Math.atan2(-camDir.x, -camDir.z)
  }
  const units = new UnitLayer(board, root, standY, faceCamera)
  const territory = new Territory(board, root)
  const overlays = new Overlays(board, root, units, cities, labels)

  let current: GameState | null = null
  let me: PlayerId | null = null
  let clearedKey = ''
  let playback: { tl: Timeline; next: GameState; resolve: () => void } | null = null
  let pending: { state: GameState; me: PlayerId | null } | null = null
  const debug: GameViewDebug & { layers?: unknown } = { timeScale: 1, seek() {}, time: () => playback?.tl.t ?? -1, frameMs: 0 }

  const territoryFromCities = (animate: boolean) => {
    const list: TerritoryCity[] = [...cities.cities.values()].map((c) => ({
      id: c.id, owner: c.owner, colorIdx: c.colorIdx, tile: c.tile, founded: current?.cities.find((x) => x.id === c.id)?.founded ?? c.id,
    }))
    territory.set(list, animate)
    updateCleared(list.map((c) => c.tile))
  }

  const updateCleared = (tiles: TileId[]) => {
    const sorted = [...tiles].sort((a, b) => a - b)
    const key = sorted.join(',')
    if (key !== clearedKey) {
      clearedKey = key
      world.setCleared(sorted)
    }
  }

  const apply = (state: GameState, who: PlayerId | null) => {
    current = state
    me = who
    units.sync(state)
    cities.sync(state)
    territory.set(state.cities.map((c) => ({ id: c.id, owner: c.owner, colorIdx: colorIndexOf(state, c.owner), tile: c.tile, founded: c.founded })), false)
    updateCleared(state.cities.map((c) => c.tile))
    overlays.refresh()
  }

  const finishPlayback = (skip: boolean) => {
    const pb = playback
    if (!pb) return
    playback = null
    if (skip) {
      pb.tl.finish()
      fx.clear()
      labels.clearFloats()
    }
    apply(pb.next, me)
    if (pending) {
      apply(pending.state, pending.me)
      pending = null
    }
    overlays.setVisible(true)
    pb.resolve()
  }

  // ---------------------------------------------------------------------------------------------
  // Input: a click or tap is a press that did not travel (so panning never issues orders).

  const el = world.renderer.domElement
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const pickTile = (cx: number, cy: number): TileId | null => {
    const plaque = cities.plaqueAt(cx, cy)
    if (plaque) return plaque.tile
    const tile = world.pick(cx, cy)
    const rect = el.getBoundingClientRect()
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, world.camera)
    const ray = raycaster.ray
    let maxD = Infinity
    if (tile !== null && Math.abs(ray.direction.y) > 1e-6) maxD = (board.tops[tile].y - ray.origin.y) / ray.direction.y + 0.05
    const u = units.pick(ray, maxD)
    if (u) return u.tile
    const c = cities.pick(ray, maxD)
    if (c) return c.tile
    return tile
  }

  const active = new Set<number>()
  let press: { id: number; x: number; y: number; button: number; shift: boolean; moved: boolean; multi: boolean; touch: boolean } | null = null
  let hoverAt: { x: number; y: number } | null = null
  let hoverTile: TileId | null = null

  const onDown = (e: PointerEvent) => {
    active.add(e.pointerId)
    if (active.size === 1) {
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey, moved: false, multi: false, touch: e.pointerType !== 'mouse' }
    } else if (press) press.multi = true
  }
  const onMove = (e: PointerEvent) => {
    if (press && e.pointerId === press.id && !press.moved) {
      const lim = press.touch ? 10 : 5
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > lim) press.moved = true
    }
    if (e.pointerType === 'mouse' && active.size === 0) hoverAt = { x: e.clientX, y: e.clientY }
  }
  const onUp = (e: PointerEvent) => {
    const wasActive = active.delete(e.pointerId)
    if (!wasActive || !press || e.pointerId !== press.id) return
    const p = press
    press = null
    if (p.moved || p.multi) return
    const tile = pickTile(e.clientX, e.clientY)
    if (tile !== null) handlers.onTileClick(tile, { button: p.button, shift: p.shift })
  }
  const onCancel = (e: PointerEvent) => {
    active.delete(e.pointerId)
    if (press?.id === e.pointerId) press = null
  }
  const onLeave = () => {
    hoverAt = null
    if (hoverTile !== null) {
      hoverTile = null
      handlers.onTileHover(null)
    }
  }
  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerleave', onLeave)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)

  // ---------------------------------------------------------------------------------------------
  // Frame

  const advance = (dt: number) => {
    if (playback) {
      const done = playback.tl.step(dt)
      if (done) finishPlayback(false)
    }
    units.update(dt, world.camera)
    cities.update(dt)
    fx.update(dt)
    territory.update(dt)
    labels.step(dt)
  }
  debug.seek = (t: number) => {
    while (playback && playback.tl.t < t) advance(1 / 60)
    debug.timeScale = 0
  }

  debug.layers = { units, cities }
  const offFrame = world.onFrame((dt, time) => {
    const t0 = performance.now()
    if (hoverAt) {
      const t = pickTile(hoverAt.x, hoverAt.y)
      hoverAt = null
      if (t !== hoverTile) {
        hoverTile = t
        handlers.onTileHover(t)
      }
    }
    const pdt = playback ? dt * debug.timeScale : dt
    flutterTime.value = time
    advance(pdt)
    overlays.update(time)
    labels.layout(world.camera, el.clientWidth, el.clientHeight)
    debug.frameMs += (performance.now() - t0 - debug.frameMs) * 0.05
  })

  const view: GameView & { __debug: GameViewDebug } = {
    world,
    __debug: debug,
    setState(state: GameState, who: PlayerId | null) {
      if (playback) {
        pending = { state, me: who }
        return
      }
      apply(state, who)
    },
    setPlans(plans: UnitPlan[]) {
      overlays.setPlans(plans)
    },
    setSelection(sel: Selection) {
      overlays.setSelection(sel)
    },
    playEvents(prev, events, next, opts) {
      if (playback) finishPlayback(true)
      apply(prev, me)
      overlays.setVisible(false)
      const tl = buildReplay(
        { board, units, cities, fx, labels, territory: territoryFromCities },
        prev, events, next, opts?.speed ?? 0.5, opts?.onTick,
      )
      return new Promise<void>((resolve) => {
        playback = { tl, next, resolve }
      })
    },
    skipPlayback() {
      finishPlayback(true)
    },
    focusTile(tile, animate = true) {
      world.focus(tile, animate)
    },
    resize() {
      world.resize()
    },
    dispose() {
      if (playback) finishPlayback(true)
      offFrame()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      overlays.dispose()
      territory.dispose()
      units.dispose()
      cities.dispose()
      fx.dispose()
      labels.dispose()
      root.removeFromParent()
      world.dispose()
    },
  }
  return view
}
