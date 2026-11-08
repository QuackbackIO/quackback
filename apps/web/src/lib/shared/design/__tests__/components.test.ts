/**
 * Component tokens and structural attributes. The default design reproduces
 * the values the portal hard-codes today, so a converted workspace keeps its
 * header, menu and cards; every other option changes them through tokens,
 * and structure through `data-qb-*` attributes on `<html>`.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio, overlay } from '../contrast'
import { BAND_FADE, BAND_TINT, layoutAttributes, PORTAL_ALIASES } from '../components'
import { VOTED_TINT } from '../voted'
import { LOGO_FILTER } from '../logo'
import { blendHue, mixColor, tintOf } from '../color'
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { renderDesignCss, resolveDesign } from '../resolve'
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
      '--qb-headline-tracking': '-0.02em',
      '--qb-headline-case': 'none',
      '--qb-label-case': 'none',
      '--qb-label-tracking': '0em',
    })
  })

  it('names each face’s word space, so a narrow one is widened to read', () => {
    const { tokens } = resolveDesign(
      design((d) => {
        d.brand.fonts.body = { kind: 'bundled', id: 'jakarta' }
        d.brand.fonts.heading = { kind: 'bundled', id: 'archivo' }
      })
    )
    expect(tokens.base).toMatchObject({
      '--qb-body-space': '0.165em',
      '--qb-heading-space': '0.196em',
      '--qb-display-space': '0.196em',
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
      '--qb-headline-tracking': '-0.03em',
      '--qb-headline-case': 'uppercase',
      '--qb-label-case': 'uppercase',
      '--qb-label-tracking': '0.06em',
    })
  })

  it('keeps every headline well above the cards and below a poster', () => {
    const { tokens } = resolveDesign(design())
    // A floor that also clears the subtitle under it, and a ceiling for the widest screens.
    expect(tokens.base['--qb-headline-floor']).toBe(
      'max(clamp(1.875rem, 1.45rem + 1.4vw, 2.5rem), calc(var(--qb-subtitle-size, 1rem) * 1.4))'
    )
    expect(tokens.base['--qb-headline-cap']).toBe('7.5rem')
  })

  it('lets an upper-case headline fit fewer letters to a line', () => {
    const plain = resolveDesign(design()).tokens.base['--qb-headline-measure']
    const upper = resolveDesign(design((d) => (d.brand.fonts.headlineCase = 'upper'))).tokens.base[
      '--qb-headline-measure'
    ]
    expect(Number(upper)).toBeLessThan(Number(plain))
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

describe('buttons’ own shape', () => {
  it('follows the corners until it is set', () => {
    const { base } = resolveDesign(design((d) => (d.shape.corners = 'subtle'))).tokens
    expect(base['--qb-radius-button']).toBe(base['--qb-radius-control'])
    expect(base['--qb-radius-composer']).toBe(base['--qb-radius-field'])
  })

  it('squares or rounds buttons, and the composer with them, whatever the corners', () => {
    const square = resolveDesign(
      design((d) => {
        d.shape.corners = 'rounded'
        d.shape.buttons = 'square'
      })
    ).tokens.base
    expect([square['--qb-radius-button'], square['--qb-radius-composer']]).toEqual(['0rem', '0rem'])
    expect(square['--qb-radius-panel']).toBe('0.75rem')
    const pill = resolveDesign(design((d) => (d.shape.buttons = 'pill'))).tokens.base
    expect([pill['--qb-radius-button'], pill['--qb-radius-composer']]).toEqual(['999px', '1.75rem'])
  })

  it('names the status style', () => {
    expect(layoutAttributes(design((d) => (d.layout.status = 'pill')))['data-qb-status']).toBe(
      'pill'
    )
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
    // Mixed in oklab, through the vivid colour between the two rather than a grey.
    const between = blendHue('#4a1942', '#e58fae', 0.5)
    expect(light['--qb-band-bg']).toBe(
      `linear-gradient(in oklab 110deg, #4a1942 0%, ${between} 50%, #e58fae 100%)`
    )
    const ink = light['--qb-band-ink']!
    expect(contrastRatio(ink, '#4a1942')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ink, between)).toBeGreaterThanOrEqual(4.5)
  })

  it('refuses a blend that no text reads across', () => {
    const doc = design((d) => {
      d.brand.light.accent = '#22c55e'
      d.brand.light.support = '#1e1b4b'
      d.layout.band = 'blend'
    })
    expect(resolveDesign(doc).errors).toEqual([
      'light: no text reaches 4.5:1 across the hero',
      'dark: no text reaches 4.5:1 across the hero',
    ])
  })

  it('blends the two as a mesh beside the words, the page under them, and in the corners on phones', () => {
    const { light } = withSupport('blend', (d) => (d.layout.blend = 'mesh')).tokens
    const page = resolveDesign(design()).light!
    // The deep plum is veiled until the near-black headline reads on it; the pink reads as it is.
    const plum = /linear-gradient\(in oklab \d+deg, (#[\da-f]{6}) /.exec(
      light['--qb-band-bg']!
    )![1]!
    expect(plum).not.toBe('#4a1942')
    expect(contrastRatio(page.foreground!, plum)).toBeGreaterThanOrEqual(3)
    expect(light['--qb-band-bg']).toContain('#e58fae')
    // The page's colour runs under the words, past the subtitle's measure.
    expect(light['--qb-band-bg']).toMatch(/^linear-gradient\(90deg, \S+ calc\(.+? \+ 42rem\)/)
    expect(light['--qb-band-bg']!.endsWith(`, ${page.background}`)).toBe(true)
    // Phones keep the colour, inside the band, on the page's colour.
    expect(light['--qb-band-bg-narrow']).toMatch(/^radial-gradient\(ellipse /)
    expect(light['--qb-band-bg-narrow']).toContain('linear-gradient(in oklab ')
    expect(light['--qb-band-bg-narrow']!.endsWith(`, ${page.background}`)).toBe(true)
    expect(light['--qb-band-ink']).toBe(page.foreground)
  })

  it('works out the words’ own colours on a mesh’s phone glows too, which the words cross there', () => {
    const resolved = resolveDesign(
      design((d) => {
        d.brand.light.accent = '#4a1942'
        d.brand.light.support = '#e58fae'
        d.layout.band = 'blend'
        d.layout.blend = 'mesh'
        d.tune = { subtitle: { colour: '#9a9a9a' } }
      })
    )
    const narrow = resolved.tokens.light['--qb-band-bg-narrow']!
    const field = /linear-gradient\(in oklab [^)]+\)/.exec(narrow)![0]
    const phone = [...field.matchAll(/(#[\da-f]{6}) \d+%/g)].map(([, colour]) => colour!)
    expect(phone).toHaveLength(3)
    const subtitle = resolved.tuned.find((tuned) => tuned.part === 'Subtitle')!
    for (const glow of phone) {
      expect(contrastRatio(subtitle.used!, glow)).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(resolved.tokens.light['--qb-band-accent']!, glow)
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('blends the two as a diagonal ribbon beside the words, on the page under them', () => {
    const { light } = withSupport('blend', (d) => (d.layout.blend = 'ribbon')).tokens
    const page = resolveDesign(design()).light!
    expect(light['--qb-band-bg']).toMatch(/^linear-gradient\(\d+deg, /)
    expect(light['--qb-band-bg']).toContain('#4a1942')
    expect(light['--qb-band-bg']).toContain('#e58fae')
    // The ribbon starts past the words and runs back to the page colour.
    expect(light['--qb-band-bg']).toMatch(new RegExp(`${page.background} \\d+%\\)$`))
    expect(light['--qb-band-bg-narrow']).toBe(page.background)
    expect(light['--qb-band-ink']).toBe(page.foreground)
    // Whatever the colours, the words sit on the page: a ribbon is always readable.
    const loud = design((d) => {
      d.brand.light.accent = '#22c55e'
      d.brand.light.support = '#1e1b4b'
      d.layout.band = 'blend'
      d.layout.blend = 'ribbon'
    })
    expect(resolveDesign(loud).errors).toEqual([])
  })

  it('runs a blend into the hero colour where one is chosen', () => {
    const { light } = withSupport('blend', (d) => {
      d.brand.light.extra = ['#14c850']
      d.layout.bandColour = 'extra1'
    }).tokens
    expect(light['--qb-band-bg']).toBe(
      `linear-gradient(in oklab 110deg, #4a1942 0%, ${blendHue('#4a1942', '#14c850', 0.5)} 50%, #14c850 100%)`
    )
    const mesh = withSupport('blend', (d) => {
      d.brand.light.extra = ['#14c850']
      d.layout.bandColour = 'extra1'
      d.layout.blend = 'mesh'
    }).tokens.light
    expect(mesh['--qb-band-bg']).toContain('#14c850')
    expect(mesh['--qb-band-bg']).not.toContain('#e58fae')
  })

  it('keeps the page under centred words in a mesh, the colours around them', () => {
    const { light } = withSupport('blend', (d) => {
      d.layout.blend = 'mesh'
      d.layout.bandAlign = 'centre'
    }).tokens
    const page = resolveDesign(design()).light!
    expect(light['--qb-band-bg']).toMatch(
      new RegExp(`^radial-gradient\\(ellipse [^,]+ at 50% \\d+%, ${page.background} \\d+%`)
    )
    expect(light['--qb-band-bg']).toContain('#e58fae')
    expect(light['--qb-band-ink']).toBe(page.foreground)
  })

  it('fades a ribbon in and out softly, over a wide span', () => {
    const { light } = withSupport('blend', (d) => (d.layout.blend = 'ribbon')).tokens
    const stops = [
      ...light['--qb-band-bg']!.matchAll(/(#[0-9a-f]{6}|oklch\([^)]*\)|rgb\([^)]*\)) (\d+)%/g),
    ].map((m) => [m[1], Number(m[2])] as const)
    const ribbon = stops.slice(1)
    const at = (c: string) => ribbon.find(([colour]) => colour === c)![1]
    // From the page to the full brand colour, and from the second back to the page, takes a fifth of the run or more.
    expect(at('#4a1942') - ribbon[0]![1]).toBeGreaterThanOrEqual(18)
    expect(ribbon.at(-1)![1] - at('#e58fae')).toBeGreaterThanOrEqual(18)
  })

  it('highlights in a pale second colour as it is', () => {
    const { light } = resolveDesign(
      design((d) => {
        d.brand.light.support = '#fdecc8'
        d.layout.band = 'none'
      })
    ).tokens
    expect(light['--qb-band-highlight']).toBe('#fdecc8')
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

describe('a panel in the band', () => {
  it('is the second colour, else the card colour, with readable words', () => {
    const plain = resolveDesign(
      design((d) => {
        d.layout.band = 'brand'
        d.layout.bandShape = 'panel'
      })
    )
    expect(plain.tokens.light['--qb-band-panel-bg']).toBe(plain.light!.card)
    const yellow = resolveDesign(
      design((d) => {
        d.brand.light.accent = '#0058a3'
        d.brand.light.support = '#ffdb00'
        d.layout.band = 'brand'
        d.layout.bandShape = 'panel'
      })
    ).tokens.light
    expect(yellow['--qb-band-panel-bg']).toBe('#ffdb00')
    for (const text of ['--qb-band-panel-ink', '--qb-band-panel-muted'] as const)
      expect(contrastRatio(yellow[text]!, '#ffdb00')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(yellow['--qb-band-panel-accent']!, '#ffdb00')).toBeGreaterThanOrEqual(3)
  })
})

describe('the headline’s colour', () => {
  it('colours the headline with the band’s accent, which reads on the band', () => {
    expect(layoutAttributes(design())['data-qb-headline']).toBe('ink')
    expect(
      layoutAttributes(design((d) => (d.brand.fonts.headlineColour = 'accent')))['data-qb-headline']
    ).toBe('accent')
  })
})

describe('the second colour at work', () => {
  const petal = (change: (d: PortalDesign) => void) =>
    resolveDesign(
      design((d) => {
        d.mode = 'light'
        d.brand.light.accent = '#4a1942'
        d.brand.light.support = '#e58fae'
        change(d)
      })
    )

  it('makes the band’s call to action, with text that reads on it', () => {
    const { light } = petal((d) => (d.shape.action = 'support')).tokens
    expect(light['--qb-action-bg']).toBe('#e58fae')
    expect(contrastRatio(light['--qb-action-ink']!, '#e58fae')).toBeGreaterThanOrEqual(4.5)
    const accent = petal(() => {})
    expect(accent.tokens.light['--qb-action-bg']).toBe(accent.light!.primary)
  })

  it('tints the vote box and the current menu item when the design asks', () => {
    const resolved = petal((d) => (d.layout.tint = 'support'))
    const { light } = resolved.tokens
    const { c, h } = parseOklch(hexToOklch(light['--qb-support-tint']!))!
    expect(c).toBeGreaterThan(0.01)
    expect(h > 330 || h < 20).toBe(true)
    expect(
      contrastRatio(light['--qb-nav-active-ink']!, light['--qb-nav-active-bg']!)
    ).toBeGreaterThanOrEqual(4.5)
    const tinted = design((d) => {
      d.brand.light.support = '#e58fae'
      d.layout.tint = 'support'
    })
    expect(layoutAttributes(tinted)['data-qb-tint']).toBe('support')
    expect(petal(() => {}).tokens.light['--qb-support-tint']).toBeUndefined()
  })
})

describe('band art and image focus', () => {
  it('draws art only on a band with colour, and steps aside for an image behind the words', () => {
    const hills = design((d) => {
      d.layout.band = 'tint'
      d.layout.bandArt = 'hills'
    })
    expect(resolveDesign(hills).tokens.light['--qb-band-art']).toMatch(
      /^url\("data:image\/svg\+xml,/
    )
    expect(layoutAttributes(hills)['data-qb-band-art']).toBe('edge')
    expect(layoutAttributes(design((d) => (d.layout.bandArt = 'dots')))['data-qb-band-art']).toBe(
      'none'
    )
    hills.brand.bandImage = { key: 'portal-images/a.jpg' }
    expect(layoutAttributes(hills)['data-qb-band-art']).toBe('edge')
    hills.layout.imagePlace = 'cover'
    expect(layoutAttributes(hills)['data-qb-band-art']).toBe('none')
    hills.layout.bandArt = 'petals'
    hills.layout.imagePlace = 'side'
    expect(layoutAttributes(hills)['data-qb-band-art']).toBe('tile')
  })

  it('crops images toward the focus the design gives', () => {
    expect(resolveDesign(design()).tokens.base['--qb-image-focus']).toBe('center')
    expect(
      resolveDesign(design((d) => (d.layout.imageFocus = 'right'))).tokens.base['--qb-image-focus']
    ).toBe('right')
  })

  it('crops toward an exact focal point, over the side it keeps', () => {
    const doc = design((d) => {
      d.layout.imageFocus = 'left'
      d.layout.imagePoint = { x: 30, y: 15 }
    })
    expect(resolveDesign(doc).tokens.base['--qb-image-focus']).toBe('30% 15%')
    // The side still shapes a side image.
    expect(resolveDesign(doc).tokens.base['--qb-image-aspect']).toBe('4 / 5')
  })

  it('leaves the image off on phones where the design asks', () => {
    expect(layoutAttributes(design())['data-qb-image-phone']).toBe('show')
    expect(
      layoutAttributes(design((d) => (d.layout.imagePhone = 'hide')))['data-qb-image-phone']
    ).toBe('hide')
  })

  it('splits a panel with its image inside, only with a side image', () => {
    const split = design((d) => {
      d.layout.band = 'brand'
      d.layout.bandShape = 'split'
    })
    expect(layoutAttributes(split)['data-qb-band-shape']).toBe('inset')
    split.brand.bandImage = { key: 'portal-images/a.jpg' }
    expect(layoutAttributes(split)['data-qb-band-shape']).toBe('split')
    split.layout.imagePlace = 'cover'
    expect(layoutAttributes(split)['data-qb-band-shape']).toBe('inset')
  })
})

describe('the hero’s call to action in the brand colour', () => {
  it('marks the band’s button for the brand colour while the other buttons are ink', () => {
    const doc = design((d) => {
      d.shape.fill = 'ink'
      d.shape.action = 'accent'
    })
    expect(layoutAttributes(doc)['data-qb-band-action']).toBe('accent')
    const css = renderDesignCss(resolveDesign(doc))
    expect(css).toContain(
      '[data-qb-fill=ink]:is([data-qb-band-action=support], [data-qb-band-action=accent])[data-portal-theme] [data-qb-action]'
    )
    expect(resolveDesign(doc).tokens.light['--qb-action-bg']).toBe(
      resolveDesign(doc).light!.primary
    )
  })

  it('leaves the band’s button as the others by default', () => {
    expect(layoutAttributes(design(() => {}))['data-qb-band-action']).toBe('buttons')
  })
})

describe('a logo image that would vanish on its header', () => {
  const tokens = (change: (d: PortalDesign) => void, mode: 'light' | 'dark' = 'light') =>
    resolveDesign(design(change)).tokens[mode]
  const filter = (change: (d: PortalDesign) => void, mode: 'light' | 'dark' = 'light') =>
    tokens(change, mode)['--qb-logo-filter']

  it('never sits on a plate', () => {
    for (const tone of ['dark', 'light'] as const)
      for (const mode of ['light', 'dark'] as const)
        expect(tokens((d) => (d.brand.logo.tone = tone), mode)).not.toHaveProperty('--qb-logo-tile')
  })

  it('draws a logo of one ink reversed, in the header’s text colour, where it would vanish', () => {
    const black = (d: PortalDesign) => {
      d.brand.logo.tone = 'dark'
      d.brand.logo.oneInk = true
    }
    expect(filter(black, 'dark')).toBe(`url(#${LOGO_FILTER.reverse})`)
    // On a light header it reads as it is.
    expect(filter(black)).toBe('none')
    const white = (d: PortalDesign) => {
      d.brand.logo.tone = 'light'
      d.brand.logo.oneInk = true
    }
    expect(filter(white)).toBe(`url(#${LOGO_FILTER.reverse})`)
    expect(filter(white, 'dark')).toBe('none')
  })

  it('lifts only the dark ink of a logo of several colours, keeping its colours', () => {
    const multi = (d: PortalDesign) => (d.brand.logo.tone = 'dark')
    expect(filter(multi, 'dark')).toBe(`url(#${LOGO_FILTER.lift})`)
    expect(filter(multi)).toBe('none')
    // On a dark band in light mode too.
    const onBand = (d: PortalDesign) => {
      d.brand.logo.tone = 'dark'
      d.brand.light.accent = '#163300'
      d.layout.band = 'brand'
      d.layout.headerOnBand = true
    }
    expect(filter(onBand)).toBe(`url(#${LOGO_FILTER.lift})`)
    expect(filter((d) => (d.brand.logo.tone = 'light'))).toBe(`url(#${LOGO_FILTER.sink})`)
  })

  it('draws a coloured logo of one ink in the header’s text where the header is its own colour', () => {
    const teal = (d: PortalDesign) => {
      d.brand.logo.oneInk = true
      d.brand.logo.ink = '#00ccbc'
      d.brand.light.accent = '#00ccbc'
      d.layout.band = 'brand'
      d.layout.headerOnBand = true
    }
    expect(filter(teal)).toBe(`url(#${LOGO_FILTER.ink})`)
    // On a plain light header, and on the dark one, it reads in its own colour.
    const plain = (d: PortalDesign) => {
      d.brand.logo.oneInk = true
      d.brand.logo.ink = '#00ccbc'
    }
    expect(filter(plain)).toBe('none')
    expect(filter(plain, 'dark')).toBe('none')
    // A logo of several colours is never drawn in one.
    expect(
      filter((d) => {
        teal(d)
        d.brand.logo.oneInk = false
      })
    ).toBe('none')
  })

  it('leaves a logo whose ink was not measured, and a dark mode logo of its own, as they are', () => {
    expect(filter(() => {}, 'dark')).toBe('none')
    const ownDark = (d: PortalDesign) => {
      d.brand.logo.tone = 'dark'
      d.brand.logo.display = 'wordmark'
      d.brand.logo.wordmark = { light: { key: 'a.png' }, dark: { key: 'b.png' } }
    }
    expect(filter(ownDark, 'dark')).toBe('none')
  })
})

describe('a header on the band', () => {
  const onBand = (change: (d: PortalDesign) => void) =>
    resolveDesign(
      design((d) => {
        d.layout.headerOnBand = true
        change(d)
      })
    ).tokens.light

  it('takes the band’s colour and text, with no rule under it', () => {
    const tokens = onBand((d) => {
      d.brand.light.accent = '#163300'
      d.brand.light.support = '#9fe870'
      d.layout.band = 'support'
    })
    expect(tokens['--qb-header-bg']).toBe('#9fe870')
    expect(tokens['--qb-header-ink']).toBe(tokens['--qb-band-ink'])
    expect(tokens['--qb-header-rule']).toBe('transparent')
    expect(contrastRatio(tokens['--qb-nav-ink']!, '#9fe870')).toBeGreaterThanOrEqual(4.5)
    // The brand colour still reads as a button on the band.
    expect(tokens['--qb-header-action-bg']).toBe('#163300')
  })

  it('shares one surface with a gradient hero: the band’s own background, sized over both', () => {
    for (const blend of ['linear', 'mesh', 'ribbon'] as const) {
      const doc = design((d) => {
        d.layout.headerOnBand = true
        d.brand.light.accent = '#4a1942'
        d.brand.light.support = '#e58fae'
        d.layout.band = 'blend'
        d.layout.blend = blend
      })
      expect(layoutAttributes(doc)['data-qb-header-span']).toBe('on')
      for (const mode of ['light', 'dark'] as const) {
        const tokens = resolveDesign(doc).tokens[mode]
        // One gradient behind both, never a solid header over a gradient band.
        expect(tokens['--qb-header-surface']).toBe(tokens['--qb-band-bg'])
        expect(tokens['--qb-header-surface']).toMatch(/gradient/)
        expect(tokens['--qb-header-surface-narrow']).toBe(
          tokens['--qb-band-bg-narrow'] ?? tokens['--qb-band-bg']
        )
        // The header's text reads wherever the header can sit on it, or the page holds under the header.
        const ink = tokens['--qb-header-ink']!
        expect(contrastRatio(ink, tokens['--qb-header-bg']!)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps the page under the header where no ink reads across the colours it spans', () => {
    const tokens = onBand((d) => {
      d.brand.light.accent = '#22c55e'
      d.brand.light.support = '#1e1b4b'
      d.layout.band = 'blend'
      d.layout.blend = 'mesh'
    })
    expect(tokens['--qb-header-surface']).toMatch(
      /^linear-gradient\(to bottom, \S+ var\(--portal-header-height/
    )
    expect(tokens['--qb-header-surface']).toBe(tokens['--qb-band-bg'])
  })

  it('a solid band, a set-in band or one with art keeps the header in its colour, unspanned', () => {
    const attr = (change: (d: PortalDesign) => void) =>
      layoutAttributes(
        design((d) => {
          d.layout.headerOnBand = true
          d.layout.band = 'blend'
          change(d)
        })
      )['data-qb-header-span']
    expect(attr((d) => (d.layout.band = 'brand'))).toBe('off')
    expect(attr((d) => (d.layout.bandShape = 'inset'))).toBe('off')
    expect(attr((d) => (d.layout.bandArt = 'dots'))).toBe('off')
    expect(attr((d) => (d.layout.headerOnBand = false))).toBe('off')
    expect(attr(() => {})).toBe('on')
  })

  it('turns its button to the band’s text where the brand colour would vanish', () => {
    const tokens = onBand((d) => {
      d.brand.light.accent = '#0f766e'
      d.layout.band = 'brand'
    })
    expect(tokens['--qb-header-bg']).toBe(tokens['--qb-band-bg'])
    expect(tokens['--qb-header-action-bg']).toBe(tokens['--qb-band-ink'])
    expect(
      contrastRatio(tokens['--qb-header-action-ink']!, tokens['--qb-header-action-bg']!)
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('leaves the header alone on a band with no colour', () => {
    const tokens = onBand(() => {})
    expect(tokens['--qb-header-bg']).toBe(resolveDesign(design()).tokens.light['--qb-header-bg'])
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
        tintOf(resolved[mode]!.primary!, resolved[mode]!.background!, BAND_TINT)
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

  it('keeps a deep brand colour’s hue over a warm page, rather than turning grey', () => {
    const { tokens } = resolveDesign(
      design((d) => {
        d.mode = 'light'
        d.layout.band = 'tint'
        d.brand.light.accent = '#1f4d3a'
        d.brand.light.background = '#f3ead8'
      })
    )
    const { c, h } = parseOklch(hexToOklch(tokens.light['--qb-band-bg']!))!
    expect(c).toBeGreaterThan(0.02)
    expect(h).toBeGreaterThan(130)
    expect(h).toBeLessThan(180)
  })

  it('fades from a tint of the brand colour into the page', () => {
    const resolved = resolveDesign(design((d) => (d.layout.band = 'fade')))
    const { primary, background } = resolved.light!
    expect(resolved.tokens.light['--qb-band-bg']).toBe(
      `linear-gradient(to bottom, ${tintOf(primary!, background!, BAND_FADE)}, ${background})`
    )
  })
})

describe('the voted state', () => {
  it('uses accent text, moved only as far as reading on its own tint needs', () => {
    const doc = design((d) => (d.brand.light.accent = '#facc15'))
    const resolved = resolveDesign(doc)
    for (const mode of ['light', 'dark'] as const) {
      const ink = resolved.tokens[mode]['--qb-vote-active']
      const accent = resolved[mode]!.accentInk!
      const tint = overlay(accent, String(resolved[mode]!.card), VOTED_TINT)
      if (contrastRatio(accent, tint) >= 4.5) expect(ink, mode).toBe(accent)
      else expect(ink, mode).not.toBe(accent)
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

  it('leaves the current page unfilled and unlined for plain, marked by ink and weight alone', () => {
    const { tokens } = resolveDesign(design((d) => (d.layout.nav = 'plain')))
    expect(tokens.light['--qb-nav-active-bg']).toBe('transparent')
    expect(tokens.base['--qb-nav-radius']).not.toBe('999px')
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

describe('menu text', () => {
  it('draws the other pages in the text colour when asked, in both modes', () => {
    const { tokens, light, dark } = resolveDesign(design((d) => (d.layout.navText = 'ink')))
    expect(tokens.light['--qb-nav-ink']).toBe(light!.foreground)
    expect(tokens.dark['--qb-nav-ink']).toBe(dark!.foreground)
  })

  it('keeps the softer grey when left out or muted', () => {
    const grey = resolveDesign(design()).tokens.light['--qb-nav-ink']
    const muted = resolveDesign(design((d) => (d.layout.navText = 'muted'))).tokens.light
    expect(muted['--qb-nav-ink']).toBe(grey)
  })

  it('takes the hero’s text on a header on the hero, and its softer text otherwise', () => {
    const onBand = (navText: 'ink' | 'muted') =>
      resolveDesign(
        design((d) => {
          d.brand.light.accent = '#163300'
          d.brand.light.support = '#9fe870'
          d.layout.band = 'tint'
          d.layout.headerOnBand = true
          d.layout.navText = navText
        })
      ).tokens.light
    expect(onBand('ink')['--qb-nav-ink']).toBe(onBand('ink')['--qb-header-ink'])
    expect(onBand('muted')['--qb-nav-ink']).toBe(onBand('muted')['--qb-band-muted'])
  })
})

describe('layoutAttributes', () => {
  it('names the structural choices', () => {
    const doc = design((d) => {
      d.layout.header = 'inline'
      d.layout.nav = 'pills'
      d.layout.cards = 'list'
      d.layout.filters = 'start'
      d.layout.postCardHides = ['tags']
    })
    expect(layoutAttributes(doc)).toEqual({
      'data-qb-header': 'inline',
      'data-qb-nav': 'pills',
      'data-qb-band': 'none',
      'data-qb-band-action': 'buttons',
      'data-qb-band-align': 'left',
      'data-qb-band-glow': 'none',
      'data-qb-band-height': 'roomy',
      'data-qb-band-over': 'page',
      'data-qb-band-shape': 'full',
      'data-qb-image-phone': 'show',
      'data-qb-header-band': 'off',
      'data-qb-header-span': 'off',
      'data-qb-status': 'colour',
      'data-qb-headline': 'ink',
      'data-qb-page-titles': 'plain',
      'data-qb-band-art': 'none',
      'data-qb-tint': 'neutral',
      'data-qb-cards': 'list',
      'data-qb-fill': 'accent',
      'data-qb-filters': 'start',
      'data-qb-menu-align': 'start',
      'data-qb-hover': 'none',
      'data-qb-card-excerpt': 'on',
      'data-qb-card-tags': 'off',
      'data-qb-card-meta': 'on',
    })
  })

  it('centres the menu only in an inline header, and names the hover motion', () => {
    const inline = design((d) => {
      d.layout.header = 'inline'
      d.layout.menuAlign = 'centre'
      d.shape.hover = 'arrow'
    })
    expect(layoutAttributes(inline)).toMatchObject({
      'data-qb-menu-align': 'centre',
      'data-qb-hover': 'arrow',
    })
    inline.layout.header = 'stacked'
    expect(layoutAttributes(inline)['data-qb-menu-align']).toBe('start')
  })

  it('centres the band under a centred header unless it says otherwise', () => {
    const centred = design((d) => (d.layout.header = 'centered'))
    expect(layoutAttributes(centred)['data-qb-band-align']).toBe('centre')
    centred.layout.bandAlign = 'left'
    expect(layoutAttributes(centred)['data-qb-band-align']).toBe('left')
    const inline = design((d) => (d.layout.bandAlign = 'centre'))
    expect(layoutAttributes(inline)['data-qb-band-align']).toBe('centre')
  })

  it('names the band’s shape, and a header on the band only where the band has colour', () => {
    const doc = design((d) => {
      d.layout.bandShape = 'panel'
      d.layout.headerOnBand = true
    })
    expect(layoutAttributes(doc)).toMatchObject({
      'data-qb-band-shape': 'panel',
      'data-qb-header-band': 'off',
    })
    doc.layout.band = 'brand'
    expect(layoutAttributes(doc)['data-qb-header-band']).toBe('on')
  })
})

describe('PORTAL_ALIASES', () => {
  it('points the portal’s own variables at the tokens', () => {
    expect(PORTAL_ALIASES['--header-background']).toBe('--qb-header-bg')
    expect(PORTAL_ALIASES['--nav-inactive-color']).toBe('--qb-nav-ink')
    expect(PORTAL_ALIASES['--radius-item']).toBe('--qb-radius-button')
    expect(PORTAL_ALIASES['--radius-panel']).toBe('--qb-radius-panel')
  })
})

describe('the logo’s height', () => {
  it('stands as tall as the design sets it, and at the usual 32px otherwise', () => {
    const doc = defaultDesign()
    expect(resolveDesign(doc).tokens.base).not.toHaveProperty('--qb-logo-height')
    doc.brand.logo.height = 20
    expect(resolveDesign(doc).tokens.base['--qb-logo-height']).toBe('1.25rem')
  })
})

describe('a fade band from its foot', () => {
  it('runs from the page colour at the top to the tint at the foot, and the words read on both', () => {
    const doc = defaultDesign()
    doc.mode = 'light'
    doc.layout.band = 'fade'
    doc.layout.fadeFrom = 'bottom'
    const tokens = resolveDesign(doc).tokens.light
    expect(tokens['--qb-band-bg']).toMatch(/^linear-gradient\(to top,/)
  })
})

describe('a glow on a brand-colour band', () => {
  const glowing = (change: (d: PortalDesign) => void = () => {}) =>
    resolveDesign(
      design((d) => {
        d.mode = 'light'
        d.brand.light.accent = '#fc5f0a'
        d.layout.band = 'brand'
        d.layout.bandGlow = 'bottom'
        change(d)
      })
    )

  it('rises from the foot over the band’s own colour, in a light of it where no colour is chosen', () => {
    const { tokens, errors } = glowing()
    const bg = tokens.light['--qb-band-bg']!
    expect(bg).toMatch(/^radial-gradient\(ellipse [\d.]+% [\d.]+% at 50% 100%, /)
    expect(bg.endsWith(', #fc5f0a')).toBe(true)
    expect(errors).toEqual([])
  })

  it('draws in the colour the design gives it, at the centre it names', () => {
    const top = glowing((d) => {
      d.brand.light.extra = ['#fc9912', '#fbde9a']
      d.layout.bandGlowColour = 'extra2'
      d.layout.bandGlow = 'top'
    }).tokens.light['--qb-band-bg']!
    expect(top).toMatch(/at 50% 0%, /)
    expect(top).toContain('#fbde9a')
    const corner = glowing((d) => (d.layout.bandGlow = 'corner')).tokens.light['--qb-band-bg']!
    expect(corner).toMatch(/at 100% 0%, /)
  })

  it('keeps the words readable where the glow reaches them, else leaves the band plain', () => {
    // White words on a deep blue keep 4.5:1 on the glow's edge, softened as far as they need.
    const deep = glowing((d) => (d.brand.light.accent = '#0c4198'))
    const ink = deep.tokens.light['--qb-band-ink']!
    const bg = deep.tokens.light['--qb-band-bg']!
    expect(bg).toMatch(/^radial-gradient\(/)
    const rim = /, (#[0-9a-f]{6}) 50%/.exec(bg)![1]!
    expect(contrastRatio(ink, rim)).toBeGreaterThanOrEqual(4.5)
    expect(deep.errors).toEqual([])
    // On a blue white words only just read on, any glow would wash them out: the band stays plain.
    const near = glowing((d) => (d.brand.light.accent = '#2563eb'))
    expect(near.tokens.light['--qb-band-bg']).toBe('#2563eb')
  })

  it('leaves the words on the band’s own colour, light where light reads clearer, with the glow below them', () => {
    // A set-in orange panel lit from its foot; the site's subtitle was light.
    const lit = glowing((d) => {
      d.mode = 'auto'
      d.layout.bandShape = 'inset'
      d.tune = { subtitle: { colour: '#fff8eb' } }
    })
    expect(lit.errors).toEqual([])
    for (const mode of ['light', 'dark'] as const) {
      const tokens = lit.tokens[mode]
      expect(tokens['--qb-band-bg']).toMatch(/^radial-gradient\(.+at 50% 100%/)
      expect(contrastRatio(tokens['--qb-band-headline']!, '#000000')).toBeGreaterThan(15)
      expect(tokens['--qb-band-subtitle']).toBe(tokens['--qb-band-headline'])
      // Titles on the other pages sit low on a short band: there it is the colour alone.
      expect(tokens['--qb-band-plain']).toBe('#fc5f0a')
    }
    const doc = design((d) => {
      d.layout.band = 'brand'
      d.layout.bandGlow = 'bottom'
    })
    expect(layoutAttributes(doc)['data-qb-band-glow']).toBe('foot')
    expect(layoutAttributes(design())['data-qb-band-glow']).toBe('none')
  })

  it('keeps a glow that reaches the words only as strong as every ink there still reads', () => {
    // Along the top the glow meets the headline: light words at 3:1 on orange leave no room for it.
    const top = glowing((d) => {
      d.layout.bandGlow = 'top'
      d.tune = { subtitle: { colour: '#fff8eb' } }
    }).tokens.light
    expect(top['--qb-band-bg']).toBe('#fc5f0a')
    expect(top['--qb-band-headline']).toBeDefined()
    // Dark words on a light band keep a glow there.
    const pale = glowing((d) => {
      d.brand.light.accent = '#f6c445'
      d.layout.bandGlow = 'top'
    }).tokens.light
    expect(pale['--qb-band-bg']).toMatch(/^radial-gradient\(.+at 50% 0%/)
    const rim = /, (#[0-9a-f]{6}) 50%/.exec(pale['--qb-band-bg']!)![1]!
    expect(contrastRatio(pale['--qb-band-ink']!, rim)).toBeGreaterThanOrEqual(4.5)
  })

  it('is drawn only on a brand or second-colour band', () => {
    const tint = glowing((d) => (d.layout.band = 'tint')).tokens.light['--qb-band-bg']!
    expect(tint).not.toContain('radial-gradient')
    const plain = glowing((d) => delete d.layout.bandGlow).tokens.light['--qb-band-bg']!
    expect(plain).toBe('#fc5f0a')
  })
})

describe('the band’s foot', () => {
  const band = (change: (d: PortalDesign) => void) =>
    resolveDesign(
      design((d) => {
        d.mode = 'auto'
        d.brand.light.accent = '#4a1942'
        d.brand.light.support = '#e58fae'
        change(d)
      })
    )
  /** The foot painted over the band, or undefined where none is ('none', set so a mode's never carries into the other's). */
  const foot = (change: (d: PortalDesign) => void, mode: 'light' | 'dark' = 'light') => {
    const painted = band(change).tokens[mode]['--qb-band-foot']
    return painted === 'none' ? undefined : painted
  }

  it('fades a mesh or ribbon of glows into the page at its foot, and in from it under a header in the page colour', () => {
    for (const blend of ['mesh', 'ribbon'] as const) {
      for (const align of ['left', 'centre'] as const) {
        const resolved = band((d) => {
          d.layout.band = 'blend'
          d.layout.blend = blend
          d.layout.bandAlign = align
        })
        for (const mode of ['light', 'dark'] as const) {
          const page = resolved[mode]!.background
          expect(resolved.tokens[mode]['--qb-band-foot']).toBe(
            `linear-gradient(to bottom, ${page}, transparent 4rem, transparent max(55%, calc(100% - 8rem)), ${page})`
          )
        }
      }
    }
  })

  it('fades only the foot under a header sharing the band, the shared surface itself unchanged', () => {
    const { tokens, light } = band((d) => {
      d.layout.band = 'blend'
      d.layout.blend = 'mesh'
      d.layout.headerOnBand = true
    })
    expect(tokens.light['--qb-band-foot']).toBe(
      `linear-gradient(to bottom, transparent max(55%, calc(100% - 8rem)), ${light!.background})`
    )
    expect(tokens.light['--qb-header-surface']).toBe(tokens.light['--qb-band-bg'])
    expect(tokens.light['--qb-header-surface']).not.toContain('max(55%')
  })

  it('keeps a clean edge where a solid band stands well apart from the page', () => {
    // Lime and orange on white: a deliberate section, as a site's.
    for (const accent of ['#9fe870', '#f38020']) {
      expect(
        foot((d) => {
          d.brand.light.accent = accent
          d.layout.band = 'brand'
        })
      ).toBeUndefined()
    }
  })

  it('fades a solid band near the page’s colour, or of its hue, into the page', () => {
    // Blue on a darker blue page: one family, an edge between them reads as cut off.
    const blueOnBlue = foot((d) => {
      d.brand.light = { accent: '#3a3fd0', background: '#131573', ink: '#ffffff' }
      d.layout.band = 'brand'
    })
    expect(blueOnBlue).toMatch(/^linear-gradient\(to bottom, transparent /)
    // Navy on near black: near enough to read as a seam.
    const navy = foot((d) => {
      d.brand.light = { accent: '#0c1a2a', background: '#0a0a0a', ink: '#ffffff' }
      d.layout.band = 'brand'
    })
    expect(navy).toBeDefined()
    // A tint is always near the page.
    expect(foot((d) => (d.layout.band = 'tint'))).toBeDefined()
  })

  it('fades over 6rem where the band’s words read on the page too, else only in its bottom padding', () => {
    const resolved = band((d) => {
      d.layout.band = 'tint'
    })
    expect(resolved.tokens.light['--qb-band-foot']).toBe(
      `linear-gradient(to bottom, transparent max(55%, calc(100% - 6rem)), ${resolved.light!.background})`
    )
    // A gradient band whose words would not read on the page fades only under them.
    const linear = band((d) => {
      d.layout.band = 'blend'
      d.layout.blend = 'linear'
    })
    expect(linear.tokens.light['--qb-band-foot']).toBe('none')
    // Faded in over the band's own bottom padding, which the band draws.
    expect(linear.tokens.light['--qb-band-foot-pad']).toBe(linear.light!.background)
  })

  it('fades into a wash of one colour, and leaves a band over a gradient as it is', () => {
    const tint = (background: unknown) =>
      foot((d) => {
        d.layout.band = 'tint'
        d.layout.background = background as never
      })
    expect(tint({ kind: 'tint', colour: '#faf9f3' })).toBeDefined()
    const gradient = {
      kind: 'gradient',
      stops: ['#7c56cc', 'page'],
      shape: 'radial',
      centre: 'middle',
    }
    expect(tint(gradient)).toBeUndefined()
    // Over the gradient no colour is painted: the band fades out itself, over its bottom padding only.
    const over = band((d) => {
      d.layout.band = 'tint'
      d.layout.background = gradient as never
    }).tokens.light
    expect(over['--qb-band-fade-out']).toBe('transparent')
    expect(
      layoutAttributes(
        design((d) => {
          d.layout.band = 'tint'
          d.layout.background = gradient as never
        })
      )['data-qb-band-over']
    ).toBe('fill')
    expect(over['--qb-band-foot-pad']).toBe('transparent')
  })

  it('never reads the band’s own padding in a token, as a token is worked out on the page, not the band', () => {
    for (const change of [
      (d: PortalDesign) => (d.layout.band = 'tint'),
      (d: PortalDesign) => ((d.layout.band = 'blend'), (d.layout.blend = 'linear')),
      (d: PortalDesign) => ((d.layout.band = 'blend'), (d.layout.blend = 'mesh')),
      (d: PortalDesign) => (d.layout.band = 'brand'),
    ]) {
      for (const tokens of Object.values(band(change).tokens))
        for (const value of Object.values(tokens)) expect(value).not.toContain('--qb-band-pad')
    }
  })

  it('sets the foot in every mode with a band, so light’s never carries into dark', () => {
    // Light on one colour, dark over a gradient: dark must not inherit light's painted foot.
    const { tokens } = band((d) => {
      d.layout.band = 'tint'
      d.layout.background = {
        kind: 'solid',
        dark: { kind: 'gradient', stops: ['#7c56cc', 'page'], shape: 'radial', centre: 'middle' },
      } as never
    })
    expect(tokens.light['--qb-band-foot']).toMatch(/^linear-gradient/)
    expect(tokens.light['--qb-band-fade-out']).toBe('black')
    expect(tokens.dark['--qb-band-foot']).toBe('none')
    expect(tokens.dark['--qb-band-fade-out']).toBe('transparent')
  })

  it('leaves no band, and a fade band that already ends in the page, alone', () => {
    expect(foot((d) => (d.layout.band = 'none'))).toBeUndefined()
    expect(foot((d) => (d.layout.band = 'fade'))).toBeUndefined()
  })

  it('keeps a band set in a panel inside the panel’s own edge', () => {
    for (const shape of ['inset', 'split'] as const) {
      for (const change of [
        (d: PortalDesign) => (d.layout.blend = 'mesh'),
        (d: PortalDesign) => (d.layout.blend = 'linear'),
      ]) {
        expect(
          foot((d) => {
            d.layout.band = 'blend'
            d.layout.bandShape = shape
            change(d)
          })
        ).toBeUndefined()
      }
    }
    expect(
      foot((d) => {
        d.layout.band = 'blend'
        d.layout.blend = 'mesh'
        d.layout.bandShape = 'panel'
      })
    ).toBeDefined()
  })
})

describe('a hero photo behind the words with its measured veil', () => {
  const photo = (change: (d: PortalDesign) => void = () => {}) =>
    design((d) => {
      d.layout.band = 'brand'
      d.brand.light.accent = '#fde047'
      d.brand.bandImage = {
        key: 'portal-images/hero.jpg',
        alt: 'A man at a laptop',
        screenshot: { key: 'portal-images/hero-source.jpg', box: { x: 0, y: 0, w: 1, h: 1 } },
        shade: { tone: 'dark', strength: 35, under: '#4a443c' },
      }
      d.layout.imagePlace = 'cover'
      change(d)
    })

  it('veils the photo in its measured shade and sets white words on it, in both modes', () => {
    const { tokens, errors } = resolveDesign(photo())
    for (const mode of ['light', 'dark'] as const) {
      expect(tokens[mode]['--qb-band-scrim']).toBe('rgb(0 0 0 / 35%)')
      expect(tokens[mode]['--qb-photo-ink']).toBe('#ffffff')
      expect(tokens[mode]['--qb-photo-muted']).toBe('#ffffff')
      expect(contrastRatio(tokens[mode]['--qb-photo-accent']!, '#4a443c')).toBeGreaterThanOrEqual(3)
    }
    // The words read on the worst colour left under the veil: no band error, though the band is yellow.
    expect(errors.filter((e) => /hero/.test(e))).toEqual([])
  })

  it('keeps the band’s own words for its colour, where the photo is not drawn (other pages, the post page)', () => {
    const { tokens } = resolveDesign(photo())
    // White on the yellow band would be 1.3:1: the band's own text stays readable on it.
    expect(
      contrastRatio(tokens.light['--qb-band-ink']!, tokens.light['--qb-band-bg']!)
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('falls back to the band’s colour where the photo is not behind the words', () => {
    const side = resolveDesign(photo((d) => (d.layout.imagePlace = 'side'))).tokens.light
    expect(side['--qb-band-scrim']).toMatch(/^color-mix/)
    expect(side['--qb-band-ink']).not.toBe('#ffffff')
    // Left off on phones, the band's own colour shows there: its own words.
    const hidden = resolveDesign(photo((d) => (d.layout.imagePhone = 'hide'))).tokens.light
    expect(hidden['--qb-band-scrim']).toMatch(/^color-mix/)
  })

  it('puts the header on the photo under a deeper veil, its one-ink logo drawn white', () => {
    const doc = photo((d) => {
      d.layout.headerOnBand = true
      d.brand.logo.tone = 'dark'
      d.brand.logo.oneInk = true
    })
    expect(layoutAttributes(doc)['data-qb-header-span']).toBe('photo')
    const { tokens } = resolveDesign(doc)
    expect(tokens.light['--qb-header-veil']).toBe('rgb(0 0 0 / 50%)')
    expect(tokens.light['--qb-header-ink']).toBe('#ffffff')
    expect(tokens.light['--qb-header-bg']).toBe('#4a443c')
    expect(tokens.light['--qb-logo-filter']).toBe(`url(#${LOGO_FILTER.reverse})`)
    // Without the shared header, in a panel, or with a photo shown on Home only, the header keeps its own surface.
    expect(layoutAttributes(photo())['data-qb-header-span']).toBe('off')
    expect(
      layoutAttributes(
        photo((d) => {
          d.layout.headerOnBand = true
          d.brand.bandImage!.homeOnly = true
        })
      )['data-qb-header-span']
    ).not.toBe('photo')
    expect(
      layoutAttributes(
        photo((d) => {
          d.layout.headerOnBand = true
          d.layout.bandShape = 'inset'
        })
      )['data-qb-header-span']
    ).toBe('off')
  })
})

describe('text reads on what is actually behind it', () => {
  const photoBand = (accent: string, tone: 'dark' | 'light', under: string) =>
    design((d) => {
      d.layout.band = 'brand'
      d.layout.imagePlace = 'cover'
      d.brand.light.accent = accent
      d.brand.bandImage = {
        key: 'portal-images/hero.jpg',
        alt: 'A photo',
        screenshot: { key: 'portal-images/hero-source.jpg', box: { x: 0, y: 0, w: 1, h: 1 } },
        shade: { tone, strength: 20, under },
      }
    })

  it('keeps the current page readable on its pill in a header on the photo', () => {
    const doc = photoBand('#000000', 'dark', '#866e66')
    doc.layout.headerOnBand = true
    for (const mode of ['light', 'dark'] as const) {
      const tokens = resolveDesign(doc).tokens[mode]
      const ratio = contrastRatio(tokens['--qb-nav-active-ink']!, tokens['--qb-nav-active-bg']!)
      expect(ratio, mode).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the current page readable on its pill in a header on a mid-tone band', () => {
    for (const accent of ['#866e66', '#7c7c7c', '#3b82f6', '#e11d48']) {
      const doc = design((d) => {
        d.layout.band = 'brand'
        d.layout.headerOnBand = true
        d.brand.light.accent = accent
      })
      const tokens = resolveDesign(doc).tokens.light
      const ratio = contrastRatio(tokens['--qb-nav-active-ink']!, tokens['--qb-nav-active-bg']!)
      expect(ratio, accent).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('a veil the design did not measure', () => {
  // The veil as the band draws it: its colour at a share over the image.
  const veil = (scrim: string) => {
    const match = /^color-mix\(in oklch, (.+) (\d+(?:\.\d+)?)%, transparent\)$/.exec(scrim)
    if (!match) throw new Error(`Not a veil: ${scrim}`)
    return { colour: match[1]!, share: Number(match[2]) / 100 }
  }

  it('is deep enough that the words read over any image beneath, cover or pattern', () => {
    for (const band of ['none', 'tint', 'brand', 'fade'] as const) {
      for (const place of ['cover', 'pattern'] as const) {
        const doc = design((d) => {
          d.layout.band = band
          d.layout.imagePlace = place
          d.brand.light.accent = '#7c3aed'
          d.brand.bandImage = { key: 'portal-images/hero.jpg', alt: 'A photo' }
        })
        for (const mode of ['light', 'dark'] as const) {
          const tokens = resolveDesign(doc).tokens[mode]
          const { colour, share } = veil(
            tokens[place === 'cover' ? '--qb-band-scrim' : '--qb-band-scrim-soft']!
          )
          for (const pixel of ['#000000', '#ffffff']) {
            const behind = overlay(colour, pixel, share)
            for (const ink of [tokens['--qb-band-ink']!, tokens['--qb-band-muted']!]) {
              expect(
                contrastRatio(ink, behind),
                `${band} ${place} ${mode} ${pixel}`
              ).toBeGreaterThanOrEqual(4.5)
            }
          }
        }
      }
    }
  })
})

describe('the page holding under a header that shares the band', () => {
  const held = (blend: 'linear' | 'mesh') =>
    resolveDesign(
      design((d) => {
        d.mode = 'dark'
        d.layout.headerOnBand = true
        d.layout.band = 'blend'
        d.layout.blend = blend
        d.layout.pageTitles = 'band'
        d.brand.light = {
          accent: '#7f9b58',
          background: '#ffffff',
          ink: '#0a0a0a',
          support: '#6f4ac1',
        }
        d.brand.dark = { accent: '#c3ee88', background: '#291061', ink: '#ffffff' }
      })
    ).tokens.dark

  it('starts a gradient of other colours on a clean edge under the header, never muddied by a fade', () => {
    // No text reads across lime to violet, so the page's colour holds under the header.
    const tokens = held('linear')
    expect(tokens['--qb-header-surface']).toMatch(
      /^linear-gradient\(to bottom, #291061 var\(--portal-header-height, 0px\), transparent var\(--portal-header-height, 0px\)\)/
    )
    expect(
      contrastRatio(tokens['--qb-header-ink']!, tokens['--qb-header-bg']!)
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('fades glows on the page’s own colour in under the header', () => {
    expect(held('mesh')['--qb-header-surface']).toMatch(
      /^linear-gradient\(to bottom, #291061 var\(--portal-header-height, 0px\), transparent calc\(var\(--portal-header-height, 0px\) \+ 5rem\)\)/
    )
  })

  it('leaves a post no strip of the band to colour: it opens on the page', () => {
    for (const blend of ['linear', 'mesh'] as const) {
      expect(held(blend)['--qb-post-band-bg']).toBeUndefined()
      expect(held(blend)['--qb-post-band-ink']).toBeUndefined()
    }
  })
})
