/**
 * A rendered page's measurements become a `BrandRead` by the same rule the
 * measured fixtures were converted by, so the browser reader reads a live site
 * as the fixtures say it should.
 */
import { describe, expect, it } from 'vitest'
import type { BrandRead } from '@/lib/shared/theme/brand-import'
import measured from '@/lib/shared/theme/__tests__/fixtures/brand-sites/measured.json'
import brandReads from '@/lib/shared/theme/__tests__/fixtures/brand-sites/brand-reads.json'
import { brandReadFromMeasure, parseCssColour } from '../measure-read'
import type { PageCandidate, PageMeasure, PageSurface } from '../page-measure'

const sites = measured as unknown as Record<string, PageMeasure>
const reads = brandReads as Record<string, BrandRead>

describe('brandReadFromMeasure', () => {
  it.each(Object.keys(sites))('reads %s as the fixture does', (site) => {
    const read = brandReadFromMeasure(sites[site]!)
    expect(JSON.parse(JSON.stringify(read))).toEqual(reads[site])
  })

  const base: PageMeasure = {
    title: 'Acme',
    themeColor: null,
    bg: 'rgb(255, 255, 255)',
    text: 'rgb(17, 17, 17)',
    bodyFont: 'Lato, sans-serif',
    h1: null,
    buttons: [],
    logo: null,
  }

  // The page's theme-color is whatever the site wrote: only a real colour
  // that could lead the brand is kept, as on the static path.
  it.each([
    ['red', undefined],
    ['#f00', '#ff0000'],
    ['  #1A73E8 ', '#1a73e8'],
    ['var(--brand)', undefined],
    ['not a colour; }', undefined],
    ['#fafafa', undefined],
    ['rgba(26, 115, 232, 0.2)', undefined],
  ])('reads the theme colour %j as %j', (raw, expected) => {
    expect(brandReadFromMeasure({ ...base, themeColor: raw }).themeColor).toBe(expected)
  })

  it('reads nothing for a colour it cannot parse', () => {
    const read = brandReadFromMeasure({ ...base, text: 'color(from red a98-rgb r g b)' })
    expect(read.page).toEqual({ background: '#ffffff' })
  })

  // Computed styles keep lab(), lch() and color() as a site wrote them.
  it.each([
    ['lab(99.9987 0.0337958 0.000309944)', [255, 255, 255, 1]],
    ['lab(0 0 0)', [0, 0, 0, 1]],
    ['lab(54.29 80.8 69.89)', [255, 0, 0, 1]],
    ['lab(54.29 80.8 69.89 / 0.4)', [255, 0, 0, 0.4]],
    ['lch(54.29 106.84 40.85)', [255, 0, 0, 1]],
    ['color(srgb 1 0.5 0)', [255, 128, 0, 1]],
    ['color(srgb 0.2 0.4 0.6 / 50%)', [51, 102, 153, 0.5]],
    ['color(display-p3 1 1 1)', [255, 255, 255, 1]],
    ['oklch(0 0 none / 0.54)', [0, 0, 0, 0.54]],
  ] as const)('reads %s', (value, [r, g, b, a]) => {
    const colour = parseCssColour(value)
    expect(colour).not.toBeNull()
    expect(Math.abs(colour![0] - r)).toBeLessThanOrEqual(1)
    expect(Math.abs(colour![1] - g)).toBeLessThanOrEqual(1)
    expect(Math.abs(colour![2] - b)).toBeLessThanOrEqual(1)
    expect(colour![3]).toBe(a)
  })

  it('reads a page and its button written in lab()', () => {
    const read = brandReadFromMeasure({
      ...base,
      bg: 'lab(99.9987 0.0337958 0.000309944)',
      text: 'lab(10.7201 -0.0959039 -1.54182)',
      candidates: [
        {
          bg: 'lab(54.29 80.8 69.89)',
          fg: 'lab(100 0 0)',
          radius: '10px',
          h: 36,
          w: 84,
          top: 20,
          text: 'Start for free',
          header: true,
          overlay: false,
        },
      ],
    })
    expect(read.page?.background).toBe('#ffffff')
    expect(read.page?.text).toBe('#1c1d1f')
    expect(read.button?.fill).toMatch(/^#f[ef]0[0-2]0[0-2]$/)
  })

  it('reads colours a browser reports in oklch, as a site defined them', () => {
    const read = brandReadFromMeasure({
      ...base,
      bg: 'oklch(0.9945 0.0017 67.8)',
      text: 'oklch(0.2 0 0)',
      candidates: [
        {
          bg: 'oklch(0.6147 0.1986 30.12)',
          fg: 'oklch(1 0 0)',
          radius: '8px',
          h: 40,
          w: 140,
          top: 300,
          text: 'Start for free',
          header: false,
          overlay: false,
        },
      ],
    })
    expect(read.button?.fill).toBe('#e34432')
    expect(read.page?.background).toMatch(/^#fe/)
  })

  it('reads an oklch colour with an alpha of nothing as see-through', () => {
    expect(parseCssColour('oklch(0.5 0.1 30 / 0)')?.[3]).toBe(0)
    expect(parseCssColour('oklch(0.5 0.1 30 / 50%)')?.[3]).toBe(0.5)
  })

  it('lays a translucent page colour over the browser’s white', () => {
    const read = brandReadFromMeasure({
      ...base,
      bg: 'oklab(0.846996 0.000175841 0.0101865 / 0.2)',
      buttons: [{ bg: 'rgba(0, 0, 0, 0.5)', fg: 'rgb(255, 255, 255)', radius: '8px', h: 40 }],
    })
    expect(read.page?.background).toBe('#f5f5f3')
    // And everything on it is laid over that, not over the colour at full strength.
    expect(read.button?.fill).toBe('#7b7b7a')
    expect(brandReadFromMeasure({ ...base, bg: 'rgba(0, 0, 0, 0.5)' }).page?.background).toBe(
      '#808080'
    )
  })

  it('lays a translucent button over the page', () => {
    const read = brandReadFromMeasure({
      ...base,
      bg: 'rgb(0, 0, 0)',
      buttons: [{ bg: 'rgba(255, 255, 255, 0.5)', fg: 'rgb(0, 0, 0)', radius: '8px', h: 40 }],
    })
    expect(read.button).toEqual({ fill: '#808080', ink: '#000000', heightPx: 40, radiusPx: 8 })
  })

  describe('the brand button', () => {
    const button = (bg: string, extra: Partial<PageCandidate> = {}): PageCandidate => ({
      bg,
      fg: 'rgb(255, 255, 255)',
      radius: '6px',
      h: 40,
      w: 140,
      top: 300,
      text: 'Get started',
      header: false,
      overlay: false,
      ...extra,
    })
    const fill = (candidates: PageCandidate[], page = base) =>
      brandReadFromMeasure({ ...page, candidates }).button?.fill

    it('takes a coloured call to action over a black or white one', () => {
      expect(
        fill([
          button('rgb(0, 0, 0)', { header: true, h: 32, text: 'Sign up' }),
          button('rgb(8, 135, 43)', { h: 46 }),
        ])
      ).toBe('#08872b')
    })

    it('takes the black one when nothing is coloured', () => {
      expect(
        fill([button('rgb(23, 23, 23)'), button('rgb(240, 240, 240)', { fg: 'rgb(0, 0, 0)' })])
      ).toBe('#171717')
    })

    it('never takes a cookie banner’s button', () => {
      expect(
        fill([button('rgb(34, 34, 34)', { overlay: true, text: 'Accept all' })])
      ).toBeUndefined()
    })

    it('skips fills that are see-through, page-coloured, or whose words cannot be read', () => {
      expect(
        fill(
          [
            button('rgba(255, 255, 255, 0)', { fg: 'rgb(0, 0, 0)' }),
            button('rgb(255, 255, 255)', { fg: 'rgb(23, 23, 23)' }),
            button('rgb(238, 240, 243)', { fg: 'rgb(255, 255, 255)' }),
            button('rgb(0, 82, 255)'),
          ],
          { ...base, bg: 'rgb(250, 250, 250)' }
        )
      ).toBe('#0052ff')
    })

    it('takes a black call to action over a pale tinted chip', () => {
      expect(
        fill([
          button('rgb(255, 201, 255)', { fg: 'rgb(13, 13, 13)', text: 'Operations' }),
          button('rgb(13, 13, 13)'),
        ])
      ).toBe('#0d0d0d')
    })

    it('takes the shape from a page-coloured button when no button gives the colour', () => {
      const read = brandReadFromMeasure({
        ...base,
        candidates: [
          button('rgb(255, 255, 255)', { fg: 'rgb(31, 31, 31)', radius: '9999px', h: 50 }),
        ],
      })
      expect(read.button).toEqual({ heightPx: 50, radiusPx: 9999 })
    })

    it('reads a huge radius written in exponent form as a pill', () => {
      const read = brandReadFromMeasure({
        ...base,
        candidates: [button('rgb(23, 23, 23)', { radius: '3.35544e+07px' })],
      })
      expect(read.button?.radiusPx).toBeGreaterThan(1000)
    })
  })

  it('reads the font and text colour most words use, over the body’s', () => {
    const read = brandReadFromMeasure({
      ...base,
      bodyFont: '"Times New Roman"',
      text: 'rgb(0, 0, 0)',
      textFont: '"Sharp Grotesk", sans-serif',
      textColor: 'rgb(30, 25, 25)',
    })
    expect(read.fonts?.body?.family).toBe('Sharp Grotesk')
    expect(read.page?.text).toBe('#1e1919')
  })

  it('reads no font when the page only has the browser’s default', () => {
    const read = brandReadFromMeasure({
      ...base,
      bodyFont: '"Times New Roman"',
      textFont: '"Times New Roman"',
    })
    expect(read.fonts).toBeUndefined()
  })

  it('reads an inline logo’s colour as a brand colour, but not the default link blue', () => {
    const logo = { tag: 'svg', src: null, w: 102, h: 32, svg: '<svg/>' }
    expect(
      brandReadFromMeasure({ ...base, logo: { ...logo, color: 'rgb(255, 56, 92)' } }).logoColour
    ).toBe('#ff385c')
    expect(
      brandReadFromMeasure({ ...base, logo: { ...logo, color: 'rgb(0, 0, 238)' } }).logoColour
    ).toBeUndefined()
  })

  describe('a logo drawn in one hue', () => {
    const logo = (svg: string, color = 'rgb(0, 0, 238)') => ({
      tag: 'svg',
      src: null,
      w: 32,
      h: 32,
      svg,
      color,
    })
    it('reads the hue its paints share as a brand colour', () => {
      const svg =
        '<svg><path fill="rgb(226, 67, 41)"/><path fill="#fc6d26"/><path fill="#fca326"/><path fill="rgb(226, 67, 41)"/><text fill="#171321">GitLab</text></svg>'
      expect(brandReadFromMeasure({ ...base, logo: logo(svg) }).logoColour).toBe('#e24329')
    })
    it('reads nothing from a logo of many hues', () => {
      const svg =
        '<svg><path fill="#f24e1e"/><path fill="#a259ff"/><path fill="#1abcfe"/><path fill="#0acf83"/><path fill="#ff7262"/></svg>'
      expect(brandReadFromMeasure({ ...base, logo: logo(svg) }).logoColour).toBeUndefined()
    })
  })

  describe('the page palette', () => {
    const surface = (bg: string, chars: number, extra: Partial<PageSurface> = {}): PageSurface => ({
      bg,
      chars,
      rounded: true,
      bordered: false,
      shadowed: false,
      wide: false,
      ...extra,
    })

    it('reads the card, border and quieter text the words sit in', () => {
      const read = brandReadFromMeasure({
        ...base,
        bg: 'rgb(238, 239, 233)',
        textColor: 'rgb(21, 21, 21)',
        surfaces: [
          surface('rgb(255, 255, 255)', 900),
          surface('rgb(30, 30, 30)', 50, { wide: true }),
          surface('rgb(255, 201, 255)', 40),
        ],
        texts: [
          { color: 'rgb(21, 21, 21)', chars: 2000 },
          { color: 'rgb(55, 65, 81)', chars: 600 },
        ],
        borders: [{ color: 'rgb(191, 193, 183)', count: 30 }],
      })
      expect(read.page).toMatchObject({ card: '#ffffff', border: '#bfc1b7', mutedText: '#374151' })
    })

    describe('a page whose body paints nothing', () => {
      const clear = { ...base, bg: 'rgba(0, 0, 0, 0)', text: 'rgb(0, 0, 0)' }
      it('is the dark fill its light words sit on, not white', () => {
        const read = brandReadFromMeasure({
          ...clear,
          textColor: 'rgb(207, 207, 207)',
          surfaces: [
            surface('rgb(37, 37, 37)', 793, { wide: true }),
            surface('rgb(40, 44, 68)', 4),
          ],
          texts: [{ color: 'rgb(207, 207, 207)', chars: 640 }],
        })
        expect(read.page).toMatchObject({ background: '#252525', text: '#cfcfcf' })
      })
      it('is the leading wide fill when the words sit on several dark fills', () => {
        const read = brandReadFromMeasure({
          ...clear,
          textColor: 'rgb(167, 186, 190)',
          surfaces: [
            surface('rgb(4, 23, 52)', 456, { wide: true, rounded: false }),
            surface('rgb(14, 13, 12)', 432),
            surface('rgb(6, 12, 24)', 207),
            surface('rgb(255, 255, 255)', 90),
          ],
        })
        expect(read.page?.background).toBe('#041734')
      })
      it('stays see-through when its words are dark: a white page with dark bands', () => {
        const read = brandReadFromMeasure({
          ...clear,
          textColor: 'rgb(80, 86, 91)',
          surfaces: [
            surface('rgb(0, 0, 0)', 855, { wide: true }),
            surface('rgb(255, 255, 255)', 284, { wide: true }),
          ],
        })
        expect(read.page?.background).toBe('transparent')
      })
      it('stays see-through when light words lie over a picture and the fills are light', () => {
        const read = brandReadFromMeasure({
          ...clear,
          textColor: 'rgb(255, 255, 255)',
          surfaces: [
            surface('rgb(255, 255, 255)', 538, { wide: true }),
            surface('rgb(16, 43, 43)', 97, { wide: true }),
          ],
        })
        expect(read.page?.background).toBe('transparent')
      })
      it('stays see-through when the dark fills are cards and no band leads', () => {
        const read = brandReadFromMeasure({
          ...clear,
          textColor: 'rgb(255, 255, 255)',
          surfaces: [
            surface('rgb(0, 59, 57)', 173),
            surface('rgb(8, 80, 75)', 60, { wide: true }),
            surface('rgb(250, 248, 245)', 33, { wide: true }),
          ],
        })
        expect(read.page?.background).toBe('transparent')
      })
      it('leaves a page that paints itself alone', () => {
        const read = brandReadFromMeasure({
          ...base,
          textColor: 'rgb(255, 255, 255)',
          surfaces: [surface('rgb(37, 37, 37)', 793, { wide: true })],
        })
        expect(read.page?.background).toBe('#ffffff')
      })
      it('stays dark when a notice is the only light fill among the dark ones', () => {
        const read = brandReadFromMeasure({
          ...clear,
          textColor: 'rgb(167, 186, 190)',
          surfaces: [
            surface('rgb(4, 23, 52)', 456, { wide: true, rounded: false }),
            surface('rgb(14, 13, 12)', 432, { bordered: true, shadowed: true }),
            surface('rgb(6, 12, 24)', 207, { bordered: true, shadowed: true }),
            surface('rgb(9, 11, 15)', 125, { bordered: true }),
            surface('rgb(255, 255, 255)', 51, { wide: true, rounded: false, shadowed: true }),
            surface('rgb(0, 16, 39)', 16, { bordered: true }),
          ],
        })
        expect(read.page).toMatchObject({ background: '#041734', text: '#a7babe' })
      })
      // White words over a hero photo, then a dark band, then light ones: the
      // dark band holds the most words, but a third of them sit on light bands.
      it.each([
        ['under a white header', { bg: 'rgb(255, 255, 255)', text: 'oklch(0.373 0.034 259.733)' }],
        ['with no header read', null],
      ])(
        'stays see-through when light bands hold a real share of the words beside a dark one, %s',
        (_, header) => {
          const read = brandReadFromMeasure({
            ...clear,
            textColor: 'rgb(255, 255, 255)',
            header,
            surfaces: [
              surface('oklch(0.278 0.033 256.848)', 131, { wide: true, rounded: false }),
              surface('rgb(255, 255, 255)', 39, { wide: true, rounded: false, shadowed: true }),
              surface('rgb(0, 58, 112)', 35, { wide: true, rounded: false }),
              surface('oklch(0.985 0.002 247.839)', 32, { wide: true, rounded: false }),
              surface('oklch(0.967 0.003 264.542)', 9, { wide: true, rounded: false }),
            ],
            texts: [{ color: 'rgb(255, 255, 255)', chars: 92 }],
          })
          expect(read.page?.background).toBe('transparent')
          expect(read.page?.text).toBe('#ffffff')
        }
      )
    })

    it('keeps a page that paints nothing white under a light header, whatever its bands hold', () => {
      const read = brandReadFromMeasure({
        ...base,
        bg: 'rgba(0, 0, 0, 0)',
        textColor: 'rgb(255, 255, 255)',
        header: { bg: 'rgb(250, 248, 245)', text: 'rgb(27, 27, 27)' },
        surfaces: [
          surface('rgb(0, 59, 57)', 280, { wide: true }),
          surface('rgb(250, 248, 245)', 20),
        ],
      })
      expect(read.page?.background).toBe('transparent')
    })

    describe('a page whose body paints a dark colour', () => {
      const black = { ...base, bg: 'rgb(0, 0, 0)', text: 'rgb(0, 0, 0)' }
      const covered = {
        ...black,
        textColor: 'rgb(0, 0, 0)',
        surfaces: [
          surface('rgb(255, 255, 255)', 516, { wide: true, rounded: false }),
          surface('rgb(1, 167, 91)', 250, { wide: true, rounded: false }),
          surface('rgb(0, 0, 0)', 62, { wide: true, rounded: false }),
        ],
        texts: [{ color: 'rgb(0, 0, 0)', chars: 20 }],
      }
      it('is the light band its dark words sit on, when light bands cover the body', () => {
        const read = brandReadFromMeasure(covered)
        expect(read.page).toMatchObject({ background: '#ffffff', text: '#000000' })
      })
      it('reads no dark mode from the same covered body', () => {
        const { bg, text, textColor, surfaces, texts } = covered
        const read = brandReadFromMeasure({
          ...covered,
          dark: { bg, text, textColor, surfaces, texts },
        })
        expect(read.dark).toBeUndefined()
      })
      it('stays dark when its dark words have no light band to sit on', () => {
        const read = brandReadFromMeasure({
          ...black,
          bg: 'rgb(13, 13, 13)',
          textColor: 'rgb(0, 0, 0)',
          surfaces: [surface('rgb(220, 51, 24)', 52), surface('rgba(0, 0, 0, 0.75)', 38)],
        })
        expect(read.page?.background).toBe('#0d0d0d')
      })
      it('stays dark when the light fill under its dark words is a card or a scrap', () => {
        const card = brandReadFromMeasure({
          ...black,
          textColor: 'rgb(0, 0, 0)',
          surfaces: [surface('rgb(255, 255, 255)', 516)],
        })
        expect(card.page?.background).toBe('#000000')
        const scrap = brandReadFromMeasure({
          ...black,
          textColor: 'rgb(0, 0, 0)',
          surfaces: [surface('rgb(255, 255, 255)', 60, { wide: true })],
        })
        expect(scrap.page?.background).toBe('#000000')
      })
      it('stays dark when dark fills hold most of the words on fills', () => {
        const read = brandReadFromMeasure({
          ...black,
          textColor: 'rgb(0, 0, 0)',
          surfaces: [
            surface('rgb(20, 23, 26)', 600, { wide: true }),
            surface('rgb(255, 255, 255)', 300, { wide: true }),
          ],
        })
        expect(read.page?.background).toBe('#000000')
      })
      // A dark first screen, then light bands whose dark words lead: the bar
      // across the top is still the body's colour.
      it('stays dark under a dark header, though dark words on light bands lead', () => {
        const read = brandReadFromMeasure({
          ...black,
          bg: 'rgb(5, 32, 60)',
          textColor: 'rgb(22, 22, 22)',
          header: { bg: 'rgb(5, 32, 60)', text: 'rgb(255, 255, 255)' },
          surfaces: [
            surface('rgb(255, 255, 255)', 424, { wide: true }),
            surface('rgb(5, 32, 60)', 276, { wide: true }),
          ],
          texts: [
            { color: 'rgb(22, 22, 22)', chars: 248 },
            { color: 'rgb(255, 255, 255)', chars: 187 },
          ],
        })
        expect(read.page?.background).toBe('#05203c')
      })
      it('reads no light "dark mode" from the same body under the same header', () => {
        const dark = {
          bg: 'rgb(5, 32, 60)',
          text: 'rgb(22, 22, 22)',
          textColor: 'rgb(22, 22, 22)',
          surfaces: [
            surface('rgb(255, 255, 255)', 424, { wide: true }),
            surface('rgb(5, 32, 60)', 276, { wide: true }),
          ],
        }
        const read = brandReadFromMeasure({
          ...base,
          ...dark,
          textColor: 'rgb(255, 255, 255)',
          header: { bg: 'rgb(5, 32, 60)', text: 'rgb(255, 255, 255)' },
          dark,
        })
        expect(read.page?.background).toBe('#05203c')
        expect(read.dark).toBeUndefined()
      })
      // Light words read on the dark body: the body is the page, whatever the bands hold.
      it.each([
        [
          'rgb(0, 13, 37)',
          '#000d25',
          [
            surface('rgb(255, 255, 255)', 56, { wide: true }),
            surface('rgb(243, 244, 247)', 19, { wide: true }),
          ],
        ],
        [
          'rgb(5, 32, 60)',
          '#05203c',
          [
            surface('rgb(255, 255, 255)', 424, { wide: true }),
            surface('rgb(5, 32, 60)', 276, { wide: true }),
          ],
        ],
        [
          'rgb(41, 45, 62)',
          '#292d3e',
          [
            surface('rgb(255, 251, 232)', 109, { wide: true }),
            surface('rgb(255, 175, 243)', 41, { wide: true }),
          ],
        ],
      ])(
        'stays dark (%s) when its light words read on the body, beside light bands',
        (bg, page, surfaces) => {
          const read = brandReadFromMeasure({
            ...black,
            bg,
            textColor: 'rgb(255, 255, 255)',
            header: { bg: 'rgb(255, 255, 255)', text: 'rgb(0, 0, 0)' },
            surfaces,
          })
          expect(read.page?.background).toBe(page)
        }
      )
    })

    it('reads the header bar the logo sits on, and its text', () => {
      const read = brandReadFromMeasure({
        ...base,
        header: { bg: 'rgb(0, 94, 184)', text: 'rgb(255, 255, 255)' },
      })
      expect(read.page).toMatchObject({ header: '#005eb8', headerText: '#ffffff' })
      expect(brandReadFromMeasure({ ...base, header: null }).page?.header).toBeUndefined()
    })

    it('reads no card from a band as wide as the page, or from a page-coloured box', () => {
      const read = brandReadFromMeasure({
        ...base,
        surfaces: [
          surface('rgb(246, 249, 252)', 900, { wide: true }),
          surface('rgb(255, 255, 255)', 50),
        ],
      })
      expect(read.page?.card).toBeUndefined()
    })

    // The card colour is the fill of the cards most words sit on. A chip, a
    // promo box or one tinted tile beside them is not the site's card.
    it('reads no card when the cards most words sit on are the page’s own colour', () => {
      const read = brandReadFromMeasure({
        ...base,
        surfaces: [
          surface('rgb(255, 255, 255)', 657, { bordered: true, shadowed: true }),
          surface('rgb(255, 240, 241)', 10, { bordered: true }),
          surface('rgb(246, 247, 248)', 10, { bordered: true }),
        ],
      })
      expect(read.page?.card).toBeUndefined()
    })

    it('reads no card from a chip holding a few words', () => {
      const read = brandReadFromMeasure({
        ...base,
        surfaces: [
          surface('rgb(255, 255, 255)', 275, { wide: true }),
          surface('rgb(242, 248, 243)', 8),
        ],
      })
      expect(read.page?.card).toBeUndefined()
    })

    it('reads no card when the leading cards are coloured, or no fill clearly leads', () => {
      const coloured = brandReadFromMeasure({
        ...base,
        surfaces: [
          surface('rgb(160, 225, 225)', 129),
          surface('rgb(33, 35, 29)', 123),
          surface('rgb(22, 51, 0)', 97),
          surface('rgb(224, 247, 247)', 60),
        ],
      })
      expect(coloured.page?.card).toBeUndefined()
      const split = brandReadFromMeasure({
        ...base,
        surfaces: [
          surface('rgb(246, 246, 254)', 196, { bordered: true }),
          surface('rgb(253, 247, 231)', 190, { bordered: true }),
        ],
      })
      expect(split.page?.card).toBeUndefined()
    })

    it('reads the card that clearly leads, beside a small box of another fill', () => {
      const read = brandReadFromMeasure({
        ...base,
        bg: 'rgb(240, 244, 245)',
        surfaces: [surface('rgb(255, 255, 255)', 213), surface('rgb(0, 75, 147)', 10)],
      })
      expect(read.page?.card).toBe('#ffffff')
    })

    it('reads the dark mode the site shows a visitor whose system is dark', () => {
      const read = brandReadFromMeasure({
        ...base,
        dark: {
          bg: 'rgb(29, 31, 39)',
          text: 'rgb(250, 250, 250)',
          candidates: [
            {
              bg: 'rgb(245, 78, 0)',
              fg: 'rgb(255, 255, 255)',
              radius: '6px',
              h: 40,
              w: 140,
              top: 300,
              text: 'Get started',
              header: false,
              overlay: false,
            },
          ],
          surfaces: [surface('rgb(45, 46, 55)', 500)],
          borders: [{ color: 'rgb(62, 66, 79)', count: 12 }],
        },
      })
      expect(read.dark).toMatchObject({
        page: { background: '#1d1f27', text: '#fafafa', card: '#2d2e37', border: '#3e424f' },
        buttonFill: '#f54e00',
      })
    })

    it('reads no dark mode when the page stays the same', () => {
      const read = brandReadFromMeasure({
        ...base,
        dark: { bg: 'rgb(255, 255, 255)', text: 'rgb(17, 17, 17)' },
      })
      expect(read.dark).toBeUndefined()
    })
  })

  describe('the cards’ look', () => {
    const card = (bg: string, chars: number, extra: Partial<PageSurface> = {}): PageSurface => ({
      bg,
      chars,
      rounded: true,
      bordered: false,
      shadowed: false,
      wide: false,
      ...extra,
    })
    const looks = (surfaces: PageSurface[]) =>
      brandReadFromMeasure({ ...base, surfaces }).card?.looks

    it('weighs each look by the words on its cards', () => {
      expect(
        looks([
          card('rgb(255, 255, 255)', 700, { shadowed: true }),
          card('rgb(250, 250, 250)', 200, { bordered: true }),
          card('rgb(240, 240, 240)', 90),
        ])
      ).toEqual({ border: 200, shadow: 700, flat: 90 })
    })

    it('counts a filled box with no edge or shadow as flat only when it stands off the page', () => {
      expect(looks([card('rgb(255, 255, 255)', 400)])).toBeUndefined()
      expect(looks([card('rgb(238, 239, 233)', 400)])).toEqual({ border: 0, shadow: 0, flat: 400 })
    })

    it('reads no look from a band as wide as the page, or a box that is no card', () => {
      expect(
        looks([
          card('rgb(246, 249, 252)', 900, { wide: true, shadowed: true }),
          card('rgb(240, 240, 240)', 300, { rounded: false }),
        ])
      ).toBeUndefined()
    })

    it('takes a card with both an edge and a shadow as neither, so it speaks for no look', () => {
      const read = looks([
        card('rgb(255, 255, 255)', 500, { bordered: true, shadowed: true }),
        card('rgb(250, 250, 250)', 100, { shadowed: true }),
      ])
      expect(read).toEqual({ border: 0, shadow: 100, flat: 0 })
    })
  })

  it('reads the name the site declares for itself', () => {
    expect(brandReadFromMeasure({ ...base, siteName: '  Northwind  ' }).siteName).toBe('Northwind')
    expect(brandReadFromMeasure({ ...base, siteName: null }).siteName).toBeUndefined()
    expect(brandReadFromMeasure({ ...base, siteName: '   ' }).siteName).toBeUndefined()
    // The other names it declares, then the logo's label; the first is the site name already.
    expect(
      brandReadFromMeasure({
        ...base,
        siteName: 'Love your freight',
        names: ['Love your freight', 'Northwind'],
        logo: { tag: 'IMG', src: null, w: 120, h: 30, label: 'Northwind Freight' },
      }).names
    ).toEqual(['Northwind', 'Northwind Freight'])
    expect(brandReadFromMeasure(base).names).toBeUndefined()
  })

  it('carries the smallest size the headings face is drawn at', () => {
    const read = (h1: { font: string; minPx?: number }) =>
      brandReadFromMeasure({ ...base, h1 }).fonts?.headline
    expect(read({ font: '"Acme Display", serif', minPx: 48 })).toEqual({
      family: 'Acme Display',
      stack: '"Acme Display", serif',
      minPx: 48,
    })
    expect(read({ font: '"Acme Display", serif' })).not.toHaveProperty('minPx')
  })

  it('takes the cards’ look as the page tallied it, box by box, over the per-colour surfaces', () => {
    const read = brandReadFromMeasure({
      ...base,
      cards: { border: 40, shadow: 600, flat: 0 },
      surfaces: [
        {
          bg: 'rgb(255, 255, 255)',
          chars: 640,
          rounded: true,
          bordered: true,
          shadowed: true,
          wide: false,
        },
      ],
    })
    expect(read.card?.looks).toEqual({ border: 40, shadow: 600, flat: 0 })
    // A flat card whose fill is too near the page to show is no card.
    const flats = brandReadFromMeasure({
      ...base,
      bg: 'rgb(253, 253, 253)',
      cards: {
        border: 0,
        shadow: 0,
        flat: 700,
        flats: [
          { bg: 'oklch(1 0 337.5)', chars: 500 },
          { bg: 'rgb(238, 239, 233)', chars: 200 },
        ],
      },
    })
    expect(flats.card?.looks).toEqual({ border: 0, shadow: 0, flat: 200 })
    // A tally with nothing on it says nothing.
    expect(
      brandReadFromMeasure({ ...base, cards: { border: 0, shadow: 0, flat: 0 } }).card
    ).toBeUndefined()
  })
})
