// Audio sandbox: /sandbox/audio.html. Every sound, the buses, music, ambience and fake replays.
import { audio, type AmbienceKind, type MusicChoice, type ReplayAudio, type SfxSound, type UiSound, type VolumeBus } from '../audio/index.ts'
import { newInterior } from '../../engine/city.ts'
import type { City, GameEvent, GameState, Unit, UnitType } from '../../engine/types.ts'

const $ = (id: string) => document.getElementById(id)!

function button(parent: HTMLElement, label: string, onClick: () => void) {
  const b = document.createElement('button')
  b.textContent = label
  b.addEventListener('click', onClick)
  parent.append(b)
  return b
}

// --- status
const status = $('status')
const showStatus = () => {
  status.textContent = audio.unlocked ? `Audio running${audio.muted ? ' (muted)' : ''}.` : 'Locked: click anywhere to unlock.'
  $('mute').textContent = audio.muted ? 'Unmute' : 'Mute'
}
audio.subscribe(showStatus)
showStatus()
$('mute').addEventListener('click', () => audio.setMuted(!audio.muted))

// --- bus sliders
const sliders = $('sliders')
for (const bus of ['master', 'music', 'ambience', 'sfx', 'ui'] as VolumeBus[]) {
  const label = document.createElement('label')
  label.textContent = bus
  const input = document.createElement('input')
  input.type = 'range'
  input.min = '0'
  input.max = '1'
  input.step = '0.01'
  input.value = String(audio.volume(bus))
  const value = document.createElement('span')
  value.textContent = audio.volume(bus).toFixed(2)
  input.addEventListener('input', () => {
    audio.setVolume(bus, Number(input.value))
    value.textContent = Number(input.value).toFixed(2)
  })
  sliders.append(label, input, value)
}

// --- music and ambience (toggle groups)
function group<T extends string>(parent: HTMLElement, items: (T | null)[], set: (v: T | null) => void) {
  const buttons: HTMLButtonElement[] = []
  for (const item of items) {
    const b = button(parent, item ?? 'off', () => {
      set(item)
      for (const x of buttons) x.classList.toggle('on', x === b && item !== null)
    })
    buttons.push(b)
  }
}
group<MusicChoice>($('music'), ['planning', 'battle', 'city', 'game', null], (v) => audio.music(v))
button($('music'), 'victory sting', () => audio.sting('victory'))
button($('music'), 'defeat sting', () => audio.sting('defeat'))
group<AmbienceKind>($('amb'), ['world', 'sea', 'meadow', 'town', null], (v) => audio.ambience(v))

// --- one-shots
for (const name of ['tap', 'select', 'order', 'cancel', 'confirm', 'turn', 'tick', 'notify', 'page'] as UiSound[]) button($('ui'), name, () => audio.ui(name))
const pan = $('pan') as HTMLInputElement
pan.addEventListener('input', () => { $('panv').textContent = pan.value })
const sfxNames: SfxSound[] = ['march', 'hooves', 'clash', 'hit', 'volley', 'thuds', 'fall', 'cityHit', 'capture', 'halt', 'muster', 'found', 'built', 'grow', 'fail', 'explore', 'spotted']
for (const name of sfxNames) button($('sfx'), name, () => audio.sfx(name, { pan: Number(pan.value) }))

// --- fake replays on a 10-column board: tile = row * 10 + col, pan follows the column
const W = 10
const tile = (col: number, row: number) => row * W + col
const panOf = (t: number) => ((t % W) / (W - 1)) * 2 - 1

let nextId = 1
const unit = (owner: number, type: UnitType, at: number): Unit => ({ id: nextId++, owner, type, tile: at, hp: 10, stance: 'cautious', path: [], found: false, target: null })
const city = (owner: number, at: number, name: string): City => ({ id: nextId++, owner, name, tile: at, pop: 3, food: 0, prod: 0, hp: 20, walls: false, build: null, capital: false, founded: 1, interior: newInterior() })
const state = (units: Unit[], cities: City[] = []) => ({ units, cities }) as unknown as GameState

function skirmish() {
  const a = [unit(0, 'spear', tile(1, 4)), unit(0, 'spear', tile(1, 5)), unit(0, 'rider', tile(0, 3)), unit(0, 'archer', tile(0, 5))]
  const b = [unit(1, 'spear', tile(8, 4)), unit(1, 'spear', tile(8, 5)), unit(1, 'rider', tile(9, 3)), unit(1, 'archer', tile(9, 5))]
  const ev: GameEvent[] = []
  const pos = new Map([...a, ...b].map((u) => [u.id, u.tile]))
  const step = (t: number, u: Unit, dc: number) => {
    const from = pos.get(u.id)!
    const to = from + dc
    pos.set(u.id, to)
    ev.push({ t, kind: 'move', unit: u.id, from, to })
  }
  for (let t = 1; t <= 3; t++) {
    for (const u of a.slice(0, 2)) step(t, u, 1)
    for (const u of b.slice(0, 2)) step(t, u, -1)
    if (t <= 2) { step(t, a[2], 2); step(t, b[2], -2) }
  }
  ev.push({ t: 4, kind: 'clash', a: a[0].id, b: b[0].id, tile: tile(4, 4), dmgA: 3, dmgB: 4 })
  ev.push({ t: 4, kind: 'melee', attacker: a[2].id, target: { unit: b[1].id }, dmgToTarget: 5, dmgToAttacker: 2 })
  ev.push({ t: 5, kind: 'melee', attacker: a[1].id, target: { unit: b[1].id }, dmgToTarget: 4, dmgToAttacker: 1 })
  ev.push({ t: 5, kind: 'death', unit: b[1].id, tile: pos.get(b[1].id)! })
  ev.push({ t: 5, kind: 'halt', unit: b[2].id, reason: 'contact' })
  ev.push({ t: 7, kind: 'shot', from: { unit: a[3].id }, target: { unit: b[0].id }, dmg: 3 })
  ev.push({ t: 7, kind: 'shot', from: { unit: b[3].id }, target: { unit: a[0].id }, dmg: 3 })
  ev.push({ t: 8, kind: 'heal', unit: a[0].id, hp: 8 })
  return { ev, prev: state([...a, ...b]) }
}

function bigMarch() {
  const us: Unit[] = []
  for (let i = 0; i < 16; i++) us.push(unit(i % 2, i % 5 === 0 ? 'rider' : 'spear', tile(i % W, Math.floor(i / W) + 2)))
  const ev: GameEvent[] = []
  for (let t = 1; t <= 6; t++) for (const u of us) ev.push({ t, kind: 'move', unit: u.id, from: u.tile + (t - 1) * W, to: u.tile + t * W })
  return { ev, prev: state(us) }
}

function siege() {
  const c = city(1, tile(7, 4), 'Granby')
  const hold = city(1, tile(9, 7), 'Borg')
  const us = [unit(0, 'spear', tile(5, 4)), unit(0, 'rider', tile(5, 5)), unit(0, 'archer', tile(4, 4))]
  const ev: GameEvent[] = [
    { t: 1, kind: 'move', unit: us[0].id, from: tile(5, 4), to: tile(6, 4) },
    { t: 1, kind: 'move', unit: us[1].id, from: tile(5, 5), to: tile(6, 5) },
    { t: 2, kind: 'melee', attacker: us[0].id, target: { city: c.id }, dmgToTarget: 4, dmgToAttacker: 2 },
    { t: 3, kind: 'melee', attacker: us[1].id, target: { city: c.id }, dmgToTarget: 5, dmgToAttacker: 2 },
    { t: 4, kind: 'move', unit: us[0].id, from: tile(6, 4), to: tile(7, 4) },
    { t: 4, kind: 'capture', city: c.id, from: 1, to: 0, unit: us[0].id },
    { t: 7, kind: 'shot', from: { unit: us[2].id }, target: { unit: us[1].id }, dmg: 0 },
    { t: 8, kind: 'built', city: hold.id, item: { building: 'wall', plot: 9 } },
  ]
  return { ev, prev: state(us, [c, hold]) }
}

function economy() {
  const c = city(0, tile(3, 3), 'Ekby')
  const settler = unit(0, 'settler', tile(6, 6))
  const fresh = unit(0, 'spear', tile(3, 3))
  const founded = city(0, tile(6, 6), 'Nyby')
  const ev: GameEvent[] = [
    { t: 1, kind: 'move', unit: settler.id, from: tile(5, 6), to: tile(6, 6) },
    { t: 8, kind: 'found', city: founded, unit: settler.id },
    { t: 8, kind: 'built', city: c.id, item: { building: 'market', plot: 2 } },
    { t: 8, kind: 'spawn', unit: fresh, city: c.id },
    { t: 8, kind: 'grow', city: c.id, pop: 4 },
  ]
  return { ev, prev: state([settler], [c]) }
}

function scouting() {
  // a rider rides into the fog: a tile or two revealed per tick, an enemy spotted and lost again,
  // then a new city at the end of the turn reveals a wide circle
  const rider = unit(0, 'rider', tile(1, 5))
  const enemy = unit(1, 'spear', tile(7, 4))
  const ev: GameEvent[] = []
  for (let t = 1; t <= 6; t++) {
    ev.push({ t, kind: 'move', unit: rider.id, from: tile(t, 5), to: tile(t + 1, 5) })
    ev.push({ t, kind: 'explore', tiles: Array.from({ length: 1 + (t % 3) }, (_, i) => tile(t + 2, 3 + i)) })
  }
  ev.push({ t: 3, kind: 'spotted', unit: enemy })
  ev.push({ t: 4, kind: 'move', unit: enemy.id, from: tile(7, 4), to: tile(8, 4) })
  ev.push({ t: 6, kind: 'lost', unit: enemy.id, tile: tile(9, 4) })
  ev.push({ t: 8, kind: 'explore', tiles: Array.from({ length: 14 }, (_, i) => tile(i % W, 8 + (i % 2))) })
  return { ev, prev: state([rider]) }
}

function ending(won: boolean) {
  const { ev, prev } = skirmish()
  ev.push({ t: 8, kind: 'victory', winner: won ? 0 : 1 })
  return { ev, prev }
}

const ticks = $('ticks')
for (const t of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const i = document.createElement('i')
  i.title = `tick ${t}`
  i.dataset.t = String(t)
  ticks.append(i)
}
let current: ReplayAudio | null = null
let lights: ReturnType<typeof setTimeout>[] = []
function run(make: () => { ev: GameEvent[]; prev: GameState }) {
  current?.stop()
  for (const l of lights) clearTimeout(l)
  for (const i of ticks.children) i.classList.remove('lit')
  const { ev, prev } = make()
  current = audio.onEvents(ev, 0.5, { me: 0, prev, pan: panOf })
  lights = current.ticks.map(({ t, start }) => setTimeout(() => {
    for (const i of ticks.children) i.classList.toggle('lit', (i as HTMLElement).dataset.t === String(t))
  }, start * 1000))
  lights.push(setTimeout(() => { for (const i of ticks.children) i.classList.remove('lit') }, current.duration * 1000 + 300))
}
button($('replays'), 'Skirmish', () => run(skirmish))
button($('replays'), 'Big march (16 units)', () => run(bigMarch))
button($('replays'), 'Siege and capture', () => run(siege))
button($('replays'), 'Economy turn', () => run(economy))
button($('replays'), 'Scouting (fog)', () => run(scouting))
button($('replays'), 'Victory', () => run(() => ending(true)))
button($('replays'), 'Defeat', () => run(() => ending(false)))
button($('replays'), 'Stop', () => current?.stop())

;(window as unknown as { audio: unknown }).audio = audio
