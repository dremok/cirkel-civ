// Tiny sRGB helpers for UI drawing.

function parse(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function fmt([r, g, b]: [number, number, number]): string {
  const c = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Mix `a` toward `b` by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const x = parse(a)
  const y = parse(b)
  return fmt([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

/** Positive = lighter (toward white), negative = darker (toward a warm near-black). */
export function shade(c: string, t: number): string {
  return t >= 0 ? mix(c, '#ffffff', t) : mix(c, '#1c1712', -t)
}

export function rgba(c: string, a: number): string {
  const [r, g, b] = parse(c)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
