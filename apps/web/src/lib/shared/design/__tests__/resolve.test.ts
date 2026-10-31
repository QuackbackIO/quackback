import { describe, expect, it } from 'vitest'
import { DEFAULT_FONT_SANS, DEFAULT_RADIUS, expandTheme } from '@/lib/shared/theme/expand'
import { contrastRatio } from '../contrast'
import { renderDesignCss, resolveDesign } from '../resolve'
import { defaultDesign, type PortalDesign } from '../schema'
import { PAIRS } from './contrast-golden'

const withAccent = (accent: string, mode: PortalDesign['mode'] = 'auto') => {
  const doc = defaultDesign()
  doc.mode = mode
  doc.brand.light.accent = accent
  return doc
}

describe('resolveDesign', () => {
  it('starts from today’s tokens and changes only what it reports', () => {
    const resolved = resolveDesign(defaultDesign())
    // An unbranded theme leaves font and radius to the stylesheet; a design states the same defaults.
    const legacy = expandTheme(
      { fontSans: DEFAULT_FONT_SANS, radius: DEFAULT_RADIUS },
      { mode: 'light' }
    )
    const adjusted = new Set<string>(
      resolved.adjustments.filter((a) => a.mode === 'light').map((a) => a.token)
    )
    for (const [token, value] of Object.entries(legacy)) {
      if (!adjusted.has(token))
        expect(resolved.light?.[token as keyof typeof legacy], token).toBe(value)
    }
  })

  it('reports each change with the value it replaced', () => {
    const { adjustments, light } = resolveDesign(defaultDesign())
    const links = adjustments.find((a) => a.mode === 'light' && a.token === 'accentInk')
    expect(links).toMatchObject({ from: 'oklch(0.720 0.176 86)' })
    expect(light?.accentInk).toBe(links?.to)
  })

  it.each(['#F5D90A', '#FFFF00', '#06B6D4', '#777777', '#0A0A0A', '#1E3A8A'])(
    'makes every pair readable with accent %s, in light and dark',
    (accent) => {
      const resolved = resolveDesign(withAccent(accent))
      expect(resolved.errors).toEqual([])
      for (const mode of ['light', 'dark'] as const) {
        const vars = resolved[mode]!
        for (const { pair, fg, bg, min } of PAIRS) {
          expect(
            contrastRatio(String(vars[fg]), String(vars[bg])),
            `${mode} ${pair}`
          ).toBeGreaterThanOrEqual(min)
        }
      }
    }
  )

  it('keeps the accent fill when it can carry text, and moves it only when it cannot', () => {
    expect(resolveDesign(withAccent('#0f766e')).adjustments.map((a) => a.token)).not.toContain(
      'primary'
    )
    const yellow = resolveDesign(withAccent('#777777'))
    const fill = yellow.adjustments.find((a) => a.token === 'primary')
    expect(fill?.reason).toMatch(/button text/)
  })

  it('refuses a design whose ink cannot be read on its background', () => {
    const doc = defaultDesign()
    doc.brand.light.ink = '#fefefe'
    expect(resolveDesign(doc).errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/light: ink on background/)])
    )
  })

  it('resolves only the modes a design shows', () => {
    expect(resolveDesign(withAccent('#0f766e', 'light')).dark).toBeNull()
    expect(resolveDesign(withAccent('#0f766e', 'dark')).light).toBeNull()
  })

  it('uses dark colours a design sets and works out the rest', () => {
    const doc = defaultDesign()
    doc.brand.dark = { background: '#0b0d12' }
    const { dark } = resolveDesign(doc)
    expect(dark?.background).toBe('#0b0d12')
    expect(dark?.primary).toBe(doc.brand.light.accent)
  })

  it('maps corners to a radius and the body font to its stack', () => {
    const doc = defaultDesign()
    doc.shape.corners = 'sharp'
    doc.brand.fonts.body = { kind: 'bundled', id: 'lora' }
    const { light } = resolveDesign(doc)
    expect(light?.radius).toBe('0rem')
    expect(light?.fontSans).toBe('"Lora", ui-serif, Georgia, serif')
  })
})

describe('renderDesignCss', () => {
  it('scopes tokens to the portal and adds the dark block for auto', () => {
    const css = renderDesignCss(resolveDesign(withAccent('#0f766e')))
    expect(css).toContain('[data-portal-theme] {')
    expect(css).toContain('.dark[data-portal-theme] {')
    expect(css).not.toContain(':root')
  })

  it('names the semantic tokens and points the component names at them', () => {
    const css = renderDesignCss(resolveDesign(withAccent('#0f766e')))
    const [light, dark] = css.split('.dark[data-portal-theme] {')
    expect(light).toContain('--qb-accent: #0f766e;')
    expect(light).toContain('--primary: var(--qb-accent);')
    expect(light).toContain('--background: var(--qb-bg);')
    expect(light).toContain('--input: var(--qb-border-strong);')
    // The dark block changes the tokens only; the names already point at them.
    expect(dark).toContain('--qb-accent:')
    expect(dark).not.toContain('--primary:')
  })

  it('writes one block for a design that is always light', () => {
    const css = renderDesignCss(resolveDesign(withAccent('#0f766e', 'light')))
    expect(css).not.toContain('.dark[data-portal-theme]')
  })

  it('applies the body font and radius under the scope, without !important', () => {
    const css = renderDesignCss(resolveDesign(defaultDesign()))
    expect(css).toContain('[data-portal-theme] body { --font-sans:')
    expect(css).not.toContain('!important')
  })

  it('sets the heading family, in a layer utilities can override, and the heading weight', () => {
    const doc = defaultDesign()
    doc.brand.fonts.heading = { kind: 'bundled', id: 'fraunces' }
    doc.brand.fonts.headingWeight = 700
    const resolved = resolveDesign(doc)
    expect(resolved.tokens.base['--qb-font-heading']).toBe('"Fraunces", ui-serif, Georgia, serif')
    expect(resolved.tokens.base['--qb-heading-weight']).toBe('700')
    const css = renderDesignCss(resolved)
    expect(css).toContain(
      '@layer base { [data-portal-theme] :is(h1, h2, h3) { font-family: var(--qb-font-heading); } }'
    )
    expect(css).toContain(
      '@layer design { [data-portal-theme] { letter-spacing: -0.01em; } [data-portal-theme] :is(h1, h2, h3) { font-weight: var(--qb-heading-weight); letter-spacing: -0.02em; } }'
    )
  })
})
