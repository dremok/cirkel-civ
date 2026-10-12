// Thin-line icons drawn for the game: 24 px grid, 1.5 px stroke, round joins.
import type { ReactNode, SVGProps } from 'react'
import type { BuildingType, BuildItem, Stance, UnitType } from '../../engine/types.ts'

const PATHS = {
  spear: (
    <>
      <path d="M4.5 19.5 14.6 9.4" />
      <path d="M14.6 9.4c.8-2.8 2.8-4.8 5.4-5.4-.6 2.6-2.6 4.6-5.4 5.4Z" />
      <path d="M12.2 9.6l2.2 2.2" />
      <circle cx="16.6" cy="16.6" r="3.4" />
      <path d="M16.6 15.4v2.4" />
    </>
  ),
  archer: (
    <>
      <path d="M8 3.5c6 2.4 8.4 6 8.4 8.5S14 18.1 8 20.5" />
      <path d="M8 3.5v17" />
      <path d="M3.5 12H19" />
      <path d="M17 9.8 19.5 12 17 14.2" />
      <path d="M4.5 10.5 3.5 12l1 1.5" />
    </>
  ),
  rider: (
    <>
      <path d="M7 20.5v-3.2c-1.6-1.4-2.2-3.6-1.4-5.8L8 5.5 9.6 3.5l.9 2.4h2.6c3.2 0 5.6 2.4 6.2 5.2l.3 1.6-1.9.8-2.6-1.6-1.4.4c.1 2.4 1 5.2 2.4 8.2" />
      <path d="M10.6 9.1h.01" />
    </>
  ),
  settler: (
    <>
      <path d="M3.5 8.5h11l-1.2 6H4.7Z" />
      <circle cx="8.5" cy="17.5" r="2.5" />
      <path d="M14.5 8.5 20 5.5" />
      <path d="M8.5 8.5V3.5l4 1.5-4 1.5" />
    </>
  ),
  walls: (
    <>
      <path d="M3.5 20V9.5h3v2.5h3V9.5h5v2.5h3V9.5h3V20Z" />
      <path d="M10 20v-3.2a2 2 0 0 1 4 0V20" />
      <path d="M3.5 15h3.5M17 15h3.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12c2.4-4.2 5.6-6.3 9.5-6.3s7.1 2.1 9.5 6.3c-2.4 4.2-5.6 6.3-9.5 6.3S4.9 16.2 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  chevrons: (
    <>
      <path d="M6 13.5 12 7.5l6 6" />
      <path d="M6 18.5l6-6 6 6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.2 19 6v5.3c0 4.4-2.9 7.9-7 9.5-4.1-1.6-7-5.1-7-9.5V6Z" />
      <path d="M12 3.2v17.6" opacity=".45" />
    </>
  ),
  city: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M5 20.5v-7l3.5-3 3.5 3v7" />
      <path d="M12 20.5V9l3.8-3.5L19.5 9v11.5" />
      <path d="M8.5 20.5v-3M15.8 20.5V17M15.8 12h.01" />
    </>
  ),
  tower: (
    <>
      <path d="M7.5 20.5V8.5h9v12" />
      <path d="M6.5 8.5V4.5h2v2h2v-2h3v2h2v-2h2v4" />
      <path d="M10.5 20.5v-3.5a1.5 1.5 0 0 1 3 0v3.5M12 11.5h.01" />
    </>
  ),
  food: (
    <>
      <path d="M12 21V8" />
      <path d="M12 12.5c-2.6 0-4.2-1.6-4.2-4.2 2.6 0 4.2 1.6 4.2 4.2ZM12 12.5c2.6 0 4.2-1.6 4.2-4.2-2.6 0-4.2 1.6-4.2 4.2ZM12 17c-2.6 0-4.2-1.6-4.2-4.2 2.6 0 4.2 1.6 4.2 4.2ZM12 17c2.6 0 4.2-1.6 4.2-4.2-2.6 0-4.2 1.6-4.2 4.2Z" />
      <path d="M12 8c-1.2-1-1.2-3 0-4.5 1.2 1.5 1.2 3.5 0 4.5Z" />
    </>
  ),
  prod: (
    <>
      <path d="M13.5 6.5 4 16l3 3 9.5-9.5" />
      <path d="M11.8 4.2c2.3-1 4.9-.8 6.6.6l1.6 1.6-3.6 3.6-3.7-3.7Z" />
    </>
  ),
  pop: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 20c.6-3.7 3.2-6 6.5-6s5.9 2.3 6.5 6" />
    </>
  ),
  heart: <path d="M12 19.5s-7.5-4.4-7.5-9.6A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.3c0 5.2-7.5 9.6-7.5 9.6Z" />,
  next: (
    <>
      <path d="M4 12h12.5" />
      <path d="M12.5 7.5 17 12l-4.5 4.5" />
      <path d="M20 6v12" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="M5 12.5 9.8 17 19 7.5" />,
  share: (
    <>
      <path d="M12 3.5v11" />
      <path d="M8 7.2 12 3.5l4 3.7" />
      <path d="M8 10.5H6.5v10h11v-10H16" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  menu: <path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15" />,
  replay: (
    <>
      <path d="M4.8 12a7.2 7.2 0 1 0 2.1-5.1" />
      <path d="M4.5 3.8v3.7h3.7" />
      <path d="m10.5 9.3 4 2.7-4 2.7Z" />
    </>
  ),
  skip: (
    <>
      <path d="m5 6.5 7 5.5-7 5.5ZM12 6.5l7 5.5-7 5.5Z" />
    </>
  ),
  bot: (
    <>
      <rect x="5" y="8" width="14" height="10.5" rx="3" />
      <path d="M12 8V4.8M12 4.5h.01" />
      <path d="M9.3 12.8v.4M14.7 12.8v.4" />
      <path d="M3 12.5v2.5M21 12.5v2.5" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8.3" r="3.5" />
      <path d="M5 20c.7-4 3.4-6.4 7-6.4s6.3 2.4 7 6.4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  crown: (
    <>
      <path d="M4 17.5 3 8l5 4 4-6.5 4 6.5 5-4-1 9.5Z" />
      <path d="M4.5 20.5h15" />
    </>
  ),
  star: <path d="m12 4 2.3 5 5.4.6-4 3.6 1.1 5.3L12 15.8l-4.8 2.7 1.1-5.3-4-3.6 5.4-.6Z" />,
  flag: (
    <>
      <path d="M6 21V3.5" />
      <path d="M6 4.5h11.5L15 8.2l2.5 3.8H6" />
    </>
  ),
  swords: (
    <>
      <path d="M5 5l10.5 10.5M12.5 17.5l5-5M15.5 15.5 19 19" />
      <path d="M19 5 8.5 15.5M11.5 17.5l-5-5M8.5 15.5 5 19" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
    </>
  ),
  undo: (
    <>
      <path d="M8.5 5.5 4.5 9.5l4 4" />
      <path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.5c-2-1.6-4.8-2-8-1.6v13.2c3.2-.4 6 0 8 1.6 2-1.6 4.8-2 8-1.6V4.9c-3.2-.4-6 0-8 1.6Z" />
      <path d="M12 6.5v13.2" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7M12 16.8h.01" />
    </>
  ),
  home: (
    <>
      <path d="M4 11 12 4.5l8 6.5" />
      <path d="M6 9.5v10h12v-10" />
    </>
  ),
  saw: (
    <>
      <path d="M3.5 15.5 15 4l5.5 5.5L9 21Z" />
      <path d="M7 12l1.5 1.5M10 9l1.5 1.5M13 6l1.5 1.5" />
    </>
  ),
  market: (
    <>
      <path d="M4 9.5 5.5 4.5h13L20 9.5" />
      <path d="M4 9.5c0 1.4 1 2.3 2.7 2.3s2.6-.9 2.6-2.3c0 1.4 1 2.3 2.7 2.3s2.7-.9 2.7-2.3c0 1.4.9 2.3 2.6 2.3S20 10.9 20 9.5Z" />
      <path d="M5.5 11.5v8h13v-8M10 19.5v-4.5h4v4.5" />
    </>
  ),
  anchor: (
    <>
      <circle cx="12" cy="5.5" r="2" />
      <path d="M12 7.5v13M8.5 11h7" />
      <path d="M4.5 14c.6 3.8 3.6 6.5 7.5 6.5s6.9-2.7 7.5-6.5M4.5 14l-1 1.5M4.5 14l1.7.6M19.5 14l1 1.5M19.5 14l-1.7.6" />
    </>
  ),
  temple: (
    <>
      <path d="M3.5 9 12 4l8.5 5Z" />
      <path d="M5 9v9M9.7 9v9M14.3 9v9M19 9v9" />
      <path d="M3.5 20.5h17M4.5 18h15" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" />
    </>
  ),
  soundOff: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  cloud: <path d="M7 18.5h10.2a3.8 3.8 0 0 0 .5-7.6A5.6 5.6 0 0 0 6.9 9.6 4.5 4.5 0 0 0 7 18.5Z" />,
  eyeOff: (
    <>
      <path d="M9.9 6a9.6 9.6 0 0 1 2.1-.3c3.9 0 7.1 2.1 9.5 6.3a16 16 0 0 1-2.2 3M6.5 7.6A15 15 0 0 0 2.5 12c2.4 4.2 5.6 6.3 9.5 6.3 1.5 0 2.9-.3 4.2-.9" />
      <path d="M10 10.2a2.8 2.8 0 0 0 3.8 3.8M3.5 3.5l17 17" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  arrowRight: (
    <>
      <path d="M4.5 12h15" />
      <path d="M14 6.5l5.5 5.5-5.5 5.5" />
    </>
  ),
  eyeOpen: (
    <>
      <path d="M2.5 12c2.4-4.2 5.6-6.3 9.5-6.3s7.1 2.1 9.5 6.3c-2.4 4.2-5.6 6.3-9.5 6.3S4.9 16.2 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  wifiOff: (
    <>
      <path d="M3 3.5l18 17" />
      <path d="M8.6 15.5a5 5 0 0 1 6.4-.3M5.3 12.3a9.7 9.7 0 0 1 4.3-2.3M18.8 12.4a9.7 9.7 0 0 0-3.2-2M2 9a14.6 14.6 0 0 1 4-2.5M22 9a14.6 14.6 0 0 0-9.6-3.9M12 19h.01" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20, className, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ? `icon ${className}` : 'icon'}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}

export const UNIT_ICON: Record<UnitType, IconName> = {
  spear: 'spear',
  archer: 'archer',
  rider: 'rider',
  settler: 'settler',
}

export const BUILDING_ICON: Record<BuildingType, IconName> = {
  house: 'home',
  farm: 'food',
  sawmill: 'saw',
  workshop: 'prod',
  market: 'market',
  harbor: 'anchor',
  barracks: 'swords',
  temple: 'temple',
  tower: 'tower',
  wall: 'walls',
}

export const buildIcon = (item: BuildItem): IconName => (typeof item === 'string' ? UNIT_ICON[item] : BUILDING_ICON[item.building])

export const STANCE_ICON: Record<Stance, IconName> = {
  cautious: 'eye',
  aggressive: 'chevrons',
  hold: 'shield',
}
