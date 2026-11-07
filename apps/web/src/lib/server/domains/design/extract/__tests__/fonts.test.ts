/**
 * The font matcher on fixtures with known answers: a line drawn in a bundled
 * face by the server's own renderer, set dark on light as a screenshot would
 * show it, then measured and matched back.
 */
import { describe, expect, it } from 'vitest'
import { faceById, FACES, sameDesign } from '../fonts/faces'
import { fontFor, renderText } from '../fonts/woff'
import { inkMask, textMetrics } from '../fonts/metrics'
import { fitAt, matchText } from '../fonts/type-match'
import { chooseFace } from '../fonts/face-choice'
import { measure } from '../fonts/match'
import { cropText, matchCrops } from '../fonts/type-crops'
import type { Image } from '../png'

/** A line drawn in a face, composited dark on a light page, and the box around its ink. */
function shot(faceId: string, weight: number, size: number, text: string, trackingEm = 0) {
  const face = faceById(faceId)!
  const font = fontFor(face, weight)!
  const drawn = renderText(font, size, text, trackingEm * size)
  const pad = 20
  const width = drawn.mask.w + 2 * pad
  const height = drawn.mask.h + 2 * pad
  const data = new Uint8Array(width * height * 4).fill(255)
  let x0 = width
  let y0 = height
  let x1 = 0
  let y1 = 0
  for (let y = 0; y < drawn.mask.h; y++)
    for (let x = 0; x < drawn.mask.w; x++) {
      const a = drawn.mask.a[y * drawn.mask.w + x]!
      const o = ((y + pad) * width + x + pad) * 4
      for (let k = 0; k < 3; k++) data[o + k] = Math.round(250 * (1 - a) + 20 * a)
      if (a > 0.2) {
        x0 = Math.min(x0, x + pad)
        y0 = Math.min(y0, y + pad)
        x1 = Math.max(x1, x + pad + 1)
        y1 = Math.max(y1, y + pad + 1)
      }
    }
  const img: Image = { width, height, data }
  return { img, box: [x0 - 2, y0 - 2, x1 + 2, y1 + 2] }
}

describe('font files', () => {
  it('reads every face the matcher knows, at each of its weights', () => {
    for (const face of FACES)
      for (const weight of face.weights)
        expect(fontFor(face, weight), `${face.id} ${weight}`).not.toBeNull()
  })

  it('draws capitals at the face’s cap height, and heavier weights with wider stems', () => {
    const inter = faceById('inter')!
    const regular = textMetrics(renderText(fontFor(inter, 400)!, 40, 'HHHH').mask).lines[0]!
    expect(regular.tall / 40).toBeGreaterThan(0.69)
    expect(regular.tall / 40).toBeLessThan(0.76)
    const bold = textMetrics(renderText(fontFor(inter, 800)!, 40, 'HHHH').mask).lines[0]!
    expect(bold.stem / regular.stem).toBeGreaterThan(1.6)
  })

  it('draws a CFF face (Geist) as well as TrueType ones', () => {
    const geist = renderText(fontFor(faceById('geist')!, 500)!, 36, 'Ship faster')
    expect(textMetrics(geist.mask).lines).toHaveLength(1)
  })
})

describe('matchText', () => {
  const text = 'Customer feedback that shapes the roadmap'

  it.each([
    ['inter', 700, 48, 0],
    ['fraunces', 400, 44, 0],
    ['geist', 500, 40, -0.02],
    ['poppins', 600, 36, 0],
    ['mona-sans', 700, 44, 0],
    ['hanken-grotesk', 300, 44, 0],
  ] as const)('matches %s at %i back from its own drawing', (id, weight, size, tracking) => {
    const { img, box } = shot(id, weight, size, text, tracking)
    const match = matchText(img, box, text)!
    expect(match).not.toBeNull()
    expect(sameDesign(match.face.id, id), `${match.face.id} for ${id}`).toBe(true)
    expect(Math.abs(match.size / size - 1)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(match.weight - weight)).toBeLessThanOrEqual(100)
    expect(match.close).toBe(true)
    expect(match.capRatio).toBeGreaterThan(0.6)
    expect(match.capRatio).toBeLessThan(0.85)
  })

  it('reads capitals as upper case', () => {
    const { img, box } = shot('inter', 700, 40, 'SAVES YOU MONEY')
    expect(matchText(img, box, 'SAVES YOU MONEY')!.upper).toBe(true)
  })

  it('takes the finder’s words as the whole text, however long', () => {
    // The spike's truth text was cut at 80 characters, so a longer text was
    // read as cut short: its last word dropped and its last line unused.
    const first = 'Customer feedback that shapes the roadmap'
    const second = 'for every team that ships its work in public'
    const face = faceById('inter')!
    const a = renderText(fontFor(face, 500)!, 32, first)
    const b = renderText(fontFor(face, 500)!, 32, second)
    const width = Math.max(a.mask.w, b.mask.w) + 40
    const height = 2 * 46 + 40
    const data = new Uint8Array(width * height * 4).fill(255)
    for (const [d, top] of [
      [a, 20],
      [b, 66],
    ] as const)
      for (let y = 0; y < d.mask.h; y++)
        for (let x = 0; x < d.mask.w; x++) {
          const v = d.mask.a[y * d.mask.w + x]!
          const o = ((y + top) * width + x + 20) * 4
          for (let k = 0; k < 3; k++) data[o + k] = Math.round(255 * (1 - v) + 20 * v)
        }
    const img: Image = { width, height, data }
    const text = `${first} ${second}`
    expect(text.length).toBeGreaterThan(80)
    const box = [14, 14, width - 14, height - 14]
    expect(measure(img, box, text, 1).lines.map((l) => l.text)).toEqual([first])
    expect(measure(img, box, text, 1, Infinity).lines.map((l) => l.text)).toEqual([first, second])
    expect(sameDesign(matchText(img, box, text)!.face.id, 'inter')).toBe(true)
  })

  it('gives nothing without words or a box', () => {
    const { img, box } = shot('inter', 400, 30, 'Hello there')
    expect(matchText(img, box, '')).toBeNull()
    expect(matchText(img, null, 'Hello there')).toBeNull()
  })

  it('fits the tracking a line was set with, so the face draws the line as wide', () => {
    for (const tracking of [-0.03, 0, 0.02]) {
      const { img, box } = shot('inter', 700, 48, text, tracking)
      const match = matchText(img, box, text)!
      expect(Math.abs(match.tracking - tracking), `${tracking}`).toBeLessThan(0.008)
    }
  })

  it('fits each weight drawn, a lighter weight’s narrower letters needing more spacing', () => {
    const { img, box } = shot('mona-sans', 500, 48, text, 0)
    const match = matchText(img, box, text)!
    const fits = match.fits!
    expect(fits.map((f) => f.weight)).toEqual([...fits.map((f) => f.weight)].sort((a, b) => a - b))
    const own = fitAt(match, match.weight)!
    expect(own.tracking).toBeCloseTo(match.tracking)
    const lighter = fitAt(match, match.weight - 100)!
    expect(lighter.tracking).toBeGreaterThan(own.tracking)
    expect(Math.abs(lighter.size / own.size - 1)).toBeLessThan(0.05)
  })
})

describe('matchText: the glyph width', () => {
  // Letters' own widths (ink columns, free of letter-spacing) against the normal-width
  // faces drawn at the same height: a condensed face reads 0.27 to 0.48 narrower (log),
  // a normal one within 0.06 however tightly it is tracked.
  const lower = 'Customer feedback that shapes the roadmap'
  const caps = 'SAVES YOU MONEY ABROAD'

  it.each([
    ['oswald', 500, lower],
    ['oswald', 500, caps],
    ['barlow-condensed', 600, lower],
    ['barlow-condensed', 300, caps],
  ] as const)('reads %s %i as condensed', (id, weight, words) => {
    const { img, box } = shot(id, weight, 56, words)
    expect(matchText(img, box, words)!.glyphWidth).toBeLessThan(-0.2)
  })

  it.each([
    ['inter', 800, -0.04, lower],
    ['inter', 900, -0.08, lower],
    ['inter', 900, -0.08, caps],
    ['roboto', 700, 0, caps],
    ['noto-sans', 900, -0.05, caps],
    ['archivo', 900, -0.05, lower],
    ['poppins', 600, -0.03, lower],
  ] as const)(
    'reads normal-width %s %i as normal, however tightly tracked (%f em)',
    (id, weight, tracking, words) => {
      const { img, box } = shot(id, weight, 56, words, tracking)
      expect(Math.abs(matchText(img, box, words)!.glyphWidth!)).toBeLessThan(0.12)
    }
  )
})

describe('matchText: the sample the width is read on', () => {
  const words = 'Customer feedback that shapes the roadmap'

  it('counts the letters and the ink width of the lines it drew', () => {
    const { img, box } = shot('inter', 700, 48, words)
    const m = matchText(img, box, words)!
    expect(m.letters).toBe(words.replace(/\s/g, '').length)
    expect(m.letterGaps).toBe(words.length - 1)
    expect(m.widthPx! / (box[2]! - box[0]!)).toBeGreaterThan(0.9)
    expect(m.widthPx! / (box[2]! - box[0]!)).toBeLessThan(1.01)
  })
})

describe('matchText and chooseFace: condensed only where the text is', () => {
  const loads = () => [300, 400, 500, 600, 700, 800]
  const words = 'Customer feedback that shapes the roadmap'

  it('sets a condensed headline in a condensed face', () => {
    const { img, box } = shot('oswald', 500, 64, words)
    const chosen = chooseFace(matchText(img, box, words)!, {
      kind: 'sans',
      role: 'headline',
      weight: 500,
      loads,
    })
    expect(chosen.face.sub).toBe('condensed')
  })

  it('keeps a normal headline normal when the words read are more than it shows', () => {
    // Three words too many: every face must squeeze, and the width reads condensed.
    const { img, box } = shot('inter', 700, 64, words)
    const m = matchText(img, box, `${words} for every team`)!
    expect(m.glyphWidth).toBeLessThan(-0.2)
    expect(chooseFace(m, { kind: 'sans', role: 'headline', weight: 700, loads }).face.sub).not.toBe(
      'condensed'
    )
  })
})

describe('inkMask: text on two grounds', () => {
  it('takes the dark text for ink where the box is mostly a coloured shape and the page shows beside it', () => {
    // Outside the box: the light page above, photos below and at the sides, none of it half the
    // frame. Inside: a teal shape under most of the words, the page under the rest, so the box's
    // middle is teal and its light side is the page, not the text.
    const width = 320
    const height = 120
    const box = [20, 20, 300, 100]
    const data = new Uint8Array(width * height * 4).fill(255)
    const paint = (x: number, y: number, c: readonly number[]) => data.set(c, (y * width + x) * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const inside = x >= box[0]! && x < box[2]! && y >= box[1]! && y < box[3]!
        if (!inside)
          paint(
            x,
            y,
            y < box[1]!
              ? [240, 240, 240]
              : x < box[0]! || (y >= box[3]! && x < 160)
                ? [200, 120, 40]
                : [120, 60, 140]
          )
        else paint(x, y, x < 220 ? [0, 204, 188] : [240, 240, 240])
      }
    // Strokes of text, dark grey, across both grounds.
    for (let y = 40; y < 80; y++)
      for (let x = 30; x < 290; x++) if (x % 12 < 4) paint(x, y, [70, 72, 72])
    const ink = inkMask({ width, height, data } as Image, box)
    expect(ink.ink[0]).toBeLessThan(120)
  })
})

/** Lines drawn in a face, one under another, dark on a background painted per pixel. */
function linesOn(
  faceId: string,
  weight: number,
  size: number,
  lines: readonly string[],
  ground: (x: number, y: number, width: number) => readonly [number, number, number]
) {
  const font = fontFor(faceById(faceId)!, weight)!
  const drawn = lines.map((l) => renderText(font, size, l))
  const pad = 30
  const pitch = Math.round(size * 1.25)
  const width = Math.max(...drawn.map((d) => d.mask.w)) + 2 * pad
  const height = pitch * (lines.length - 1) + drawn.at(-1)!.mask.h + 2 * pad
  const data = new Uint8Array(width * height * 4).fill(255)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(ground(x, y, width), (y * width + x) * 4)
  drawn.forEach((d, i) => {
    const left = pad + Math.round((width - 2 * pad - d.mask.w) / 2)
    for (let y = 0; y < d.mask.h; y++)
      for (let x = 0; x < d.mask.w; x++) {
        const a = d.mask.a[y * d.mask.w + x]!
        const o = ((y + pad + i * pitch) * width + x + left) * 4
        for (let k = 0; k < 3; k++) data[o + k] = Math.round(data[o + k]! * (1 - a) + 40 * a)
      }
  })
  return { img: { width, height, data } as Image, width, height, pad }
}

describe('matchText: text on two grounds', () => {
  it('reads dark text set across a coloured shape and the light page around it', () => {
    // A diagonal teal shape under most of the headline, the light page around and behind the rest:
    // the box's middle is mostly teal, so its light side is the page, not the ink.
    const lines = ['Fresh dinners, brought', 'round to your door today.']
    const { img, width, height, pad } = linesOn('inter', 700, 44, lines, (x, y, w) =>
      x < w * 0.75 - y * 0.6 ? [0, 204, 188] : [240, 240, 240]
    )
    const box = [pad - 4, pad - 4, width - pad + 4, height - pad + 4]
    const m = matchText(img, box, lines.join(' '))!
    expect(m.iou).toBeGreaterThanOrEqual(0.4)
    expect(m.upper).toBe(false)
    expect(sameDesign(m.face.id, 'inter')).toBe(true)
  })
})

describe('matchText: another reading of a box no face draws', () => {
  it('parts two lines a photo’s edge bridges', () => {
    const lines = ['Fresh dinners, brought', 'round to your door today.']
    const { img, width, height, pad } = linesOn('inter', 700, 44, lines, () => [240, 240, 240])
    // A dark sliver of a photo down the box's left edge, through the gap between the lines.
    for (let y = pad - 6; y < height - pad + 6; y++)
      for (let x = pad - 22; x < pad - 2; x++) img.data.set([60, 50, 40], (y * width + x) * 4)
    const box = [pad - 24, pad - 8, width - pad + 8, height - pad + 8]
    const text = lines.join(' ')
    expect(measure(img, box, text, 1, Infinity).tm.lines).toHaveLength(1)
    const m = matchText(img, box, text)!
    // Drawn, two lines; the sliver's ink stays on the lines, so the face is among the nearest.
    expect(m.iou).toBeGreaterThanOrEqual(0.4)
    expect(m.alternatives.slice(0, 3).some((a) => sameDesign(a.face.id, 'inter'))).toBe(true)
  })

  it('reads the first words alone where the box holds only a paragraph’s first line', () => {
    const lines = [
      'Record and share short videos with your',
      'teammates and customers to get more done',
    ]
    const { img, width, pad } = linesOn('inter', 400, 22, lines, () => [255, 255, 255])
    // The box ends under the first line; the finder read the whole paragraph.
    const box = [pad - 4, pad - 4, width - pad + 4, pad + 24]
    const m = matchText(img, box, lines.join(' '))!
    expect(m.iou).toBeGreaterThanOrEqual(0.4)
    expect(m.face.sub).not.toBe('condensed')
    expect(m.glyphWidth!).toBeGreaterThan(-0.2)
  })

  it('reads a headline again but not the text under it, which pairs with the headline instead', () => {
    const lines = [
      'Record and share short videos with your',
      'teammates and customers to get more done',
    ]
    const { img, width, pad } = linesOn('inter', 400, 22, lines, () => [255, 255, 255])
    const box = [pad - 4, pad - 4, width - pad + 4, pad + 24]
    const crop = cropText(img, box, lines.join(' '))
    const matches = matchCrops({ headline: crop, body: crop })
    expect(matches.headline!.iou).toBeGreaterThanOrEqual(0.4)
    expect(matches.body!.iou).toBeLessThan(0.4)
  })
})
