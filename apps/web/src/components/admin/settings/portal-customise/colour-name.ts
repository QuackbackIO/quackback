/**
 * A colour's plain name, for the chat's reply ("Header is now navy"): its hue
 * and how light it is, nothing finer. The exact value stays in the swatch's
 * tooltip.
 */
import { tryCssColorToHex } from '@/lib/shared/theme'

/** Hue bands, each up to (not including) its end, in degrees. */
const HUES: ReadonlyArray<[end: number, name: string]> = [
  [15, 'red'],
  [40, 'orange'],
  [65, 'yellow'],
  [165, 'green'],
  [195, 'teal'],
  [255, 'blue'],
  [295, 'purple'],
  [345, 'pink'],
  [360, 'red'],
]

function grey(lightness: number): string {
  if (lightness >= 0.98) return 'white'
  if (lightness >= 0.93) return 'off-white'
  if (lightness >= 0.7) return 'light grey'
  if (lightness >= 0.35) return 'grey'
  if (lightness >= 0.1) return 'dark grey'
  return 'black'
}

/** "navy", "dark green", "light grey", "orange"; null for anything that is not a colour. */
export function colourName(colour: string): string | null {
  const hex = tryCssColorToHex(colour)
  if (!hex) return null
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  const lightness = (max + min) / 2
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1))
  // Too little colour to name a hue.
  if (chroma < 0.06 || saturation < 0.15) return grey(lightness)

  let hue: number
  if (max === r) hue = ((g - b) / chroma) % 6
  else if (max === g) hue = (b - r) / chroma + 2
  else hue = (r - g) / chroma + 4
  hue = (hue * 60 + 360) % 360
  const name = HUES.find(([end]) => hue < end)![1]

  // Dark colours with names of their own.
  if (name === 'blue' && lightness < 0.3) return 'navy'
  if ((name === 'orange' || name === 'yellow') && lightness < 0.3) return 'brown'
  if (name === 'yellow' && lightness < 0.42) return 'gold'
  if (lightness < 0.25) return `dark ${name}`
  if (lightness > 0.78) return `light ${name}`
  return name
}
