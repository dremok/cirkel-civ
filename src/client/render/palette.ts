// The shared palette (see ART.md). Owned by the world agent; everyone imports from here.
import type { Biome } from '../../engine/types.ts'

export const BIOME: Record<Biome, { base: string; light: string; dark: string }> = {
  deep: { base: '#1F4E5F', light: '#2E6A78', dark: '#163A48' },
  shallow: { base: '#4FB3AE', light: '#7ED3C6', dark: '#3A8F8E' },
  beach: { base: '#E9D7AE', light: '#F3E6C6', dark: '#CDB98C' },
  grass: { base: '#9DBF6B', light: '#B9D47F', dark: '#6E9A4F' },
  plains: { base: '#D7C27A', light: '#E8D691', dark: '#B59F5E' },
  forest: { base: '#5E8A4A', light: '#6C9A45', dark: '#46703A' },
  hills: { base: '#A8A06B', light: '#BDB57F', dark: '#8F8B78' },
  mountain: { base: '#8C8597', light: '#A49EAE', dark: '#5F5A6B' },
  snow: { base: '#F6F3EE', light: '#FFFFFF', dark: '#C9D6E6' },
}

export const NATURE = {
  foam: '#F4F1E8',
  pine: '#2F5D46', pineLight: '#3F7656',
  broadleaf: '#4F7F3A', broadleafLight: '#6C9A45', amber: '#C8873A', rust: '#B5642F',
  rock: '#8F8B78',
  earth: '#A2825F', strataLight: '#978A7C', strataRock: '#857868', strataDeep: '#7A6E64', base: '#655C55',
  trunk: '#6B5040', wheat: '#E3CB7E', flowerA: '#F4EFE2', flowerB: '#F2CF5B', flowerC: '#D99AB8',
  pineTeal: '#2B5C55', pineTealLight: '#47806B', spruce: '#2E5A4A',
  oak: '#35764B', oakLight: '#539856', olive: '#58783C', oliveLight: '#7E9A4C',
  birch: '#8DB552', birchLight: '#B4CF6A', birchBark: '#EEE9DF', gold: '#D9A43A', goldLight: '#EEC65C',
  fern: '#5E9A4C', moss: '#74885A', mushroom: '#C8463A', mushroomCream: '#E9DCC4', log: '#7A5A44', reed: '#8FA65A', cattail: '#7B5638',
  heather: '#8A6A83', heatherLight: '#AC8CA6', heatherStem: '#6E7A4C',
  poppy: '#D9473A', lavender: '#A58BD0', buttercup: '#F2CC4A', daisy: '#F6F1E6', clover: '#5E9449',
  skyZenith: '#8FB8D8', skyHorizon: '#F3E3CC',
  sun: '#FFD7A0', skyFill: '#A6B2DE', groundBounce: '#E2C9C2',
}

/** Hue flavours per surface, mixed across the board by slow world-space noise (see terrain.ts). */
export const FLAVOURS = {
  meadow: ['#98C26A', '#A5BB7E', '#AEC765', '#85B568', '#9DC477'], // spring, sage, chartreuse, meadow, fresh
  plains: ['#E2C46E', '#D9C383', '#E6B678', '#D6B962'], // honey, wheat, apricot, straw
  forest: ['#4F8550', '#5D8A47', '#46795A', '#6A8A44'], // emerald, olive, teal moss, olive gold
  hills: ['#B0AD74', '#A3A77E', '#BCAE70', '#9DAA78'], // olive ochre, heath, gold, sage
  beach: ['#EEDDB7', '#EDCDB3', '#E8D6A9', '#F0D9C0'], // cream, rose, straw, peach
  rock: ['#968D9A', '#8C7C94', '#808799', '#9A8E88'], // warm grey, plum, slate, taupe
  strata: { turfShadow: '#5C7B44', ochre: '#C29659', rust: '#A9714F', umber: '#86664F', plum: '#7C6A6C', deep: '#665A5C', base: '#544B4F' },
  moss: '#7E9A55', lichen: '#B9B987',
}

export interface PlayerColor { name: string; base: string; light: string; dark: string }

export const PLAYERS: PlayerColor[] = [
  { name: 'Vermilion', base: '#E2543A', light: '#F28A6F', dark: '#A8341F' },
  { name: 'Kobolt', base: '#3460D9', light: '#6F92F0', dark: '#213E99' },
  { name: 'Saffran', base: '#F0A92E', light: '#F7C96E', dark: '#B57914' },
  { name: 'Plommon', base: '#A8458F', light: '#CC7BB7', dark: '#72285F' },
]

export const UI = {
  paper: '#F7F2E8', ink: '#2A2622', muted: '#7A6F62', rule: '#D9CFBF', danger: '#C2412D',
}
