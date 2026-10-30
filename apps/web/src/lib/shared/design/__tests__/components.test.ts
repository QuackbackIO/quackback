/**
 * Component tokens and structural attributes. The default design reproduces
 * the values the portal hard-codes today, so a converted workspace keeps its
 * header, menu and cards; every other option changes them through tokens,
 * and structure through `data-qb-*` attributes on `<html>`.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../contrast'
import { layoutAttributes, PORTAL_ALIASES } from '../components'
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

  it('tints with the subtle accent and keeps both text colours readable on it', () => {
    const doc = design((d) => {
      d.layout.band = 'tint'
      d.brand.light.accent = '#f59e0b'
    })
    const resolved = resolveDesign(doc)
    for (const mode of ['light', 'dark'] as const) {
      const bg = resolved.tokens[mode]['--qb-band-bg']
      expect(bg, mode).toBe(resolved[mode]!.accent)
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

  it('fades from the subtle accent into the page', () => {
    const resolved = resolveDesign(design((d) => (d.layout.band = 'fade')))
    expect(resolved.tokens.light['--qb-band-bg']).toBe(
      `linear-gradient(to bottom, ${resolved.light!.accent}, ${resolved.light!.background})`
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
