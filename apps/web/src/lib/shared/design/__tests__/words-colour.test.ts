/**
 * Words in a brand colour role, and a headline accent in one, read where
 * they sit: the colour is moved in lightness until it reads (4.5:1 for rich
 * words, 3:1 for a headline's large type), on cards and the page, in a tinted
 * or brand colour block, on the band, its panel and a plain page title. The
 * tokens and rules exist only for the roles a design uses.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../contrast'
import { mixColor } from '../color'
import { renderDesignCss, resolveDesign } from '../resolve'
import { defaultDesign, type PortalDesign } from '../schema'
import { newBlock } from '../home'

const coloured = (role: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Vote', marks: [{ type: 'colour', attrs: { role } }] }],
    },
  ],
})

/** A design with a pale second colour, which would not read as text on white. */
function design(mode: PortalDesign['mode'] = 'auto'): PortalDesign {
  const doc = defaultDesign()
  doc.mode = mode
  doc.brand.light.support = '#ffe14d'
  doc.brand.light.extra = ['#7ad3ff']
  return doc
}

const block = (id: string, look?: object) =>
  ({ ...newBlock('welcome'), id, body: coloured('support'), ...(look ? { look } : {}) }) as never

describe('rich words in a colour role', () => {
  it('are moved until they read on cards and the page, in each mode', () => {
    const doc = design()
    doc.pages.feedback.welcome = { show: true, body: coloured('support') as never }
    const resolved = resolveDesign(doc)
    for (const mode of ['light', 'dark'] as const) {
      const used = resolved.tokens[mode]['--qb-words-support']!
      expect(used).toBeTruthy()
      const vars = resolved[mode]!
      expect(contrastRatio(used, vars.card!)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(used, vars.background!)).toBeGreaterThanOrEqual(4.5)
    }
    expect(resolved.tokens.light['--qb-words-extra1']).toBeUndefined()
  })

  it('in a tinted block read on its tint', () => {
    const doc = design()
    doc.pages.home.blocks = [block('tinted001', { tone: 'tint', colour: 'extra1' })]
    const resolved = resolveDesign(doc)
    const vars = resolved.light!
    const tint = mixColor(doc.brand.light.extra![0]!, vars.card!, 0.1)
    const used = resolved.tokens.light['--qb-words-block-tinted001-support']!
    expect(contrastRatio(used, tint)).toBeGreaterThanOrEqual(4.5)
    expect(renderDesignCss(resolved)).toContain(
      '[data-portal-theme] [data-qb-section=block-tinted001] { --qb-words-support: var(--qb-words-block-tinted001-support); }'
    )
  })

  it('in a brand colour block read on its colour', () => {
    const doc = design()
    doc.pages.home.blocks = [block('branded01', { tone: 'brand' })]
    const resolved = resolveDesign(doc)
    const used = resolved.tokens.dark['--qb-words-block-branded01-support']!
    expect(contrastRatio(used, resolved.dark!.primary!)).toBeGreaterThanOrEqual(4.5)
  })

  it('leave a design without them as it was', () => {
    const doc = design()
    const before = renderDesignCss(resolveDesign(doc))
    doc.pages.home.blocks = [{ ...newBlock('welcome'), id: 'plain0001' } as never]
    const after = renderDesignCss(resolveDesign(doc))
    expect(after).toBe(before)
    expect(after).not.toContain('--qb-words-')
    expect(after).not.toContain('data-qb-accent-colour')
  })
})

describe('a headline accent in a colour role', () => {
  function withAccent(mode: PortalDesign['mode'] = 'auto') {
    const doc = design(mode)
    doc.pages.home.headline = {
      title: { en: 'Help shape Acme' },
      subtitle: {},
      accent: { style: 'colour', colour: 'support', text: { en: 'Acme' } },
    }
    return doc
  }

  it('reads at 3:1 on the page under a plain title', () => {
    const resolved = resolveDesign(withAccent())
    for (const mode of ['light', 'dark'] as const) {
      const used = resolved.tokens[mode]['--qb-page-accent-support']!
      expect(contrastRatio(used, resolved[mode]!.background!)).toBeGreaterThanOrEqual(3)
      expect(resolved.tokens[mode]['--qb-band-accent-support']).toBeTruthy()
      expect(resolved.tokens[mode]['--qb-band-panel-accent-support']).toBeTruthy()
    }
  })

  it('reads at 3:1 on a brand colour band', () => {
    const doc = withAccent('light')
    doc.layout.band = 'brand'
    const resolved = resolveDesign(doc)
    const used = resolved.tokens.light['--qb-band-accent-support']!
    expect(contrastRatio(used, resolved.light!.primary!)).toBeGreaterThanOrEqual(3)
  })

  it('takes its colour where it sits: the band, its panel, a photo or a plain title', () => {
    const css = renderDesignCss(resolveDesign(withAccent()))
    expect(css).toContain(
      '[data-portal-theme] [data-qb-accent-colour=support] { --qb-band-accent: var(--qb-band-accent-support); --qb-band-highlight: var(--qb-band-highlight-support); }'
    )
    expect(css).toContain(
      '[data-qb-band-shape=panel] [data-qb-part=band] [data-qb-accent-colour=support] { --qb-band-accent: var(--qb-band-panel-accent-support); }'
    )
    expect(css).toContain(
      '[data-portal-theme] [data-qb-section=hero]:not([data-qb-part=band]) [data-qb-accent-colour=support] { --qb-band-accent: var(--qb-page-accent-support); --qb-band-highlight: var(--qb-page-highlight-support); }'
    )
    expect(css).not.toContain('accent-colour=extra1')
  })

  it('in the brand colour, or a role the design has no colour for, adds nothing', () => {
    const doc = withAccent()
    const before = renderDesignCss(
      resolveDesign({
        ...doc,
        pages: {
          ...doc.pages,
          home: {
            ...doc.pages.home,
            headline: {
              ...doc.pages.home.headline!,
              accent: { style: 'colour', text: { en: 'Acme' } },
            },
          },
        },
      })
    )
    doc.pages.home.headline!.accent!.colour = 'extra2'
    expect(renderDesignCss(resolveDesign(doc))).toBe(before)
  })
})
