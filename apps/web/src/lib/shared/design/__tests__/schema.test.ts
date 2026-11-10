import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import { heroSchema } from '../hero'

const fixtures = import.meta.glob<unknown>('./fixtures/*.json', { eager: true, import: 'default' })

const base = (): PortalDesign => structuredClone(defaultDesign())
const parse = (doc: unknown) => portalDesign.safeParse(doc)

describe('portalDesign', () => {
  it.each(Object.entries(fixtures))('parses the reference design %s', (_path, doc) => {
    const result = parse(doc)
    expect(result.error?.issues ?? []).toEqual([])
  })

  it('takes light heading weights (300, 400) for light display type, and no weight off the list', () => {
    for (const weight of [300, 400, 500, 600, 700, 800]) {
      const doc = base()
      doc.brand.fonts.headingWeight = weight as PortalDesign['brand']['fonts']['headingWeight']
      expect(parse(doc).success, String(weight)).toBe(true)
    }
    const doc = base() as unknown as { brand: { fonts: { headingWeight: number } } }
    doc.brand.fonts.headingWeight = 200
    expect(parse(doc).success).toBe(false)
  })

  it('parses the default design', () => {
    expect(parse(defaultDesign()).success).toBe(true)
  })

  describe('the Top posts block', () => {
    const withIdeas = (extra: Record<string, unknown>) => {
      const doc = base()
      doc.pages.home.blocks = [
        { type: 'ideas', width: 'half', sort: 'top', count: 3, ...extra },
      ] as never
      return doc
    }
    const BOARD = 'board_01h455vb4pex5vsknk084sn02q'

    it('still reads a design saved before it had boards', () => {
      expect(parse(withIdeas({})).success).toBe(true)
    })

    it('takes 3, 5 or 10 posts and no other number', () => {
      for (const count of [3, 5, 10]) expect(parse(withIdeas({ count })).success).toBe(true)
      expect(parse(withIdeas({ count: 7 })).success).toBe(false)
    })

    it('takes up to ten board ids', () => {
      expect(parse(withIdeas({ boardIds: [BOARD] })).success).toBe(true)
      expect(parse(withIdeas({ boardIds: [] })).success).toBe(true)
      expect(parse(withIdeas({ boardIds: Array(10).fill(BOARD) })).success).toBe(true)
      expect(parse(withIdeas({ boardIds: Array(11).fill(BOARD) })).success).toBe(false)
      expect(parse(withIdeas({ boardIds: ['roadmap_01h455vb4pex5vsknk084sn02q'] })).success).toBe(
        false
      )
    })
  })

  it('stores colours in their canonical form', () => {
    const doc = base()
    doc.brand.light.accent = 'rgb(15 118 110)'
    expect(parse(doc).data?.brand.light.accent).toBe('#0f766e')
  })

  it.each<[string, (doc: PortalDesign) => void]>([
    ['a named colour', (d) => void (d.brand.light.accent = 'teal')],
    ['a colour that escapes its declaration', (d) => void (d.brand.light.ink = '#000; } body {')],
    ['an unknown field', (d) => Object.assign(d.layout, { sidebar: 'left' })],
    ['an unknown layout value', (d) => void ((d.layout as { header: string }).header = 'floating')],
    [
      'a font that is not bundled',
      (d) => void (d.brand.fonts.body = { kind: 'bundled', id: 'comic' } as never),
    ],
    [
      'a block off the grid',
      (d) => void d.pages.home.blocks.push({ type: 'status', grid: { x: 12, y: 0, w: 4, h: 4 } }),
    ],
    [
      'thirteen Home blocks',
      (d) =>
        void d.pages.home.blocks.push(
          ...Array(13).fill({ type: 'status', grid: { x: 0, y: 0, w: 4, h: 4 } })
        ),
    ],
    [
      'a link that is not http(s)',
      (d) =>
        void d.nav.items.push({
          type: 'link',
          id: 'x',
          label: 'X',
          url: 'javascript:alert(1)',
          newTab: true,
        }),
    ],
    [
      'a menu with no page when Home is off',
      (d) => d.nav.items.forEach((item) => item.type !== 'link' && (item.shown = false)),
    ],
    [
      'an over-long composer prompt',
      (d) => void (d.pages.feedback.copy = { prompt: { en: 'x'.repeat(61) } }),
    ],
  ])('refuses %s', (_label, mutate) => {
    const doc = base()
    mutate(doc)
    expect(parse(doc).success).toBe(false)
  })

  it('accepts a menu with every page hidden when Home is on', () => {
    const doc = base()
    doc.nav.home.on = true
    doc.nav.items.forEach((item) => item.type !== 'link' && (item.shown = false))
    expect(parse(doc).success).toBe(true)
  })
})

describe('the band image', () => {
  const withImage = (heroImage: unknown) => {
    const doc = defaultDesign() as unknown as { brand: Record<string, unknown> }
    doc.brand.heroImage = heroImage
    return doc
  }

  it('keeps an image stored as one file, as designs before copies were', () => {
    expect(parse(withImage({ key: 'portal-images/room.jpg' })).success).toBe(true)
  })

  it('keeps its width and the smaller copies made on upload', () => {
    const image = {
      key: 'portal-images/room.webp',
      width: 2560,
      variants: [
        { key: 'portal-images/room-640.webp', w: 640 },
        { key: 'portal-images/room-1280.webp', w: 1280 },
      ],
    }
    expect(parse(withImage(image)).success).toBe(true)
  })

  it('refuses a copy whose key would break the srcset it is written into', () => {
    const bad = (key: string) => ({ key: 'portal-images/room.webp', variants: [{ key, w: 640 }] })
    expect(parse(withImage(bad('portal-images/a b.webp 9999w, https://x'))).success).toBe(false)
    expect(parse(withImage(bad('portal-images/a,b.webp'))).success).toBe(false)
  })

  it('refuses a stored file whose key would break the srcset or CSS it is written into', () => {
    const injected = 'portal-images/a.webp 1w, https://evil.example/x.png'
    expect(parse(withImage({ key: injected, width: 2560 })).success).toBe(false)
    expect(parse(withImage({ key: 'portal-images/a"b).webp' })).success).toBe(false)
    expect(parse(withImage({ key: 'portal-images/../../api/v1/x' })).success).toBe(false)
    const logo = defaultDesign()
    logo.brand.logo.mark.light = { key: 'logos/a.png 1w, https://evil.example/x.png' }
    expect(parse(logo).success).toBe(false)
    // The hero's settings, as the builder and the AI write them.
    expect(heroSchema.shape.image.safeParse({ key: injected }).success).toBe(false)
  })

  it('keeps every key an upload names', () => {
    const key = 'portal-images/2026/11/0b4e7d2c-8f4e-4c39-9d8e-2a6b1c1d9e0f-my_photo..v2.webp'
    expect(parse(withImage({ key })).success).toBe(true)
  })
})

describe('defaultDesign', () => {
  it('reproduces today’s portal', () => {
    const doc = defaultDesign()
    expect(doc.layout).toEqual({
      header: 'stacked',
      nav: 'tabs',
      hero: 'none',
      cards: 'bordered',
      density: 'comfortable',
      width: 'default',
      filters: 'end',
    })
    expect(doc.shape.corners).toBe('rounded')
    expect(doc.brand.fonts.heading).toEqual({ kind: 'bundled', id: 'inter' })
    expect(doc.nav.home).toEqual({ on: false, tab: false })
    expect(doc.pages.home.blocks).toEqual([])
    expect(doc.pages.feedback.defaultSort).toBe('trending')
    expect(doc).not.toHaveProperty('vocabulary')
    expect(doc.mode).toBe('auto')
  })

  it('returns a fresh document each time', () => {
    defaultDesign().layout.header = 'inline'
    expect(defaultDesign().layout.header).toBe('stacked')
  })
})
