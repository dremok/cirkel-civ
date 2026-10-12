// The game's vocabulary (see SPEC.md).
import { BUILDINGS } from '../../engine/index.ts'
import type { Biome, BuildItem, Stance, UnitType } from '../../engine/types.ts'

export const UNIT_NAME: Record<UnitType, string> = {
  spear: 'Spearman',
  archer: 'Archer',
  rider: 'Rider',
  settler: 'Settler',
}

/** Lower case, for use inside sentences. */
export const unitNoun = (t: UnitType) => UNIT_NAME[t].toLowerCase()

/** "a spearman", "an archer". */
export const withArticle = (noun: string) => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`

/** With soft hyphens, for narrow buttons. */
export const UNIT_SHORT: Record<UnitType, string> = {
  spear: 'Spear­man',
  archer: 'Archer',
  rider: 'Rider',
  settler: 'Settler',
}

/** "Spearman", or the building's name ("Farm"). */
export const buildName = (item: BuildItem) => (typeof item === 'string' ? UNIT_NAME[item] : BUILDINGS[item.building].name)

export const STANCE_NAME: Record<Stance, string> = {
  cautious: 'Cautious',
  aggressive: 'Aggressive',
  hold: 'Hold',
}

export const STANCE_HINT: Record<Stance, string> = {
  cautious: 'Follows its path but stops when an enemy comes close.',
  aggressive: 'Looks for a fight and attacks the weakest enemy next to it.',
  hold: 'Stays put with +50% defense.',
}

export const ARCHER_HOLD_HINT = 'Stays put, keeps watch and shoots the first enemy in range.'

export const BIOME_NAME: Record<Biome, string> = {
  deep: 'Deep sea',
  shallow: 'Shallows',
  beach: 'Beach',
  grass: 'Grassland',
  plains: 'Plains',
  forest: 'Forest',
  hills: 'Hills',
  mountain: 'Mountains',
  snow: 'Snow',
}

/** "Anna" -> "Anna's". */
export const possessive = (name: string) => `${name}’s`

export const turnsWord = (n: number) => (n === 1 ? '1 turn' : `${n} turns`)

/** "Tap" on touch screens, "Click" with a mouse. */
export const tapVerb = (): string => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click')

export const helpLines = (): string[] => {
  const v = tapVerb()
  return [
    `${v} a unit, then a tile, to give it a path.`,
    `Everyone plans at the same time, in secret. ${v} Ready when you are done.`,
    'When everyone is ready, the turn plays out in six ticks. Faster units get there first.',
    'A unit’s stance decides what it does when something unexpected happens.',
    `${v} a city to choose what it builds.`,
    'Take every rival city, or have the highest score after 60 turns.',
  ]
}

/** Names of the seat colours (palette.ts order). */
export const COLOR_NAME = ['Vermilion', 'Cobalt', 'Saffron', 'Plum']

/** "Anna", "Anna and Lars", "Anna, Lars and Eva". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const NAME_A = ['Amber', 'Quiet', 'Swift', 'Bright', 'Silver', 'Copper', 'Gentle', 'Bold', 'Misty', 'Golden', 'Wild', 'Patient']
const NAME_B = ['Fox', 'Heron', 'Otter', 'Lynx', 'Raven', 'Badger', 'Hare', 'Owl', 'Stag', 'Wren', 'Falcon', 'Marten']

/** A friendly stand-in for players who never typed a name: "Amber Fox". */
export function friendlyName(): string {
  const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)]
  return `${pick(NAME_A)} ${pick(NAME_B)}`
}
