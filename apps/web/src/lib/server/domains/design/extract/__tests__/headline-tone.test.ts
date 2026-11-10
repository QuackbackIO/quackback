/**
 * Two-tone headlines: a headline whose later lines (or words) are set in a
 * second, lighter or coloured ink, as Paylane's first sentence in navy and
 * the rest in slate. Read from the ink colours line by line; a one-colour
 * headline, or one whose colours do not split in two runs, has none.
 */
import { describe, expect, it } from 'vitest'
import { faceById } from '../fonts/faces'
import { fontFor, renderText } from '../fonts/woff'
import type { RGB } from '../color'
import { headlineTone } from '../headline-tone'
import type { Image } from '../png'

const NAVY: RGB = [10, 37, 64]
const SLATE: RGB = [66, 84, 102]
const PURPLE: RGB = [99, 91, 255]
const GREY: RGB = [160, 160, 160]
const PALE: RGB = [212, 212, 212]

function page(width: number, height: number, bg: RGB = [255, 255, 255]): Image {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([...bg, 255], i * 4)
  return { width, height, data }
}

/** Words drawn in Inter at (x, top) in a colour; gives the right edge. */
function words(img: Image, text: string, x: number, top: number, ink: RGB, size = 44): number {
  const drawn = renderText(fontFor(faceById('inter')!, 500)!, size, text)
  for (let j = 0; j < drawn.mask.h; j++)
    for (let i = 0; i < drawn.mask.w; i++) {
      const a = drawn.mask.a[j * drawn.mask.w + i]!
      if (!a) continue
      const o = ((top + j) * img.width + x + i) * 4
      for (let k = 0; k < 3; k++)
        img.data[o + k] = Math.round(img.data[o + k]! * (1 - a) + ink[k]! * a)
    }
  return x + drawn.mask.w
}

const BOX: [number, number, number, number] = [30, 30, 1100, 290]

describe('headlineTone', () => {
  it('reads a second, lighter ink on the later lines as a muted tail (Paylane)', () => {
    const img = page(1200, 320)
    words(img, 'Financial infrastructure to grow your revenue.', 40, 40, NAVY)
    words(img, 'Accept payments and offer services', 40, 100, SLATE)
    words(img, 'from your first transaction onwards.', 40, 160, SLATE)
    const tone = headlineTone(img, BOX)
    expect(tone).toMatchObject({ place: 'tail', style: 'muted' })
  })

  it('reads a coloured first line as a coloured head', () => {
    const img = page(1200, 320)
    words(img, 'Customer feedback', 40, 40, PURPLE)
    words(img, 'that shapes the roadmap', 40, 100, NAVY)
    expect(headlineTone(img, BOX)).toMatchObject({ place: 'head', style: 'colour' })
  })

  it('reads a coloured phrase at the end of a one-line headline', () => {
    const img = page(1200, 320)
    const end = words(img, 'Ship work', 40, 40, NAVY)
    words(img, 'faster together', end + 14, 40, PURPLE)
    expect(headlineTone(img, BOX)).toMatchObject({ place: 'tail', style: 'colour' })
  })

  it('reads none in a one-colour headline', () => {
    const img = page(1200, 320)
    words(img, 'Financial infrastructure to grow', 40, 40, NAVY)
    words(img, 'your revenue, from the first sale', 40, 100, NAVY)
    expect(headlineTone(img, BOX)).toBeNull()
  })

  it('reads none where the colours alternate rather than split in two runs', () => {
    const img = page(1200, 320)
    words(img, 'One line in navy', 40, 40, NAVY)
    words(img, 'one line in purple', 40, 100, PURPLE)
    words(img, 'and navy again', 40, 160, NAVY)
    words(img, 'then purple again', 40, 220, PURPLE)
    expect(headlineTone(img, BOX)).toBeNull()
  })

  it('reads a light grey lead around a black middle as a muted head (Helpdeck)', () => {
    const img = page(1200, 320)
    words(img, 'A complete system for', 40, 40, GREY)
    words(img, 'AI and human', 40, 100, [17, 17, 17])
    words(img, 'customer service', 40, 160, GREY)
    expect(headlineTone(img, BOX)).toMatchObject({
      place: 'head',
      style: 'muted',
      accent: GREY,
      main: [17, 17, 17],
    })
  })

  it('reads a light grey first line before a black one as a muted head', () => {
    const img = page(1200, 320)
    words(img, 'The feedback tool', 40, 40, GREY)
    words(img, 'your customers love', 40, 100, [17, 17, 17])
    expect(headlineTone(img, BOX)).toMatchObject({ place: 'head', style: 'muted' })
  })

  it('reads a very pale grey lead (low contrast against the page) on one line', () => {
    const img = page(1200, 320)
    const end = words(img, 'Feedback,', 40, 40, PALE)
    words(img, 'organised for you', end + 14, 40, [17, 17, 17])
    expect(headlineTone(img, BOX)).toMatchObject({ place: 'head', style: 'muted' })
  })

  it('reads a coloured middle line between two navy ones as a coloured accent', () => {
    const img = page(1200, 320)
    words(img, 'One line in navy', 40, 40, NAVY)
    words(img, 'one line in purple', 40, 100, PURPLE)
    words(img, 'and navy again here', 40, 160, NAVY)
    expect(headlineTone(img, BOX)).toMatchObject({ style: 'colour', accent: PURPLE })
  })

  it('reads light text on a dark page the same way', () => {
    const img = page(1200, 320, [17, 17, 17])
    words(img, 'Build the future', 40, 40, [250, 250, 250])
    words(img, 'of your product', 40, 100, [140, 140, 140])
    expect(headlineTone(img, BOX)).toMatchObject({ place: 'tail', style: 'muted' })
  })
})
