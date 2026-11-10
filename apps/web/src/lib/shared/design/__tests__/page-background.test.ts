import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../contrast'
import {
  backgroundPageOf,
  drawFill,
  fillFor,
  hasPageBackground,
  imageLayer,
  imageTones,
  IMAGE_TEXT,
  PAGE_TEXT,
  pageBackgroundCss,
  type BackgroundGround,
  type PageBackground,
} from '../page-background'
import { renderDesignCss, resolveDesign } from '../resolve'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'

const LIGHT: BackgroundGround = { page: '#ffffff', ink: '#0a0a0a', accent: '#4f46e5' }
const DARK: BackgroundGround = { page: '#0a0a0a', ink: '#fafafa', accent: '#818cf8' }

function design(background?: PageBackground, pages?: PortalDesign['layout']['pageBackgrounds']) {
  const doc = defaultDesign()
  doc.brand.light.accent = '#4f46e5'
  doc.brand.light.support = '#f59e0b'
  if (background) doc.layout.background = background
  if (pages) doc.layout.pageBackgrounds = pages
  return portalDesign.parse(doc)
}

const IMAGE_KEY = 'portal-images/2026/11/0b9c-photo.webp'

describe('page background schema', () => {
  it('reads a design stored before page backgrounds unchanged', () => {
    const before = defaultDesign()
    const parsed = portalDesign.parse(structuredClone(before))
    expect(parsed).toEqual(before)
    expect(parsed.layout.background).toBeUndefined()
    expect(hasPageBackground(parsed)).toBe(false)
  })

  it('draws a design without one exactly as before', () => {
    const css = renderDesignCss(resolveDesign(defaultDesign()))
    expect(css).not.toContain('--qb-page-bg')
    expect(css).not.toContain('[data-qb-page=')
  })

  it('takes each kind, brand roles or exact colours', () => {
    const kinds: PageBackground[] = [
      { kind: 'solid' },
      { kind: 'tint', colour: 'support', strength: 'soft' },
      { kind: 'tint', colour: '#FDF6E3' },
      { kind: 'gradient', stops: ['accent', 'page'], direction: 'down' },
      { kind: 'gradient', stops: ['accent', 'support', '#ffffff'], shape: 'radial', centre: 'top' },
      { kind: 'image', image: { key: IMAGE_KEY, tones: ['#101010', '#f0f0f0'] }, fit: 'cover' },
      { kind: 'pattern', pattern: 'dots', colour: 'accent', scale: 'small' },
      { kind: 'tint', colour: 'accent', dark: { kind: 'solid' } },
    ]
    for (const bg of kinds) expect(() => design(bg)).not.toThrow()
    expect(design({ kind: 'tint', colour: '#FDF6E3' }).layout.background).toEqual({
      kind: 'tint',
      colour: '#fdf6e3',
    })
  })

  it('refuses an image from anywhere but the workspace’s portal images, and keys that could end a url()', () => {
    for (const key of [
      'logos/a.png',
      'portal-images/a").png',
      'portal-images/../x.png',
      'https://x.test/a.png',
    ])
      expect(() => design({ kind: 'image', image: { key } })).toThrow()
  })

  it('refuses a gradient of one colour or of four, and an unknown page', () => {
    expect(() => design({ kind: 'gradient', stops: ['accent'] })).toThrow()
    expect(() =>
      design({ kind: 'gradient', stops: ['accent', 'page', 'support', 'extra1'] })
    ).toThrow()
    expect(() =>
      design(undefined, {
        settings: { kind: 'solid' },
      } as unknown as PortalDesign['layout']['pageBackgrounds'])
    ).toThrow()
  })
})

describe('which background a page shows', () => {
  const doc = design(
    { kind: 'tint', colour: 'accent', dark: { kind: 'pattern', pattern: 'grid' } },
    { roadmap: { kind: 'gradient', stops: ['support', 'page'] }, help: { kind: 'solid' } }
  )

  it('is the page’s own over the site’s', () => {
    expect(fillFor(doc, 'roadmap', 'light').kind).toBe('gradient')
    expect(fillFor(doc, 'help', 'light').kind).toBe('solid')
    expect(fillFor(doc, 'feedback', 'light').kind).toBe('tint')
    expect(fillFor(doc, null, 'light').kind).toBe('tint')
  })

  it('takes dark’s own in dark, else light’s drawn in dark', () => {
    expect(fillFor(doc, 'feedback', 'dark').kind).toBe('pattern')
    expect(fillFor(doc, 'roadmap', 'dark').kind).toBe('gradient')
  })

  it('names item pages by their page and leaves unknown ones to the site', () => {
    expect(backgroundPageOf('post')).toBe('post')
    expect(backgroundPageOf('help')).toBe('help')
    expect(backgroundPageOf('settings')).toBeNull()
    expect(backgroundPageOf(null)).toBeNull()
  })
})

describe('drawing each kind', () => {
  const doc = design()

  it('draws a brand colour as a pale wash that text reads on', () => {
    const drawn = drawFill(doc, { kind: 'tint', colour: 'accent' }, LIGHT, 'light')
    expect(drawn.css).toMatch(/^#[0-9a-f]{6}$/)
    expect(drawn.css).not.toBe('#ffffff')
    expect(contrastRatio(LIGHT.ink, drawn.css)).toBeGreaterThanOrEqual(PAGE_TEXT)
    expect(drawn.top).toBe(drawn.css)
  })

  it('draws an exact light colour as given, and softens one text cannot read on', () => {
    expect(drawFill(doc, { kind: 'tint', colour: '#fdf6e3' }, LIGHT, 'light').css).toBe('#fdf6e3')
    const navy = drawFill(doc, { kind: 'tint', colour: '#1e3a8a' }, LIGHT, 'light')
    expect(navy.softened).toBe(true)
    expect(contrastRatio(LIGHT.ink, navy.css)).toBeGreaterThanOrEqual(PAGE_TEXT)
  })

  it('works out dark from light: an exact light colour becomes a dark wash', () => {
    const drawn = drawFill(doc, { kind: 'tint', colour: '#fdf6e3' }, DARK, 'dark')
    expect(contrastRatio(DARK.ink, drawn.css)).toBeGreaterThanOrEqual(PAGE_TEXT)
    expect(contrastRatio('#000000', drawn.css)).toBeLessThan(2)
  })

  it('draws a linear gradient in its direction, and a glow from its centre', () => {
    const down = drawFill(doc, { kind: 'gradient', stops: ['accent', 'page'] }, LIGHT, 'light')
    expect(down.css).toMatch(/^linear-gradient\(180deg, #[0-9a-f]{6}, #ffffff\)$/)
    expect(down.top).not.toBe('#ffffff')
    const right = drawFill(
      doc,
      { kind: 'gradient', stops: ['accent', 'support'], direction: 'right' },
      LIGHT,
      'light'
    )
    expect(right.css).toContain('linear-gradient(90deg')
    const glow = drawFill(
      doc,
      { kind: 'gradient', stops: ['support', 'page'], shape: 'radial', centre: 'corner' },
      LIGHT,
      'light'
    )
    expect(glow.css).toMatch(
      /^radial-gradient\(140vw 100vh at 0% 0%, #[0-9a-f]{6}, #ffffff\) #ffffff$/
    )
    for (const bg of [...down.behind, ...right.behind, ...glow.behind])
      expect(contrastRatio(LIGHT.ink, bg)).toBeGreaterThanOrEqual(PAGE_TEXT)
  })

  it('makes a stronger gradient deeper than a faint one', () => {
    const depth = (strength: 'faint' | 'strong') =>
      contrastRatio(
        '#ffffff',
        drawFill(doc, { kind: 'gradient', stops: ['accent', 'page'], strength }, LIGHT, 'light')
          .behind[0]!
      )
    expect(depth('strong')).toBeGreaterThan(depth('faint'))
  })

  it('tiles a pattern in its colour, faint enough for text', () => {
    const drawn = drawFill(
      doc,
      { kind: 'pattern', pattern: 'grid', scale: 'large', strength: 'strong' },
      LIGHT,
      'light'
    )
    expect(drawn.css).toMatch(/^url\("data:image\/svg\+xml,.+"\) 0 0 \/ 32px 32px repeat #ffffff$/)
    expect(decodeURIComponent(drawn.css)).toContain("stroke='#4f46e5'")
    for (const bg of drawn.behind)
      expect(contrastRatio(LIGHT.ink, bg)).toBeGreaterThanOrEqual(PAGE_TEXT)
  })

  it('lays the page colour over an image as strongly as its tones need', () => {
    const busy = imageLayer(['#000000', '#ffffff'], LIGHT, 100)
    const pale = imageLayer(['#e8e8e8', '#ffffff'], LIGHT, 100)
    expect(busy.alpha).toBeGreaterThan(pale.alpha)
    for (const bg of [...busy.behind, ...pale.behind])
      expect(contrastRatio(LIGHT.ink, bg)).toBeGreaterThanOrEqual(IMAGE_TEXT)
    // The strength is the least layer; readability may ask for more, never less.
    expect(imageLayer(['#e8e8e8', '#ffffff'], LIGHT, 20).alpha).toBeCloseTo(0.8)
  })

  it('dims an image on dark and lightens it on light', () => {
    const fill = {
      kind: 'image' as const,
      image: { key: IMAGE_KEY, tones: ['#202020', '#e0e0e0'] as [string, string] },
    }
    expect(drawFill(doc, fill, LIGHT, 'light').css).toContain('color-mix(in srgb, #ffffff')
    expect(drawFill(doc, fill, DARK, 'dark').css).toContain('color-mix(in srgb, #0a0a0a')
  })

  it('serves a phone copy on phones and holds the image still only where asked', () => {
    const drawn = drawFill(
      doc,
      {
        kind: 'image',
        image: { key: IMAGE_KEY, phone: { key: 'portal-images/2026/11/0b9c-phone.webp' } },
        fit: 'cover',
        position: 'top',
        scroll: 'fixed',
      },
      LIGHT,
      'light'
    )
    expect(drawn.css).toContain(`url("/api/storage/${IMAGE_KEY}") center top / cover no-repeat`)
    expect(drawn.phone).toContain('0b9c-phone.webp')
    expect(drawn.phone).not.toContain('fixed')
    expect(drawn.wide).toContain('no-repeat fixed')
    const tiled = drawFill(
      doc,
      { kind: 'image', image: { key: IMAGE_KEY }, fit: 'tile' },
      LIGHT,
      'light'
    )
    expect(tiled.css).toContain('/ auto repeat')
    expect(tiled.wide).toBeUndefined()
  })
})

describe('the page backgrounds as CSS', () => {
  it('paints the shell, each page’s own, phones, larger screens and print', () => {
    const doc = design(
      { kind: 'tint', colour: 'accent' },
      { roadmap: { kind: 'gradient', stops: ['support', 'page'] } }
    )
    const css = renderDesignCss(resolveDesign(doc))
    expect(css).toMatch(/\[data-portal-theme\] \[data-portal\] \{ --qb-page-bg: #[0-9a-f]{6};/)
    expect(css).toContain(
      '[data-portal-theme] [data-portal][data-qb-page=roadmap] { --qb-page-bg: linear-gradient('
    )
    expect(css).toMatch(
      /\.dark\[data-portal-theme\] \[data-portal\] \{ --qb-page-bg: #[0-9a-f]{6};/
    )
    expect(css).toContain('[data-portal-theme] [data-portal] { background: var(--qb-page-bg); }')
    expect(css).toContain('@media (max-width: 639px)')
    expect(css).toContain('@media (min-width: 1024px) and (hover: hover)')
    expect(css).toContain(
      '@media print { [data-portal-theme] [data-portal] { background: none; } }'
    )
  })

  it('gives the header the colour along the page’s top, unless it sits on the hero', () => {
    const tinted = design({ kind: 'tint', colour: 'accent' })
    const resolved = resolveDesign(tinted)
    const top = resolved.backgrounds.light!.site.top
    expect(resolved.backgroundCss).toContain(`--header-background: ${top};`)
    const onHero = structuredClone(tinted)
    onHero.layout.band = 'brand'
    onHero.layout.headerOnBand = true
    expect(resolveDesign(onHero).backgroundCss).not.toContain('--header-background')
  })

  it('names a single-mode design’s dark too, so another design’s dark rule never wins', () => {
    const doc = design({ kind: 'tint', colour: 'accent' })
    doc.mode = 'light'
    const css = pageBackgroundCss(doc, resolveDesign(doc).backgrounds)
    expect(css).toContain(
      '[data-portal-theme] [data-portal], .dark[data-portal-theme] [data-portal] {'
    )
  })
})

describe('readability against the page background', () => {
  it('moves secondary text and links until they read on every colour behind them', () => {
    const doc = design({ kind: 'gradient', stops: ['accent', 'support'], strength: 'strong' })
    const resolved = resolveDesign(doc)
    expect(resolved.errors).toEqual([])
    const light = resolved.light!
    for (const bg of resolved.backgrounds.light!.site.behind) {
      expect(contrastRatio(light.foreground!, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(light.mutedForeground!, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(light.accentInk!, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('reads a page’s own background as well as the site’s', () => {
    const doc = design(undefined, {
      changelog: { kind: 'tint', colour: 'support', strength: 'strong' },
    })
    const resolved = resolveDesign(doc)
    const own = resolved.backgrounds.light!.pages.changelog!
    expect(contrastRatio(resolved.light!.mutedForeground!, own.css)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps cards on their own surface', () => {
    const doc = design({ kind: 'tint', colour: 'accent', strength: 'strong' })
    expect(resolveDesign(doc).light!.card).toBe(resolveDesign(design()).light!.card)
  })

  it('checks a tuned link colour on the page background too', () => {
    const doc = design({ kind: 'tint', colour: '#c7d2fe' })
    doc.tune = { link: { colour: '#6b7cff' } }
    const link = resolveDesign(doc).tuned.find((t) => t.part === 'Links')!
    expect(contrastRatio(link.used!, '#c7d2fe')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('an uploaded image’s tones', () => {
  const pixels = (colours: Array<[number, number, number, number]>) => colours.flat()

  it('finds the darkest and lightest tones, past a stray speck', () => {
    const many = Array.from({ length: 98 }, (_, i): [number, number, number, number] =>
      i < 49 ? [40, 40, 60, 255] : [230, 220, 200, 255]
    )
    const tones = imageTones(pixels([[0, 0, 0, 255], ...many, [255, 255, 255, 255]]))
    expect(tones).toEqual(['#28283c', '#e6dcc8'])
  })

  it('leaves out transparent pixels, and has none when nothing shows', () => {
    expect(
      imageTones(
        pixels([
          [10, 10, 10, 0],
          [200, 200, 200, 255],
        ])
      )
    ).toEqual(['#c8c8c8', '#c8c8c8'])
    expect(imageTones(pixels([[10, 10, 10, 0]]))).toBeNull()
  })
})
