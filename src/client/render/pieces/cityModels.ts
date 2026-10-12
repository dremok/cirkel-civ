// Map-scale city buildings. Each builder makes one model in tile units (hex circumradius 1),
// standing on y = 0 with its front (door) facing +z. Plaster is `wall` paint (each instance has its
// own colour), roofs, banners and awnings are `team` paint, windows glow. The building language
// follows the city screen (src/client/city/scene): warm plaster, timber, falu-red barns, stone.
import * as THREE from 'three'
import { Kit, type Model, box, cone, cyl, dome, flat, gableEnd, gableRoof, hipRoof, lathe, slab, sphere, torus } from './kit.ts'

export const C = {
  // cream, limewash, ochre, deep ochre, rose, blush, sky-washed white, sage-white, warm stone
  plaster: ['#F4ECDD', '#F6F1E7', '#E9C88E', '#DDB273', '#EBC4B6', '#F1D6C8', '#E3EAEE', '#DCE3CF', '#E8DACA'],
  trim: '#F7F1E6',
  timber: '#7E5236',
  timberDark: '#5E3D29',
  boards: '#9A6B45',
  boardsLight: '#B88A5C',
  falu: '#9E3C2C',
  tar: '#5E4636',
  stone: '#D4C9B3',
  stoneLight: '#E3DAC6',
  stoneDark: '#AFA28A',
  granite: '#BDB6AA',
  door: '#6A4329',
  chimney: '#B7ADA1',
  brick: '#A65E44',
  iron: '#4A4B50',
  straw: '#E1C67C',
  strawDark: '#BFA05A',
  soil: '#8A6A4C',
  soilDark: '#735740',
  gravel: '#DDCBA4',
  lawn: '#8FBB5C',
  flag: '#E9DCC0',
  flagDark: '#D5C39F',
  wheat: '#E2C064',
  wheatGreen: '#B8C566',
  greens: '#7FAE4E',
  greensDark: '#5E8F3E',
  leaf: ['#6E9A4F', '#84AE57', '#5E8A4A', '#9BBF63'],
  blossom: ['#F2B8C6', '#E99AB0', '#F7D3DC'],
  flowers: ['#E2543A', '#F0A92E', '#B48BD6', '#F4F1E8', '#E77FA0'],
  fruit: ['#E8913A', '#C8402F', '#7FAE4E', '#E6C34A', '#B24A6A'],
  gold: '#D9AE4E',
  water: '#4FA9A6',
  glass: '#FFE7B0',
  lantern: '#FFD08A',
  forge: '#FF9C52',
  rope: '#C8B48C',
  terracotta: '#C2643F',
  slate: '#6E7686',
  linen: '#F3EADB',
}

// ---------------------------------------------------------------------------------------------
// Parts

function footing(k: Kit, w: number, d: number, h = 0.016) {
  k.add(box(w + 0.012, h, d + 0.012), C.stoneDark, { p: [0, h / 2, 0] })
}

/** A glowing window on a wall facing +z in the current frame, with an ivory frame and a sill. */
function win(k: Kit, x: number, y: number, z: number, rotY: number, w = 0.022, h = 0.028, shutters = false) {
  k.group({ p: [x, y, z], r: [0, rotY, 0] }, () => {
    k.add(box(w + 0.008, h + 0.008, 0.004), C.trim, { p: [0, 0, 0.001] })
    k.glow(box(w, h, 0.004), C.glass, { p: [0, 0, 0.003] })
    k.add(box(0.003, h, 0.005), C.trim, { p: [0, 0, 0.004] })
    k.add(box(w + 0.014, 0.005, 0.01), C.trim, { p: [0, -h / 2 - 0.004, 0.004] })
    if (shutters) for (const sx of [-1, 1]) k.teamDark(box(w * 0.55, h + 0.004, 0.004), 1, { p: [sx * (w * 0.78 + 0.004), 0, 0.003] })
  })
}

function door(k: Kit, x: number, z: number, rotY: number, w = 0.034, h = 0.05, color: string | 'team' = C.door) {
  k.group({ p: [x, 0, z], r: [0, rotY, 0] }, () => {
    k.add(box(w + 0.01, h + 0.006, 0.004), C.trim, { p: [0, h / 2 + 0.014, 0.001] })
    if (color === 'team') k.teamDark(box(w, h, 0.006), 1, { p: [0, h / 2 + 0.014, 0.003] })
    else k.add(box(w, h, 0.006), color, { p: [0, h / 2 + 0.014, 0.003] })
    k.add(box(w + 0.016, 0.008, 0.016), C.stoneDark, { p: [0, 0.006, 0.008] })
  })
}

function flowerBox(k: Kit, x: number, y: number, z: number, rotY: number, seed: number) {
  k.group({ p: [x, y, z], r: [0, rotY, 0] }, () => {
    k.add(box(0.032, 0.008, 0.01), C.boards, { p: [0, 0, 0.008] })
    for (let i = 0; i < 4; i++) k.add(sphere(0.0055, 5, 4), C.flowers[(seed + i) % C.flowers.length], { p: [-0.012 + i * 0.008, 0.007, 0.009] })
  })
}

function chimney(k: Kit, x: number, z: number, top: number, base: number, color = C.chimney) {
  k.add(box(0.026, top - base, 0.026), color, { p: [x, (top + base) / 2, z] })
  k.add(box(0.032, 0.007, 0.032), C.stoneDark, { p: [x, top, z] })
  k.anchor('chimney', [x, top + 0.008, z])
}

/** Walls, gable ends and roof of a gabled house (ridge along x). Returns the roof apex height. */
function gabled(k: Kit, w: number, d: number, h: number, roofH: number, o: { over?: number; wallShade?: number } = {}) {
  k.wall(box(w, h, d), o.wallShade ?? 1, { p: [0, h / 2 + 0.012, 0] })
  for (const sx of [-1, 1]) k.wall(gableEnd(d, roofH, 0.004), o.wallShade ?? 1, { p: [sx * (w / 2 - 0.002), h + 0.012, 0] })
  for (const g of gableRoof(w, d, roofH, 0.011, o.over ?? 0.016)) k.team(g, 1, { p: [0, h + 0.012, 0], mottle: 0.55 })
  k.teamDark(box(w + 2 * (o.over ?? 0.016) + 0.004, 0.011, 0.012), 1, { p: [0, h + 0.012 + roofH + 0.006, 0] })
  // ivory barge boards along the gables
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const ang = Math.atan2(roofH, d / 2)
    const len = Math.hypot(d / 2, roofH) + 0.012
    k.add(box(0.005, 0.008, len), C.trim, { p: [sx * (w / 2 + (o.over ?? 0.016) + 0.002), h + 0.012 + roofH / 2 + 0.004, sz * d / 4], r: [sz * ang, 0, 0] })
  }
  return h + 0.012 + roofH
}

/** Dark half-timbering on the four faces of a w x d x h box standing at y0. */
function timbering(k: Kit, w: number, d: number, y0: number, h: number) {
  const t = 0.006
  for (const sz of [-1, 1]) {
    const z = sz * (d / 2 + 0.002)
    for (const fx of [-0.5, -0.17, 0.17, 0.5]) k.add(box(t, h, 0.004), C.timber, { p: [fx * w, y0 + h / 2, z] })
    k.add(box(w + 0.004, t, 0.004), C.timber, { p: [0, y0 + h - t / 2, z] })
    k.add(box(w + 0.004, t, 0.004), C.timber, { p: [0, y0 + t / 2, z] })
    for (const sx of [-1, 1]) k.add(box(t, Math.hypot(w * 0.33, h) * 0.95, 0.004), C.timber, { p: [sx * w * 0.335, y0 + h / 2, z], r: [0, 0, sx * Math.atan2(w * 0.33, h)] })
  }
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 + 0.002)
    for (const fz of [-0.5, 0, 0.5]) k.add(box(0.004, h, t), C.timber, { p: [x, y0 + h / 2, fz * d] })
    k.add(box(0.004, t, d + 0.004), C.timber, { p: [x, y0 + h - t / 2, 0] })
  }
}

// ---------------------------------------------------------------------------------------------
// Houses

function cottage(k: Kit) {
  const w = 0.15, d = 0.115, h = 0.082, rh = 0.072
  footing(k, w, d)
  const top = gabled(k, w, d, h, rh)
  door(k, -0.025, d / 2, 0, 0.034, 0.05, 'team')
  win(k, 0.032, 0.058, d / 2, 0, 0.024, 0.026, true)
  flowerBox(k, 0.032, 0.04, d / 2, 0, 1)
  win(k, -0.035, 0.058, -d / 2, Math.PI)
  win(k, 0.035, 0.058, -d / 2, Math.PI)
  for (const sx of [-1, 1]) win(k, sx * w / 2, 0.11, 0, sx * Math.PI / 2, 0.018, 0.022)
  chimney(k, 0.042, -0.025, top + 0.03, top - 0.05)
}

function thatched(k: Kit) {
  // a cottage under a deep straw roof with rounded eaves; the door and shutters carry the colour
  const w = 0.15, d = 0.12, h = 0.075, rh = 0.085
  footing(k, w, d)
  k.wall(box(w, h, d), 1, { p: [0, h / 2 + 0.012, 0] })
  for (const sx of [-1, 1]) k.wall(gableEnd(d, rh, 0.004), 1, { p: [sx * (w / 2 - 0.002), h + 0.012, 0] })
  for (const g of gableRoof(w, d, rh, 0.026, 0.024)) k.add(g, C.straw, { p: [0, h + 0.006, 0], mottle: 0.45 })
  k.add(new THREE.CylinderGeometry(0.018, 0.018, w + 0.05, 8), C.strawDark, { p: [0, h + 0.012 + rh + 0.01, 0], r: [0, 0, Math.PI / 2] })
  for (const sz of [-1, 1]) k.add(new THREE.CylinderGeometry(0.012, 0.012, w + 0.05, 8), C.strawDark, { p: [0, h + 0.002, sz * (d / 2 + 0.022)], r: [0, 0, Math.PI / 2] })
  k.add(box(0.034, 0.05, 0.006), C.door, { p: [-0.03, 0.039, d / 2 + 0.003] })
  k.teamDark(box(0.03, 0.044, 0.004), 1, { p: [-0.03, 0.039, d / 2 + 0.006] })
  win(k, 0.035, 0.055, d / 2, 0, 0.024, 0.024, true)
  flowerBox(k, 0.035, 0.038, d / 2, 0, 4)
  win(k, 0, 0.055, -d / 2, Math.PI)
  chimney(k, 0.05, 0, h + 0.012 + rh + 0.035, h + rh * 0.4)
}

function townhouse(k: Kit) {
  const w = 0.13, d = 0.115, h1 = 0.08, h2 = 0.075, rh = 0.085
  footing(k, w, d)
  k.wall(box(w, h1, d), 0.97, { p: [0, h1 / 2 + 0.012, 0] })
  // jettied upper storey with half-timbering
  const w2 = w + 0.014, d2 = d + 0.012
  const y2 = h1 + 0.012
  k.add(box(w2 + 0.004, 0.008, d2 + 0.004), C.timber, { p: [0, y2, 0] })
  k.wall(box(w2, h2, d2), 1, { p: [0, y2 + h2 / 2, 0] })
  timbering(k, w2, d2, y2, h2)
  for (const sx of [-1, 1]) k.wall(gableEnd(d2, rh, 0.004), 1, { p: [sx * (w2 / 2 - 0.002), y2 + h2, 0] })
  for (const g of gableRoof(w2, d2, rh, 0.011, 0.016)) k.team(g, 1, { p: [0, y2 + h2, 0], mottle: 0.55 })
  k.teamDark(box(w2 + 0.036, 0.011, 0.012), 1, { p: [0, y2 + h2 + rh + 0.006, 0] })
  door(k, 0.0, d / 2, 0, 0.034, 0.05, 'team')
  for (const sx of [-1, 1]) win(k, sx * 0.04, 0.055, d / 2, 0)
  for (const sx of [-1, 0, 1]) win(k, sx * 0.045, y2 + 0.04, d2 / 2, 0, 0.022, 0.026, sx === 0)
  for (const sx of [-1, 1]) win(k, sx * 0.04, y2 + 0.04, -d2 / 2, Math.PI)
  win(k, 0.03, 0.055, -d / 2, Math.PI)
  for (const sx of [-1, 1]) win(k, sx * w2 / 2, y2 + h2 + 0.025, 0, sx * Math.PI / 2, 0.016, 0.02)
  flowerBox(k, -0.045, y2 + 0.02, d2 / 2, 0, 2)
  chimney(k, -0.035, -0.03, y2 + h2 + rh + 0.02, y2 + h2)
}

function longhouse(k: Kit) {
  const w = 0.22, d = 0.11, h = 0.078, rh = 0.068
  footing(k, w, d)
  const top = gabled(k, w, d, h, rh)
  door(k, -0.06, d / 2, 0)
  for (const x of [-0.015, 0.04, 0.08]) win(k, x, 0.056, d / 2, 0, 0.022, 0.026, x === 0.04)
  for (const x of [-0.07, 0, 0.07]) win(k, x, 0.056, -d / 2, Math.PI)
  for (const sx of [-1, 1]) win(k, sx * w / 2, 0.105, 0, sx * Math.PI / 2, 0.018, 0.022)
  flowerBox(k, 0.08, 0.038, d / 2, 0, 3)
  chimney(k, 0.06, -0.022, top + 0.025, top - 0.05)
  // a lean-to woodshed at one end
  k.add(box(0.04, 0.05, d * 0.8), C.boards, { p: [-w / 2 - 0.02, 0.025 + 0.012, 0] })
  k.team(box(0.05, 0.007, d * 0.9), 0.75, { p: [-w / 2 - 0.022, 0.066, 0], r: [0, 0, 0.35] })
  for (let i = 0; i < 3; i++) k.add(cyl(0.007, 0.007, 0.03, 6), C.boardsLight, { p: [-w / 2 - 0.03, 0.02 + i * 0.012, 0.03 - i * 0.004], r: [Math.PI / 2, 0, 0] })
}

function hiphouse(k: Kit) {
  const w = 0.14, d = 0.13, h = 0.095, rh = 0.08
  footing(k, w, d)
  k.wall(box(w, h, d), 1, { p: [0, h / 2 + 0.012, 0] })
  k.team(hipRoof(w + 0.03, d + 0.03, rh, 0.012), 1, { p: [0, h + 0.012, 0], mottle: 0.55 })
  k.teamDark(box(0.016, 0.012, 0.016), 1, { p: [0, h + 0.012 + rh, 0] })
  for (const sz of [-1, 1]) k.add(box(w + 0.03, 0.006, 0.006), C.trim, { p: [0, h + 0.012, sz * (d / 2 + 0.015)] })
  door(k, 0, d / 2, 0)
  // a little porch roof over the door
  k.teamDark(box(0.06, 0.006, 0.03), 1, { p: [0, 0.076, d / 2 + 0.014], r: [0.35, 0, 0] })
  for (const sx of [-1, 1]) win(k, sx * 0.042, 0.06, d / 2, 0, 0.022, 0.026, true)
  for (const sx of [-1, 1]) win(k, sx * 0.035, 0.06, -d / 2, Math.PI)
  for (const sx of [-1, 1]) win(k, sx * w / 2, 0.06, 0, sx * Math.PI / 2)
  chimney(k, 0.0, -0.02, h + 0.012 + rh + 0.025, h)
}

function tallhouse(k: Kit) {
  // narrow and tall with its gable to the front and a hoist beam
  const w = 0.1, d = 0.125, h = 0.17, rh = 0.1
  footing(k, w, d)
  k.wall(box(w, h, d), 1, { p: [0, h / 2 + 0.012, 0] })
  k.group({ r: [0, Math.PI / 2, 0] }, () => {
    for (const sx of [-1, 1]) k.wall(gableEnd(w, rh, 0.004), 1, { p: [sx * (d / 2 - 0.002), h + 0.012, 0] })
    for (const g of gableRoof(d, w, rh, 0.011, 0.014)) k.team(g, 1, { p: [0, h + 0.012, 0], mottle: 0.55 })
    k.teamDark(box(d + 0.032, 0.011, 0.012), 1, { p: [0, h + 0.012 + rh + 0.006, 0] })
  })
  k.add(box(0.01, 0.01, 0.03), C.timber, { p: [0, h + 0.05, d / 2 + 0.012] })
  door(k, -0.022, d / 2, 0)
  win(k, 0.025, 0.055, d / 2, 0)
  for (const y of [0.105, 0.155]) for (const sx of [-1, 1]) win(k, sx * 0.024, y, d / 2, 0, 0.02, 0.026, true)
  win(k, 0, h + 0.045, d / 2, 0, 0.018, 0.024)
  for (const y of [0.06, 0.13]) for (const sx of [-1, 1]) win(k, sx * w / 2, y, 0, sx * Math.PI / 2)
  for (const y of [0.06, 0.13]) win(k, 0, y, -d / 2, Math.PI)
  chimney(k, 0.025, -0.035, h + 0.012 + rh, h)
}

// ---------------------------------------------------------------------------------------------
// Landmarks

function keep(k: Kit) {
  // the capital: a tall round tower with a fluttering banner, a lower tower beside it
  const r = 0.078
  const h = 0.4
  k.add(cyl(r + 0.012, r + 0.016, 0.03, 20), C.stoneDark, { p: [0, 0.015, 0] })
  k.add(cyl(r, r + 0.008, h, 20), C.stone, { p: [0, h / 2, 0] })
  for (const y of [0.13, 0.27]) k.add(torus(r + 0.004, 0.005, 4, 24), C.stoneDark, { p: [0, y, 0], r: [Math.PI / 2, 0, 0] })
  k.add(cyl(r + 0.016, r + 0.004, 0.03, 20), C.stoneLight, { p: [0, h + 0.012, 0] })
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    k.add(box(0.026, 0.026, 0.02), C.stoneLight, { p: [Math.cos(a) * (r + 0.008), h + 0.036, Math.sin(a) * (r + 0.008)], r: [0, -a, 0] })
  }
  // conical roof with a flared eave, finial and banner
  k.team(lathe([[r + 0.02, 0], [r + 0.004, 0.02], [0.004, 0.17], [0, 0.172]], 20), 1, { p: [0, h + 0.03, 0] })
  k.add(sphere(0.012, 8, 6), C.gold, { p: [0, h + 0.21, 0] })
  k.add(cyl(0.0035, 0.0035, 0.14, 5), C.timberDark, { p: [0, h + 0.27, 0] })
  k.team(box(0.11, 0.06, 0.004), 1.06, { p: [0.057, h + 0.31, 0], flutter: (x) => Math.max(0, (x + 0.055) / 0.11) })
  k.add(box(0.03, 0.03, 0.005), C.gold, { p: [0.05, h + 0.31, 0], r: [0, 0, Math.PI / 4] })
  // arrow slits and a door
  for (const y of [0.1, 0.2, 0.32]) for (const a of [0.35, 2.4, -1.4]) {
    const yy = y + (a > 1 ? 0.04 : 0)
    k.group({ p: [Math.sin(a) * (r + 0.002), yy, Math.cos(a) * (r + 0.002)], r: [0, a, 0] }, () => k.glow(box(0.01, 0.03, 0.004), C.glass))
  }
  k.add(box(0.036, 0.06, 0.008), C.door, { p: [0, 0.042, r + 0.004] })
  k.add(box(0.046, 0.008, 0.012), C.stoneDark, { p: [0, 0.075, r + 0.006] })
  // the lower tower and a curtain wall between
  k.group({ p: [-0.11, 0, 0.055] }, () => {
    const r2 = 0.05, h2 = 0.22
    k.add(cyl(r2, r2 + 0.006, h2, 16), C.stone, { p: [0, h2 / 2, 0] })
    k.add(cyl(r2 + 0.01, r2 + 0.002, 0.022, 16), C.stoneLight, { p: [0, h2 + 0.008, 0] })
    k.team(lathe([[r2 + 0.014, 0], [r2, 0.014], [0, 0.12]], 16), 0.86, { p: [0, h2 + 0.018, 0] })
    k.add(sphere(0.008, 6, 5), C.gold, { p: [0, h2 + 0.145, 0] })
    k.glow(box(0.01, 0.026, 0.004), C.glass, { p: [0, 0.15, r2 + 0.003] })
  })
  k.add(box(0.07, 0.11, 0.03), C.stone, { p: [-0.06, 0.055, 0.03], r: [0, -0.45, 0] })
  for (let i = 0; i < 3; i++) k.add(box(0.016, 0.016, 0.03), C.stoneLight, { p: [-0.085 + i * 0.024, 0.118, 0.03 + i * 0.011], r: [0, -0.45, 0] })
}

function hall(k: Kit) {
  // a town hall with a bell turret and a flag
  const w = 0.2, d = 0.13, h = 0.1, rh = 0.095
  footing(k, w, d, 0.02)
  const top = gabled(k, w, d, h, rh, { over: 0.018 })
  k.add(box(0.05, 0.075, 0.008), C.door, { p: [0, 0.058, d / 2 + 0.003] })
  k.add(box(0.062, 0.01, 0.012), C.trim, { p: [0, 0.1, d / 2 + 0.004] })
  for (const x of [-0.065, 0.065]) win(k, x, 0.07, d / 2, 0, 0.026, 0.04, true)
  for (const x of [-0.06, 0, 0.06]) win(k, x, 0.07, -d / 2, Math.PI, 0.024, 0.036)
  for (const sx of [-1, 1]) win(k, sx * w / 2, 0.14, 0, sx * Math.PI / 2, 0.022, 0.03)
  // bell turret
  k.group({ p: [0.03, top - 0.012, 0] }, () => {
    k.wall(box(0.044, 0.05, 0.044), 1, { p: [0, 0.035, 0] })
    for (let i = 0; i < 4; i++) k.add(box(0.016, 0.024, 0.046), C.iron, { p: [0, 0.042, 0], r: [0, (i * Math.PI) / 2, 0], s: [1, 1, 1.02] })
    k.team(cone(0.04, 0.07, 4), 0.9, { p: [0, 0.095, 0], r: [0, Math.PI / 4, 0] })
    k.add(sphere(0.008, 6, 5), C.gold, { p: [0, 0.133, 0] })
    k.add(cyl(0.003, 0.003, 0.08, 5), C.timberDark, { p: [0, 0.17, 0] })
    k.team(box(0.07, 0.042, 0.004), 1.06, { p: [0.036, 0.19, 0], flutter: (x) => Math.max(0, (x + 0.035) / 0.07) })
  })
  // banners either side of the door
  for (const sx of [-1, 1]) k.team(box(0.022, 0.05, 0.004), 1.05, { p: [sx * 0.04, 0.08, d / 2 + 0.006], flutter: (_x, y) => Math.max(0, -y / 0.05 + 0.5) * 0.4 })
}

function temple(k: Kit) {
  const w = 0.17, d = 0.12, h = 0.11, rh = 0.09
  footing(k, w + 0.01, d + 0.01, 0.02)
  k.add(box(w, h, d), '#F6F0E4', { p: [0, h / 2 + 0.012, 0] })
  for (const sx of [-1, 1]) k.add(gableEnd(d, rh, 0.004), '#F6F0E4', { p: [sx * (w / 2 - 0.002), h + 0.012, 0] })
  for (const g of gableRoof(w, d, rh, 0.011, 0.016)) k.team(g, 0.92, { p: [0, h + 0.012, 0] })
  k.team(box(w + 0.036, 0.011, 0.012), 0.6, { p: [0, h + 0.012 + rh + 0.006, 0] })
  for (const x of [-0.05, 0, 0.05]) {
    win(k, x, 0.075, d / 2, 0, 0.018, 0.05)
    win(k, x, 0.075, -d / 2, Math.PI, 0.018, 0.05)
  }
  // bell tower at the east end with a slender spire
  k.group({ p: [w / 2 + 0.028, 0, 0] }, () => {
    const tw = 0.065, th = 0.25
    k.add(box(tw, th, tw), '#F2EADB', { p: [0, th / 2, 0] })
    k.add(box(tw + 0.01, 0.012, tw + 0.01), C.stoneDark, { p: [0, th, 0] })
    for (let i = 0; i < 4; i++) k.group({ r: [0, (i * Math.PI) / 2, 0] }, () => k.add(box(0.022, 0.04, 0.004), C.iron, { p: [0, th - 0.035, tw / 2 + 0.001] }))
    k.glow(torus(0.012, 0.004, 4, 12), C.glass, { p: [0, 0.14, tw / 2 + 0.002] })
    k.glow(sphere(0.009, 6, 5), C.glass, { p: [0, 0.14, tw / 2 + 0.0] })
    k.team(cone(0.052, 0.16, 4), 0.9, { p: [0, th + 0.086, 0], r: [0, Math.PI / 4, 0] })
    k.add(sphere(0.01, 6, 5), C.gold, { p: [0, th + 0.172, 0] })
    k.add(box(0.004, 0.03, 0.004), C.gold, { p: [0, th + 0.195, 0] })
    k.add(box(0.016, 0.004, 0.004), C.gold, { p: [0, th + 0.198, 0] })
    k.add(box(0.03, 0.05, 0.006), C.door, { p: [0, 0.037, tw / 2 + 0.002] })
  })
  // steps
  k.add(box(0.06, 0.01, 0.03), C.stoneLight, { p: [0, 0.005, d / 2 + 0.018] })
  k.add(box(0.04, 0.06, 0.008), C.door, { p: [0, 0.042, d / 2 + 0.003] })
}

function stall(k: Kit, x: number, z: number, rot: number, seed: number) {
  k.group({ p: [x, 0, z], r: [0, rot, 0] }, () => {
    k.add(box(0.075, 0.03, 0.035), C.boards, { p: [0, 0.015, 0] })
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(box(0.005, 0.07, 0.005), C.timberDark, { p: [sx * 0.036, 0.035, sz * 0.02] })
    // striped awning, sloping to the front
    for (let i = 0; i < 6; i++) {
      const p = { p: [-0.035 + i * 0.014, 0.075, 0.004] as [number, number, number], r: [0.32, 0, 0] as [number, number, number], flutter: () => 0.25 }
      if (i % 2) k.add(box(0.014, 0.004, 0.06), C.linen, p)
      else k.team(box(0.014, 0.004, 0.06), 1.05, p)
    }
    // scalloped valance
    for (let i = 0; i < 6; i++) k.team(sphere(0.006, 5, 3), 1.05, { p: [-0.035 + i * 0.014, 0.063, 0.034], s: [1.2, 1, 0.5] })
    // goods
    for (let i = 0; i < 6; i++) k.add(sphere(0.008, 6, 5), C.fruit[(seed + i) % C.fruit.length], { p: [-0.026 + (i % 3) * 0.026, 0.035, -0.006 + Math.floor(i / 3) * 0.012] })
  })
}

function market(k: Kit) {
  stall(k, -0.06, 0.02, 0.4, 0)
  stall(k, 0.06, 0.02, -0.4, 2)
  stall(k, 0, -0.06, 0, 4)
  for (const [x, z] of [[-0.02, 0.06], [0.03, 0.065]] as const) k.add(box(0.022, 0.02, 0.022), C.boardsLight, { p: [x, 0.01, z], r: [0, x * 10, 0] })
  k.add(lathe([[0.012, 0], [0.015, 0.014], [0.012, 0.028]], 10), C.boards, { p: [0.0, 0, 0.03] })
}

function workshop(k: Kit) {
  const w = 0.15, d = 0.11, h = 0.085, rh = 0.06
  footing(k, w, d)
  k.add(box(w, h, d), C.granite, { p: [0, h / 2 + 0.012, 0] })
  for (const sx of [-1, 1]) k.add(gableEnd(d, rh, 0.004), C.granite, { p: [sx * (w / 2 - 0.002), h + 0.012, 0] })
  for (const g of gableRoof(w, d, rh, 0.011, 0.016)) k.team(g, 1, { p: [0, h + 0.012, 0], mottle: 0.5 })
  k.teamDark(box(w + 0.036, 0.011, 0.012), 1, { p: [0, h + 0.012 + rh + 0.006, 0] })
  // the forge: an open front with a glowing hearth
  k.add(box(0.06, 0.06, 0.006), C.iron, { p: [0.03, 0.045, d / 2 + 0.002] })
  k.glow(box(0.034, 0.022, 0.006), C.forge, { p: [0.03, 0.03, d / 2 + 0.004] })
  win(k, -0.045, 0.06, d / 2, 0)
  k.add(box(0.03, 0.02, 0.014), C.iron, { p: [0.03, 0.025, d / 2 + 0.03] })
  chimney(k, 0.05, 0, h + 0.012 + rh + 0.05, h, C.brick)
  // a lean-to with stacked boards
  k.add(box(0.035, 0.045, d), C.boards, { p: [-w / 2 - 0.018, 0.035, 0] })
  k.team(box(0.045, 0.006, d + 0.01), 0.7, { p: [-w / 2 - 0.02, 0.064, 0], r: [0, 0, 0.3] })
}

function barracks(k: Kit) {
  const w = 0.2, d = 0.1, h = 0.075, rh = 0.06
  footing(k, w, d)
  k.add(box(w, h * 0.45, d), C.stone, { p: [0, h * 0.225 + 0.012, 0] })
  k.add(box(w, h * 0.55, d), C.boards, { p: [0, h * 0.725 + 0.012, 0] })
  for (const sx of [-1, 1]) k.add(gableEnd(d, rh, 0.004), C.boards, { p: [sx * (w / 2 - 0.002), h + 0.012, 0] })
  for (const g of gableRoof(w, d, rh, 0.011, 0.016)) k.team(g, 0.86, { p: [0, h + 0.012, 0] })
  k.team(box(w + 0.036, 0.011, 0.012), 0.55, { p: [0, h + 0.012 + rh + 0.006, 0] })
  for (const x of [-0.06, 0.06]) win(k, x, 0.065, d / 2, 0)
  door(k, 0, d / 2, 0, 0.04, 0.055)
  // yard: a weapon rack and a straw dummy, a banner
  k.group({ p: [0.06, 0, d / 2 + 0.05] }, () => {
    k.add(box(0.05, 0.006, 0.006), C.timberDark, { p: [0, 0.05, 0] })
    for (let i = 0; i < 3; i++) {
      k.add(cyl(0.0025, 0.0025, 0.1, 4), C.timber, { p: [-0.016 + i * 0.016, 0.05, 0], r: [0.12, 0, 0] })
      k.add(cone(0.005, 0.014, 4), '#A9B0B9', { p: [-0.016 + i * 0.016, 0.105, 0.006] })
    }
  })
  k.group({ p: [-0.05, 0, d / 2 + 0.05] }, () => {
    k.add(cyl(0.003, 0.003, 0.08, 4), C.timber, { p: [0, 0.04, 0] })
    k.add(capsule2(k), C.straw, { p: [0, 0.07, 0] })
    k.add(box(0.06, 0.006, 0.006), C.timber, { p: [0, 0.075, 0] })
  })
  k.add(cyl(0.0035, 0.0035, 0.2, 5), C.timberDark, { p: [-w / 2 + 0.015, 0.1, d / 2 + 0.01] })
  k.team(box(0.07, 0.045, 0.004), 1.06, { p: [-w / 2 + 0.05, 0.17, d / 2 + 0.01], flutter: (x) => Math.max(0, (x + 0.035) / 0.07) })
}

function capsule2(_k: Kit): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(0.014, 0.02, 3, 8)
}

// ---------------------------------------------------------------------------------------------
// Outskirts

function barn(k: Kit, faluRed: boolean) {
  const w = 0.13, d = 0.095, h = 0.07, rh = 0.06
  footing(k, w, d, 0.012)
  const wall = faluRed ? C.falu : C.tar
  k.add(box(w, h, d), wall, { p: [0, h / 2 + 0.01, 0] })
  for (const sx of [-1, 1]) k.add(gableEnd(d, rh, 0.004), wall, { p: [sx * (w / 2 - 0.002), h + 0.01, 0] })
  for (const g of gableRoof(w, d, rh, 0.01, 0.014)) k.team(g, 1, { p: [0, h + 0.01, 0], mottle: 0.5 })
  k.teamDark(box(w + 0.03, 0.01, 0.011), 1, { p: [0, h + 0.01 + rh + 0.005, 0] })
  // white-trimmed doors with an X brace
  k.add(box(0.05, 0.055, 0.004), C.boards, { p: [0, 0.038, d / 2 + 0.002] })
  for (const s of [-1, 1]) k.add(box(0.004, 0.07, 0.004), C.trim, { p: [0, 0.038, d / 2 + 0.005], r: [0, 0, s * 0.72] })
  k.add(box(0.056, 0.004, 0.005), C.trim, { p: [0, 0.067, d / 2 + 0.005] })
  for (const sx of [-1, 1]) k.add(box(0.004, 0.058, 0.005), C.trim, { p: [sx * 0.027, 0.038, d / 2 + 0.005] })
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(box(0.005, h, 0.005), C.trim, { p: [sx * (w / 2), h / 2 + 0.01, sz * (d / 2)] })
  win(k, 0, h + 0.03, 0, Math.PI / 2, 0.016, 0.018)
}

function field(k: Kit, crop: 'wheat' | 'greens' | 'flowers', seed: number) {
  // a patch of rows, long along x, with a low fence on the back and sides
  const w = 0.17, d = 0.12
  k.add(box(w, 0.008, d), C.soil, { p: [0, 0.004, 0] })
  const rows = 6
  for (let i = 0; i < rows; i++) {
    const z = -d / 2 + (d / rows) * (i + 0.5)
    if (crop === 'wheat') k.add(box(w - 0.01, 0.026, 0.016), i % 2 ? C.wheat : '#D9B456', { p: [0, 0.02, z], flutter: () => 0.15 })
    else if (crop === 'greens') for (let j = 0; j < 7; j++) k.add(sphere(0.01, 6, 4), j % 3 ? C.greens : C.greensDark, { p: [-w / 2 + 0.014 + j * 0.0235, 0.013, z], s: [1, 0.75, 1] })
    else for (let j = 0; j < 7; j++) k.add(sphere(0.0085, 5, 4), C.flowers[(seed + i + j * 2) % C.flowers.length], { p: [-w / 2 + 0.014 + j * 0.0235, 0.015, z] })
  }
  const post = (x: number, z: number) => k.add(box(0.005, 0.03, 0.005), C.timberDark, { p: [x, 0.015, z] })
  for (let i = 0; i <= 7; i++) post(-w / 2 + (w / 7) * i, d / 2 + 0.006)
  k.add(box(w, 0.004, 0.004), C.boardsLight, { p: [0, 0.024, d / 2 + 0.006] })
  for (const sx of [-1, 1]) {
    for (let i = 0; i <= 5; i++) post(sx * (w / 2 + 0.006), -d / 2 + (d / 5) * i)
    k.add(box(0.004, 0.004, d), C.boardsLight, { p: [sx * (w / 2 + 0.006), 0.024, 0] })
  }
  if (crop === 'wheat') {
    // a scarecrow
    k.group({ p: [0.06, 0, 0.01] }, () => {
      k.add(cyl(0.003, 0.003, 0.08, 4), C.timber, { p: [0, 0.04, 0] })
      k.add(box(0.05, 0.004, 0.004), C.timber, { p: [0, 0.065, 0] })
      k.team(box(0.02, 0.026, 0.012), 0.8, { p: [0, 0.062, 0] })
      k.add(sphere(0.009, 6, 5), C.straw, { p: [0, 0.084, 0] })
      k.add(cone(0.016, 0.012, 8), C.strawDark, { p: [0, 0.094, 0] })
    })
  }
}

/** A field with its barn beside it; +z points out of town, so the fence runs along the outer edge. */
function farmstead(k: Kit, faluRed: boolean, crop: 'wheat' | 'greens' | 'flowers', seed: number) {
  k.group({ p: [-0.045, 0, 0] }, () => field(k, crop, seed))
  k.group({ p: [0.1, 0, -0.005], r: [0, -Math.PI / 2, 0], s: 0.78 }, () => barn(k, faluRed))
  k.add(dome(0.024, 10, 5, 0.5), C.straw, { p: [0.105, 0, 0.065], s: [1, 1.3, 1] })
}

function sawmill(k: Kit) {
  // an open shed, a log pile, a sawhorse and stumps
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(box(0.008, 0.08, 0.008), C.timberDark, { p: [sx * 0.05, 0.04, sz * 0.035 - 0.02] })
  for (const g of gableRoof(0.11, 0.08, 0.04, 0.009, 0.012)) k.team(g, 0.8, { p: [0, 0.08, -0.02] })
  k.add(box(0.06, 0.03, 0.03), C.boardsLight, { p: [0, 0.03, -0.02] })
  k.add(box(0.012, 0.012, 0.07), C.iron, { p: [0, 0.05, -0.02] })
  const log = (x: number, y: number, z: number, len = 0.11) => {
    k.add(cyl(0.012, 0.012, len, 8), C.boards, { p: [x, y, z], r: [0, 0, Math.PI / 2] })
    for (const sx of [-1, 1]) k.add(cyl(0.0115, 0.0115, 0.002, 8), '#D9B98A', { p: [x + sx * len / 2, y, z], r: [0, 0, Math.PI / 2] })
  }
  for (let i = 0; i < 4; i++) log(0.0, 0.012, 0.04 + i * 0.024)
  for (let i = 0; i < 3; i++) log(0.0, 0.033, 0.052 + i * 0.024)
  for (let i = 0; i < 2; i++) log(0.0, 0.054, 0.064 + i * 0.024)
  k.add(cyl(0.016, 0.018, 0.02, 8), C.boards, { p: [0.08, 0.01, 0.06] })
  k.add(cyl(0.015, 0.015, 0.002, 8), '#D9B98A', { p: [0.08, 0.021, 0.06] })
  k.add(flat([[-0.07, -0.06], [0.08, -0.06], [0.09, 0.12], [-0.08, 0.12]], 0.002), '#C9A97E', {})
}

function jetty(k: Kit) {
  // planks along +z from the shore (z = 0) out over the water, on posts
  const w = 0.07, len = 0.4
  k.add(box(w, 0.008, len), C.boards, { p: [0, 0, len / 2] })
  for (let i = 0; i < 10; i++) k.add(box(w + 0.004, 0.009, 0.004), C.boardsLight, { p: [0, 0.001, 0.02 + i * 0.04] })
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) k.add(cyl(0.006, 0.006, 0.14, 6), C.timberDark, { p: [sx * (w / 2 - 0.004), -0.06, 0.04 + i * 0.12] })
  for (const sx of [-1, 1]) k.add(cyl(0.007, 0.007, 0.03, 6), C.timberDark, { p: [sx * (w / 2 - 0.004), 0.015, len - 0.02] })
  k.add(torus(0.008, 0.002, 4, 8), C.rope, { p: [w / 2 - 0.004, 0.02, len - 0.02], r: [Math.PI / 2, 0, 0] })
  // a lantern at the end
  k.add(cyl(0.003, 0.003, 0.09, 5), C.timberDark, { p: [-w / 2 + 0.006, 0.045, len - 0.01] })
  k.glow(box(0.012, 0.016, 0.012), C.lantern, { p: [-w / 2 + 0.006, 0.093, len - 0.01] })
  k.anchor('halo', [-w / 2 + 0.006, 0.093, len - 0.01])
  k.add(cone(0.011, 0.01, 4), C.iron, { p: [-w / 2 + 0.006, 0.106, len - 0.01], r: [0, Math.PI / 4, 0] })
  // a crate and a coil of rope
  k.add(box(0.02, 0.018, 0.02), C.boardsLight, { p: [0.015, 0.013, 0.06] })
  k.add(torus(0.01, 0.004, 4, 10), C.rope, { p: [-0.01, 0.007, 0.1], r: [Math.PI / 2, 0, 0] })
}

/** Steps from the shore (top, y = 1) down to the jetty (y = 0) along +z; scale y by the drop. */
function stairs(k: Kit) {
  const n = 5
  for (let i = 0; i < n; i++) k.add(box(0.06, 1 / n, 0.022), C.boards, { p: [0, 1 - (i + 0.5) / n, -0.01 + i * 0.016] })
  for (const sx of [-1, 1]) k.add(box(0.006, 1, 0.006), C.timberDark, { p: [sx * 0.032, 0.5, 0.06] })
}

function boat(k: Kit) {
  // a little sailing boat, bow towards +z
  k.add(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), C.boards, { s: [0.032, 0.026, 0.075] })
  k.add(torus(1, 0.06, 4, 24), C.timberDark, { s: [0.032, 0.032, 0.075], r: [Math.PI / 2, 0, 0], p: [0, 0.001, 0] })
  k.team(box(0.066, 0.004, 0.008), 0.7, { p: [0, -0.008, 0.03] })
  k.add(box(0.05, 0.004, 0.012), C.boardsLight, { p: [0, 0.0, -0.01] })
  k.add(cyl(0.0035, 0.004, 0.16, 5), C.timberDark, { p: [0, 0.08, 0.01] })
  k.add(cyl(0.0025, 0.0025, 0.06, 4), C.timberDark, { p: [0, 0.03, -0.015], r: [Math.PI / 2, 0, 0] })
  k.team(slab([[0, 0], [0.0, 0.13], [-0.055, 0.0]], 0.003), 1.05, { p: [0, 0.03, 0.012], r: [0, Math.PI / 2, 0], flutter: (_x, y) => Math.max(0, 0.6 - y * 3) })
  k.add(box(0.008, 0.004, 0.05), C.linen, { p: [0.03, 0.006, -0.03], r: [0, 0.3, 0] })
}

// ---------------------------------------------------------------------------------------------
// Fortifications

/** Length of one wall side: the side of a hexagon with inradius `WALL_IN`. */
export const WALL_IN = 0.82
export const WALL_LEN = 2 * WALL_IN * Math.tan(Math.PI / 6)

/** A straight stretch of wall along x, its outer face towards +z. */
function wallSegment(k: Kit, len: number, gap = 0) {
  const h = 0.07, t = 0.032
  const piece = (x0: number, x1: number) => {
    const l = x1 - x0
    if (l <= 0.001) return
    const cx = (x0 + x1) / 2
    k.add(box(l, h, t), C.stone, { p: [cx, h / 2, 0] })
    k.add(box(l, 0.008, t + 0.008), C.stoneDark, { p: [cx, 0.004, 0] })
    k.add(box(l, 0.006, t + 0.006), C.stoneLight, { p: [cx, h, 0] })
    const n = Math.max(1, Math.round(l / 0.04))
    for (let i = 0; i < n; i++) {
      const x = x0 + (l / n) * (i + 0.5)
      k.add(box(0.022, 0.02, 0.012), C.stoneLight, { p: [x, h + 0.012, t / 2 - 0.004] })
      k.add(box(0.022, 0.014, 0.01), C.stoneLight, { p: [x, h + 0.009, -t / 2 + 0.004] })
    }
  }
  if (!gap) piece(-len / 2, len / 2)
  else {
    piece(-len / 2, -gap / 2)
    piece(gap / 2, len / 2)
  }
}

function wallSide(k: Kit) {
  wallSegment(k, WALL_LEN)
}

function gate(k: Kit) {
  const gap = 0.07
  wallSegment(k, WALL_LEN, gap + 0.06)
  for (const sx of [-1, 1]) {
    k.group({ p: [sx * (gap / 2 + 0.024), 0, 0] }, () => {
      k.add(box(0.05, 0.13, 0.05), C.stone, { p: [0, 0.065, 0] })
      k.add(box(0.058, 0.01, 0.058), C.stoneLight, { p: [0, 0.13, 0] })
      k.team(cone(0.046, 0.07, 4), 0.9, { p: [0, 0.17, 0], r: [0, Math.PI / 4, 0] })
      k.add(sphere(0.007, 6, 5), C.gold, { p: [0, 0.207, 0] })
      k.glow(box(0.008, 0.022, 0.004), C.glass, { p: [0, 0.09, 0.026] })
    })
  }
  // lintel, gateway and banner
  k.add(box(gap + 0.01, 0.03, 0.04), C.stone, { p: [0, 0.103, 0] })
  k.add(box(gap + 0.014, 0.006, 0.044), C.stoneLight, { p: [0, 0.12, 0] })
  k.add(box(gap, 0.088, 0.006), '#3E3430', { p: [0, 0.044, -0.004] })
  for (let i = 0; i < 4; i++) k.add(box(0.003, 0.08, 0.004), C.iron, { p: [-gap / 2 + 0.01 + i * 0.0165, 0.05, 0.001] })
  k.team(box(0.04, 0.06, 0.004), 1.06, { p: [0, 0.07, 0.024], flutter: (_x, y) => Math.max(0, 0.5 - y / 0.06) * 0.6 })
  k.add(box(0.016, 0.016, 0.005), C.gold, { p: [0, 0.075, 0.027], r: [0, 0, Math.PI / 4] })
}

function tower(k: Kit) {
  const r = 0.05, h = 0.17
  k.add(cyl(r, r + 0.008, h, 16), C.stone, { p: [0, h / 2, 0] })
  k.add(torus(r + 0.004, 0.004, 4, 20), C.stoneDark, { p: [0, 0.07, 0], r: [Math.PI / 2, 0, 0] })
  k.add(cyl(r + 0.01, r + 0.002, 0.02, 16), C.stoneLight, { p: [0, h + 0.008, 0] })
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    k.add(box(0.018, 0.018, 0.014), C.stoneLight, { p: [Math.cos(a) * (r + 0.004), h + 0.026, Math.sin(a) * (r + 0.004)], r: [0, -a, 0] })
  }
  k.team(lathe([[r + 0.012, 0], [r - 0.002, 0.012], [0, 0.11]], 16), 0.92, { p: [0, h + 0.02, 0] })
  k.add(sphere(0.007, 6, 5), C.gold, { p: [0, h + 0.135, 0] })
  for (const a of [0, 2.1, -2.1]) k.group({ p: [Math.sin(a) * (r + 0.003), 0.11, Math.cos(a) * (r + 0.003)], r: [0, a, 0] }, () => k.glow(box(0.008, 0.024, 0.004), C.glass))
}

// ---------------------------------------------------------------------------------------------
// The square, streets and greenery

export const SQUARE_R = 0.37
export const RING_R = 0.635

function ground(k: Kit) {
  // a cultivated lawn plot with a low kerb, so every town reads the same on sand, grass or forest
  const lawn = (r: number) => Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 30) * Math.PI) / 180
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number]
  })
  k.add(flat(lawn(0.875), 0.002), C.lawn, { mottle: 0.95 })
  for (let i = 0; i < 6; i++) {
    const a0 = ((60 * i - 30) * Math.PI) / 180
    const a1 = ((60 * i + 30) * Math.PI) / 180
    const r = 0.875
    const mx = (Math.cos(a0) + Math.cos(a1)) * r / 2
    const mz = (Math.sin(a0) + Math.sin(a1)) * r / 2
    k.add(box(r, 0.008, 0.012), C.stoneDark, { p: [mx, 0.004, mz], r: [0, -Math.atan2(mz, mx) + Math.PI / 2, 0] })
  }
  // the square: warm flagstones, a darker band and a compass rose in the player colour
  k.add(lathe([[SQUARE_R + 0.012, 0], [SQUARE_R + 0.012, 0.009], [SQUARE_R, 0.012], [0, 0.012]], 56), C.flag, { mottle: 0.3 })
  // flower strips along the kerb in front of each inner plot
  for (let i = 0; i < 6; i++) {
    const a0 = (i * 60 * Math.PI) / 180
    for (let j = -4; j <= 4; j++) {
      const a = a0 + j * 0.075
      const r = SQUARE_R + 0.024 + (j % 2 ? 0.006 : 0)
      k.add(new THREE.IcosahedronGeometry(0.0085, 0), j % 3 === 0 ? C.leaf[1] : C.flowers[(i * 3 + j + 9) % C.flowers.length], { p: [Math.cos(a) * r, 0.011, Math.sin(a) * r] })
    }
  }
  k.add(lathe([[0.315, 0.0122], [0.255, 0.0122]], 56), C.flagDark)
  k.add(lathe([[0.13, 0.0123], [0.118, 0.0123]], 40), C.gold)
  const star: [number, number][] = []
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2
    const r = i % 4 === 0 ? 0.11 : i % 2 === 0 ? 0.07 : 0.032
    star.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  k.team(flat(star, 0.0126), 1)
  k.add(lathe([[0.022, 0.0128], [0, 0.0128]], 16), C.trim)
  // the ring street and six lanes between the inner plots
  const ringW = 0.042
  k.add(lathe([[RING_R + ringW / 2, 0.003], [RING_R + ringW / 2 - 0.004, 0.006], [RING_R - ringW / 2 + 0.004, 0.006], [RING_R - ringW / 2, 0.003]], 64), C.gravel)
  for (let i = 0; i < 6; i++) {
    const a = (-60 * i - 30) * (Math.PI / 180)
    const r0 = SQUARE_R + 0.005
    const r1 = RING_R
    const len = r1 - r0
    const mid = (r0 + r1) / 2
    k.add(box(0.036, 0.006, len), C.gravel, { p: [Math.cos(a) * mid, 0.003, Math.sin(a) * mid], r: [0, -a + Math.PI / 2, 0] })
  }
}

/** Six lanterns around the square, beside the mouths of the lanes. */
function lanterns(k: Kit) {
  for (let i = 0; i < 6; i++) {
    const a = (-60 * i - 30) * (Math.PI / 180) + 0.17
    const r = 0.405
    k.group({ p: [Math.cos(a) * r, 0.012, Math.sin(a) * r] }, () => {
      k.add(cyl(0.009, 0.011, 0.01, 8), C.stoneDark, { p: [0, 0.005, 0] })
      k.add(cyl(0.0028, 0.0032, 0.075, 5), C.iron, { p: [0, 0.045, 0] })
      k.glow(box(0.014, 0.017, 0.014), C.lantern, { p: [0, 0.088, 0] })
      k.add(cone(0.013, 0.012, 4), C.iron, { p: [0, 0.102, 0], r: [0, Math.PI / 4, 0] })
      k.anchor('halo', [0, 0.088, 0])
    })
  }
}

/** A road from the ring street to the tile edge along +z (z = 0 at the ring). */
function road(k: Kit) {
  const len = 0.24
  k.add(box(0.05, 0.006, len), C.gravel, { p: [0, 0.003, len / 2] })
}

function well(k: Kit) {
  k.add(lathe([[0.032, 0], [0.034, 0.03], [0.028, 0.032], [0.026, 0.01], [0, 0.01]], 16), C.stone)
  k.add(cyl(0.026, 0.026, 0.002, 14), C.water, { p: [0, 0.024, 0] })
  for (const sx of [-1, 1]) k.add(box(0.005, 0.07, 0.005), C.timberDark, { p: [sx * 0.028, 0.065, 0] })
  k.add(box(0.06, 0.004, 0.004), C.timber, { p: [0, 0.078, 0] })
  for (const g of gableRoof(0.06, 0.05, 0.024, 0.006, 0.008)) k.team(g, 0.9, { p: [0, 0.098, 0] })
  k.add(cyl(0.008, 0.007, 0.012, 8), C.boards, { p: [0.0, 0.055, 0] })
}

function tree(k: Kit, colors: string[], seed: number) {
  k.add(cyl(0.009, 0.013, 0.08, 7), C.timber, { p: [0, 0.04, 0] })
  const blobs: [number, number, number, number][] = [[0, 0.11, 0, 0.055], [0.035, 0.09, 0.02, 0.04], [-0.032, 0.095, -0.015, 0.042], [0.005, 0.145, -0.01, 0.038], [-0.01, 0.085, 0.035, 0.034]]
  blobs.forEach(([x, y, z, r], i) => k.add(new THREE.IcosahedronGeometry(r, 1), colors[(seed + i) % colors.length], { p: [x, y, z] }))
}

function bushes(k: Kit, seed: number) {
  const spots: [number, number, number][] = [[0, 0, 0.022], [0.035, 0.01, 0.017], [-0.03, 0.015, 0.018], [0.012, -0.03, 0.015]]
  spots.forEach(([x, z, r], i) => {
    k.add(new THREE.IcosahedronGeometry(r, 1), C.leaf[(seed + i) % C.leaf.length], { p: [x, r * 0.8, z] })
    for (let j = 0; j < 4; j++) {
      const a = (j / 4) * Math.PI * 2 + i
      k.add(sphere(0.005, 5, 4), C.flowers[(seed + i + j) % C.flowers.length], { p: [x + Math.cos(a) * r * 0.8, r * 1.2, z + Math.sin(a) * r * 0.8] })
    }
  })
}

function garden(k: Kit, seed: number) {
  // a kitchen garden: beds of greens with a tiny fence, a bench and flowers
  const w = 0.12, d = 0.09
  k.add(box(w, 0.008, d), C.soilDark, { p: [0, 0.004, 0] })
  for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) k.add(sphere(0.009, 6, 4), (i + seed) % 3 === 0 ? C.flowers[(j + seed) % C.flowers.length] : j % 2 ? C.greens : C.greensDark, { p: [-w / 2 + 0.014 + j * 0.023, 0.012, -d / 2 + 0.017 + i * 0.028], s: [1, 0.8, 1] })
  for (let i = 0; i <= 6; i++) k.add(box(0.004, 0.022, 0.004), C.trim, { p: [-w / 2 + (w / 6) * i, 0.011, d / 2 + 0.008] })
  k.add(box(w, 0.004, 0.004), C.trim, { p: [0, 0.018, d / 2 + 0.008] })
}

function flowerbed(k: Kit, seed: number) {
  const rx = 0.075, rz = 0.05
  k.add(lathe([[1, 0], [1, 0.012], [0.92, 0.016], [0, 0.017]], 20), C.soilDark, { s: [rx, 1, rz] })
  // a clipped box hedge around it, open at the front
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    if (Math.abs(Math.sin(a) - 1) < 0.2) continue
    k.add(new THREE.IcosahedronGeometry(0.014, 0), C.greensDark, { p: [Math.cos(a) * (rx + 0.008), 0.012, Math.sin(a) * (rz + 0.008)], s: [1, 0.85, 1], mottle: 0.5 })
  }
  for (let i = 0; i < 14; i++) {
    const a = i * 2.399
    const r = Math.sqrt((i + 0.5) / 14) * 0.85
    k.add(sphere(0.008, 5, 4), C.flowers[(seed + i) % C.flowers.length], { p: [Math.cos(a) * r * rx, 0.024, Math.sin(a) * r * rz] })
    if (i % 3 === 0) k.add(sphere(0.007, 4, 3), C.leaf[i % C.leaf.length], { p: [Math.cos(a + 1) * r * rx, 0.02, Math.sin(a + 1) * r * rz] })
  }
}

function hedge(k: Kit) {
  // a clipped hedge along x with a little arch-gap, and a bench behind it
  for (const [x0, x1] of [[-0.1, -0.02], [0.02, 0.1]] as const) {
    k.add(box(x1 - x0, 0.032, 0.026), C.greensDark, { p: [(x0 + x1) / 2, 0.018, 0], mottle: 0.6 })
    k.add(box(x1 - x0 - 0.006, 0.006, 0.02), C.greens, { p: [(x0 + x1) / 2, 0.037, 0], mottle: 0.6 })
  }
  k.add(box(0.05, 0.006, 0.016), C.boardsLight, { p: [0.0, 0.022, -0.04] })
  for (const sx of [-1, 1]) k.add(box(0.005, 0.02, 0.012), C.timberDark, { p: [sx * 0.02, 0.01, -0.04] })
  for (let i = 0; i < 5; i++) k.add(sphere(0.006, 4, 3), C.flowers[(i * 2) % C.flowers.length], { p: [-0.09 + i * 0.045, 0.04, 0.012] })
}

// ---------------------------------------------------------------------------------------------
// The catalogue

export type CityVariant =
  | 'cottage' | 'thatched' | 'townhouse' | 'longhouse' | 'hiphouse' | 'tallhouse'
  | 'keep' | 'hall' | 'temple' | 'market' | 'workshop' | 'barracks'
  | 'farmWheat' | 'farmGreens' | 'farmFlowers' | 'farmWheatTar' | 'sawmill' | 'jetty' | 'stairs' | 'boat'
  | 'wall' | 'gate' | 'tower'
  | 'ground' | 'lanterns' | 'road' | 'well' | 'linden' | 'blossom' | 'bushes' | 'garden' | 'flowerbed' | 'hedge'

export const HOUSES: CityVariant[] = ['cottage', 'thatched', 'townhouse', 'longhouse', 'hiphouse', 'tallhouse']

const BUILDERS: Record<CityVariant, (k: Kit) => void> = {
  cottage, thatched, townhouse, longhouse, hiphouse, tallhouse,
  keep, hall, temple, market, workshop, barracks,
  farmWheat: (k) => farmstead(k, true, 'wheat', 1),
  farmGreens: (k) => farmstead(k, true, 'greens', 2),
  farmFlowers: (k) => farmstead(k, true, 'flowers', 3),
  farmWheatTar: (k) => farmstead(k, false, 'wheat', 4),
  sawmill, jetty, stairs, boat,
  wall: wallSide, gate, tower,
  ground, lanterns, road, well,
  linden: (k) => tree(k, C.leaf, 0),
  blossom: (k) => tree(k, [...C.blossom, C.leaf[1]], 1),
  bushes: (k) => bushes(k, 2),
  garden: (k) => garden(k, 1),
  flowerbed: (k) => flowerbed(k, 2),
  hedge,
}

const cache = new Map<CityVariant, Model>()
export function cityModel(v: CityVariant): Model {
  let m = cache.get(v)
  if (!m) {
    const k = new Kit()
    BUILDERS[v](k)
    m = k.build()
    cache.set(v, m)
  }
  return m
}

/** Roof tones for ordinary buildings (the player colour stays on accents and landmarks). */
export const ROOFS: { color: THREE.Color; weight: number }[] = [
  { color: new THREE.Color('#C46A45'), weight: 0.28 }, // terracotta
  { color: new THREE.Color('#A9553B'), weight: 0.14 }, // dark terracotta
  { color: new THREE.Color('#7D8899'), weight: 0.2 }, // warm slate blue-grey
  { color: new THREE.Color('#8C8792'), weight: 0.1 }, // lavender slate
  { color: new THREE.Color('#D3AE5E'), weight: 0.12 }, // thatch gold
  { color: new THREE.Color('#8E8D5C'), weight: 0.16 }, // mossy weathered tile
]

/** True when two colours are close in hue and both clearly coloured. */
export function hueClash(a: THREE.Color, b: THREE.Color, within = 0.07): boolean {
  const ha = { h: 0, s: 0, l: 0 }
  const hb = { h: 0, s: 0, l: 0 }
  a.getHSL(ha)
  b.getHSL(hb)
  const dh = Math.min(Math.abs(ha.h - hb.h), 1 - Math.abs(ha.h - hb.h))
  return dh < within && ha.s > 0.25 && hb.s > 0.25
}

/** Pick a plaster colour that does not fight the player colour. */
export function plasterFor(team: THREE.Color, pick: number): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 }
  team.getHSL(hsl)
  const ok = C.plaster.filter((c) => {
    const x = new THREE.Color(c)
    const h2 = { h: 0, s: 0, l: 0 }
    x.getHSL(h2)
    const dh = Math.min(Math.abs(h2.h - hsl.h), 1 - Math.abs(h2.h - hsl.h))
    return dh > 0.06 || h2.s < 0.18
  })
  return new THREE.Color(ok[Math.floor(pick * ok.length) % ok.length] ?? C.plaster[0])
}

/** Falu-red barns, unless the player is red; then tarred timber. */
export function barnIsFalu(team: THREE.Color): boolean {
  const hsl = { h: 0, s: 0, l: 0 }
  team.getHSL(hsl)
  return !(hsl.h < 0.06 || hsl.h > 0.95)
}
