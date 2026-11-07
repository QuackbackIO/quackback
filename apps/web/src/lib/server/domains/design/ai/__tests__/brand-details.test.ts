/**
 * The finer details a brand match reads from its screenshot (the subtitle's
 * ink, the header button's label, a text field's corners) and the changes
 * they make: each measured value set, each not measured cleared, colours in
 * light mode only.
 */
import { describe, expect, it } from 'vitest'
import type { FoundElements } from '../../extract/finder'
import { faceById } from '../../extract/fonts/faces'
import { fontFor, renderText } from '../../extract/fonts/woff'
import { BOX_KINDS, type Box, type BoxKind } from '../../extract/kinds'
import { roundOutline } from '../../extract/__tests__/shapes'
import type { Image } from '../../extract/png'
import { detailChanges, labelBox, measureDetails } from '../brand-details'
import type { Shot } from '../brand-measure'

type RGB = [number, number, number]

function blank(width: number, height: number): Image {
  return { width, height, data: new Uint8Array(width * height * 4).fill(255) }
}

function fill(img: Image, [x0, y0, x1, y1]: Box, c: RGB) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const o = (y * img.width + x) * 4
      img.data[o] = c[0]
      img.data[o + 1] = c[1]
      img.data[o + 2] = c[2]
    }
}

/** Words in Inter at `size`, in `ink` over whatever is there; gives the ink box. */
function write(img: Image, size: number, words: string, x: number, y: number, ink: RGB): Box {
  const drawn = renderText(fontFor(faceById('inter')!, 500)!, size, words)
  let box: Box = [img.width, img.height, 0, 0]
  for (let j = 0; j < drawn.mask.h; j++)
    for (let i = 0; i < drawn.mask.w; i++) {
      const a = drawn.mask.a[j * drawn.mask.w + i]!
      if (!a) continue
      const o = ((y + j) * img.width + x + i) * 4
      for (let k = 0; k < 3; k++)
        img.data[o + k] = Math.round(img.data[o + k]! * (1 - a) + ink[k]! * a)
      if (a > 0.3)
        box = [
          Math.min(box[0], x + i),
          Math.min(box[1], y + j),
          Math.max(box[2], x + i + 1),
          Math.max(box[3], y + j + 1),
        ]
    }
  return [box[0] - 3, box[1] - 3, box[2] + 3, box[3] + 3]
}

function shot(
  img: Image,
  boxes: Partial<Record<BoxKind, Box>>,
  words: Record<string, string> = {}
): Shot {
  const all = Object.fromEntries(BOX_KINDS.map((k) => [k, boxes[k] ?? null])) as Record<
    BoxKind,
    Box | null
  >
  return {
    index: 0,
    img,
    strip: null,
    width: img.width,
    height: img.height,
    found: {
      version: 'test',
      scale: 1,
      boxes: all,
      snapped: all,
      output: { headline_text: '', subtitle_text: '', primary_button_text: '', ...words },
    } as unknown as FoundElements,
  }
}

const VIOLET: RGB = [83, 58, 253]

describe('measureDetails', () => {
  it('reads the label size inside the header’s call to action', () => {
    const img = blank(1440, 900)
    fill(img, [1200, 16, 1336, 56], VIOLET)
    write(img, 16, 'Sign up', 1236, 26, [255, 255, 255])
    const d = measureDetails(shot(img, { header: [0, 0, 1440, 72] }), {}, null)
    expect(d.tune.label?.size).toBeGreaterThanOrEqual(15)
    expect(d.tune.label?.size).toBeLessThanOrEqual(17)
  })

  it('reads the main button’s label, and its capitals, where the header has no button', () => {
    const img = blank(1440, 900)
    fill(img, [200, 500, 400, 548], VIOLET)
    write(img, 14, 'GET STARTED', 228, 514, [255, 255, 255])
    const s = shot(
      img,
      { primary_button: [198, 498, 402, 550] },
      {
        primary_button_text: 'GET STARTED',
      }
    )
    const d = measureDetails(s, {}, null)
    expect(d.tune.button).toEqual({ case: 'upper' })
    expect(d.tune.label?.size).toBeGreaterThanOrEqual(13)
    expect(d.tune.label?.size).toBeLessThanOrEqual(15)
  })

  it('reads no capitals from a label in lower case', () => {
    const img = blank(1440, 900)
    fill(img, [200, 500, 400, 548], VIOLET)
    write(img, 14, 'Get started', 228, 514, [255, 255, 255])
    const s = shot(
      img,
      { primary_button: [198, 498, 402, 550] },
      {
        primary_button_text: 'Get started',
      }
    )
    expect(measureDetails(s, {}, null).tune.button).toBeUndefined()
  })

  it('reads the subtitle’s ink as its colour', () => {
    const img = blank(1440, 900)
    const sub = write(img, 20, 'Payments infrastructure for the internet', 200, 400, [22, 51, 0])
    const s = shot(
      img,
      { subtitle: sub },
      { subtitle_text: 'Payments infrastructure for the internet' }
    )
    const colour = measureDetails(s, {}, null).tune.subtitle?.colour
    expect(colour).toMatch(/^#[0-9a-f]{6}$/)
    // Within a few steps of the ink: the darkest pixels of antialiased letters.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour!.slice(i, i + 2), 16))
    expect(Math.max(Math.abs(r! - 22), Math.abs(g! - 51), Math.abs(b! - 0))).toBeLessThanOrEqual(12)
  })

  it('reads a text field’s corners', () => {
    const img = blank(1440, 900)
    // A field with a 1px grey edge and 8px corners, white inside.
    roundOutline(img, [300, 300, 700, 344], 8, 1, [208, 215, 222])
    const d = measureDetails(shot(img, { input_field: [299, 299, 701, 345] }), {}, null)
    expect(d.tune.field).toEqual({ radius: 8 })
  })
})

describe('labelBox', () => {
  it('draws the box in past its edges and corners, so the frame is the fill', () => {
    expect(labelBox([1200, 16, 1336, 56])).toEqual([1214, 24, 1322, 48])
    expect(labelBox([0, 0, 10, 10])).toBeNull()
  })
})

describe('detailChanges', () => {
  const measured = {
    tune: {
      subtitle: { colour: '#5a6677' },
      heading: { leading: 1.1, colour: '#061b31' },
      label: { size: 14 },
      field: { radius: 8 },
      button: { case: 'upper' as const },
    },
    why: {
      subtitleColour: 'the text under your headline is #5a6677',
      headingLeading: 'set as tight as your headline’s lines, 1.10',
      headingColour: 'your section headings are set in #061b31',
      labelSize: 'your buttons’ labels are about 14px',
      fieldRadius: 'your text field’s corners are 8px',
      buttonCase: 'your main button’s label is set in capitals',
    },
  }
  const values = (changes: ReturnType<typeof detailChanges>) =>
    Object.fromEntries(changes.map((c) => [c.path, c.value]))

  it('sets each measured value, with its evidence', () => {
    const changes = detailChanges(measured, 'light')
    expect(values(changes)).toEqual({
      'tune.subtitle.colour': '#5a6677',
      'tune.heading.leading': 1.1,
      'tune.heading.colour': '#061b31',
      'tune.label.size': 14,
      'tune.button.case': 'upper',
      'tune.field.radius': 8,
    })
    expect(changes.every((c) => c.why.length > 0)).toBe(true)
  })

  it('clears each value not measured, so an earlier match’s goes', () => {
    const changes = detailChanges({ tune: {}, why: {} }, 'light')
    expect(changes).toHaveLength(6)
    expect(changes.every((c) => c.value === null)).toBe(true)
  })

  it('sets no light-mode colours for a dark site', () => {
    const v = values(detailChanges(measured, 'dark'))
    expect(v['tune.subtitle.colour']).toBeNull()
    expect(v['tune.heading.colour']).toBeNull()
    expect(v['tune.label.size']).toBe(14)
  })
})
