/**
 * The site's own marks on a photo, on synthetic pictures: small set type and
 * badges are dense hard edges and are found; a photograph's soft light and
 * single outlines are not; words already handled are left out; and the
 * largest part clear of every mark is found, or none when too small.
 */
import { describe, expect, it } from 'vitest'
import { boxMarks, clearPart, typeMarks } from '../photo-marks'
import type { Box } from '../kinds'
import type { Image } from '../png'

type Fill = [number, number, number]

function canvas(width: number, height: number, bg: (x: number, y: number) => Fill): Image {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set([...bg(x, y), 255], (y * width + x) * 4)
  return { width, height, data }
}

/** Soft light in many colours, as a photograph's background is. */
const soft = (x: number, y: number): Fill => [
  90 + 70 * Math.sin(x / 97 + y / 151),
  110 + 60 * Math.sin(x / 131 - y / 83 + 1),
  100 + 80 * Math.cos(x / 173 + y / 59),
]

/** A badge: a white plate with a line of small dark type on it. */
function badge(img: Image, [x0, y0, x1, y1]: Box) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const type = y >= y0 + 8 && y < y1 - 8 && x >= x0 + 8 && x < x1 - 8 && (x - x0) % 5 < 2
      img.data.set(type ? [20, 20, 20, 255] : [255, 255, 255, 255], (y * img.width + x) * 4)
    }
}

const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

describe('typeMarks', () => {
  it('finds a badge laid over a photo', () => {
    const img = canvas(800, 500, soft)
    const seal: Box = [600, 60, 720, 120]
    badge(img, seal)
    const marks = typeMarks(img, [0, 0, 800, 500])
    expect(marks.length).toBe(1)
    expect(overlaps(marks[0]!, seal)).toBe(true)
  })

  it('finds nothing in soft light crossed by a single hard outline', () => {
    const img = canvas(800, 500, (x, y) => (Math.abs(x - y) < 2 ? [250, 250, 250] : soft(x, y)))
    expect(typeMarks(img, [0, 0, 800, 500])).toEqual([])
  })

  it('leaves out type inside the words given', () => {
    const img = canvas(800, 500, soft)
    const headline: Box = [40, 200, 400, 260]
    badge(img, headline)
    expect(typeMarks(img, [0, 0, 800, 500], [[20, 180, 420, 280]])).toEqual([])
  })
})

describe('boxMarks', () => {
  it('counts a small box on the photo, never one framing it or off it', () => {
    const region: Box = [0, 0, 800, 500]
    expect(boxMarks(region, [[600, 100, 720, 300]])).toHaveLength(1)
    expect(boxMarks(region, [[0, 0, 800, 500]])).toHaveLength(0)
    expect(boxMarks(region, [[900, 0, 1000, 100], null])).toHaveLength(0)
  })
})

describe('clearPart', () => {
  it('is the whole when nothing blocks it', () => {
    expect(clearPart([0, 0, 800, 480], [], 400, 280)).toEqual([0, 0, 800, 480])
  })

  it('is the largest part clear of the marks', () => {
    const part = clearPart(
      [0, 0, 800, 480],
      [
        [700, 0, 800, 80],
        [0, 420, 200, 480],
      ],
      400,
      280
    )!
    expect(part).not.toBeNull()
    for (const b of [
      [700, 0, 800, 80],
      [0, 420, 200, 480],
    ] as Box[])
      expect(overlaps(part, b)).toBe(false)
    expect((part[2] - part[0]) * (part[3] - part[1])).toBeGreaterThanOrEqual(0.97 * 700 * 420)
  })

  it('is null when no clear part is large enough', () => {
    expect(clearPart([0, 0, 600, 400], [[250, 0, 350, 400]], 400, 280)).toBeNull()
  })
})
