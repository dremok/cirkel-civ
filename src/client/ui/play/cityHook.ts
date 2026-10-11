// Entry point to the detailed city view (src/client/city/, SPEC.md §5b). The play screen calls
// openCity from the city panel's "Enter city" button and on a double tap or double click on your
// own city. The city view is wired in here during integration; until then it does nothing.
import type { CityId } from '../../../engine/types.ts'

export function openCity(cityId: CityId): void {
  void cityId
}
