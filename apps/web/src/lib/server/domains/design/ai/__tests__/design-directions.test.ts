/**
 * A starting look is a whole portal: brand, shapes and layout, Home, the
 * words and the composer's wording, built on its preset through the same
 * checks as any change from the model.
 */
import { describe, expect, it, vi } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'

vi.mock('@/lib/server/config', () => ({ config: {} }))

const { DIRECTIONS_EXAMPLE, faithfulAccent, lookDesign, withMeasuredTune } =
  await import('../design-directions')

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
      layout: { band: 'brand', cards: 'bordered', nav: 'pills', header: 'inline' },
      vocabulary: { post: 'suggestion', board: 'category' },
      nav: { home: { on: true, tab: true } },
    })
    expect(design.pages.feedback.copy.prompt).toEqual({
      en: 'Suggest a route, a class or some kit',
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

  it('sets the look’s type, band, buttons and Home composer', () => {
    const { design } = lookDesign(defaultDesign(), DIRECTIONS_EXAMPLE, allows)
    expect(design.brand.fonts).toMatchObject({ scale: 'large', tracking: 'tight' })
    expect(design.layout).toMatchObject({ band: 'brand', bandShape: 'full', headerOnBand: false })
    expect(design.brand.logo.display).toBe('name')
    expect(design.pages.home.composer).toBe('band')
  })

  it('places a website’s wordmark and share image, and nothing else the model names', () => {
    const assets = {
      wordmark: { key: 'header-logos/site-a.svg', colours: ['#ecb22e', '#36c5f0', '#e01e5a'] },
      shareImage: { key: 'portal-images/site-b.jpeg', mimeType: 'image/jpeg', base64: '' },
    }
    const look = {
      ...DIRECTIONS_EXAMPLE,
      logo: 'wordmark',
      status: 'brand',
      shareImage: 'side',
    } as const
    const { design, refused } = lookDesign(defaultDesign(), look, allows, assets)
    expect(refused).toEqual([])
    expect(design.brand.logo).toMatchObject({
      display: 'wordmark',
      wordmark: { light: { key: 'header-logos/site-a.svg' } },
    })
    expect(design.brand.logoColours).toEqual(['#ecb22e', '#36c5f0', '#e01e5a'])
    expect(design.layout.status).toBe('brand')
    expect(design.brand.bandImage).toEqual({ key: 'portal-images/site-b.jpeg' })
    expect(design.layout.imagePlace).toBe('side')
  })

  it('falls back where the website gave nothing: no wordmark, no logo colours, no image', () => {
    const look = {
      ...DIRECTIONS_EXAMPLE,
      logo: 'wordmark',
      status: 'brand',
      shareImage: 'side',
    } as const
    const { design } = lookDesign(defaultDesign(), look, allows)
    expect(design.brand.logo.display).toBe('mark_and_name')
    expect(design.layout.status).toBe('colour')
    expect(design.brand.bandImage).toBeUndefined()
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
      band: 'blend',
      blend: 'mesh',
    } as const
    const { design, refused } = lookDesign(defaultDesign(), look, allows)
    expect(refused).toEqual([])
    expect(design.brand.light.support).toBe('#ff7a59')
    expect(design.layout).toMatchObject({ band: 'blend', blend: 'mesh' })
    expect(
      lookDesign(defaultDesign(), DIRECTIONS_EXAMPLE, allows).design.layout.blend
    ).toBeUndefined()
  })

  it('gives the contact block a row of its own when the composer moves into the band', () => {
    const blocks = [
      { type: 'composer', width: 'full' },
      { type: 'contact', width: 'half' },
      { type: 'ideas', width: 'half' },
    ] as const
    const inBand = lookDesign(
      defaultDesign(),
      { ...DIRECTIONS_EXAMPLE, homeBlocks: [...blocks] },
      allows
    ).design
    expect(inBand.pages.home.blocks.find((b) => b.type === 'contact')?.width).toBe('full')
    const onGrid = lookDesign(
      defaultDesign(),
      { ...DIRECTIONS_EXAMPLE, composer: 'block', homeHeadline: '', homeBlocks: [...blocks] },
      allows
    ).design
    expect(onGrid.pages.home.blocks.find((b) => b.type === 'contact')?.width).toBe('half')
  })

  it('gives the contact block its row when a Home headline moves the composer into the band', () => {
    const blocks = [
      { type: 'composer', width: 'full' },
      { type: 'contact', width: 'half' },
      { type: 'ideas', width: 'half' },
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
    expect(moved.blocks.find((b) => b.type === 'contact')?.width).toBe('full')
  })
})

describe('a look’s finishing choices', () => {
  it('sets band art, headline colour and a two-tone name, and the second colour at work', () => {
    const look = {
      ...DIRECTIONS_EXAMPLE,
      band: 'tint',
      bandArt: 'hills',
      headlineColour: 'accent',
      logo: 'name',
      nameColour: 'accent',
      nameAccent: 'line',
      support: '#c6ff3d',
      tint: 'support',
      action: 'support',
    } as const
    const { design, refused } = lookDesign(defaultDesign(), look, allows)
    expect(refused).toEqual([])
    expect(design.layout).toMatchObject({ bandArt: 'hills', tint: 'support' })
    expect(design.shape.action).toBe('support')
    expect(design.brand.fonts.headlineColour).toBe('accent')
    expect(design.brand.logo).toMatchObject({ nameColour: 'accent', nameAccent: 'line' })
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
  const site = { palette: ['#112231', '#ff4f40', '#218fb7'] } as never

  it('takes their own colour back when the model only darkened it', () => {
    expect(faithfulAccent('#9c240b', { site })).toBe('#ff4f40')
  })

  it('keeps a different hue, a grey, and an accent when they gave no colours', () => {
    expect(faithfulAccent('#533afd', { site: { palette: ['#ff7a59'] } as never })).toBe('#533afd')
    expect(faithfulAccent('#1a1a1a', { site })).toBe('#1a1a1a')
    expect(faithfulAccent('#9c240b', {})).toBe('#9c240b')
  })

  it('reads an image’s colours as well', () => {
    expect(faithfulAccent('#3d7a2e', { palette: ['#9fe870'] })).toBe('#9fe870')
  })
})

describe('the faithful look’s measured type and shapes', () => {
  it('takes the brand’s own values, exactly as its page sets them', () => {
    const site = {
      measured: {
        headline: { size: 48, weight: 300, tracking: -0.02, leading: 1.15 },
        button: { radius: 4, height: 40 },
      },
    } as never
    const design = withMeasuredTune(defaultDesign(), site, allows)
    expect(design.tune).toEqual({
      headline: { size: 48, weight: 300, tracking: -0.02, leading: 1.15 },
      button: { radius: 4, height: 40 },
    })
  })

  it('leaves the design alone when nothing was measured', () => {
    const design = defaultDesign()
    expect(withMeasuredTune(design, { measured: null } as never, allows)).toBe(design)
    expect(withMeasuredTune(design, null, allows)).toBe(design)
  })
})
