/**
 * A starting look is a whole portal: brand, shapes and layout, Home, the
 * words and the composer's wording, built on its preset through the same
 * checks as any change from the model.
 */
import { describe, expect, it, vi } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'

vi.mock('@/lib/server/config', () => ({ config: {} }))

const { DIRECTIONS_EXAMPLE, faithfulAccent, lookDesign } = await import('../design-directions')
const { confirmedBy } = await import('../faithful-look')

const every = [
  'welcome',
  'composer',
  'ideas',
  'roadmap',
  'updates',
  'help_search',
  'help_topics',
  'status',
  'contact',
  'links',
] as const
const allows = { blockTypes: every, checkCss: () => null }

describe('lookDesign', () => {
  it('makes the example a complete design, with nothing left out', () => {
    const { design, refused } = lookDesign(defaultDesign(), DIRECTIONS_EXAMPLE, allows)
    expect(refused).toEqual([])
    expect(design).toMatchObject({
      mode: 'light',
      brand: {
        light: { accent: '#d9480f', background: '#f7f5f2', ink: '#1c1b19' },
        fonts: {
          heading: { kind: 'bundled', id: 'space-grotesk' },
          body: { kind: 'bundled', id: 'inter' },
          headingWeight: 700,
        },
      },
      layout: { hero: 'brand', cards: 'bordered', nav: 'pills', header: 'inline' },
      nav: { home: { on: true, tab: true } },
    })
    expect(design).not.toHaveProperty('vocabulary')
    expect(design.pages.feedback.copy.prompt).toEqual({
      en: 'A route, a class or some kit?',
    })
    expect(design.pages.home.headline?.title).toEqual({ en: 'Climb with us' })
    expect(design.pages.home.blocks.map((block) => block.type)).toEqual([
      'composer',
      'contact',
      'ideas',
      'updates',
      'roadmap',
      'help_topics',
    ])
  })

  it('leaves out Home blocks for pages the workspace does not have, and keeps the rest', () => {
    const { design, refused } = lookDesign(defaultDesign(), DIRECTIONS_EXAMPLE, {
      ...allows,
      blockTypes: ['composer', 'ideas', 'roadmap', 'updates'],
    })
    expect(design.pages.home.blocks.map((block) => block.type)).toEqual([
      'composer',
      'ideas',
      'updates',
      'roadmap',
    ])
    expect(refused.map((change) => change.reason)).toEqual([
      'the contact block needs its page on',
      'the help topics block needs its page on',
    ])
  })

  it('puts a dark look’s page and text in dark mode', () => {
    const { design } = lookDesign(
      defaultDesign(),
      {
        ...DIRECTIONS_EXAMPLE,
        mode: 'dark',
        accent: '#c6ff3d',
        background: '#0b1020',
        ink: '#e8ecf8',
        surface: '',
      },
      allows
    )
    expect(design.mode).toBe('dark')
    expect(design.brand.dark).toMatchObject({ background: '#0b1020', ink: '#e8ecf8' })
    expect(design.brand.light.accent).toBe('#c6ff3d')
  })

  it('trims text too long for its field at a word, rather than refusing the look', () => {
    const { design, refused } = lookDesign(
      defaultDesign(),
      {
        ...DIRECTIONS_EXAMPLE,
        headline:
          'A headline that goes on and on well past the eighty characters a headline may have',
        submit: 'Send your wonderful suggestion',
      },
      allows
    )
    expect(refused).toEqual([])
    const headline = design.pages.feedback.headline!.title.en!
    expect(headline.length).toBeLessThanOrEqual(80)
    expect(headline.endsWith(' ')).toBe(false)
    expect(design.pages.feedback.copy.submit).toEqual({ en: 'Send your wonderful' })
  })

  it('offers every heading weight a design takes, light ones included', async () => {
    const { lookSchema } = await import('../design-looks')
    const { DESIGN_OPTIONS } = await import('@/lib/shared/design/options')
    expect(lookSchema.shape.headingWeight.options).toEqual(DESIGN_OPTIONS.headingWeight.map(String))
    const { design } = lookDesign(
      defaultDesign(),
      { ...DIRECTIONS_EXAMPLE, headingFont: 'inter-tight', headingWeight: '300' },
      allows
    )
    expect(design.brand.fonts.headingWeight).toBe(300)
  })

  it('sets the look’s type, band, buttons and Home composer', () => {
    const { design } = lookDesign(defaultDesign(), DIRECTIONS_EXAMPLE, allows)
    expect(design.brand.fonts).toMatchObject({ scale: 'large', tracking: 'tight' })
    expect(design.layout).toMatchObject({ hero: 'brand', heroShape: 'full', headerOnHero: false })
    // A look leaves the logo as the draft has it: an icon and a title.
    expect(design.brand.logo.display).toBe('mark_and_name')
    expect(design.pages.home.composer).toBe('band')
  })

  it('falls back where a start gives nothing: no logo colours, no image', () => {
    const look = { ...DIRECTIONS_EXAMPLE, status: 'brand' } as const
    const { design } = lookDesign(defaultDesign(), look, allows)
    expect(design.layout.status).toBe('colour')
    expect(design.brand.heroImage).toBeUndefined()
  })

  it('sets an accent phrase apart only where the headline holds it', () => {
    const look = {
      ...DIRECTIONS_EXAMPLE,
      headline: 'What should we set next?',
      homeHeadline: 'Climb with us',
      accentPhrase: 'set next',
      accentStyle: 'highlight',
    } as const
    const { design } = lookDesign(defaultDesign(), look, allows)
    expect(design.pages.feedback.headline?.accent).toEqual({
      style: 'highlight',
      text: { en: 'set next' },
    })
    expect(design.pages.home.headline?.accent).toBeUndefined()
  })

  it('sets the second colour and a mesh only where the look asks', () => {
    const look = {
      ...DIRECTIONS_EXAMPLE,
      accent: '#533afd',
      background: '#ffffff',
      support: '#ff7a59',
      hero: 'blend',
      blend: 'mesh',
    } as const
    const { design, refused } = lookDesign(defaultDesign(), look, allows)
    expect(refused).toEqual([])
    expect(design.brand.light.support).toBe('#ff7a59')
    expect(design.layout).toMatchObject({ hero: 'blend', blend: 'mesh' })
    expect(
      lookDesign(defaultDesign(), DIRECTIONS_EXAMPLE, allows).design.layout.blend
    ).toBeUndefined()
  })

  it('gives the contact block a row of its own when the composer moves into the band', () => {
    const blocks = [
      { type: 'composer', x: 0, y: 0, w: 12 },
      { type: 'contact', x: 0, y: 1, w: 6 },
      { type: 'ideas', x: 6, y: 1, w: 6 },
    ] as const
    const inBand = lookDesign(
      defaultDesign(),
      { ...DIRECTIONS_EXAMPLE, homeBlocks: [...blocks] },
      allows
    ).design
    expect(inBand.pages.home.blocks.find((b) => b.type === 'contact')?.grid.w).toBe(12)
    const onGrid = lookDesign(
      defaultDesign(),
      { ...DIRECTIONS_EXAMPLE, composer: 'block', homeHeadline: '', homeBlocks: [...blocks] },
      allows
    ).design
    expect(onGrid.pages.home.blocks.find((b) => b.type === 'contact')?.grid.w).toBe(6)
  })

  it('gives the contact block its row when a Home headline moves the composer into the band', () => {
    const blocks = [
      { type: 'composer', x: 0, y: 0, w: 12 },
      { type: 'contact', x: 0, y: 1, w: 6 },
      { type: 'ideas', x: 6, y: 1, w: 6 },
    ] as const
    const moved = lookDesign(
      defaultDesign(),
      {
        ...DIRECTIONS_EXAMPLE,
        composer: 'block',
        homeHeadline: 'Climb with us',
        homeBlocks: [...blocks],
      },
      allows
    ).design.pages.home
    expect(moved.composer).toBe('band')
    expect(moved.blocks.find((b) => b.type === 'contact')?.grid.w).toBe(12)
  })
})

describe('a look’s finishing choices', () => {
  it('sets band art, headline colour and the second colour at work', () => {
    const look = {
      ...DIRECTIONS_EXAMPLE,
      hero: 'tint',
      heroArt: 'hills',
      headlineColour: 'accent',
      support: '#c6ff3d',
      tint: 'support',
      action: 'support',
    } as const
    const { design, refused } = lookDesign(defaultDesign(), look, allows)
    expect(refused).toEqual([])
    expect(design.layout).toMatchObject({ heroArt: 'hills', tint: 'support' })
    expect(design.shape.action).toBe('support')
    expect(design.brand.fonts.headlineColour).toBe('accent')
  })

  it('puts the composer under a Home headline, whatever the look says', () => {
    const look = {
      ...DIRECTIONS_EXAMPLE,
      composer: 'block',
      homeHeadline: 'Climb with us',
    } as const
    expect(lookDesign(defaultDesign(), look, allows).design.pages.home.composer).toBe('band')
    const bare = { ...look, homeHeadline: '' } as const
    expect(lookDesign(defaultDesign(), bare, allows).design.pages.home.composer).toBe('block')
  })
})

describe('the faithful look’s accent', () => {
  const palette = ['#112231', '#ff4f40', '#218fb7']

  it('takes their own colour back when the model only darkened it', () => {
    expect(faithfulAccent('#9c240b', { palette })).toBe('#ff4f40')
  })

  it('keeps a different hue, a grey, and an accent when they gave no colours', () => {
    expect(faithfulAccent('#533afd', { palette: ['#ff7a59'] })).toBe('#533afd')
    expect(faithfulAccent('#1a1a1a', { palette })).toBe('#1a1a1a')
    expect(faithfulAccent('#9c240b', {})).toBe('#9c240b')
  })

  it('reads an image’s colours as well', () => {
    expect(faithfulAccent('#3d7a2e', { palette: ['#9fe870'] })).toBe('#9fe870')
  })
})

describe('a colour, borne out by what was seen', () => {
  // Fernway's screenshot: its lime and forest green, with white and near-black.
  const seen = confirmedBy(['#9fe870', '#163300', '#ffffff', '#0e0f0c'])

  it('holds a colour near one that was seen, and not one that was not', () => {
    expect(seen('#163300')).toBe(true)
    expect(seen('#a0e972')).toBe(true)
    // An old blue nothing on the screenshot shows.
    expect(seen('#0081ba')).toBe(false)
    expect(seen('not a colour')).toBe(false)
  })
})
