/**
 * The inks a logo is drawn in, by how much of it each one draws: the logo
 * is drawn here, in the page that showed it, and its pixels counted. The
 * app then knows how much of the logo would show on any surface (a white
 * wordmark beside a coloured mark is mostly white, whatever its markup says;
 * a bitmap's colours are in no markup at all).
 *
 * Used twice: by the browser reader, as a pass of its own after the
 * measurement, and by the editor, for the logo a person uploaded. For the
 * reader it must stay self-contained: it is sent as its source text and runs
 * in the page, so it refers to nothing outside its own body. Anything that
 * goes wrong (a page that forbids data images, a picture that will not
 * decode, pixels that may not be read) reads as null, and the caller falls
 * back: the reader to what the logo's markup says, the editor to no warning.
 */
export interface LogoInk {
  /** `#rrggbb`. */
  color: string
  /** The share of the logo's drawn pixels in this ink, 0 to 1. */
  share: number
  /**
   * Where in the logo this ink is drawn: the box round its pixels, as
   * `[left, top, right, bottom]` in shares of the logo's width and height.
   */
  box?: [number, number, number, number]
  /**
   * The picture's own ground: this ink is at all four corners, so it is a
   * plate the logo sits on, not the logo.
   */
  plate?: boolean
}

export async function measureLogoInk(src: string, w: number, h: number): Promise<LogoInk[] | null> {
  const MAX_SIDE = 160
  const MAX_INKS = 8
  const WAIT_MS = 1500
  try {
    const image = new Image()
    const loaded = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), WAIT_MS)
      image.onload = () => {
        clearTimeout(timer)
        resolve(true)
      }
      image.onerror = () => {
        clearTimeout(timer)
        resolve(false)
      }
      image.src = src
    })
    if (!loaded) return null
    const wide = w > 0 ? w : image.naturalWidth || image.width
    const tall = h > 0 ? h : image.naturalHeight || image.height
    if (!(wide > 0) || !(tall > 0)) return null
    const scale = Math.min(1, MAX_SIDE / Math.max(wide, tall))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(wide * scale))
    canvas.height = Math.max(1, Math.round(tall * scale))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    // Colours in steps of 16 a channel; each pixel counts by how solid it is.
    type Ink = { r: number; g: number; b: number; weight: number; box: number[] }
    const weights = new Map<number, Ink>()
    let total = 0
    for (let i = 0; i + 3 < data.length; i += 4) {
      const alpha = data[i + 3]! / 255
      if (alpha < 0.2) continue
      const key = ((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4)
      const x = (i / 4) % canvas.width
      const y = Math.floor(i / 4 / canvas.width)
      const entry = weights.get(key) ?? { r: 0, g: 0, b: 0, weight: 0, box: [x, y, x, y] }
      entry.r += data[i]! * alpha
      entry.g += data[i + 1]! * alpha
      entry.b += data[i + 2]! * alpha
      entry.weight += alpha
      // Only pixels that are really this ink mark where it is: a soft edge is a blend.
      if (alpha >= 0.6)
        entry.box = [
          Math.min(entry.box[0]!, x),
          Math.min(entry.box[1]!, y),
          Math.max(entry.box[2]!, x),
          Math.max(entry.box[3]!, y),
        ]
      weights.set(key, entry)
      total += alpha
    }
    if (total === 0) return []
    // The ink at all four corners is the picture's ground, when it has one.
    const cornerKeys = [
      0,
      canvas.width - 1,
      (canvas.height - 1) * canvas.width,
      canvas.height * canvas.width - 1,
    ].map((pixel) => {
      const i = pixel * 4
      return data[i + 3]! / 255 >= 0.6
        ? ((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4)
        : -1
    })
    const ground = cornerKeys.every((key) => key !== -1 && key === cornerKeys[0])
      ? weights.get(cornerKeys[0]!)
      : undefined
    const hex = (value: number) => Math.round(value).toString(16).padStart(2, '0')
    return [...weights.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_INKS)
      .map((ink) => ({
        color: `#${hex(ink.r / ink.weight)}${hex(ink.g / ink.weight)}${hex(ink.b / ink.weight)}`,
        share: Math.round((ink.weight / total) * 1000) / 1000,
        box: [
          Math.round((ink.box[0]! / canvas.width) * 100) / 100,
          Math.round((ink.box[1]! / canvas.height) * 100) / 100,
          Math.round(((ink.box[2]! + 1) / canvas.width) * 100) / 100,
          Math.round(((ink.box[3]! + 1) / canvas.height) * 100) / 100,
        ] as [number, number, number, number],
        ...(ink === ground ? { plate: true } : {}),
      }))
  } catch {
    return null
  }
}
