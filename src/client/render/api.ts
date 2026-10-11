// Contract between the UI (React), the world renderer (terrain/sky/water) and the pieces
// renderer (units, cities, overlays, replay). See ART.md for the look.

import type * as THREE from 'three'
import type { CityId, GameEvent, GameMap, GameState, PlayerId, Stance, Tick, TileId, UnitId } from '../../engine/types.ts'

// ---------------------------------------------------------------------------------------------
// World: owned by the world agent (src/client/render/world/). Knows nothing about game pieces.

export interface World {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly map: GameMap
  /** Top centre of a tile in world space: where a piece stands. */
  tileTop(tile: TileId): THREE.Vector3
  /** Tile under a client-space point (e.g. a pointer event), or null. */
  pick(clientX: number, clientY: number): TileId | null
  /** Register a per-frame callback (dt and elapsed time in seconds), called before rendering. Returns an unsubscribe. */
  onFrame(cb: (dt: number, time: number) => void): () => void
  /** Trees and props are removed on these tiles (cities stand there). */
  setCleared(tiles: TileId[]): void
  /** Move the camera target to a tile. */
  focus(tile: TileId, animate: boolean): void
  /** Call when the container changes size. */
  resize(): void
  dispose(): void
  // Optional extras (world agent):
  /** Current render quality tier (auto-detected, lowered automatically if frames are slow). */
  readonly quality?: WorldQuality
  /** Force a quality tier, or 'auto' to detect and adapt. */
  setQuality?(q: WorldQuality | 'auto'): void
  /** Return the camera to the default framing of the whole board. */
  home?(animate?: boolean): void
}

/** 'ultra' adds screen-space ambient occlusion; it is never picked automatically. */
export type WorldQuality = 'low' | 'medium' | 'high' | 'ultra'

// ---------------------------------------------------------------------------------------------
// GameView: owned by the pieces agent (src/client/render/index.ts + pieces/). Used by the UI.

export interface PlanStep {
  tile: TileId
  turn: number // 0 = this turn
  tick: number // 1..6, when the unit enters the tile
}

export interface UnitPlan {
  unit: UnitId
  steps: PlanStep[]
  kind: 'move' | 'attack' | 'found'
  stance: Stance
  /** Archers: preferred volley target tile (a reticle with a dashed arc from where the archer ends up). Steps may be empty. */
  target?: TileId | null
}

export interface Selection {
  unit: UnitId | null
  city: CityId | null
  /** Tiles reachable this turn by the selected unit (soft highlight). */
  reachable: TileId[]
  /** Path preview under the pointer while choosing a destination. */
  preview: { steps: PlanStep[]; kind: 'move' | 'attack' | 'found' } | null
  /** Hovered tile (subtle outline). */
  hover: TileId | null
}

export interface ViewHandlers {
  onTileClick(tile: TileId, info: { button: number; shift: boolean }): void
  onTileHover(tile: TileId | null): void
}

export interface PlaybackOptions {
  /** Seconds per tick at speed 1. */
  speed?: number
  onTick?(t: Tick): void
}

export interface GameView {
  readonly world: World
  /** Show a state as-is (no animation). `me` decides whose plans/overlays are shown. */
  setState(state: GameState, me: PlayerId | null): void
  /** My units' planned paths for this turn and beyond. */
  setPlans(plans: UnitPlan[]): void
  setSelection(sel: Selection): void
  /** Animate a resolved turn from `prev` through `events` to `next`. Resolves when done. */
  playEvents(prev: GameState, events: GameEvent[], next: GameState, opts?: PlaybackOptions): Promise<void>
  /** Jump to the end of a running playback. */
  skipPlayback(): void
  focusTile(tile: TileId, animate?: boolean): void
  resize(): void
  dispose(): void
}

export type CreateGameView = (container: HTMLElement, map: GameMap, handlers: ViewHandlers) => GameView
