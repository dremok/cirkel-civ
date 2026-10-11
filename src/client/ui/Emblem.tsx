// The home screen's emblem: a small hand-composed island of hex columns, drawn as an oblique SVG
// in the game's palette. Columns rise into place on load.
import { memo, type ReactNode } from 'react'
import type { Biome } from '../../engine/types.ts'
import { BIOME, NATURE, PLAYERS } from '../render/palette.ts'
import { mix, shade } from './color.ts'

const S = 30 // px per world unit (hex circumradius)
const K = 0.6 // squash of the ground plane
const HL = 8.5 // px per height level
const FOOT = -1.6 // level where every column ends

type Prop = 'city' | 'peak' | 'pines' | 'broad' | 'rocks' | 'wheat' | 'tufts'
interface Cell { q: number; r: number; h: number; b: Biome; prop?: Prop }

const CELLS: Cell[] = [
  { q: 0, r: 0, h: 4, b: 'grass', prop: 'city' },
  { q: 1, r: -1, h: 6, b: 'mountain', prop: 'peak' },
  { q: 0, r: -1, h: 5, b: 'hills', prop: 'rocks' },
  { q: 1, r: 0, h: 4, b: 'forest', prop: 'pines' },
  { q: 0, r: 1, h: 3, b: 'grass', prop: 'tufts' },
  { q: -1, r: 1, h: 3, b: 'plains', prop: 'wheat' },
  { q: -1, r: 0, h: 3, b: 'forest', prop: 'broad' },
  { q: 2, r: -2, h: 4, b: 'forest', prop: 'pines' },
  { q: 2, r: -1, h: 3, b: 'forest', prop: 'pines' },
  { q: 2, r: 0, h: 3, b: 'grass' },
  { q: 1, r: 1, h: 2, b: 'grass', prop: 'tufts' },
  { q: 0, r: 2, h: 2, b: 'beach' },
  { q: -1, r: 2, h: 2, b: 'beach' },
  { q: -2, r: 2, h: 1, b: 'shallow' },
  { q: -2, r: 1, h: 2, b: 'beach' },
  { q: -2, r: 0, h: 2, b: 'plains', prop: 'wheat' },
  { q: -1, r: -1, h: 3, b: 'forest', prop: 'broad' },
  { q: 0, r: -2, h: 4, b: 'grass', prop: 'tufts' },
  { q: 1, r: -2, h: 5, b: 'forest', prop: 'pines' },
]
// The outer ring is sea.
for (let i = 0; i < 6; i++) {
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
  const [sq, sr] = dirs[(i + 4) % 6]
  const [dq, dr] = dirs[i]
  for (let k = 0; k < 3; k++) CELLS.push({ q: sq * 3 + dq * k, r: sr * 3 + dr * k, h: 1, b: 'shallow' })
}

const project = (x: number, z: number, h: number) => ({ X: x * S, Y: z * S * K - h * HL })

function corners(cx: number, cz: number, h: number, inset = 0.965) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30)
    return project(cx + Math.cos(a) * inset, cz + Math.sin(a) * inset, h)
  })
}

const pts = (p: { X: number; Y: number }[]) => p.map((v) => `${v.X.toFixed(1)},${v.Y.toFixed(1)}`).join(' ')

function hash(q: number, r: number) {
  const s = Math.sin(q * 127.1 + r * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function sideBands(c: Cell): [number, number, string][] {
  const biome = BIOME[c.b]
  return [
    [c.h, c.h - 0.42, shade(biome.dark, -0.06)],
    [c.h - 0.42, Math.max(FOOT, 1.4), NATURE.earth],
    [Math.max(FOOT, 1.4), 0.2, NATURE.strataRock],
    [0.2, FOOT, NATURE.base],
  ]
}

function Column({ c, delay }: { c: Cell; delay: number }) {
  const x = Math.sqrt(3) * (c.q + c.r / 2)
  const z = 1.5 * c.r
  const water = c.b === 'shallow' || c.b === 'deep'
  const top = corners(x, z, c.h)
  const jitter = (hash(c.q, c.r) - 0.5) * 0.06
  const topColor = water ? mix(mix(BIOME.shallow.base, BIOME.deep.light, 0.3), BIOME.shallow.light, 0.12 + jitter * 3) : shade(BIOME[c.b].base, jitter)
  const faces: ReactNode[] = []
  for (const [i, light] of [[1, 0.04], [2, -0.16]] as const) {
    if (water) {
      const a0 = corners(x, z, c.h)
      const a1 = corners(x, z, FOOT)
      faces.push(
        <polygon key={i} points={pts([a0[i], a0[(i + 1) % 6], a1[(i + 1) % 6], a1[i]])} fill={`url(#emblem-water-${i})`} />,
        <polyline key={`f${i}`} points={pts([a0[i], a0[(i + 1) % 6]])} stroke={NATURE.foam} strokeOpacity={0.75} strokeWidth={1.2} />,
      )
      continue
    }
    for (const [h0, h1, col] of sideBands(c)) {
      if (h0 <= h1) continue
      const a0 = corners(x, z, h0)
      const a1 = corners(x, z, h1)
      faces.push(
        <polygon key={`${i}-${h0}`} points={pts([a0[i], a0[(i + 1) % 6], a1[(i + 1) % 6], a1[i]])} fill={shade(col, light)} />,
      )
    }
  }
  const ctr = project(x, z, c.h)
  return (
    <g className="emblem-col" style={{ animationDelay: `${delay}ms` }}>
      {faces}
      <polygon points={pts(top)} fill={topColor} />
      <polyline points={pts([top[3], top[4], top[5], top[0]])} fill="none" stroke={shade(topColor, 0.28)} strokeWidth={0.9} strokeLinejoin="round" />
      {c.prop && <PropShape kind={c.prop} X={ctr.X} Y={ctr.Y} seed={hash(c.r, c.q)} />}
    </g>
  )
}

function Pine({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g>
      <ellipse cx={x + 1.5} cy={y + 0.6} rx={4.6 * s} ry={1.6 * s} fill="rgba(30,26,20,0.18)" />
      <polygon points={`${x - 4.2 * s},${y} ${x},${y - 14 * s} ${x},${y}`} fill={NATURE.pine} />
      <polygon points={`${x},${y} ${x},${y - 14 * s} ${x + 4.2 * s},${y}`} fill={NATURE.pineLight} />
    </g>
  )
}

function Broad({ x, y, s = 1, accent = false }: { x: number; y: number; s?: number; accent?: boolean }) {
  const base = accent ? NATURE.rust : NATURE.broadleaf
  const light = accent ? NATURE.amber : NATURE.broadleafLight
  return (
    <g>
      <ellipse cx={x + 1.5} cy={y + 0.6} rx={4.8 * s} ry={1.6 * s} fill="rgba(30,26,20,0.18)" />
      <path d={`M${x} ${y}v${-5 * s}`} stroke={NATURE.earth} strokeWidth={1.2} />
      <circle cx={x} cy={y - 8 * s} r={5 * s} fill={base} />
      <circle cx={x + 1.1 * s} cy={y - 9 * s} r={3.8 * s} fill={light} />
    </g>
  )
}

function House({ x, y, roof, roofDark, tall = 0 }: { x: number; y: number; roof: string; roofDark: string; tall?: number }) {
  const wall = '#F3EBDD'
  const wallDark = '#D6C7AE'
  const t = tall
  return (
    <g>
      <ellipse cx={x + 2} cy={y + 0.8} rx={7} ry={2} fill="rgba(30,26,20,0.2)" />
      <polygon points={`${x - 4},${y} ${x + 1},${y} ${x + 1},${y - 6 - t} ${x - 4},${y - 6 - t}`} fill={wall} />
      <polygon points={`${x + 1},${y} ${x + 6.5},${y - 2.2} ${x + 6.5},${y - 8.2 - t} ${x + 1},${y - 6 - t}`} fill={wallDark} />
      <polygon points={`${x - 4},${y - 6 - t} ${x + 1},${y - 6 - t} ${x - 1.5},${y - 10.5 - t}`} fill={wall} />
      <polygon points={`${x - 1.5},${y - 10.5 - t} ${x + 4},${y - 12.7 - t} ${x + 7},${y - 8 - t} ${x + 1},${y - 5.7 - t}`} fill={roof} />
      <polyline points={`${x - 4.4},${y - 5.6 - t} ${x - 1.5},${y - 10.6 - t} ${x + 1},${y - 5.8 - t}`} fill="none" stroke={roofDark} strokeWidth={1.1} strokeLinejoin="round" />
    </g>
  )
}

function PropShape({ kind, X, Y, seed }: { kind: Prop; X: number; Y: number; seed: number }) {
  const red = PLAYERS[0]
  switch (kind) {
    case 'pines':
      return (
        <g>
          <Pine x={X - 8} y={Y - 2} s={0.9} />
          <Pine x={X + 6} y={Y - 4} s={1.05} />
          <Pine x={X - 1} y={Y + 5} s={1.15} />
        </g>
      )
    case 'broad':
      return (
        <g>
          <Broad x={X - 7} y={Y - 1} s={0.85} />
          <Broad x={X + 6} y={Y - 3} s={0.95} accent={seed > 0.5} />
          <Broad x={X} y={Y + 5} s={1.05} />
        </g>
      )
    case 'peak': {
      const B = BIOME.mountain
      return (
        <g>
          <ellipse cx={X + 3} cy={Y + 3} rx={15} ry={4} fill="rgba(30,26,20,0.16)" />
          <polygon points={`${X - 13},${Y + 3} ${X + 1},${Y - 30} ${X + 2},${Y + 5}`} fill={B.dark} />
          <polygon points={`${X + 2},${Y + 5} ${X + 1},${Y - 30} ${X + 14},${Y + 2}`} fill={B.light} />
          <polygon points={`${X - 4.5},${Y - 16} ${X + 1},${Y - 30} ${X + 1.6},${Y - 18} ${X - 1.5},${Y - 14.5}`} fill={BIOME.snow.dark} />
          <polygon points={`${X + 1.6},${Y - 18} ${X + 1},${Y - 30} ${X + 7},${Y - 16.5} ${X + 4},${Y - 17.5}`} fill={BIOME.snow.base} />
        </g>
      )
    }
    case 'rocks':
      return (
        <g>
          <polygon points={`${X - 9},${Y + 1} ${X - 6},${Y - 4} ${X - 3},${Y + 1.5}`} fill={shade(NATURE.rock, 0.12)} />
          <polygon points={`${X - 9},${Y + 1} ${X - 6},${Y - 4} ${X - 6.5},${Y + 1.6}`} fill={shade(NATURE.rock, -0.15)} />
          <polygon points={`${X + 4},${Y + 4} ${X + 6.5},${Y + 0.5} ${X + 9},${Y + 4.2}`} fill={shade(NATURE.rock, 0.12)} />
          <polygon points={`${X + 4},${Y + 4} ${X + 6.5},${Y + 0.5} ${X + 6},${Y + 4.3}`} fill={shade(NATURE.rock, -0.15)} />
        </g>
      )
    case 'wheat':
      return (
        <g stroke={BIOME.plains.dark} strokeWidth={1.1} strokeLinecap="round">
          {[[-8, -1], [-4, 3], [3, -3], [7, 2], [0, 5]].map(([dx, dy], i) => (
            <path key={i} d={`M${X + dx} ${Y + dy}v-4.5M${X + dx + 1.5} ${Y + dy + 0.5}v-3.6M${X + dx - 1.5} ${Y + dy + 0.4}v-3.2`} />
          ))}
        </g>
      )
    case 'tufts':
      return (
        <g stroke={BIOME.grass.dark} strokeWidth={1} strokeLinecap="round">
          {[[-7, 0], [5, -3], [2, 5]].map(([dx, dy], i) => (
            <path key={i} d={`M${X + dx - 1.4} ${Y + dy}l-.6-2.6M${X + dx} ${Y + dy}v-3.2M${X + dx + 1.4} ${Y + dy}l.6-2.6`} />
          ))}
          <circle cx={X - 2} cy={Y + 1} r={1} fill="#F4F1E8" stroke="none" />
          <circle cx={X + 8} cy={Y + 2} r={0.9} fill={PLAYERS[2].light} stroke="none" />
        </g>
      )
    case 'city':
      return (
        <g transform={`translate(${X} ${Y}) scale(1.3) translate(${-X} ${-Y})`}>
          <House x={X - 9} y={Y - 2} roof={red.base} roofDark={red.dark} />
          <g>
            <ellipse cx={X + 3} cy={Y - 4} rx={5} ry={1.6} fill="rgba(30,26,20,0.2)" />
            <polygon points={`${X - 1},${Y - 4} ${X + 3},${Y - 4} ${X + 3},${Y - 21} ${X - 1},${Y - 21}`} fill="#F3EBDD" />
            <polygon points={`${X + 3},${Y - 4} ${X + 6},${Y - 5.2} ${X + 6},${Y - 22.2} ${X + 3},${Y - 21}`} fill="#D6C7AE" />
            <path d={`M${X - 1} ${Y - 21}v-2h1.3v1.2h1.4v-1.2h1.3v2M${X + 3} ${Y - 21}l3-1.2v-2l-1.5.6v1l-1.5.6Z`} fill="#F3EBDD" stroke="#D6C7AE" strokeWidth={0.6} />
            <path d={`M${X + 1} ${Y - 24}v-8`} stroke={NATURE.earth} strokeWidth={0.9} />
            <path d={`M${X + 1} ${Y - 32}l6 1.6-6 1.6Z`} fill={red.base} />
          </g>
          <House x={X + 6} y={Y + 5} roof={red.base} roofDark={red.dark} />
          <House x={X - 3} y={Y + 8} roof={red.light} roofDark={red.dark} />
          <g className="emblem-smoke" fill="#F4F1E8">
            <circle cx={X - 6} cy={Y - 17} r={1.6} opacity={0.7} />
            <circle cx={X - 4.5} cy={Y - 21} r={2.1} opacity={0.45} />
            <circle cx={X - 2.5} cy={Y - 25.5} r={2.6} opacity={0.22} />
          </g>
        </g>
      )
  }
}

export const Emblem = memo(function Emblem({ className }: { className?: string }) {
  const cells = [...CELLS].sort((a, b) => a.r - b.r || a.q + a.r / 2 - (b.q + b.r / 2))
  const xs = cells.map((c) => Math.sqrt(3) * (c.q + c.r / 2) * S)
  const ys = cells.map((c) => 1.5 * c.r * S * K)
  const minX = Math.min(...xs) - S
  const maxX = Math.max(...xs) + S
  const minY = Math.min(...ys) - S * K - 7 * HL - 30
  const maxY = Math.max(...ys) + S * K - FOOT * HL + 24
  return (
    <svg className={className} viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} role="img" aria-label="A small island of hexagons with a town">
      <defs>
        {([[1, 0.04], [2, -0.14]] as const).map(([i, l]) => (
          <linearGradient key={i} id={`emblem-water-${i}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={shade(mix(BIOME.shallow.dark, BIOME.deep.base, 0.35), l)} />
            <stop offset="1" stopColor={shade(BIOME.deep.dark, l)} />
          </linearGradient>
        ))}
        <radialGradient id="emblem-shadow">
          <stop offset="0" stopColor="#2A2622" stopOpacity="0.22" />
          <stop offset="1" stopColor="#2A2622" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={0} cy={maxY - 18} rx={(maxX - minX) * 0.46} ry={16} fill="url(#emblem-shadow)" />
      {cells.map((c) => (
        <Column key={`${c.q},${c.r}`} c={c} delay={120 + (Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r)) * 6 + c.r + 3) * 28} />
      ))}
    </svg>
  )
})
