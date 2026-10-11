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
  earth: '#8A6E52', strataRock: '#6E6259', base: '#4B4440',
  skyZenith: '#8FB8D8', skyHorizon: '#F3E3CC',
  sun: '#FFE2B8', skyFill: '#9BB8D6', groundBounce: '#C9B08A',
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
