// Game audio. One shared engine; import { audio } and call it from anywhere in the client.
//
//   audio.unlock()                      also happens by itself on the first pointer/touch/key
//   audio.ui('tap' | 'select' | 'order' | 'cancel' | 'confirm' | 'turn' | 'tick' | 'notify' | 'page')
//   audio.sfx('clash', { pan, volume, delay })
//   audio.music('planning' | 'battle' | 'city' | 'game' | null)     'game' follows the fighting
//   audio.ambience('world' | 'sea' | 'meadow' | 'town' | null)
//   const s = audio.onEvents(events, secPerTick, { me, prev, pan })  then onTick: (t) => s.tick(t)
//   audio.sting('victory' | 'defeat')
//   audio.setVolume('master' | 'music' | 'ambience' | 'sfx' | 'ui', 0..1), audio.setMuted(b)

import { AudioEngine } from './engine.ts'

export const audio = new AudioEngine()

export type { AudioEngine, PlayOptions } from './engine.ts'
export type { AmbienceKind, MusicChoice, MusicTrack, SfxSound, Sting, UiSound, VolumeBus } from './catalog.ts'
export type { ReplayAudio, ReplayAudioOptions } from './replay.ts'
