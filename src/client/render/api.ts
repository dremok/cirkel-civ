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
  /** Top centre of a tile in world space: where a piece stands. Fog-aware: for a tile that is
   * unexplored under the current setFog it returns a point on the flat cloud surface (the same
   * height for every clouded tile, lying on top of the cloud sea), so nothing drawn there reveals
   * the hidden land; otherwise the real top. Re-read it after each setFog. */
  tileTop(tile: TileId): THREE.Vector3
  /** Tile under a client-space point (e.g. a pointer event), or null. Clouded tiles are picked by
   * the flat cloud surface, never by the hidden columns. */
  pick(clientX: number, clientY: number): TileId | null
  /** Register a per-frame callback (dt and elapsed time in seconds), called before rendering. Returns an unsubscribe. */
  onFrame(cb: (dt: number, time: number) => void): () => void
  /** Trees and props are removed on these tiles (cities stand there). */
  setCleared(tiles: TileId[]): void
  /** Move the camera target to a tile. With `{ zoom: 'unit' }` also come in to a distance where a
   * unit is comfortably large (about 48 CSS px tall); never zooms out. */
  focus(tile: TileId, animate: boolean, opts?: { zoom?: 'unit' | 'keep' }): void
  /** Call when the container changes size. */
  resize(): void
  dispose(): void
  // Optional extras (world agent):
  /** Current render quality tier (auto-detected, lowered automatically if frames are slow). */
  readonly quality?: WorldQuality
  /** Force a quality tier, or 'auto' to detect and adapt. */
  setQuality?(q: WorldQuality | 'auto'): void
  /** Return the camera to the default framing: the whole board, or with `around` a few hexes
   * around that tile (e.g. the player's capital; about 7 hexes across on a phone). The choice is
   * remembered across resizes; pass `around: null` to go back to the whole board. */
  home?(animate?: boolean, opts?: { around?: TileId | null }): void
  /** Screen areas covered by UI (CSS px from each edge of the canvas). Framing and focus centre
   * on the uncovered rest. Call whenever the HUD changes size. */
  setViewInsets?(insets: { top: number; bottom: number; left: number; right: number }): void
  /** Fog of war (one byte per TileId, 1 = yes). Unexplored tiles lie under a dreamy cloud sea;
   * explored tiles out of sight are softly veiled. `null` = no fog (everything clear). With
   * `animate`, newly explored tiles part their clouds and newly seen tiles lift their veil over
   * about 0.8 s (used tick by tick during replay). */
  setFog?(fog: { explored: Uint8Array; visible: Uint8Array } | null, opts?: { animate?: boolean }): void
}

/** low/medium render straight to the screen; high adds bloom, close-zoom tilt-shift and SMAA (the
 * default on strong desktop GPUs); ultra also adds screen-space ambient occlusion and is opt-in. */
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
