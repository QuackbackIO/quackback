/**
 * Component tokens and structural attributes. The default design reproduces
 * the values the portal hard-codes today, so a converted workspace keeps its
 * header, menu and cards; every other option changes them through tokens,
 * and structure through `data-qb-*` attributes on `<html>`.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../contrast'
import { BAND_FADE, BAND_TINT, layoutAttributes, PORTAL_ALIASES } from '../components'
import { mixColor } from '../color'
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { resolveDesign } from '../resolve'
import { defaultDesign, type PortalDesign } from '../schema'

const design = (change: (doc: PortalDesign) => void = () => {}) => {
  const doc = defaultDesign()
  change(doc)
  return doc
}

describe('component tokens of the default design', () => {
  const { tokens } = resolveDesign(design())

  it('keeps today’s header', () => {
    expect(tokens.light['--qb-header-bg']).toBe('#ffffff')
    expect(tokens.light['--qb-header-ink']).toBe('#0a0a0a')
    expect(tokens.light['--qb-header-rule']).toBe('#e5e5e5')
    expect(tokens.dark['--qb-header-bg']).toBe('#0a0a0a')
    expect(tokens.dark['--qb-header-rule']).toBe('#262626')
  })

  it('keeps today’s menu', () => {
    expect(tokens.light['--qb-nav-active-bg']).toBe('#f5f5f5')
    expect(tokens.light['--qb-nav-active-ink']).toBe('#0a0a0a')
    expect(tokens.light['--qb-nav-ink']).toBe('#525252')
    expect(tokens.dark['--qb-nav-active-bg']).toBe('#222222')
    expect(tokens.dark['--qb-nav-ink']).toBe('#a1a1a1')
  })
})

describe('size tokens of the default design', () => {
  const { tokens } = resolveDesign(design())

  it('keeps today’s corners, spacing and width', () => {
    expect(tokens.base).toMatchObject({
      '--qb-radius-control': '999px',
      '--qb-radius-field': '0.5rem',
      '--qb-radius-panel': '0.75rem',
      '--qb-card-padding': '1rem',
      '--qb-feed-gap': '0.75rem',
      '--qb-title-size': '1rem',
      '--qb-page-max': '72rem',
    })
  })
})

describe('a headline’s accent phrase', () => {
  it('is the brand colour where it reads, and readable on a band of the brand colour', () => {
    const plain = resolveDesign(design((d) => (d.brand.light.accent = '#0f766e'))).tokens.light
    expect(plain['--qb-band-accent']).toBe('#0f766e')
    const filled = resolveDesign(
      design((d) => {
        d.brand.light.accent = '#0f766e'
        d.layout.band = 'brand'
      })
    ).tokens.light
    const [accent, band] = [filled['--qb-band-accent']!, filled['--qb-band-bg']!]
    expect(contrastRatio(accent, band)).toBeGreaterThanOrEqual(3)
  })
})

describe('type style', () => {
  it('keeps today’s headline size, tracking and case', () => {
    const { tokens } = resolveDesign(design())
    expect(tokens.base).toMatchObject({
      '--qb-headline-size': 'clamp(1.5rem, 1.25rem + 1vw, 1.875rem)',
      '--qb-heading-tracking': '-0.02em',
      '--qb-headline-case': 'none',
      '--qb-label-case': 'none',
      '--qb-label-tracking': 'normal',
    })
  })

  it('sets display headlines large, tight and upper case, and spaces upper-case labels', () => {
    const { tokens } = resolveDesign(
      design((d) => {
        Object.assign(d.brand.fonts, {
          scale: 'display',
          tracking: 'tight',
          headlineCase: 'upper',
          labelCase: 'upper',
        })
      })
    )
    expect(tokens.base).toMatchObject({
      '--qb-headline-size': 'clamp(2.25rem, 1.2rem + 4.6vw, 4.75rem)',
      '--qb-headline-leading': '1.02',
      '--qb-heading-tracking': '-0.035em',
      '--qb-headline-case': 'uppercase',
      '--qb-label-case': 'uppercase',
      '--qb-label-tracking': '0.06em',
    })
  })

  it('sizes large between the two', () => {
    const { tokens } = resolveDesign(design((d) => (d.brand.fonts.scale = 'large')))
    expect(tokens.base['--qb-headline-size']).toBe('clamp(2rem, 1.5rem + 2.2vw, 3rem)')
  })
})

describe('shape and layout choices', () => {
  it('squares every corner for sharp', () => {
    const { tokens } = resolveDesign(design((d) => (d.shape.corners = 'sharp')))
    expect(tokens.base['--qb-radius-control']).toBe('0rem')
    expect(tokens.base['--qb-radius-panel']).toBe('0rem')
  })

  it('tightens the feed for compact and widens the page for wide', () => {
    const { tokens } = resolveDesign(
      design((d) => {
        d.layout.density = 'compact'
        d.layout.width = 'wide'
      })
    )
    expect(tokens.base['--qb-card-padding']).toBe('0.75rem')
    expect(tokens.base['--qb-feed-gap']).toBe('0.5rem')
    expect(tokens.base['--qb-page-max']).toBe('80rem')
  })

  it('runs list cards together', () => {
    const { tokens } = resolveDesign(design((d) => (d.layout.cards = 'list')))
    expect(tokens.base['--qb-feed-gap']).toBe('0rem')
  })
})

describe('a second brand colour', () => {
  const withSupport = (band: PortalDesign['layout']['band'], change?: (d: PortalDesign) => void) =>
    resolveDesign(
      design((d) => {
        d.brand.light.accent = '#4a1942'
        d.brand.light.support = '#e58fae'
        d.layout.band = band
        change?.(d)
      })
    )

  it('fills a support band with it, with text readable on it', () => {
    const { light } = withSupport('support').tokens
    expect(light['--qb-band-bg']).toBe('#e58fae')
    expect(contrastRatio(light['--qb-band-ink']!, '#e58fae')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(light['--qb-band-muted']!, '#e58fae')).toBeGreaterThanOrEqual(4.5)
  })

  it('fills a support band with the accent when there is no second colour', () => {
    const { light } = resolveDesign(design((d) => (d.layout.band = 'support'))).tokens
    expect(light['--qb-band-bg']).toBe(resolveDesign(design()).light!.primary)
  })

  it('blends the two in a line, with text readable where it sits', () => {
    const { light } = withSupport('blend').tokens
    expect(light['--qb-band-bg']).toBe('linear-gradient(110deg, #4a1942 0%, #e58fae 100%)')
    const ink = light['--qb-band-ink']!
    expect(contrastRatio(ink, '#4a1942')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ink, mixColor('#4a1942', '#e58fae', 0.5))).toBeGreaterThanOrEqual(4.5)
  })

  it('refuses a blend that no text reads across', () => {
    const doc = design((d) => {
      d.brand.light.accent = '#22c55e'
      d.brand.light.support = '#1e1b4b'
      d.layout.band = 'blend'
    })
    expect(resolveDesign(doc).errors).toEqual([
      'light: no text reaches 4.5:1 across the band',
      'dark: no text reaches 4.5:1 across the band',
    ])
  })

  it('blends the two as a mesh beside the words, plain under them and on phones', () => {
    const { light } = withSupport('blend', (d) => (d.layout.blend = 'mesh')).tokens
    const background = resolveDesign(design()).light!.background
    expect(light['--qb-band-bg']).toContain('radial-gradient(circle at 72% 22%, #4a1942')
    expect(light['--qb-band-bg']).toContain('#e58fae')
    expect(light['--qb-band-bg']).toMatch(/^linear-gradient\(90deg, \S+ 34%/)
    expect(light['--qb-band-bg-narrow']).toBe(background)
    expect(light['--qb-band-ink']).toBe(resolveDesign(design()).light!.foreground)
  })

  it('highlights in it', () => {
    const { light } = withSupport('none').tokens
    expect(light['--qb-band-highlight']).toBe(
      mixColor('#e58fae', resolveDesign(design()).light!.background!, 0.35)
    )
  })

  it('carries it into dark mode when dark does not set its own', () => {
    const { dark } = withSupport('support', (d) => (d.mode = 'auto')).tokens
    expect(dark['--qb-band-bg']).toBe('#e58fae')
  })
})

describe('the top band', () => {
  it('is plain for none and readable on the accent for brand', () => {
    expect(resolveDesign(design()).tokens.light['--qb-band-bg']).toBe('transparent')
    const doc = design((d) => {
      d.layout.band = 'brand'
      d.brand.light.accent = '#0f766e'
    })
    const resolved = resolveDesign(doc)
    for (const mode of ['light', 'dark'] as const) {
      const bg = resolved.tokens[mode]['--qb-band-bg']
      expect(bg, mode).toBe(resolved[mode]!.primary)
      expect(
        contrastRatio(resolved.tokens[mode]['--qb-band-ink'], bg),
        mode
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(resolved.tokens[mode]['--qb-band-muted'], bg),
        mode
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('tints with the brand colour and keeps both text colours readable on it', () => {
    const doc = design((d) => {
      d.layout.band = 'tint'
      d.brand.light.accent = '#7a1f35'
    })
    const resolved = resolveDesign(doc)
    for (const mode of ['light', 'dark'] as const) {
      const bg = resolved.tokens[mode]['--qb-band-bg']
      expect(bg, mode).toBe(
        mixColor(resolved[mode]!.primary!, resolved[mode]!.background!, BAND_TINT)
      )
      // A tint of burgundy leans red, never the neutral grey of hover states.
      const { c, h } = parseOklch(hexToOklch(bg))!
      expect(c, mode).toBeGreaterThan(0.01)
      expect(h < 40 || h > 330, mode).toBe(true)
      expect(
        contrastRatio(resolved.tokens[mode]['--qb-band-ink'], bg),
        mode
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(resolved.tokens[mode]['--qb-band-muted'], bg),
        mode
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('fades from a tint of the brand colour into the page', () => {
    const resolved = resolveDesign(design((d) => (d.layout.band = 'fade')))
    const { primary, background } = resolved.light!
    expect(resolved.tokens.light['--qb-band-bg']).toBe(
      `linear-gradient(to bottom, ${mixColor(primary!, background!, BAND_FADE)}, ${background})`
    )
  })
})

describe('the voted state', () => {
  it('uses accent text, which the solver keeps readable', () => {
    const doc = design((d) => (d.brand.light.accent = '#facc15'))
    const resolved = resolveDesign(doc)
    for (const mode of ['light', 'dark'] as const) {
      const ink = resolved.tokens[mode]['--qb-vote-active']
      expect(ink).toBe(resolved[mode]!.accentInk)
      expect(contrastRatio(ink, String(resolved[mode]!.card)), mode).toBeGreaterThanOrEqual(4.5)
    }
    expect(PORTAL_ALIASES['--post-card-voted-color']).toBe('--qb-vote-active')
  })
})

describe('menu styles', () => {
  it('leaves the current page unfilled for underline, which the attribute underlines', () => {
    const { tokens } = resolveDesign(design((d) => (d.layout.nav = 'underline')))
    expect(tokens.light['--qb-nav-active-bg']).toBe('transparent')
  })

  it('fills the current page with readable accent text for pills', () => {
    const doc = design((d) => {
      d.layout.nav = 'pills'
      d.brand.light.accent = '#f59e0b'
    })
    const { tokens } = resolveDesign(doc)
    for (const mode of ['light', 'dark'] as const) {
      const bg = tokens[mode]['--qb-nav-active-bg']
      const ink = tokens[mode]['--qb-nav-active-ink']
      expect(contrastRatio(ink, bg), mode).toBeGreaterThanOrEqual(4.5)
    }
    expect(tokens.base['--qb-nav-radius']).toBe('999px')
  })
})

describe('layoutAttributes', () => {
  it('names the structural choices', () => {
    const doc = design((d) => {
      d.layout.header = 'inline'
      d.layout.nav = 'pills'
      d.layout.cards = 'list'
      d.layout.filters = 'start'
    })
    expect(layoutAttributes(doc)).toEqual({
      'data-qb-header': 'inline',
      'data-qb-nav': 'pills',
      'data-qb-band': 'none',
      'data-qb-cards': 'list',
      'data-qb-filters': 'start',
    })
  })
})

describe('PORTAL_ALIASES', () => {
  it('points the portal’s own variables at the tokens', () => {
    expect(PORTAL_ALIASES['--header-background']).toBe('--qb-header-bg')
    expect(PORTAL_ALIASES['--nav-inactive-color']).toBe('--qb-nav-ink')
    expect(PORTAL_ALIASES['--radius-item']).toBe('--qb-radius-control')
    expect(PORTAL_ALIASES['--radius-panel']).toBe('--qb-radius-panel')
  })
})
