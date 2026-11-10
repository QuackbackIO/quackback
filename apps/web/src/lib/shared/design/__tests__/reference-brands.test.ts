/**
 * The reference brands are eight complete portal designs that between them use
 * every option a design offers. They are the fixtures for rendering, contrast
 * and screenshot tests, so an option no fixture uses is an option nothing
 * tests. Adding an option to DESIGN_OPTIONS fails this test until a fixture
 * uses it.
 */
import { describe, expect, it } from 'vitest'
import { DESIGN_OPTIONS, type DesignOption } from '../options'
import { LEGACY_WIDTH_COLUMNS } from '../home-legacy'

type Headline = { title: unknown; accent?: { style: string } } | null

interface Fixture {
  version: number
  mode: string
  brand: {
    light: Record<string, string>
    dark?: Record<string, string>
    fonts: {
      heading: { kind: string }
      body: { kind: string }
      headingWeight: number
      scale?: string
      tracking?: string
      headlineCase?: string
      labelCase?: string
      headlineColour?: string
    }
    logo: { display: string; tone?: string }
    bandImage?: { key: string }
  }
  shape: { corners: string; buttons?: string; action?: string; fill?: string; hover?: string }
  layout: Record<'header' | 'nav' | 'band' | 'cards' | 'density' | 'width' | 'filters', string> & {
    blend?: string
    menuAlign?: string
    navText?: string
    bandAlign?: string
    bandShape?: string
    bandHeight?: string
    fadeFrom?: string
    status?: string
    imagePlace?: string
    tint?: string
    bandArt?: string
    bandColour?: string
    imageFocus?: string
    imagePhone?: string
    pageTitles?: string
    postCardHides?: string[]
  }
  pages: {
    home: {
      headline: Headline
      composer?: string
      blocks: Array<{
        type: string
        width: string
        sort?: string
        count?: number
        links?: Array<{ label: string; url: string }>
        look?: { tone?: string; align?: string; colour?: string }
      }>
    }
    feedback: {
      headline: Headline
      welcome: { show: boolean }
      defaultSort: string
      copy: Record<string, Record<string, string>>
    }
    titles?: Record<string, Headline>
    changelog?: { entries?: string; images?: string; subscribe?: string }
    help?: { topics?: string; popular?: boolean; search?: string }
    roadmap?: { board?: string; votes?: boolean }
  }
  nav: {
    home: { on: boolean; tab: boolean }
    items: Array<{ type: string; shown?: boolean; url?: string; label?: string }>
  }
}

const fixtures = Object.fromEntries(
  Object.entries(
    import.meta.glob<Fixture>('./fixtures/*.json', { eager: true, import: 'default' })
  ).map(([path, doc]) => [path.replace('./fixtures/', '').replace('.json', ''), doc])
)

/** Every value a fixture uses, per option. */
function used(): Record<DesignOption, Set<string>> {
  const out = Object.fromEntries(
    Object.keys(DESIGN_OPTIONS).map((k) => [k, new Set<string>()])
  ) as Record<DesignOption, Set<string>>
  const add = (option: DesignOption, value: unknown) => out[option].add(String(value))
  for (const doc of Object.values(fixtures)) {
    add('mode', doc.mode)
    add('corners', doc.shape.corners)
    add('headingWeight', doc.brand.fonts.headingWeight)
    add('fontKind', doc.brand.fonts.heading.kind)
    add('fontKind', doc.brand.fonts.body.kind)
    add('logoDisplay', doc.brand.logo.display)
    if (doc.brand.logo.tone) add('logoTone', doc.brand.logo.tone)
    add('inkOrAccent', doc.brand.fonts.headlineColour ?? 'ink')
    // An absent type choice is today's type.
    const { scale, tracking, headlineCase, labelCase } = doc.brand.fonts
    add('typeScale', scale ?? 'standard')
    add('tracking', tracking ?? 'normal')
    add('textCase', headlineCase ?? 'sentence')
    add('textCase', labelCase ?? 'sentence')
    const titles = doc.pages.titles ?? {}
    for (const headline of [
      doc.pages.home.headline,
      doc.pages.feedback.headline,
      ...Object.values(titles),
    ])
      if (headline?.accent) add('headlineAccent', headline.accent.style)
    for (const page of Object.keys(titles)) add('titledPage', page)
    add('pageTitles', doc.layout.pageTitles ?? 'plain')
    for (const key of ['header', 'nav', 'band', 'cards', 'density', 'width', 'filters'] as const)
      add(key, doc.layout[key])
    if (doc.layout.band === 'blend') add('blend', doc.layout.blend ?? 'linear')
    add('bandAlign', doc.layout.bandAlign ?? (doc.layout.header === 'centered' ? 'centre' : 'left'))
    add('bandShape', doc.layout.bandShape ?? 'full')
    add('bandHeight', doc.layout.bandHeight ?? 'roomy')
    add('fadeFrom', doc.layout.fadeFrom ?? 'top')
    if (['brand', 'tint', 'fade'].includes(doc.layout.band))
      add('colourRole', doc.layout.bandColour ?? 'accent')
    add('buttons', doc.shape.buttons ?? 'match')
    add('action', doc.shape.action ?? 'buttons')
    add('fill', doc.shape.fill ?? 'accent')
    add('hover', doc.shape.hover ?? 'none')
    add('menuAlign', doc.layout.menuAlign ?? 'start')
    add('navText', doc.layout.navText ?? 'muted')
    add('tint', doc.layout.tint ?? 'neutral')
    add('bandArt', doc.layout.bandArt ?? 'none')
    if (doc.brand.bandImage) add('imageFocus', doc.layout.imageFocus ?? 'centre')
    if (doc.brand.bandImage) add('imagePhone', doc.layout.imagePhone ?? 'show')
    add('status', doc.layout.status ?? 'colour')
    if (doc.brand.bandImage) add('imagePlace', doc.layout.imagePlace ?? 'side')
    if (doc.pages.home.blocks.some((block) => block.type === 'composer'))
      add('composerPlace', doc.pages.home.composer ?? 'block')
    add('sort', doc.pages.feedback.defaultSort)
    for (const block of doc.pages.home.blocks) {
      add('blockType', block.type)
      add('blockTone', block.look?.tone ?? 'card')
      add('blockAlign', block.look?.align ?? 'start')
      if (block.look?.tone === 'tint' || block.look?.tone === 'brand')
        add('colourRole', block.look.colour ?? 'accent')
      if (block.sort) add('sort', block.sort)
    }
    for (const field of doc.layout.postCardHides ?? []) add('postCardField', field)
    // An absent page choice is today's page.
    const { changelog, help, roadmap } = doc.pages
    add('changelogEntries', changelog?.entries ?? 'timeline')
    add('entryImage', changelog?.images ?? 'none')
    add('titleAction', changelog?.subscribe ?? 'beside')
    add('helpTopics', help?.topics ?? 'cards')
    add('searchSize', help?.search ?? 'standard')
    add('roadmapBoard', roadmap?.board ?? 'columns')
  }
  return out
}

describe('reference brand fixtures', () => {
  it('has the eight brands from the canvas', () => {
    expect(Object.keys(fixtures).sort()).toEqual([
      'bramble',
      'fieldnote',
      'juniper',
      'kiln',
      'ledger',
      'orbit',
      'plume',
      'tandem',
    ])
  })

  it.each(Object.entries(fixtures))('%s uses only documented options', (_name, doc) => {
    expect(doc.version).toBe(2)
    const check = (option: DesignOption, value: unknown) =>
      expect(DESIGN_OPTIONS[option] as readonly unknown[], `${option}: ${String(value)}`).toContain(
        value
      )
    check('mode', doc.mode)
    check('corners', doc.shape.corners)
    check('headingWeight', doc.brand.fonts.headingWeight)
    check('fontKind', doc.brand.fonts.heading.kind)
    check('fontKind', doc.brand.fonts.body.kind)
    check('logoDisplay', doc.brand.logo.display)
    for (const key of ['header', 'nav', 'band', 'cards', 'density', 'width', 'filters'] as const)
      check(key, doc.layout[key])
    check('sort', doc.pages.feedback.defaultSort)
    for (const key of ['accent', 'background', 'ink'] as const)
      expect(doc.brand.light[key]).toMatch(/^#[\da-f]{6}$/i)
  })

  it.each(Object.entries(fixtures))(
    '%s keeps Home and the menu within their rules',
    (_name, doc) => {
      const { blocks } = doc.pages.home
      expect(blocks.length).toBeLessThanOrEqual(12)
      for (const block of blocks) {
        expect(DESIGN_OPTIONS.blockType as readonly string[]).toContain(block.type)
        // Written before the grid, at a width each, which reads as a place.
        expect(Object.keys(LEGACY_WIDTH_COLUMNS), `${block.type} at ${block.width}`).toContain(
          block.width
        )
        for (const link of block.links ?? []) expect(link.url).toMatch(/^https:\/\//)
      }
      if (!doc.nav.home.on) {
        expect(blocks).toEqual([])
        expect(doc.nav.items.some((item) => item.type !== 'link' && item.shown)).toBe(true)
      }
      for (const item of doc.nav.items.filter((i) => i.type === 'link')) {
        expect(item.url).toMatch(/^https:\/\//)
        expect(item.label?.length).toBeGreaterThan(0)
      }
    }
  )

  it('uses every option at least once across the eight', () => {
    const seen = used()
    // Page backgrounds came after the reference brands, which all show their page colour;
    // page-background.test.ts covers each of their options.
    const later = new Set<string>([
      'pageBackground',
      'backgroundPage',
      'backgroundColour',
      'backgroundStrength',
      'gradientShape',
      'gradientDirection',
      'gradientCentre',
      'backgroundFit',
      'backgroundPosition',
      'backgroundScroll',
      'pattern',
      'patternScale',
      // A band's glow came after them too; components.test.ts and hero.test.ts cover it.
      'bandGlow',
      // So did the composer's width in the band; composer-width.test.ts and hero.test.ts cover it.
      'composerWidth',
      // And the hero's main action; main-action.test.ts and hero.test.ts cover it.
      'mainAction',
      'heroButtonTo',
    ])
    for (const [option, values] of Object.entries(DESIGN_OPTIONS))
      for (const value of later.has(option) ? [] : values)
        // `plain` is the menu style for sites with no visible current item, and a `muted` accent
        // a two-tone headline's lighter part, set by a brand match; no reference brand shows either.
        if (
          !(option === 'nav' && value === 'plain') &&
          !(option === 'headlineAccent' && value === 'muted')
        )
          expect(
            seen[option as DesignOption].has(String(value)),
            `no fixture uses ${option}: ${value}`
          ).toBe(true)
  })

  it('covers both sides of every switch', () => {
    const docs = Object.values(fixtures)
    const both = (label: string, has: (doc: Fixture) => boolean) => {
      expect(docs.some(has), `no fixture with ${label}`).toBe(true)
      expect(
        docs.some((doc) => !has(doc)),
        `every fixture has ${label}`
      ).toBe(true)
    }
    both('Home on', (doc) => doc.nav.home.on)
    both('a Home tab', (doc) => doc.nav.home.tab)
    both('a hidden Feedback tab', (doc) =>
      doc.nav.items.some((i) => i.type === 'feedback' && !i.shown)
    )
    both('a custom link', (doc) => doc.nav.items.some((i) => i.type === 'link'))
    both('a welcome message shown', (doc) => doc.pages.feedback.welcome.show)
    both('a feedback headline', (doc) => doc.pages.feedback.headline !== null)
    both('a Home headline', (doc) => doc.nav.home.on && doc.pages.home.headline !== null)
    both('own wording', (doc) => Object.keys(doc.pages.feedback.copy).length > 0)
    both('dark colours set', (doc) => Object.keys(doc.brand.dark ?? {}).length > 0)
    both('dark colours partly set', (doc) => {
      const keys = Object.keys(doc.brand.dark ?? {})
      return keys.length > 0 && keys.length < 3
    })
    const counts = (type: string) =>
      new Set(
        docs.flatMap((doc) =>
          doc.pages.home.blocks.filter((b) => b.type === type).map((b) => b.count)
        )
      )
    expect([...counts('ideas')].sort()).toEqual([3, 5])
    expect([...counts('updates')].sort()).toEqual([2, 3, 4])
  })
})
