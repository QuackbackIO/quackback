/**
 * Geometry on synthetic images with known answers: corner radius of filled
 * and outlined shapes at several scales, border or shadow outside a box,
 * ink-free spacing and card padding, the content's width, the header's
 * layout from logo and menu boxes, and the menu's current item.
 */
import { describe, expect, it } from 'vitest'
import type { Box } from '../kinds'
import { cornerRadius, edgeStyle } from '../geometry'
import { headerLayout, navActive, navText } from '../header-nav'
import { boxGap, cardPadding, contentExtent, gapBelow, inkFreeBands } from '../spacing'
import {
  boxShadow,
  canvas,
  letters,
  paint,
  rect,
  roundOutline,
  roundRect,
  type Fill,
} from './shapes'
import { shadowStep } from '../measured-design'

const WHITE: Fill = [255, 255, 255]
const BLUE: Fill = [83, 58, 253]
const INK: Fill = [20, 24, 32]
const GREY: Fill = [226, 230, 236]

describe('cornerRadius', () => {
  it.each([0, 4, 6, 8, 12, 16])('measures a %ipx corner on a filled button within a pixel', (r) => {
    const img = canvas(300, 120, WHITE)
    roundRect(img, [60, 30, 220, 78], r, BLUE)
    const m = cornerRadius(img, [58, 28, 222, 80])!
    expect(Math.abs(m.radius - r)).toBeLessThan(1)
    expect(m.pill).toBe(false)
    expect(m.height).toBeCloseTo(48, 0)
  })

  it('calls a fully round end a pill, with half the height as its radius', () => {
    const img = canvas(300, 120, WHITE)
    roundRect(img, [60, 30, 220, 74], 22, BLUE)
    const m = cornerRadius(img, [60, 30, 220, 74])!
    expect(m.pill).toBe(true)
    expect(m.radius).toBeCloseTo(22, 0)
  })

  it('measures an outlined shape by its outline, and a card larger than a button', () => {
    const img = canvas(400, 300, WHITE)
    roundOutline(img, [40, 40, 340, 260], 12, 1, GREY)
    const m = cornerRadius(img, [40, 40, 340, 260])!
    expect(Math.abs(m.radius - 12)).toBeLessThan(1.5)
  })

  it('brings retina and downscaled images back to CSS px', () => {
    for (const scale of [2, 1024 / 1440]) {
      const img = canvas(Math.round(300 * scale), Math.round(120 * scale), WHITE)
      const k = (v: number) => v * scale
      roundRect(img, [k(60), k(30), k(220), k(78)], k(8), BLUE)
      const m = cornerRadius(img, [k(60), k(30), k(220), k(78)], { scale })!
      expect(Math.abs(m.radius - 8), String(scale)).toBeLessThan(1.5)
      expect(m.height).toBeCloseTo(48, 0)
    }
  })

  it('keeps its answer when one corner is hidden by a neighbour', () => {
    const img = canvas(300, 120, WHITE)
    roundRect(img, [60, 30, 220, 78], 8, BLUE)
    rect(img, [200, 20, 240, 40], BLUE)
    expect(Math.abs(cornerRadius(img, [60, 30, 220, 78])!.radius - 8)).toBeLessThan(1)
  })

  it('gives nothing for a box with no edge (text alone)', () => {
    const img = canvas(300, 120, WHITE)
    expect(cornerRadius(img, [60, 30, 220, 78])).toBeNull()
  })
})

describe('edgeStyle', () => {
  it('finds a 1px border round a card on the page colour', () => {
    const img = canvas(400, 300, WHITE)
    roundOutline(img, [40, 40, 340, 260], 8, 1, GREY)
    const e = edgeStyle(img, [40, 40, 340, 260])!
    expect(e.kind).toBe('border')
    expect(e.border!.width).toBe(1)
    expect(e.filled).toBe(false)
  })

  it('finds a soft shadow below a card', () => {
    const img = canvas(400, 300, WHITE)
    // A shadow fading over 10px below, and 3px at the sides.
    for (let d = 10; d >= 1; d--) {
      const v = Math.round(255 - (11 - d) * 2.2)
      rect(img, [40 - Math.min(d, 3), 42, 340 + Math.min(d, 3), 260 + d], [v, v, v])
    }
    roundRect(img, [40, 40, 340, 260], 8, WHITE)
    const e = edgeStyle(img, [40, 40, 340, 260])!
    expect(e.kind).toBe('shadow')
    expect(e.shadow!.depth).toBeGreaterThanOrEqual(3)
  })

  it('follows a deep shadow down past its edge profile, and reads each of the design’s own steps back', () => {
    const depth = (layers: Parameters<typeof boxShadow>[2]) => {
      const img = canvas(500, 420, WHITE)
      boxShadow(img, [60, 60, 400, 260], layers)
      roundRect(img, [60, 60, 400, 260], 8, WHITE)
      return edgeStyle(img, [60, 60, 400, 260])!.shadow!.depth
    }
    // The design's steps, as tune.ts draws them.
    const soft = depth([
      { y: 1, blur: 3, alpha: 0.08 },
      { y: 1, blur: 2, alpha: 0.06 },
    ])
    const lifted = depth([
      { y: 4, blur: 6, spread: -1, alpha: 0.1 },
      { y: 2, blur: 4, spread: -2, alpha: 0.1 },
    ])
    const floating = depth([
      { y: 6, blur: 18, spread: -4, alpha: 0.14 },
      { y: 1, blur: 3, alpha: 0.05 },
    ])
    const deep = depth([
      { y: 18, blur: 48, spread: -12, alpha: 0.2 },
      { y: 4, blur: 10, spread: -4, alpha: 0.06 },
    ])
    expect([soft, lifted, floating, deep].map(shadowStep)).toEqual([
      'soft',
      'lifted',
      'floating',
      'deep',
    ])
    // As sites draw them: Roomly's 0 8px 28px and Codewren's 0 28px 70px float well past 11px.
    expect(depth([{ y: 8, blur: 28, alpha: 0.28 }])).toBeGreaterThan(25)
    expect(depth([{ y: 28, blur: 70, alpha: 0.14 }])).toBeGreaterThan(40)
  })

  it('stops a deep shadow at what sits below it', () => {
    const img = canvas(500, 420, WHITE)
    boxShadow(img, [60, 60, 400, 260], [{ y: 12, blur: 32, spread: -8, alpha: 0.16 }])
    roundRect(img, [60, 60, 400, 260], 8, WHITE)
    rect(img, [60, 290, 400, 330], INK)
    expect(edgeStyle(img, [60, 60, 400, 260])!.shadow!.depth).toBeLessThan(30)
  })

  it('calls a card in its own colour filled, with no border', () => {
    const img = canvas(400, 300, WHITE)
    roundRect(img, [40, 40, 340, 260], 16, [240, 244, 250])
    const e = edgeStyle(img, [40, 40, 340, 260])!
    expect(e.kind).toBe('none')
    expect(e.filled).toBe(true)
  })

  it('sees nothing round a box of page colour (a list row)', () => {
    const img = canvas(400, 300, WHITE)
    letters(img, 'Hnn', { x: 60, baseline: 80, cap: 14, xHeight: 10, stem: 2, gap: 1 }, INK)
    const e = edgeStyle(img, [40, 40, 340, 260])!
    expect(e.kind).toBe('none')
    expect(e.filled).toBe(false)
  })
})

describe('spacing', () => {
  it('finds ink-free bands and the gap under a headline', () => {
    const img = canvas(600, 400, WHITE)
    rect(img, [50, 50, 400, 98], INK)
    rect(img, [50, 130, 300, 150], INK)
    rect(img, [50, 230, 200, 270], BLUE)
    const bands = inkFreeBands(img, [0, 0, 600, 400])
    expect(bands).toEqual([
      [0, 50],
      [98, 130],
      [150, 230],
      [270, 400],
    ])
    expect(gapBelow(img, [50, 50, 400, 98])).toBe(32)
    expect(gapBelow(img, [50, 50, 400, 98], { scale: 2 })).toBe(16)
  })

  it('falls back to the gap between boxes under a headline on busy pixels', () => {
    const headline = [50, 50, 400, 98]
    expect(
      boxGap(headline, [null, [50, 130, 300, 150], [50, 230, 200, 270], [500, 100, 560, 120]])
    ).toBe(32)
    expect(boxGap(headline, [[50, 130, 300, 150]], { scale: 2 })).toBe(16)
    expect(boxGap(headline, [[500, 130, 560, 150]])).toBeNull()
    // On a photo no row under the headline is free of ink: the pixel gap gives nothing.
    const img = canvas(600, 400, WHITE)
    for (let y = 0; y < 400; y += 2) rect(img, [0, y, 600, y + 1], INK)
    expect(gapBelow(img, headline)).toBeNull()
  })

  it('measures card padding from the card edge to its content', () => {
    const img = canvas(400, 300, WHITE)
    roundOutline(img, [40, 40, 340, 260], 8, 1, GREY)
    letters(img, 'Hnn', { x: 64, baseline: 78, cap: 14, xHeight: 10, stem: 2, gap: 1 }, INK)
    expect(cardPadding(img, [40, 40, 340, 260])).toBe(24)
  })

  it('reads the content width from the header’s ink, else from the boxes', () => {
    const img = canvas(1440, 400, WHITE)
    rect(img, [120, 20, 200, 50], INK)
    rect(img, [1200, 20, 1320, 52], BLUE)
    const e = contentExtent(img, [0, 0, 1440, 72], [])!
    expect(e.left).toBe(120)
    expect(e.right).toBe(1320)
    expect(e.width).toBe(1200)
    expect(
      contentExtent(img, null, [[300, 100, 900, 200], null, [250, 300, 800, 350]])!.width
    ).toBe(650)
  })
})

describe('headerLayout', () => {
  const W = 1440
  it('reads inline with the menu beside the logo, or centred between', () => {
    expect(headerLayout([100, 26, 165, 51], [193, 29, 665, 47], W)).toEqual({
      header: 'inline',
      menuAlign: 'start',
    })
    expect(headerLayout([22, 15, 55, 49], [527, 23, 913, 40], W)).toEqual({
      header: 'inline',
      menuAlign: 'centre',
    })
  })
  it('reads stacked with the menu under the logo, and centred with the logo in the middle', () => {
    expect(headerLayout([48, 20, 160, 60], [48, 80, 600, 100], W)!.header).toBe('stacked')
    expect(headerLayout([680, 20, 760, 60], [500, 80, 940, 100], W)!.header).toBe('centered')
  })
  it('gives nothing without a logo', () => {
    expect(headerLayout(null, [193, 29, 665, 47], W)).toBeNull()
  })
})

describe('navActive', () => {
  /** Five menu items "Hnnn" 24px apart; `mark` styles item 2. */
  function menu(
    mark: (img: ReturnType<typeof canvas>, item: Box) => void,
    opts: { stem?: number[]; ink?: Fill[] } = {}
  ) {
    const img = canvas(900, 90, WHITE)
    const items: Box[] = []
    let x = 100
    for (let i = 0; i < 5; i++) {
      const box: Box = [x, 30, x + 60, 50]
      if (i === 2) mark(img, box)
      const right = letters(
        img,
        'Hnnn',
        { x, baseline: 50, cap: 14, xHeight: 10, stem: opts.stem?.[i] ?? 1.6, gap: 1.5 },
        opts.ink?.[i] ?? INK
      )
      items.push([x, 36, Math.ceil(right), 50])
      x = Math.ceil(right) + 28
    }
    return { img, nav: [96, 30, x - 24, 56] as Box }
  }

  it('finds the items and no current one on a plain menu', () => {
    const { img, nav } = menu(() => {})
    const a = navActive(img, nav)!
    expect(a.items).toHaveLength(5)
    expect(a.style).toBe('none')
  })

  it('finds a pill behind the current item', () => {
    const { img, nav } = menu((im, [x0, y0, x1, y1]) =>
      roundRect(im, [x0 - 10, y0 - 2, x1 + 6, y1 + 6], 10, GREY)
    )
    expect(navActive(img, [80, 20, 600, 66])).toMatchObject({ style: 'pill', index: 2 })
    expect(nav).toBeTruthy()
  })

  it('finds a line under the current item', () => {
    const { img, nav } = menu(() => {})
    const it2 = navActive(img, nav)!.items[2]!
    rect(img, [it2[0], 54, it2[2], 56], BLUE)
    expect(navActive(img, nav)).toMatchObject({ style: 'underline', index: 2 })
  })

  it('finds a heavier current item, and one in a colour of its own', () => {
    const bold = menu(() => {}, { stem: [1.6, 1.6, 3.2, 1.6, 1.6] })
    expect(navActive(bold.img, bold.nav)).toMatchObject({ style: 'bold', index: 2 })
    const colour = menu(() => {}, { ink: [INK, INK, BLUE, INK, INK] })
    expect(navActive(colour.img, colour.nav)).toMatchObject({ style: 'plain', index: 2 })
  })

  it('takes art or a gradient behind one item for no current item', () => {
    const { img, nav } = menu(() => {})
    const it4 = navActive(img, nav)!.items[4]!
    // A gradient from the last item to the right edge, as art behind a header.
    paint(img, [it4[0] - 20, 0, 900, 90], (x) => x >= it4[0] - 20, [200, 220, 255])
    for (let x = Math.round(it4[0] - 20); x < 900; x++)
      rect(
        img,
        [x, 0, x + 1, 90],
        [Math.round(255 - (x - it4[0]) * 0.3), Math.round(240 - (x - it4[0]) * 0.2), 255]
      )
    letters(
      img,
      'Hnnn',
      { x: it4[0], baseline: 50, cap: 14, xHeight: 10, stem: 1.6, gap: 1.5 },
      INK
    )
    expect(navActive(img, nav)!.style).toBe('none')
  })

  it('takes a rule running on across the page from under one item for no current item', () => {
    const { img, nav } = menu(() => {})
    const it4 = navActive(img, nav)!.items[4]!
    rect(img, [it4[0] - 2, 56, 900, 58], BLUE)
    expect(navActive(img, nav)!.style).toBe('none')
  })

  it('reads a fill running down to the header’s foot as a tab', () => {
    const img = canvas(900, 90, WHITE)
    paint(img, [0, 0, 900, 90], () => false, WHITE)
    const { img: m } = menu((im, [x0, , x1]) => rect(im, [x0 - 10, 18, x1 + 6, 70], GREY))
    expect(navActive(m, [80, 20, 600, 66], { header: [0, 0, 900, 70] })).toMatchObject({
      style: 'tabs',
      index: 2,
    })
  })
})

describe('navText', () => {
  /** Five menu items in one ink on a header colour. */
  function row(ink: Fill, header: Fill = WHITE) {
    const img = canvas(900, 90, header)
    let x = 100
    for (let i = 0; i < 5; i++) {
      const right = letters(
        img,
        'Hnnn',
        { x, baseline: 50, cap: 14, xHeight: 10, stem: 1.6, gap: 1.5 },
        ink
      )
      x = Math.ceil(right) + 28
    }
    const nav: Box = [96, 30, x - 24, 56]
    return navText(img, navActive(img, nav))
  }

  it('reads a menu in the page’s dark text as strong', () => {
    expect(row(INK)).toMatchObject({ strong: true })
    // X0: Paylane's navy, Chatterly's and Notewell's near black.
    expect(row([6, 27, 49])!.strong).toBe(true)
  })

  it('reads a grey menu as soft, as Deployr’s and Coralbank’s are', () => {
    expect(row([80, 80, 80])!.strong).toBe(false)
    expect(row([107, 116, 123])!.strong).toBe(false)
  })

  it('weighs the ink against what its header allows: dark green on a lime header is strong', () => {
    // X0: Fernway's menu, 9.5:1 on its green header, as far as that header lets any text go.
    expect(row([22, 51, 0], [159, 232, 112])!.strong).toBe(true)
  })

  it('reads light grey on a dark header as soft, and near white as strong', () => {
    expect(row([138, 143, 152], [8, 9, 10])!.strong).toBe(false)
    expect(row([240, 240, 240], [8, 9, 10])!.strong).toBe(true)
  })

  it('leaves the current item out, and gives nothing without items', () => {
    const img = canvas(900, 90, WHITE)
    expect(navText(img, null)).toBeNull()
    expect(navText(img, { style: 'none', index: -1, items: [] })).toBeNull()
  })
})
