/**
 * Checks beyond colour flag text set below 12px, a hero image without a
 * description, vague link labels in Links blocks and the menu, and blocks
 * headed alike; each names the part that fixes it.
 */
import { describe, expect, it } from 'vitest'
import { designChecks } from '../checks'
import { newBlock } from '../home'
import { defaultDesign, portalDesign } from '../schema'

describe('designChecks', () => {
  it('passes the default design', () => {
    expect(designChecks(defaultDesign())).toEqual([])
  })

  it('flags text set below 12px, and not at 12px', () => {
    const design = defaultDesign()
    design.tune = { label: { size: 10 }, heading: { size: 12 } }
    expect(designChecks(design).map((check) => [check.id, check.part])).toEqual([
      ['small-label', 'site:styles'],
    ])
  })

  it('flags a hero image until it is described or marked as decoration', () => {
    const design = defaultDesign()
    design.brand.heroImage = { key: 'band.png' }
    expect(designChecks(design).map((check) => check.part)).toEqual(['hero'])
    design.brand.heroImage = { key: 'band.png', alt: '  ' }
    expect(designChecks(design)).toHaveLength(1)
    design.brand.heroImage = { key: 'band.png', alt: 'Our team at work' }
    expect(designChecks(design)).toEqual([])
    design.brand.heroImage = { key: 'band.png', decorative: true }
    expect(designChecks(design)).toEqual([])
    expect(portalDesign.safeParse(design).success).toBe(true)
  })

  it('flags vague link labels in Links blocks and the menu', () => {
    const design = defaultDesign()
    const links = {
      ...newBlock('links'),
      id: 'links00001',
      links: [
        { label: 'Click here!', url: 'https://example.com/a' },
        { label: 'Pricing', url: 'https://example.com/b' },
      ],
    } as ReturnType<typeof newBlock>
    design.pages.home.blocks = [links]
    design.nav.items.push({
      type: 'link',
      id: 'more',
      label: 'Read more',
      url: 'https://example.com',
      newTab: false,
    })
    expect(designChecks(design).map((check) => check.part)).toEqual(['header', 'block-links00001'])
  })

  it('flags a block headed as another is', () => {
    const design = defaultDesign()
    design.pages.home.blocks = [
      { ...newBlock('ideas'), id: 'ideas00001', heading: { en: 'Top asks' } },
      { ...newBlock('welcome'), id: 'welcome001', heading: { en: 'top asks ' } },
    ]
    expect(designChecks(design).map((check) => check.part)).toEqual(['block-welcome001'])
  })
})

describe('page background checks', () => {
  it('says when a chosen colour is softened so text reads, once per page', () => {
    const doc = defaultDesign()
    doc.layout.background = { kind: 'tint', colour: '#1e3a8a' }
    doc.layout.pageBackgrounds = {
      roadmap: { kind: 'gradient', stops: ['#111827', 'page'] },
      help: { kind: 'tint', colour: '#fdf6e3' },
    }
    const ids = designChecks(portalDesign.parse(doc))
      .filter((check) => check.id.startsWith('page-background'))
      .map((check) => [check.id, check.text])
    expect(ids).toEqual([
      [
        'page-background-site',
        'The page background is softened so text reads on it. Choose a lighter colour to show it as chosen.',
      ],
      [
        'page-background-roadmap',
        'The Roadmap page’s background is softened so text reads on it. Choose a lighter colour to show it as chosen.',
      ],
    ])
    expect(
      designChecks(defaultDesign()).some((check) => check.id.startsWith('page-background'))
    ).toBe(false)
  })
})
