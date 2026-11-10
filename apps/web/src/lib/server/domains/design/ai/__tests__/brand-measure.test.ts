/**
 * The font stage reads type from the sharpest pixels sent: a retina capture
 * is halved for the finder and the tools, which costs a face's details, so
 * the header strip, sent at the capture's own resolution and lossless, is
 * read instead wherever the text's box lies within it.
 */
import { describe, expect, it } from 'vitest'
import type { FoundElements } from '../../extract/finder'
import { BOX_KINDS, type Box, type BoxKind } from '../../extract/kinds'
import type { Image } from '../../extract/png'
import { faceById } from '../../extract/fonts/faces'
import { fontFor, renderText } from '../../extract/fonts/woff'
import { matchType } from '../brand-fonts'
import type { Measured } from '../../extract/measured-design'
import type { TypeMatch } from '../../extract/fonts/type-match'
import {
  cleanShots,
  headlineWeight,
  measureColours,
  measureGeometry,
  onlyDimmed,
  sharpest,
  withTypeMatch,
  type Shot,
} from '../brand-measure'

const HEADLINE = 'Plan and ship your best work'

function blank(width: number, height: number): Image {
  return { width, height, data: new Uint8Array(width * height * 4).fill(255) }
}

/** Words in Inter at `size` drawn at (x, y top); gives the ink box. */
function draw(
  img: Image,
  weight: number,
  size: number,
  text: string,
  x: number,
  y: number,
  trackingEm = 0
): Box {
  const drawn = renderText(fontFor(faceById('inter')!, weight)!, size, text, trackingEm * size)
  let box: Box = [img.width, img.height, 0, 0]
  for (let j = 0; j < drawn.mask.h; j++)
    for (let i = 0; i < drawn.mask.w; i++) {
      const a = drawn.mask.a[j * drawn.mask.w + i]!
      if (!a) continue
      const o = ((y + j) * img.width + x + i) * 4
      for (let k = 0; k < 3; k++) img.data[o + k] = Math.round(255 * (1 - a) + 17 * a)
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

function shot(img: Image, strip: Image | null, headline: Box): Shot {
  const boxes = Object.fromEntries(BOX_KINDS.map((k) => [k, null])) as Record<BoxKind, Box | null>
  boxes.headline = headline
  return {
    index: 0,
    img,
    strip,
    width: strip?.width ?? img.width,
    height: img.height * 2,
    found: {
      version: 'test',
      scale: 1,
      boxes,
      snapped: boxes,
      output: { headline_text: HEADLINE, subtitle_text: '' },
    } as unknown as FoundElements,
  }
}

describe('sharpest', () => {
  it('gives the strip and the box at its scale when the box lies within it', () => {
    const s = shot(blank(600, 800), blank(1200, 900), [40, 100, 400, 160])
    const at = sharpest(s, [40, 100, 400, 160])
    expect(at.img).toBe(s.strip)
    expect(at.scale).toBe(2)
    expect(at.box).toEqual([80, 200, 800, 320])
  })

  it('gives the analysis image for a box below the strip, or without one', () => {
    const s = shot(blank(600, 800), blank(1200, 400), [40, 100, 400, 300])
    expect(sharpest(s, [40, 100, 400, 300])).toEqual({
      img: s.img,
      box: [40, 100, 400, 300],
      scale: 1,
    })
    const none = shot(blank(600, 800), null, [40, 100, 400, 160])
    expect(sharpest(none, [40, 100, 400, 160]).img).toBe(none.img)
  })
})

describe('matchType', () => {
  it('reads the headline from the native strip, sizing it in CSS px', () => {
    // The analysis image (CSS px) shows nothing to read; the strip, at twice
    // its resolution, holds the headline in Inter Bold at 96 device px (48 CSS).
    const strip = blank(1200, 600)
    const native = draw(strip, 700, 96, HEADLINE, 80, 200)
    const css = native.map((v) => Math.round(v / 2)) as unknown as Box
    const match = matchType(shot(blank(600, 800), strip, css))
    expect(match.headline?.face.id).toMatch(/^inter/)
    expect(match.headline!.size).toBeGreaterThan(44)
    expect(match.headline!.size).toBeLessThan(52)
    expect(match.headline!.weight).toBeGreaterThanOrEqual(600)
  })
})

describe('the headline weight', () => {
  const sans = faceById('inter-tight')!
  const serif = faceById('fraunces')!
  // On the X0 captures the closest bundled face, fitted to a wider brand face, read
  // heavier than the stem (Paylane's Sohne 300: stem 408, Inter Tight fitted at 500).
  it('takes the step at or below the stem when it reads lighter than the matched face', () => {
    // X0 strip crops: Hemla 700 (stem 737, fit 800), Roomly 500 (551, 600), Boxfield 500 (597, 700).
    expect(headlineWeight(737, { weight: 800, face: sans })).toBe(700)
    expect(headlineWeight(551, { weight: 600, face: sans })).toBe(500)
    expect(headlineWeight(597, { weight: 700, face: sans })).toBe(500)
  })

  it('keeps the matched weight when the stem is only a little lighter', () => {
    expect(headlineWeight(590, { weight: 600, face: sans })).toBe(600)
  })

  it('reads a headline lighter than 450 as light display type, 300', () => {
    expect(headlineWeight(408, { weight: 500, face: sans })).toBe(300)
  })

  it('keeps the matched face’s weight when the stem reads as heavy or heavier', () => {
    expect(headlineWeight(627, { weight: 600, face: sans })).toBe(600)
    expect(headlineWeight(900, { weight: 800, face: sans })).toBe(800)
    expect(headlineWeight(null, { weight: 500, face: sans })).toBe(500)
  })

  it('trusts the matched face for a serif, whose thin hairlines the stem under-reads', () => {
    // Postbird's 400 (Means): its stem read 287 to 546 by source; the fit read 400 from each.
    expect(headlineWeight(287, { weight: 400, face: serif })).toBe(400)
    expect(headlineWeight(546, { weight: 400, face: serif })).toBe(400)
  })

  it('pulls a serif fit far heavier than the stem halfway back to it', () => {
    // A substitute serif matched by its stems draws heavier than a higher-contrast brand
    // serif (the Daily Ledger's 500 read 900 at 11-02e). On bundled serifs drawn and matched
    // with their own face left out, the stem is within a step 95% of the time and the fit
    // 83% (Source Serif 500 fitted Merriweather 700, stem 530): their mean, 600.
    expect(headlineWeight(530, { weight: 700, face: serif })).toBe(600)
    expect(headlineWeight(700, { weight: 900, face: serif })).toBe(800)
  })

  it('reads the stem from the match’s own sharp crop when it has one', () => {
    // The analysis JPEG's stem read can collapse (Paylane's headline over its gradient
    // read 100 from the builder's JPEG); the match reads the lossless strip.
    const measured = {
      headline: { size: 47, weight: 100, letterSpacing: 0, lineHeight: 54, leading: 1.15 },
    } as unknown as Measured
    const match = {
      face: sans,
      weight: 600,
      stem: 590,
      size: 48,
      tracking: 0,
      capRatio: 0.7,
    } as unknown as TypeMatch
    expect(withTypeMatch(measured, match).headline).toMatchObject({ weight: 600 })
  })

  it('is what the headline carries once the face is matched', () => {
    const measured = {
      headline: { size: 47, weight: 408, letterSpacing: 0, lineHeight: 54, leading: 1.15 },
    } as unknown as Measured
    const match = {
      face: sans,
      weight: 500,
      size: 48,
      tracking: -0.02,
      capRatio: 0.7,
    } as unknown as TypeMatch
    expect(withTypeMatch(measured, match).headline).toMatchObject({ weight: 300, size: 48 })
  })
})

describe('the headline tracking', () => {
  const measured = {
    headline: { size: 60, weight: 700, letterSpacing: 0.04, lineHeight: null, leading: null },
  } as unknown as Measured
  const fitted = (tracking: number, iou = 0.66) =>
    withTypeMatch(measured, {
      face: faceById('noto-sans')!,
      weight: 700,
      stem: 700,
      size: 60,
      tracking,
      iou,
      close: iou >= 0.7,
      capRatio: 0.72,
    } as unknown as TypeMatch).headline!

  it('is the matched face’s own fitted tracking, not the site’s, and says so', () => {
    expect(fitted(-0.035)).toMatchObject({ letterSpacing: -0.035, trackingFitted: true })
  })

  it('is kept within -0.04 to +0.02 em, where a substitute neither collides nor spreads', () => {
    // X0: the sites' headlines run -0.06 to 0.
    expect(fitted(-0.08).letterSpacing).toBe(-0.04)
    expect(fitted(0.035).letterSpacing).toBe(0.02)
  })

  it('goes to -0.06 em for a close match, as tight as the sites go', () => {
    // Deployr's Geist matched Geist (word overlap 0.80) at -0.08; the site sets -0.06.
    expect(fitted(-0.08, 0.8).letterSpacing).toBe(-0.06)
  })

  it('takes the range’s end for a face far too wide or narrow, the width nearest the screenshot', () => {
    // Fernway: Noto Sans 900 fitted -0.13 for a site at 0, drawn 1.20 times as wide at the
    // house -0.02em; the face choice weighs that width (chooseFace).
    expect(fitted(-0.13)).toMatchObject({ letterSpacing: -0.04, trackingFitted: true })
    expect(fitted(0.18).letterSpacing).toBe(0.02)
  })

  it('is left out where the drawing does not fit the crop', () => {
    // A drawing that barely overlaps the crop says nothing about the spacing.
    expect(fitted(-0.02, 0.4)).toMatchObject({ letterSpacing: null, trackingFitted: true })
    expect(fitted(-0.13, 0.4).letterSpacing).toBeNull()
  })

  it('makes the substitute draw the site’s line as wide, from a drawn headline', () => {
    // Set in Inter 700 at -0.03em: matched back, the tracking reproduces the line's width.
    const text = 'Customer feedback that shapes the roadmap'
    const page = blank(1400, 120)
    const s = shot(page, null, draw(page, 700, 48, text, 20, 20, -0.03))
    s.found.output.headline_text = text
    const match = matchType(s).headline!
    const h = withTypeMatch(measureGeometry(s), match).headline!
    expect(h.letterSpacing).not.toBeNull()
    const site = renderText(fontFor(faceById('inter')!, 700)!, 48, text, -0.03 * 48)
    const drawn = renderText(
      fontFor(match.face, match.weight)!,
      match.size,
      text,
      h.letterSpacing! * match.size
    )
    expect(Math.abs(drawn.advance / site.advance - 1)).toBeLessThan(0.02)
  })
})

describe('a headline reading that is not of its words', () => {
  const sans = faceById('inter')!
  const measured = {
    headline: {
      size: 150,
      weight: 100,
      letterSpacing: 0,
      lineHeight: null,
      leading: null,
      inkBox: [100, 200, 700, 310],
    },
    sectionHeading: { size: 30, capHeight: 21 },
    gapBelowHeadline: 40,
  } as unknown as Measured
  const match = (glyphWidth: number | undefined) =>
    ({
      face: sans,
      weight: 300,
      stem: 300,
      size: 150,
      tracking: 0,
      iou: 0.3,
      capRatio: 0.73,
      glyphWidth,
      letters: 24,
    }) as unknown as TypeMatch

  it('sizes nothing when the words drawn at that size are far narrower than any face', () => {
    // Two lines read as one (artwork bridging them, or a photo's dark parts read as the
    // ink): the size is the whole block's and the words come out at a fraction of any
    // face's width, as a carousel slide's lettering read glyph width -2.4.
    const read = withTypeMatch(measured, match(-1.2))
    expect(read.headline).toBeNull()
    // Its box says only how large the words are set.
    expect(read.headlineBlock).toBeGreaterThan(0)
    expect(read.sectionHeading).toEqual(measured.sectionHeading)
    expect(read.gapBelowHeadline).toBe(40)
  })

  it('keeps a condensed face’s reading, and one made without a width reading', () => {
    // Oswald and Barlow Condensed read -0.27 to -0.48.
    expect(withTypeMatch(measured, match(-0.48)).headline).toMatchObject({ size: 150 })
    expect(withTypeMatch(measured, match(-0.48)).headlineBlock).toBeUndefined()
    expect(withTypeMatch(measured, match(undefined)).headline).toMatchObject({ size: 150 })
  })

  it('is caught from a drawn headline whose two lines artwork runs together', () => {
    const text = 'Plan and ship your best work'
    const page = blank(1000, 260)
    const a = draw(page, 700, 60, 'Plan and ship', 40, 40)
    const b = draw(page, 700, 60, 'your best work', 40, 120)
    // Artwork beside the words, inside the headline's box, runs the lines' bands into one.
    const right = Math.max(a[2], b[2])
    for (let y = a[1]; y < b[3]; y++)
      for (let x = right + 10; x < right + 70; x++) {
        const o = (y * page.width + x) * 4
        for (let k = 0; k < 3; k++) page.data[o + k] = 17
      }
    const box: Box = [a[0], a[1], right + 70, b[3]]
    const s = shot(page, null, box)
    s.found.output.headline_text = text
    const geometry = measureGeometry(s)
    // As one line, the block reads as a headline more than twice its size.
    expect(geometry.headline!.lines).toBe(1)
    expect(geometry.headline!.size).toBeGreaterThan(150)
    const read = withTypeMatch(geometry, matchType(s).headline)
    expect(read.headline).toBeNull()
    // The box holds its words on two lines at about their own 60px (these lines are set
    // apart wider than most, 1.33, so it reads a little large).
    expect(read.headlineBlock).toBeGreaterThan(60 * 0.87)
    expect(read.headlineBlock).toBeLessThan(60 * 1.35)
  })
})

describe('the main button’s height', () => {
  const VIOLET: [number, number, number] = [83, 58, 253]
  /** A filled button with a label of white bars, as solid shapes find one. */
  function button(img: Image, [x0, y0, x1, y1]: Box, fill = VIOLET) {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const o = (y * img.width + x) * 4
        const label =
          y >= y0 + (y1 - y0) * 0.35 &&
          y < y0 + (y1 - y0) * 0.65 &&
          (x - x0) % 9 < 4 &&
          x > x0 + 16 &&
          x < x1 - 16
        const c = label ? [255, 255, 255] : fill
        img.data[o] = c[0]!
        img.data[o + 1] = c[1]!
        img.data[o + 2] = c[2]!
      }
  }
  function page(primary: Box, header: Box | null) {
    const img = blank(1440, 900)
    const s = shot(img, null, [200, 200, 900, 300])
    s.found.snapped.header = [0, 0, 1440, 72]
    s.found.snapped.primary_button = [
      primary[0] - 2,
      primary[1] - 2,
      primary[2] + 2,
      primary[3] + 2,
    ]
    button(img, primary)
    if (header) button(img, header)
    return s
  }

  // The site's main button, as the rig's fingerprint and the portal read it, is the
  // header's call to action (Paylane 40px, Chatterly 42, Fernway 32); the finder's main
  // button is usually the hero's bigger one (48, 57, 48).
  it('is the header’s call to action when one in the main button’s colour is there', () => {
    const s = page([200, 500, 340, 548], [1200, 16, 1336, 56])
    expect(measureGeometry(s).button).toMatchObject({ height: 40 })
  })

  it('is the main button’s own without a call to action in the header', () => {
    const s = page([200, 500, 340, 548], null)
    expect(measureGeometry(s).button).toMatchObject({ height: 48 })
  })

  it('reads the header’s button from the lossless strip, not the analysis JPEG', () => {
    const s = page([200, 500, 340, 548], null)
    // The strip at twice the CSS px holds the 40px header button; the analysis image does not.
    const strip = blank(2880, 400)
    button(strip, [2400, 32, 2672, 112])
    s.strip = strip
    expect(measureGeometry(s).button).toMatchObject({ height: 40 })
  })

  it('ignores a header button of another colour', () => {
    const img = page([200, 500, 340, 548], null)
    button(img.img, [1200, 16, 1336, 56], [10, 120, 60])
    expect(measureGeometry(img).button).toMatchObject({ height: 48 })
  })
})

describe('the section heading', () => {
  const page = (headingTop: number, height = 700) => {
    const img = blank(1000, height)
    const headline = draw(img, 600, 56, HEADLINE, 60, 120)
    const heading = draw(img, 500, 32, 'Built for every team', 60, headingTop)
    const s = shot(img, null, headline)
    s.found.snapped.section_heading = heading
    s.found.output.section_heading_text = 'Built for every team'
    return s
  }

  it('is measured where it shows whole below the headline', () => {
    const h = measureGeometry(page(560)).sectionHeading
    expect(h).toBeTruthy()
    expect(Math.abs(h!.size / 32 - 1)).toBeLessThanOrEqual(0.1)
  })

  it('is left out when cut by the bottom of the screenshot, or above the headline', () => {
    // Its box runs to the screenshot's bottom edge: the heading may go on below it.
    const cut = page(560, 594)
    cut.found.snapped.section_heading = [57, 557, 700, 594]
    expect(measureGeometry(cut).sectionHeading).toBeNull()
    const above = page(20)
    expect(measureGeometry(above).sectionHeading).toBeNull()
  })

  it('is left out inside a card: a card’s title is not a section heading (Fernway’s first card)', () => {
    const s = page(560)
    s.found.snapped.card = [40, 520, 760, 690]
    expect(measureGeometry(s).sectionHeading).toBeNull()
  })

  it('takes the matched face’s own cap height, as the headline does', () => {
    const measured = {
      headline: { size: 56, weight: 600, letterSpacing: 0, lineHeight: null, leading: null },
      sectionHeading: { size: 30, capHeight: 23.4, weight: 500 },
    } as unknown as Measured
    const match = {
      face: faceById('inter-tight')!,
      weight: 600,
      size: 56,
      tracking: 0,
      capRatio: 0.72,
    } as unknown as TypeMatch
    expect(withTypeMatch(measured, match).sectionHeading!.size).toBeCloseTo(32.5, 1)
  })
})

describe('screenshots under a pop-up', () => {
  const BLUE = [0, 88, 163]
  /** A white page with a blue logo and button and dark text; `dim` darkens every pixel by one factor. */
  function page(dim = 1, told: Shot['told'] = {}, banner = false): Shot {
    const img = blank(960, 600)
    const fill = ([x0, y0, x1, y1]: Box, c: number[]) => {
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) img.data.set([c[0]!, c[1]!, c[2]!, 255], (y * 960 + x) * 4)
    }
    fill([32, 20, 112, 44], BLUE)
    fill([700, 300, 860, 344], BLUE)
    for (let x = 64; x < 600; x += 8) fill([x, 160, x + 4, 200], [17, 17, 17])
    for (let x = 64; x < 600; x += 8) fill([x, 420, x + 3, 432], [17, 17, 17])
    if (dim !== 1)
      for (let i = 0; i < img.data.length; i += 4)
        for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(img.data[i + k]! * dim)
    // The pop-up's own white type, above the layer.
    if (dim !== 1) for (let x = 64; x < 600; x += 8) fill([x, 160, x + 4, 200], [255, 255, 255])
    const boxes = Object.fromEntries(BOX_KINDS.map((k) => [k, null])) as Record<BoxKind, Box | null>
    Object.assign(boxes, {
      header: [0, 0, 960, 64],
      logo: [32, 20, 112, 44],
      hero: [0, 64, 960, 380],
      headline: [60, 156, 604, 204],
      primary_button: [700, 300, 860, 344],
    })
    return {
      index: 0,
      img,
      strip: null,
      width: 960,
      height: 600,
      told,
      found: {
        version: 'test',
        scale: 1,
        boxes,
        snapped: boxes,
        output: {
          headline_text: HEADLINE,
          subtitle_text: '',
          behind_headline: 'plain',
          dimmed: false,
          cookie_banner: banner,
        },
      } as unknown as FoundElements,
    }
  }

  it('leaves a dimmed one out when a clean one shows the page, banner or not', () => {
    // The builder warned the first was dimmed (the finder missed it); the second has a banner.
    const dimmed = page(0.25, { dimmed: true })
    const clean = page(1, {}, true)
    expect(cleanShots([dimmed, clean])).toEqual([clean])
    const { roles } = measureColours([dimmed, clean])
    expect(roles.scheme).toBe('light')
    expect(roles.page).toBe('#ffffff')
    expect(roles.identity.value).not.toBe('#404040')
    expect(onlyDimmed([dimmed, clean])).toBe(false)
  })

  it('reads only dimmed ones as they are, never as a dark site, and says so', () => {
    // A white page under a heavy layer reads #404040: too dark to lift, and no dark site either.
    const dimmed = page(0.25, { dimmed: true })
    expect(cleanShots([dimmed])).toEqual([dimmed])
    expect(onlyDimmed([dimmed])).toBe(true)
    expect(measureColours([dimmed]).roles.scheme).toBe('light')
  })
})
