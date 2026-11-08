/**
 * The style token registry and its rendering: every token is valid in the
 * schema and draws a rule; states, per-block looks and dark mode go through
 * one resolver; text stays readable on every fill it sits on.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../contrast'
import { renderDesignCss, resolveDesign } from '../resolve'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import {
  BLOCK_STYLE_ELEMENTS,
  STYLE_ELEMENTS,
  STYLE_PROPS,
  blockStylePath,
  readStyleValue,
  stylePath,
  styleTokens,
  type StyleToken,
} from '../style-tokens'

const design = (change: (d: PortalDesign) => void) => {
  const d = defaultDesign()
  change(d)
  return portalDesign.parse(d)
}

/** A valid value for a token. */
function sample(token: StyleToken): unknown {
  switch (token.type) {
    case 'colour':
      return '#335577'
    case 'paint':
      return { from: 'accent', to: 'support', angle: 90 }
    case 'number':
      return token.range!.min
    case 'choice':
      return Object.keys(token.looks!)[0]
  }
}

const setAt = (d: PortalDesign, path: string, value: unknown) => {
  const keys = path.split('.')
  let at = d as unknown as Record<string, unknown>
  for (const key of keys.slice(0, -1)) at = (at[key] ??= {}) as Record<string, unknown>
  at[keys.at(-1)!] = value
}

describe('the style token registry', () => {
  const tokens = styleTokens()

  it('lists every element, state and property it allows, each described with its default', () => {
    expect(new Set(tokens.map((t) => t.element)).size).toBe(Object.keys(STYLE_ELEMENTS).length)
    expect(tokens.length).toBeGreaterThan(300)
    for (const t of tokens) {
      expect(t.about.length, t.name).toBeGreaterThan(10)
      expect(t.default.length, t.name).toBeGreaterThan(3)
      expect(stylePath(t.name), t.name).toBe(t.name)
    }
  })

  it('takes a valid value for every token, and draws a rule for it', () => {
    for (const t of tokens) {
      const d = design(() => {})
      setAt(d, t.name, sample(t))
      const parsed = portalDesign.safeParse(d)
      expect(parsed.success, `${t.name}: ${parsed.error?.message}`).toBe(true)
      const css = renderDesignCss(resolveDesign(parsed.data!))
      expect(css, t.name).toContain(`--qb-st-${t.element}-${t.state}-${t.prop}`)
    }
  })

  it('refuses a state an element does not have, a property out of range, and an unknown colour', () => {
    const bad = [
      ['style.headline.hover.color', '#000000'],
      ['style.button.base.radius', 2000],
      ['style.button.base.background', 'chartreuse'],
      ['style.postCard.focus.ring', 'accent'],
      ['style.panel.hover.background', 'raised'],
      ['style.panel.base.lift', 2],
      ['style.card.base.radius', 4],
      ['style.button.base.lift', 2],
    ] as const
    for (const [path, value] of bad) {
      const d = defaultDesign()
      setAt(d, path, value)
      expect(portalDesign.safeParse(d).success, path).toBe(false)
    }
  })

  it('reads keys as people write them, and values as the AI writes them', () => {
    expect(stylePath('style.button.background')).toBe('style.button.base.background')
    expect(stylePath('style.navItem.current.weight')).toBe('style.navItem.current.weight')
    expect(stylePath('styleDark.button.hover.background')).toBe('styleDark.button.hover.background')
    expect(stylePath('styleDark.button.base.radius')).toBeNull()
    expect(stylePath('style.headline.hover.color')).toBeNull()
    expect(blockStylePath('style.postCard.hover.lift')).toBe('style.postCard.hover.lift')
    expect(blockStylePath('style.header.background')).toBeNull()
    expect(readStyleValue('radius', '12px')).toBe(12)
    expect(readStyleValue('background', 'brand colour')).toBe('accent')
    expect(readStyleValue('background', '{"from":"accent","to":"#ffffff"}')).toEqual({
      from: 'accent',
      to: '#ffffff',
    })
    expect(readStyleValue('color', '#ABC')).toBe('#aabbcc')
  })

  it('has a property kind for each of its properties', () => {
    for (const prop of Object.values(STYLE_PROPS)) expect(prop.kind).toBeTruthy()
    for (const el of BLOCK_STYLE_ELEMENTS) expect(STYLE_ELEMENTS[el]).toBeTruthy()
  })
})

describe('element styles, drawn', () => {
  it('change nothing when a design has none', () => {
    const resolved = resolveDesign(defaultDesign())
    expect(resolved.styleCss).toBe('')
    expect(renderDesignCss(resolved)).not.toContain('--qb-st-')
  })

  it('draw each state under its own selector, over the portal’s rules, with a preview hook', () => {
    const r = resolveDesign(
      design((d) => {
        d.style = {
          button: { base: { radius: 4 }, hover: { lift: 2 }, focus: { ring: 'accent' } },
          navItem: { current: { weight: 700 } },
        }
      })
    )
    expect(r.tokens.base['--qb-st-button-base-radius' as never]).toBeUndefined()
    expect(r.tokens.light['--qb-st-button-base-radius']).toBe('4px')
    expect(r.styleCss).toContain('[data-portal-theme]:not(#qb) :is([data-slot=button]')
    expect(r.styleCss).toContain(':is(:hover, [data-qb-force=hover])')
    expect(r.styleCss).toContain(':is(:focus-visible, [data-qb-force=focus])')
    expect(r.styleCss).toContain('.portal-nav__item--active')
    // Motion only for those who have not asked for less.
    expect(r.styleCss).toMatch(/prefers-reduced-motion: no-preference\) \{.*translate: 0 calc/)
  })

  it('names colours by role, drawn as each mode’s own', () => {
    const r = resolveDesign(
      design((d) => {
        d.brand.light.accent = '#4f46e5'
        d.style = { postCard: { base: { borderColor: 'accent' } } }
      })
    )
    expect(r.tokens.light['--qb-st-postCard-base-borderColor']).toBe(r.light!.primary)
    expect(r.tokens.dark['--qb-st-postCard-base-borderColor']).toBe(r.dark!.primary)
  })

  it('draws hover and pressed fills from a set fill, a little darker, with readable text', () => {
    const r = resolveDesign(
      design((d) => {
        d.mode = 'light'
        d.style = { button: { base: { background: '#f59e0b' } } }
      })
    )
    const base = r.tokens.light['--qb-st-button-base-background']!
    const hover = r.tokens.light['--qb-st-button-hover-background']!
    const active = r.tokens.light['--qb-st-button-active-background']!
    expect(hover).not.toBe(base)
    expect(contrastRatio(hover, '#ffffff')).toBeGreaterThan(contrastRatio(base, '#ffffff'))
    expect(contrastRatio(active, '#ffffff')).toBeGreaterThan(contrastRatio(hover, '#ffffff'))
    for (const state of ['base', 'hover', 'active'])
      expect(
        contrastRatio(
          r.tokens.light[`--qb-st-button-${state}-color`]!,
          r.tokens.light[`--qb-st-button-${state}-background`]!
        ),
        state
      ).toBeGreaterThanOrEqual(4.5)
  })

  it('moves a hover text colour until it reads on its fill, and says so', () => {
    const r = resolveDesign(
      design((d) => {
        d.mode = 'light'
        d.style = { secondary: { hover: { background: '#1e1b4b', color: '#312e81' } } }
      })
    )
    const check = r.styled.find((c) => c.where === 'style.secondary.hover' && c.mode === 'light')!
    expect(check.set).toBe('#312e81')
    expect(check.used).not.toBe('#312e81')
    expect(contrastRatio(check.used!, '#1e1b4b')).toBeGreaterThanOrEqual(4.5)
  })

  it('gives a fill set without text the text that reads clearer, where black and white both pass', () => {
    const r = resolveDesign(
      design((d) => {
        d.mode = 'light'
        // Black page text reaches 4.5:1 on the blue, as white does.
        d.brand.light.ink = '#000000'
        d.style = { secondary: { base: { background: '#0c73e5' } } }
      })
    )
    const check = r.styled.find((c) => c.where === 'style.secondary.base' && c.mode === 'light')!
    expect(contrastRatio(check.used!, '#000000')).toBeGreaterThan(
      contrastRatio(check.used!, '#ffffff')
    )
    expect(contrastRatio(check.used!, '#0c73e5')).toBeGreaterThanOrEqual(4.5)
  })

  it('reads text on both ends of a gradient', () => {
    const r = resolveDesign(
      design((d) => {
        d.mode = 'light'
        d.brand.light.accent = '#4f46e5'
        d.brand.light.support = '#1e1b4b'
        d.style = { hero: { base: { background: { from: 'accent', to: 'support' } } } }
      })
    )
    const check = r.styled.find((c) => c.where === 'style.hero.base')!
    expect(r.tokens.light['--qb-st-hero-base-background']).toMatch(/^linear-gradient\(180deg/)
    expect(contrastRatio(check.used!, '#4f46e5')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(check.used!, '#1e1b4b')).toBeGreaterThanOrEqual(4.5)
    expect(r.styleCss).toContain('--qb-band-ink: var(--qb-st-hero-base-color)')
    expect(r.errors).toEqual([])
  })

  it('refuses a fill no text reads on, as it refuses a hero', () => {
    const r = resolveDesign(
      design((d) => {
        d.mode = 'light'
        d.style = { hero: { base: { background: { from: '#4f46e5', to: '#fde68a' } } } }
      })
    )
    expect(r.errors.some((e) => /hero/.test(e))).toBe(true)
  })

  it('takes dark mode’s own colour where set, and works one out where not', () => {
    const r = resolveDesign(
      design((d) => {
        d.style = { link: { base: { color: '#1d4ed8' } } }
        d.styleDark = { link: { base: { color: '#93c5fd' } } }
      })
    )
    expect(r.tokens.light['--qb-st-link-base-color']).toBe('#1d4ed8')
    expect(r.tokens.dark['--qb-st-link-base-color']).toBe('#93c5fd')
    const derived = resolveDesign(
      design((d) => (d.style = { link: { base: { color: '#1d4ed8' } } }))
    )
    expect(
      contrastRatio(derived.tokens.dark['--qb-st-link-base-color']!, derived.dark!.background!)
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('draws a Home block’s own look inside that block only, over the site’s', () => {
    const r = resolveDesign(
      design((d) => {
        d.pages.home.blocks = [
          {
            id: 'ideas00001',
            type: 'ideas',
            sort: 'top',
            count: 3,
            grid: { x: 0, y: 0, w: 6, h: 1 },
          },
        ] as PortalDesign['pages']['home']['blocks']
        d.style = { postCard: { base: { radius: 4 } } }
        d.pages.home.blocks[0]!.look = {
          style: { block: { base: { background: 'raised' } }, postCard: { hover: { lift: 2 } } },
        }
      })
    )
    expect(r.tokens.light['--qb-st-bideas00001-block-base-background']).toBe(r.light!.muted)
    expect(r.styleCss).toContain(
      '[data-portal-theme]:not(#qb) [data-qb-section="block-ideas00001"] {'
    )
    expect(r.styleCss).toContain('[data-qb-section="block-ideas00001"] [data-qb-post]:is(:hover')
  })

  it('styles post cards apart from panels, a post card focused while what it holds is', () => {
    const r = resolveDesign(
      design((d) => {
        d.style = {
          postCard: { hover: { lift: 2 }, focus: { borderColor: 'accent' } },
          panel: { base: { radius: 0 } },
        }
      })
    )
    expect(r.styleCss).toContain('[data-qb-post]:is(:hover, [data-qb-force=hover])')
    expect(r.styleCss).toContain(
      '[data-qb-post]:is(:has(:focus-visible), [data-qb-force=focus]) { border-color'
    )
    expect(r.styleCss).toContain(
      '[data-portal-theme]:not(#qb) [data-qb-surface=card]:not([data-qb-post]) { border-radius'
    )
    // A panel never lifts: nothing clicks it.
    expect(r.styleCss).not.toMatch(/data-qb-post\]\):is\(:hover/)
  })

  it('draws a divider as one line in its colour, width and style', () => {
    const r = resolveDesign(
      design((d) => (d.style = { divider: { base: { borderStyle: 'dotted', borderWidth: 2 } } }))
    )
    expect(r.styleCss).toContain('border-top: var(--qb-st-divider-base-borderWidth) dotted')
  })
})

describe('what most people change', () => {
  it('each element lists a few of its own properties, shown first', () => {
    for (const [name, el] of Object.entries(STYLE_ELEMENTS)) {
      expect(el.common.length, name).toBeGreaterThan(0)
      expect(el.common.length, name).toBeLessThanOrEqual(4)
      for (const prop of el.common) expect(el.props, `${name} ${prop}`).toContain(prop)
    }
    expect(STYLE_ELEMENTS.button.common).toEqual(['background', 'color', 'radius', 'size'])
    expect(STYLE_ELEMENTS.headline.common).toEqual(['color', 'size', 'weight'])
  })
})
