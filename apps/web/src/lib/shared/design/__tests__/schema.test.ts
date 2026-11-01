import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'

const fixtures = import.meta.glob<unknown>('./fixtures/*.json', { eager: true, import: 'default' })

const base = (): PortalDesign => structuredClone(defaultDesign())
const parse = (doc: unknown) => portalDesign.safeParse(doc)

describe('portalDesign', () => {
  it.each(Object.entries(fixtures))('parses the reference design %s', (_path, doc) => {
    const result = parse(doc)
    expect(result.error?.issues ?? []).toEqual([])
  })

  it('parses the default design', () => {
    expect(parse(defaultDesign()).success).toBe(true)
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
      'a block at a width it cannot take',
      (d) => void d.pages.home.blocks.push({ type: 'status', width: 'full' }),
    ],
    [
      'thirteen Home blocks',
      (d) => void d.pages.home.blocks.push(...Array(13).fill({ type: 'status', width: 'third' })),
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
    ['an unknown word', (d) => void ((d.vocabulary as { post: string }).post = 'ticket')],
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

describe('defaultDesign', () => {
  it('reproduces today’s portal', () => {
    const doc = defaultDesign()
    expect(doc.layout).toEqual({
      header: 'stacked',
      nav: 'tabs',
      band: 'none',
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
    expect(doc.vocabulary).toEqual({ post: 'idea', board: 'board' })
    expect(doc.mode).toBe('auto')
  })

  it('returns a fresh document each time', () => {
    defaultDesign().layout.header = 'inline'
    expect(defaultDesign().layout.header).toBe('stacked')
  })
})
