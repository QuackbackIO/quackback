/**
 * Exact values under the design's choices: each one a design sets replaces
 * what the tiles chose, scales sensibly on a phone, and wins over the card
 * styles; each one it leaves out changes nothing.
 */
import { describe, expect, it } from 'vitest'
import { renderDesignCss, resolveDesign } from '../resolve'
import { defaultDesign, portalDesign } from '../schema'
import { tunedColours, tuneColourCss, tuneCss, tuneHexes, tuneTokens } from '../tune'
import { contrastRatio } from '../contrast'

describe('exact values', () => {
  it('change nothing when a design has none', () => {
    expect(tuneTokens(undefined)).toEqual({})
    expect(tuneCss(undefined)).toBe('')
    expect(renderDesignCss(resolveDesign(defaultDesign()))).not.toContain('--qb-button-height')
  })

  it('set a headline’s exact size, scaled down on a phone, and its own weight, tracking and leading', () => {
    const tokens = tuneTokens({
      headline: { size: 48, weight: 300, tracking: -0.02, leading: 1.15 },
    })
    expect(tokens['--qb-headline-size']).toBe('clamp(28px, 3.333vw, 48px)')
    expect(tokens['--qb-headline-weight']).toBe('300')
    expect(tokens['--qb-headline-tracking']).toBe('-0.02em')
    expect(tokens['--qb-headline-leading']).toBe('1.15')
    // Its line grows with it, so a big headline's line never reads as a caption.
    expect(tokens['--qb-subtitle-size']).toBe('clamp(16px, 1.167vw, 16.8px)')
    expect(tuneTokens({ headline: { size: 104 } })['--qb-subtitle-size']).toBe(
      'clamp(16px, 1.528vw, 22px)'
    )
    // The other pages' titles sit a step below the headline.
    expect(tokens['--qb-page-title-size']).toBe('clamp(24px, 2.067vw, 29.76px)')
  })

  it('never sets a poster headline wider than a phone: its smallest size gives way to the screen', () => {
    // 110px is wider than a word fits on a 390px phone; 14vw there is 55px.
    expect(tuneTokens({ headline: { size: 200 } })['--qb-headline-size']).toBe(
      'clamp(min(110px, 14vw), 13.889vw, 200px)'
    )
  })

  it('keep a tuned heading’s words apart however tight it is set', () => {
    expect(tuneCss({ heading: { tracking: -0.04 } })).toContain(
      'letter-spacing: var(--qb-heading-tracking); word-spacing: max(0em, calc(0.22em - var(--qb-heading-tracking) - var(--qb-heading-space)))'
    )
  })

  it('carry a light heading weight (300 or 400) into the headline and heading CSS', () => {
    for (const weight of [300, 400] as const) {
      const doc = defaultDesign()
      doc.brand.fonts.heading = { kind: 'bundled', id: 'inter-tight' }
      doc.brand.fonts.headingWeight = weight
      const css = renderDesignCss(resolveDesign(doc))
      expect(css).toContain(`--qb-headline-weight: ${weight}`)
      expect(css).toContain(`--qb-heading-weight: ${weight}`)
    }
  })

  it('give headlines the heading weight until a tune gives them their own', () => {
    const doc = defaultDesign()
    expect(renderDesignCss(resolveDesign(doc))).toContain('--qb-headline-weight: 600')
    expect(renderDesignCss(resolveDesign(doc))).toContain(
      '[data-qb-part=headline] { font-family: var(--qb-font-display); font-weight: var(--qb-headline-weight);'
    )
    doc.tune = { headline: { weight: 300 } }
    expect(renderDesignCss(resolveDesign(doc))).toContain('--qb-headline-weight: 300')
  })

  it('set a button’s weight and capitals in both modes, on every primary button', () => {
    const css = tuneCss({ button: { case: 'upper', weight: 600 } })
    expect(css).toContain(
      '[data-portal-theme] :is([data-slot=button][data-variant=default], [data-qb-action]) { font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }'
    )
    expect(css).not.toContain(':not(.dark)')
  })

  it('size section headings, labels and buttons only when tuned', () => {
    const css = tuneCss({
      heading: { size: 32 },
      label: { weight: 500 },
      button: { height: 40, radius: 4 },
    })
    expect(css).toContain(
      '[data-portal-theme] [data-qb-part=section-heading] { font-size: var(--qb-heading-size); }'
    )
    expect(css).toContain('[data-qb-action]) { font-weight: var(--qb-label-weight); }')
    expect(css).toContain('min-height: var(--qb-button-height)')
    expect(tuneTokens({ button: { radius: 4 } })['--qb-radius-button']).toBe('4px')
  })

  it('keep a tall button in the header to a sane height, inset from its edges', () => {
    const css = tuneCss({ button: { height: 60 } })
    expect(css).toContain(
      '[data-portal-theme] .portal-header :is([data-slot=button][data-variant=default], [data-qb-action]) { min-height: min(var(--qb-button-height), 2.5rem); padding-inline: calc(min(var(--qb-button-height), 2.5rem) * 0.45); }'
    )
  })

  it('draw cards exactly, after the card styles and at their weight, so the tune wins', () => {
    const doc = defaultDesign()
    doc.layout.cards = 'raised'
    doc.tune = { card: { radius: 6, border: 0, shadow: 'none' } }
    const css = renderDesignCss(resolveDesign(doc))
    const rule =
      '[data-qb-cards][data-portal-theme] [data-qb-surface=card] { border-radius: var(--qb-radius-card); border-width: 0px; }'
    expect(css).toContain(rule)
    expect(css.indexOf(rule)).toBeGreaterThan(
      css.indexOf('[data-qb-cards=raised][data-portal-theme]')
    )
  })

  it('float cards on a deep, soft shadow, reaching further than lifted', () => {
    const reach = (shadow: 'soft' | 'lifted' | 'floating' | 'deep') => {
      const css = tuneCss({ card: { shadow } })
      const first = /box-shadow: 0 (\d+)px (\d+)px(?: (-?\d+)px)?/.exec(css)!
      const [y, blur, spread] = first.slice(1).map((v) => Number(v ?? 0)) as [
        number,
        number,
        number,
      ]
      return y + blur / 2 + spread
    }
    expect(reach('deep')).toBeGreaterThan(2 * reach('floating'))
    expect(reach('floating')).toBeGreaterThan(reach('lifted'))
    expect(reach('lifted')).toBeGreaterThan(reach('soft'))
    expect(
      portalDesign.safeParse({ ...defaultDesign(), tune: { card: { shadow: 'floating' } } }).success
    ).toBe(true)
  })

  it('refuse values outside what any page can carry', () => {
    const doc = defaultDesign()
    expect(portalDesign.safeParse({ ...doc, tune: { headline: { size: 48 } } }).success).toBe(true)
    expect(portalDesign.safeParse({ ...doc, tune: { headline: { size: 900 } } }).success).toBe(
      false
    )
    expect(portalDesign.safeParse({ ...doc, tune: { button: { height: 4 } } }).success).toBe(false)
    expect(portalDesign.safeParse({ ...doc, tune: { card: { glow: 1 } } }).success).toBe(false)
  })
})

describe('exact colours', () => {
  const page = { background: '#ffffff', band: [], mixed: false }

  it('colour headlines and section headings where they read, in light mode', () => {
    const css = tuneColourCss(
      { headline: { colour: '#163300' }, heading: { colour: '#163300' } },
      { background: '#ffffff', band: ['#9fe870'], mixed: false }
    )
    expect(css).toContain(
      '[data-portal-theme]:not(.dark) [data-qb-part=headline] { color: #163300; }'
    )
    expect(css).toContain('[data-qb-part=section-heading] { color: #163300; }')
  })

  it('move a section heading colour until it reads at body size, keeping its hue', () => {
    // 4.2:1 is large text's, not a phone's 16px heading's.
    const surface = { background: '#fffaf1', band: [], mixed: false }
    const [tuned] = tunedColours({ heading: { colour: '#b4642b' } }, surface)
    expect(tuned).toMatchObject({ part: 'Section headings', set: '#b4642b' })
    expect(tuned!.used).not.toBe('#b4642b')
    expect(contrastRatio(tuned!.used!, '#fffaf1')).toBeGreaterThanOrEqual(4.5)
    expect(tuneColourCss({ heading: { colour: '#b4642b' } }, surface)).toContain(
      `[data-qb-part=section-heading] { color: ${tuned!.used}; }`
    )
  })

  it('move a headline colour until it reads, and leave out one no shade of which reads', () => {
    const [moved] = tunedColours({ headline: { colour: '#f0f0f0' } }, page)
    expect(contrastRatio(moved!.used!, '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(tuneColourCss({ headline: { colour: '#f0f0f0' } }, page)).not.toContain('#f0f0f0')
    // Dark on the white page, it cannot also read on a navy band.
    const band = { background: '#ffffff', band: ['#0b1020'], mixed: false }
    expect(tunedColours({ headline: { colour: '#163300' } }, band)[0]!.used).toBeNull()
    expect(tuneColourCss({ headline: { colour: '#163300' } }, band)).toBe('')
    // No one colour reads across a blend or an image.
    expect(
      tuneColourCss(
        { headline: { colour: '#163300' } },
        { background: '#ffffff', band: [], mixed: true }
      )
    ).toBe('')
  })

  it('fill buttons exactly, with their own label where it reads and the fill’s best label where not', () => {
    expect(
      tuneColourCss(
        { button: { fill: '#163300', ink: '#9fe870', case: 'upper', weight: 600 } },
        page
      )
    ).toContain(
      ':is([data-slot=button][data-variant=default], [data-qb-action]) { background-color: #163300; color: #9fe870; }'
    )
    expect(tuneColourCss({ button: { fill: '#163300', ink: '#1f3f10' } }, page)).toContain(
      'background-color: #163300; color: #ffffff'
    )
  })

  it('keep the band’s button in the second colour, when the design asks', () => {
    expect(tuneColourCss({ button: { fill: '#163300' } }, page)).toContain(
      ':is([data-qb-band-action=support], [data-qb-band-action=accent]) [data-qb-action] { background-color: var(--qb-action-bg);'
    )
  })

  it('change nothing without a light page', () => {
    expect(tuneColourCss({ headline: { colour: '#163300' } }, null)).toBe('')
  })
})

describe('a headline colour on a band of more than one colour', () => {
  it('applies where the words sit on one colour, such as the page under a mesh', () => {
    const doc = defaultDesign()
    doc.mode = 'light'
    doc.layout.hero = 'blend'
    doc.layout.blend = 'mesh'
    doc.tune = { headline: { colour: '#163300' } }
    expect(renderDesignCss(resolveDesign(doc))).toContain(
      '[data-qb-part=headline] { color: #163300; }'
    )
  })
})

describe('links, secondary buttons, body text and card titles', () => {
  it('style each where a tune sets it, and nothing where it does not', () => {
    expect(tuneCss({ link: { underline: 'hover', weight: 600 } })).toContain(
      ':is(.prose a, [data-qb-link]) { font-weight: 600; text-decoration-line: none; text-underline-offset: 0.15em; }'
    )
    expect(tuneCss({ link: { underline: 'hover' } })).toContain(
      ':is(.prose a, [data-qb-link]):hover { text-decoration-line: underline; }'
    )
    expect(tuneCss({ secondary: { style: 'tint' } })).toContain('[data-variant=outline]')
    expect(tuneCss({ body: { size: 18, leading: 1.6 } })).toContain(
      '[data-qb-part=post-excerpt]) { font-size: 18px; line-height: 1.6; }'
    )
    expect(tuneCss({ card: { titleWeight: 500 } })).toContain(
      '[data-qb-part=post-title] { font-weight: 500; }'
    )
    expect(tuneTokens({ card: { titleSize: 17 } })['--qb-title-size']).toBe('17px')
    expect(tuneCss({ card: { radius: 4 } })).not.toContain('post-title')
  })

  it('colour links where they read, never inside a block in the brand colour', () => {
    const page = { background: '#ffffff', band: [], mixed: false }
    const css = tuneColourCss({ link: { colour: '#1d4ed8' } }, page)
    expect(css).toContain(
      ':is(.prose a, [data-qb-link]):not([data-qb-tone=brand] *) { color: #1d4ed8; }'
    )
  })
})

describe('the subtitle', () => {
  it('takes its own size, scaled down on a phone, over the one the headline gives it', () => {
    const tokens = tuneTokens({ headline: { size: 100 }, subtitle: { size: 20 } })
    expect(tokens['--qb-subtitle-size']).toBe('clamp(16px, 1.389vw, 20px)')
    expect(tuneTokens({ subtitle: { weight: 500 } })['--qb-subtitle-size']).toBeUndefined()
    expect(tuneCss({ subtitle: { weight: 500 } })).toContain(
      '[data-portal-theme] [data-qb-part=subtitle] { font-weight: 500; }'
    )
  })

  it('takes its own colour where it reads on the band, as body text does', () => {
    const surface = { background: '#ffffff', band: ['#ffdb00'], mixed: false }
    const [subtitle] = tunedColours({ subtitle: { colour: '#9ca3af' } }, surface)
    expect(subtitle!.part).toBe('Subtitle')
    expect(contrastRatio(subtitle!.used!, '#ffdb00')).toBeGreaterThanOrEqual(4.5)
    expect(tuneColourCss({ subtitle: { colour: '#9ca3af' } }, surface)).toContain(
      `[data-portal-theme]:not(.dark) [data-qb-part=subtitle] { color: ${subtitle!.used}; }`
    )
    expect(tunedColours({ subtitle: { colour: '#9ca3af' } }, { ...surface, mixed: true })).toEqual(
      []
    )
  })
})

describe('exact colours by brand role', () => {
  const withTune = (tune: Record<string, unknown>) =>
    portalDesign.parse({
      ...defaultDesign(),
      brand: {
        ...defaultDesign().brand,
        light: { ...defaultDesign().brand.light, accent: '#b0123a', ink: '#1a1a2e' },
      },
      tune,
    })

  it('takes a role as well as a hex, and nothing else', () => {
    expect(withTune({ headline: { colour: 'accent' } }).tune?.headline?.colour).toBe('accent')
    expect(withTune({ button: { fill: 'ink', ink: 'page' } }).tune?.button).toEqual({
      fill: 'ink',
      ink: 'page',
    })
    expect(withTune({ link: { colour: '#0f766e' } }).tune?.link?.colour).toBe('#0f766e')
    expect(() => withTune({ link: { colour: 'teal' } })).toThrow()
  })

  it('draws a role as the brand colour it names, and follows the brand when it changes', () => {
    const byRole = withTune({ headline: { colour: 'accent' }, button: { fill: 'ink' } })
    const byHex = withTune({ headline: { colour: '#b0123a' }, button: { fill: '#1a1a2e' } })
    expect(resolveDesign(byRole).tuneCss).toBe(resolveDesign(byHex).tuneCss)
    expect(tuneHexes(byRole)).toEqual({
      headline: { colour: '#b0123a' },
      button: { fill: '#1a1a2e' },
    })
    const moved = structuredClone(byRole)
    moved.brand.light.accent = '#0f766e'
    expect(tuneHexes(moved)?.headline?.colour).toBe('#0f766e')
  })

  it('draws a second colour the brand has not got as the brand colour', () => {
    expect(tuneHexes(withTune({ link: { colour: 'support' } }))?.link?.colour).toBe('#b0123a')
  })

  it('leaves a tune with hex colours alone, so it draws exactly as before', () => {
    const doc = withTune({ headline: { colour: '#123456', size: 40 } })
    expect(tuneHexes(doc)).toBe(doc.tune)
    expect(tuneHexes(defaultDesign())).toBeUndefined()
  })
})
