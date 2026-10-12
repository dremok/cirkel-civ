// Entry point to the detailed city view (src/client/city/, SPEC.md §5b). The play screen registers
// itself as the opener; openCity is called from the city panel's "Enter city" button and on a
// double tap or double click on your own city.
import type { CityId } from '../../../engine/types.ts'

let opener: ((cityId: CityId) => void) | null = null

/** The play screen owns the city view. Returns an unregister function. */
export function setCityOpener(fn: (cityId: CityId) => void): () => void {
  opener = fn
  return () => {
    if (opener === fn) opener = null
  }
}

export function openCity(cityId: CityId): void {
  opener?.(cityId)
}
