import { describe, expect, it } from 'vitest'
import { DEFAULT_FONT_SANS, DEFAULT_RADIUS, expandTheme } from '@/lib/shared/theme/expand'
import { contrastRatio } from '../contrast'
import { renderDesignCss, resolveDesign } from '../resolve'
import { fontStack } from '../fonts'
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
    // An unbranded theme leaves font and radius to the stylesheet; a design states the same
    // defaults, Inter with its stand-in, as the stylesheet's own stack has it.
    const inter = fontStack({ kind: 'bundled', id: 'inter' })
    expect(inter).toBe(
      DEFAULT_FONT_SANS.replace('"Inter", ', '"Inter", "Inter Variable Fallback", ')
    )
    const legacy = expandTheme({ fontSans: inter, radius: DEFAULT_RADIUS }, { mode: 'light' })
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

  it('puts light text on buttons where black and white both reach 4.5:1, as it reads clearer', () => {
    for (const accent of ['#0c73e5', '#08872a']) {
      const resolved = resolveDesign(withAccent(accent))
      for (const mode of ['light', 'dark'] as const) {
        const vars = resolved[mode]!
        expect(contrastRatio(vars.primaryForeground!, '#ffffff'), `${accent} ${mode}`).toBeLessThan(
          1.1
        )
        expect(contrastRatio(vars.primaryForeground!, vars.primary!)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps dark button text where white falls under 4.5:1, and never moves the fill for it', () => {
    const resolved = resolveDesign(withAccent('#db483c'))
    expect(resolved.light?.primary).toBe('#db483c')
    expect(contrastRatio(resolved.light!.primaryForeground!, '#000000')).toBeLessThan(1.5)
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
    expect(light?.fontSans).toBe('"Lora", "Lora Fallback", ui-serif, Georgia, serif')
  })
})

describe('the second colour’s tint in the design CSS', () => {
  it('tints vote boxes that are not voted', () => {
    expect(renderDesignCss(resolveDesign(defaultDesign()))).toContain(
      '[data-qb-tint=support][data-portal-theme] [data-qb-part=vote-button]:not([data-state=voted]) { background: var(--qb-support-tint); border-color: var(--qb-support-edge); }'
    )
  })
})

describe('focus in the design CSS', () => {
  it('rings anything focused by keyboard in the focus colour, unless it draws its own', () => {
    expect(renderDesignCss(resolveDesign(defaultDesign()))).toContain(
      '@layer base { [data-portal-theme] :is(h1, h2, h3) { font-family: var(--qb-font-heading); } [data-portal-theme] :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; } }'
    )
  })
})

describe('the headline font in the design CSS', () => {
  it('sets page headlines in their own face, which is the heading font unless the design gives one', () => {
    const doc = defaultDesign()
    expect(renderDesignCss(resolveDesign(doc))).toContain(
      '[data-portal-theme] [data-qb-part=headline] { font-family: var(--qb-font-display);'
    )
    expect(renderDesignCss(resolveDesign(doc))).toMatch(/--qb-font-display: [^;]*Inter/)
    doc.brand.fonts.display = { kind: 'bundled', id: 'oswald' }
    expect(renderDesignCss(resolveDesign(doc))).toMatch(/--qb-font-display: [^;]*Oswald/)
  })
})

describe('the button fill in the design CSS', () => {
  it('fills primary buttons with the text colour when the design asks', () => {
    expect(renderDesignCss(resolveDesign(defaultDesign()))).toContain(
      '[data-qb-fill=ink][data-portal-theme] :is([data-slot=button][data-variant=default], [data-qb-action]) { background-color: var(--qb-fill-bg); color: var(--qb-fill-ink); }'
    )
  })
})

describe('card styles in the design CSS', () => {
  it('gives every card surface the design’s card style', () => {
    const css = renderDesignCss(resolveDesign(defaultDesign()))
    expect(css).toContain(
      '[data-qb-cards=raised][data-portal-theme] [data-qb-surface=card]:not(:focus-visible) { box-shadow:'
    )
    expect(css).toContain(
      '[data-qb-cards=list][data-portal-theme] [data-qb-surface=card] { border-radius: 0; border-inline-width: 0; border-top-width: 0; background: transparent; }'
    )
    expect(css).toContain(
      '[data-qb-cards=filled][data-portal-theme] [data-qb-surface=card] { border-color: transparent; border-radius: calc(var(--qb-radius-panel, 0.75rem) * 1.6); }'
    )
    // A card's shadow gives way to a focus ring, which is drawn as one.
    expect(css).toContain(
      '[data-qb-cards=filled][data-portal-theme] [data-qb-surface=card]:not(:focus-visible) { box-shadow: none; }'
    )
  })
})

describe('status styles in the design CSS', () => {
  it('draws status dots in the ink, or statuses as tags tinted with their colour', () => {
    const css = renderDesignCss(resolveDesign(defaultDesign()))
    expect(css).toContain(
      '[data-qb-status=ink][data-portal-theme] [data-qb-status-dot] { background: var(--qb-ink); }'
    )
    expect(css).toContain(
      'background: color-mix(in oklch, var(--qb-status, var(--qb-muted)) 18%, var(--qb-surface));'
    )
    expect(css).toContain(
      '[data-qb-status=pill][data-portal-theme] [data-qb-part=status-badge] > [data-qb-status-dot] { display: none; }'
    )
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
    const [light, rest] = css.split('.dark[data-portal-theme] {')
    const dark = rest!.slice(0, rest!.indexOf('}'))
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
    // Blocks in the brand colour set it again inside; the site's colours are set once.
    expect(css.match(/--qb-accent: #0f766e;/g)).toHaveLength(1)
  })

  it('ends a prompt too long for its box with an ellipsis, never a sliced letter', () => {
    expect(renderDesignCss(resolveDesign(defaultDesign()))).toContain(
      '[data-portal-theme] input { text-overflow: ellipsis; }'
    )
  })

  it('breaks a word of a headline wider than the screen rather than scroll the page', () => {
    expect(renderDesignCss(resolveDesign(defaultDesign()))).toMatch(
      /\[data-qb-part=headline\] \{[^}]*overflow-wrap: break-word;/
    )
  })

  it('applies the body font and radius under the scope, without !important', () => {
    const css = renderDesignCss(resolveDesign(defaultDesign()))
    expect(css).toContain('[data-portal-theme] body { --font-sans:')
    expect(css).not.toContain('!important')
  })

  it('sets the heading family, in a layer utilities can override, the heading weight and tracking, and headline and label case', () => {
    const doc = defaultDesign()
    doc.brand.fonts.heading = { kind: 'bundled', id: 'fraunces' }
    doc.brand.fonts.headingWeight = 700
    const resolved = resolveDesign(doc)
    expect(resolved.tokens.base['--qb-font-heading']).toBe(
      '"Fraunces", "Fraunces Fallback", ui-serif, Georgia, serif'
    )
    expect(resolved.tokens.base['--qb-heading-weight']).toBe('700')
    const css = renderDesignCss(resolved)
    expect(css).toContain(
      '@layer base { [data-portal-theme] :is(h1, h2, h3) { font-family: var(--qb-font-heading); } [data-portal-theme] :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; } }'
    )
    expect(css).toContain(
      '@layer design.base { [data-portal-theme] { letter-spacing: -0.01em; } [data-portal-theme], [data-portal-theme] :is(button, input, textarea, select) { word-spacing: max(0em, calc(0.22em - var(--qb-body-space))); } [data-portal-theme] :is(h1, h2, h3) { font-weight: var(--qb-heading-weight); letter-spacing: -0.02em; word-spacing: max(0em, calc(0.22em + 0.02em - var(--qb-heading-space))); } [data-portal-theme] [data-qb-part=headline] { font-family: var(--qb-font-display); font-weight: var(--qb-headline-weight); letter-spacing: var(--qb-headline-tracking); word-spacing: max(0em, calc(0.22em - var(--qb-headline-tracking) - var(--qb-display-space))); text-transform: var(--qb-headline-case); overflow-wrap: break-word; } [data-portal-theme] :is([data-qb-part=nav-item], [data-qb-label]) { text-transform: var(--qb-label-case); letter-spacing: max(0em, var(--qb-label-tracking)); } }'
    )
  })
})

describe('a design shown in one mode', () => {
  it('names the dark scope too, so a dark block from another design cannot outrank it', () => {
    const light = renderDesignCss(resolveDesign(withAccent('#ff247d', 'light')))
    expect(light.startsWith('[data-portal-theme], .dark[data-portal-theme] {')).toBe(true)
    // The draft's colours, previewed after the live design's dark block, win the cascade.
    const both = renderDesignCss(resolveDesign(withAccent('#1d4ed8', 'auto')))
    expect(both.startsWith('[data-portal-theme] {')).toBe(true)
    expect(both).toContain('.dark[data-portal-theme] {')
  })
})

describe('blocks in the brand colour', () => {
  it('redraw every part inside in the colour that reads on it, rich text and votes too', () => {
    const css = renderDesignCss(resolveDesign(defaultDesign()))
    const inside = css.slice(css.indexOf('[data-qb-tone=brand] > * {'))
    for (const name of ['--foreground', '--primary', '--qb-accent', '--post-card-voted-color'])
      expect(inside).toContain(`${name}: var(--qb-tone-ink);`)
    expect(inside).toContain('--primary-foreground: var(--qb-tone-fill);')
    expect(css).toContain('[data-qb-tone=brand] .prose { --tw-prose-body: var(--qb-tone-ink);')
    expect(css).toContain('[data-qb-tone=brand] [data-qb-part=vote-button][data-state=voted]')
  })
})

describe('motion under the pointer', () => {
  it('moves nothing for a visitor who asks for less motion', () => {
    const css = renderDesignCss(resolveDesign(defaultDesign()))
    const guard = css.indexOf('@media (prefers-reduced-motion: no-preference)')
    expect(guard).toBeGreaterThan(0)
    for (const motion of ['translateX(3px)', 'transition:'])
      expect(css.indexOf(motion)).toBeGreaterThan(guard)
    // The arrow itself shows either way; only its nudge moves.
    expect(
      css.indexOf(
        "[data-qb-hover=arrow][data-portal-theme] [data-qb-link]::after { content: '\\2192'"
      )
    ).toBeGreaterThan(0)
  })

  it('has no lift of its own: Lift is the element Hover values, drawn once', () => {
    const css = renderDesignCss(resolveDesign(defaultDesign()))
    expect(css).not.toContain('data-qb-hover=lift')
    expect(css).not.toContain('translateY(-2px)')
  })
})
