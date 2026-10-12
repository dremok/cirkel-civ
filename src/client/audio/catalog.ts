// The mix: which asset plays for each sound name, how loud, how much it varies, how many may
// overlap. Files are loudness-normalised per bus (tools/audio/process.py); balance them here.
// Gains were set from measured loudness so that, at full volume, music sits near -28 LUFS, the
// ambience near -31, battle impacts at -24..-28 (max momentary), footsteps near -33 and UI clicks
// near -31 (very short clicks a little lower: their peaks, not their loudness, are the limit).
// Tune by ear in /sandbox/audio.html.

import type { AssetId } from './assets.gen.ts'

export type UiSound = 'tap' | 'select' | 'order' | 'cancel' | 'confirm' | 'turn' | 'tick' | 'notify' | 'page'

export type SfxSound =
  | 'march' | 'hooves' | 'clash' | 'hit' | 'volley' | 'thuds' | 'fall' | 'cityHit' | 'capture' | 'halt'
  | 'muster' | 'found' | 'built' | 'grow' | 'fail' | 'explore' | 'spotted'

export type MusicTrack = 'planning' | 'battle' | 'city'
/** 'game' picks planning or battle music by itself, from how much fighting the recent turns had. */
export type MusicChoice = MusicTrack | 'game'

export type AmbienceKind = 'world' | 'sea' | 'meadow' | 'town'

export type Sting = 'victory' | 'defeat'

export interface SoundDef {
  asset: AssetId
  /** Linear gain on top of the bus. */
  gain: number
  /** Random pitch spread, in cents (+/-). */
  cents: number
  /** Most simultaneous voices of this sound; more are dropped (or the oldest is cut, if `steal`). */
  voices: number
  steal?: boolean
  /** Fewest seconds between two starts of this sound (default 0.03), across replays. */
  minGap?: number
  /** Duck music and ambience while it plays: depth (0..1 of the level kept) and hold seconds. */
  duck?: { depth: number; hold: number }
}

export const UI: Record<UiSound, SoundDef> = {
  tap: { asset: 'ui_tap', gain: 0.9, cents: 40, voices: 2, steal: true },
  select: { asset: 'ui_select', gain: 0.8, cents: 30, voices: 2, steal: true },
  order: { asset: 'ui_order', gain: 0.46, cents: 30, voices: 2, steal: true },
  cancel: { asset: 'ui_cancel', gain: 0.4, cents: 20, voices: 1, steal: true },
  confirm: { asset: 'ui_confirm', gain: 0.65, cents: 0, voices: 1, steal: true },
  turn: { asset: 'ui_turn', gain: 0.6, cents: 0, voices: 1, steal: true },
  tick: { asset: 'ui_tick', gain: 0.26, cents: 15, voices: 2, steal: true },
  notify: { asset: 'ui_notify', gain: 0.58, cents: 0, voices: 1, steal: true },
  page: { asset: 'ui_page', gain: 0.4, cents: 40, voices: 1, steal: true },
}

export const SFX: Record<SfxSound, SoundDef> = {
  march: { asset: 'march', gain: 0.5, cents: 120, voices: 4 },
  hooves: { asset: 'hooves', gain: 0.55, cents: 100, voices: 3 },
  clash: { asset: 'clash', gain: 0.7, cents: 80, voices: 3, duck: { depth: 0.6, hold: 0.5 } },
  hit: { asset: 'hit', gain: 0.56, cents: 120, voices: 4 },
  volley: { asset: 'volley', gain: 0.48, cents: 80, voices: 3 },
  thuds: { asset: 'thuds', gain: 0.42, cents: 100, voices: 3 },
  fall: { asset: 'fall', gain: 0.55, cents: 80, voices: 3 },
  cityHit: { asset: 'city_hit', gain: 0.75, cents: 80, voices: 2 },
  capture: { asset: 'capture', gain: 0.62, cents: 0, voices: 1, duck: { depth: 0.45, hold: 2.2 } },
  halt: { asset: 'halt', gain: 0.3, cents: 100, voices: 2 },
  muster: { asset: 'muster', gain: 0.58, cents: 40, voices: 2 },
  found: { asset: 'found', gain: 0.6, cents: 0, voices: 2, duck: { depth: 0.7, hold: 1.6 } },
  built: { asset: 'built', gain: 0.9, cents: 40, voices: 2 },
  grow: { asset: 'grow', gain: 0.47, cents: 60, voices: 2 },
  fail: { asset: 'fail', gain: 0.32, cents: 40, voices: 1 },
  // Fog of war: clouds parting is a breath under everything, a sighted enemy a distant call.
  explore: { asset: 'explore', gain: 0.32, cents: 150, voices: 1, minGap: 2 },
  spotted: { asset: 'spotted', gain: 0.42, cents: 60, voices: 1, minGap: 1.5, duck: { depth: 0.75, hold: 0.9 } },
}

export interface TrackDef {
  asset: AssetId
  /** Linear gain on top of the music bus. */
  gain: number
  /** Silence between plays, seconds [min, max]: the music comes and goes, the ambience carries. */
  rest: [number, number]
}

export const MUSIC: Record<MusicTrack, TrackDef> = {
  planning: { asset: 'music_planning', gain: 1, rest: [25, 50] },
  battle: { asset: 'music_battle', gain: 0.9, rest: [6, 14] },
  city: { asset: 'music_city', gain: 0.85, rest: [15, 35] },
}

export const STINGS: Record<Sting, { asset: AssetId; gain: number }> = {
  victory: { asset: 'sting_victory', gain: 0.9 },
  defeat: { asset: 'sting_defeat', gain: 0.9 },
}

/** Ambience beds are layers of loops. */
export const AMBIENCE: Record<AmbienceKind, [AssetId, number][]> = {
  world: [['amb_sea', 0.6], ['amb_meadow', 0.7]],
  sea: [['amb_sea', 1]],
  meadow: [['amb_meadow', 1]],
  town: [['amb_town', 1], ['amb_meadow', 0.3]],
}

/** Bus levels at volume 1. */
export const MIX = { master: 0.9, music: 0.45, ambience: 0.55, sfx: 0.8, ui: 0.6 }

export type VolumeBus = keyof typeof MIX
