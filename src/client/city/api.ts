// Contract between the game UI and the city screen (src/client/city/). The UI opens CityScreen when
// the player goes into a city and owns the data; the screen only reports what the player chose.

import type { BuildingOrder, BuildingType, CityFocus, CityInterior } from '../../engine/city.ts'
import type { CityId, GameState, PlayerId } from '../../engine/types.ts'

export type { BuildingOrder, BuildingType, CityFocus, CityInterior }

/** What the city is building right now: a building on a plot, or a unit. `progress` and `cost` are in production. */
export type CityConstruction =
  | { building: BuildingType; plot: number; progress: number; cost: number }
  | { unit: string; progress: number; cost: number }
  | null

export interface CityScreenProps {
  state: GameState
  cityId: CityId
  interior: CityInterior
  /** The viewing player; only the owner can build or change focus. */
  me: PlayerId | null
  construction: CityConstruction
  /** Set the construction (a building on a plot), or cancel it with null. */
  onBuild(order: BuildingOrder | null): void
  onFocus(f: CityFocus): void
  /** Called after the exit transition has finished. */
  onClose(): void
}
