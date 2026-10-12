// Thin-line icons for the city screen: 24 px grid, 1.5 px stroke, round joins (as the game's own).
import type { ReactNode, SVGProps } from 'react'
import type { BuildingType } from '../../engine/city.ts'

const P = {
  food: (
    <>
      <path d="M12 21V8.5" />
      <path d="M12 8.5c-2.2-.3-3.6-1.9-3.8-4.5 2.4.2 3.7 1.8 3.8 4.5Z" />
      <path d="M12 8.5c2.2-.3 3.6-1.9 3.8-4.5-2.4.2-3.7 1.8-3.8 4.5Z" />
      <path d="M12 13c-2.4-.2-3.9-1.8-4.2-4.4 2.6.1 4 1.7 4.2 4.4Z" />
      <path d="M12 13c2.4-.2 3.9-1.8 4.2-4.4-2.6.1-4 1.7-4.2 4.4Z" />
      <path d="M12 17.4c-2.4-.2-3.9-1.8-4.2-4.4 2.6.1 4 1.7 4.2 4.4Z" />
      <path d="M12 17.4c2.4-.2 3.9-1.8 4.2-4.4-2.6.1-4 1.7-4.2 4.4Z" />
    </>
  ),
  prod: (
    <>
      <path d="M13.5 6.5 4.8 15.2a1.8 1.8 0 0 0 2.5 2.5L16 9" />
      <path d="M11.2 4.2 15 3l6 6-1.2 3.8-2.4-2.4-1.8 1.8L12.6 9l1.8-1.8Z" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="7.5" r="2.8" />
      <path d="M3.8 19.5c.5-3.6 2.4-5.6 5.2-5.6s4.7 2 5.2 5.6" />
      <circle cx="16.6" cy="8.6" r="2.2" />
      <path d="M15.6 13.9c2.6-.3 4.2 1.4 4.7 4.6" />
    </>
  ),
  housing: (
    <>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  turns: (
    <>
      <path d="M7 3.5h10M7 20.5h10" />
      <path d="M8 3.5c0 4 2 5.6 4 8.5-2 2.9-4 4.5-4 8.5" />
      <path d="M16 3.5c0 4-2 5.6-4 8.5 2 2.9 4 4.5 4 8.5" />
      <path d="M10 18h4" />
    </>
  ),
  plot: (
    <>
      <path d="M12 3.2 19.6 7.6v8.8L12 20.8l-7.6-4.4V7.6Z" strokeDasharray="2.2 2" />
      <path d="M12 9v6M9 12h6" />
    </>
  ),
  back: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  // buildings
  house: (
    <>
      <path d="M3.5 12 9.5 6.5l6 5.5" />
      <path d="M5 11v8.5h9V11" />
      <path d="M13.5 9.2V6h2.4v5.4" />
      <path d="M15.5 12 20.5 12v7.5H14" />
      <path d="M8 19.5v-3.5h3v3.5" />
    </>
  ),
  farm: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M4.5 11 10 6.5l5.5 4.5" />
      <path d="M5.5 10v10.5h9V10" />
      <path d="M8 20.5v-5l2-1.5 2 1.5v5" />
      <path d="M17.5 20.5V12M17.5 12c-1.4-.2-2.2-1.2-2.4-2.8 1.5.1 2.3 1.1 2.4 2.8Z" />
      <path d="M17.5 15.5c1.4-.2 2.2-1.2 2.4-2.8-1.5.1-2.3 1.1-2.4 2.8Z" />
    </>
  ),
  sawmill: (
    <>
      <circle cx="9" cy="13" r="6" />
      <circle cx="9" cy="13" r="1.4" />
      <path d="M9 7v4.6M9 14.4V19M3 13h4.6M10.4 13H15M4.8 8.8l3.2 3.2M10 14l3.2 3.2M13.2 8.8 10 12M8 14l-3.2 3.2" />
      <path d="M15 11.5h5.5v9H11" />
    </>
  ),
  workshop: (
    <>
      <path d="M4 15.5h11l-1.5 2.5H6.5Z" />
      <path d="M6.5 15.5c0-2.2 1.6-3 3.5-3h7.5c0 1.6-1 2.6-3 3" />
      <path d="M8 18v2.5M12 18v2.5" />
      <path d="M14 3.5 19 8.5M16.5 6l-3 3" />
    </>
  ),
  market: (
    <>
      <path d="M3.5 9.5 5.5 4.5h13l2 5" />
      <path d="M3.5 9.5c0 1.4 1 2.2 2.1 2.2s2.1-.8 2.1-2.2c0 1.4 1 2.2 2.1 2.2s2.1-.8 2.1-2.2c0 1.4 1 2.2 2.1 2.2s2.1-.8 2.1-2.2c0 1.4 1 2.2 2.1 2.2s2.1-.8 2.1-2.2" />
      <path d="M5.5 12v8.5h13V12" />
      <path d="M9.5 20.5v-4.5h5v4.5" />
    </>
  ),
  harbor: (
    <>
      <path d="M12 3.5v13" />
      <path d="M12 4.5l6 9.5h-6" />
      <path d="M4.5 16.5h15l-2 3.5h-11Z" />
      <path d="M2.5 21c1.2 0 1.8-.6 3-.6s1.8.6 3 .6" opacity=".6" />
    </>
  ),
  barracks: (
    <>
      <path d="M6 20.5 18 4.5" />
      <path d="M18 4.5 19.5 3l-.3 2.5-1.6.8Z" />
      <path d="M18 20.5 6 4.5" />
      <path d="M6 4.5 4.5 3l.3 2.5 1.6.8Z" />
      <path d="M12 9.5c2.6.7 4.4 1.8 4.4 4.5 0 3-2.1 4.6-4.4 6-2.3-1.4-4.4-3-4.4-6 0-2.7 1.8-3.8 4.4-4.5Z" />
    </>
  ),
  temple: (
    <>
      <path d="M12 2.5v3.5M10.5 4h3" />
      <path d="M9 11.5 12 6l3 5.5" />
      <path d="M9 11.5v9h6v-9" />
      <path d="M15 14h5.5v6.5H15M9 14H3.5v6.5H9" />
      <path d="M11 20.5v-3a1 1 0 0 1 2 0v3" />
    </>
  ),
  tower: (
    <>
      <path d="M7.5 20.5 8.5 9.5h7l1 11Z" />
      <path d="M7 9.5h10V7h-1.8v1.2h-1.6V7h-3.2v1.2H8.8V7H7Z" />
      <path d="M12 7V2.5l3 1.2-3 1.2" />
      <path d="M11 20.5v-3a1 1 0 0 1 2 0v3" />
      <path d="M12 12.5v2" />
    </>
  ),
  wall: (
    <>
      <path d="M3 20.5V10.5h2.5V12H8v-1.5h2.5V12H13v-1.5h2.5V12H18v-1.5h3v10" />
      <path d="M10 20.5v-3.5a2 2 0 0 1 4 0v3.5" />
      <path d="M3 15.5h4M17 15.5h4" opacity=".6" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof P

export function Icon({ name, ...rest }: { name: IconName | BuildingType } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="cv-icon" {...rest}>
      {P[name as IconName]}
    </svg>
  )
}
