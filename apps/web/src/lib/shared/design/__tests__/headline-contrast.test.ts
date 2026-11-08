/**
 * A headline's colour reads at 3:1 only while it is large text everywhere it
 * shows (WCAG 1.4.3): its smallest size at least 24px, or 18.66px bold.
 * Smaller anywhere, on a phone too, and it reads at 4.5:1.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../contrast'
import { resolveDesign } from '../resolve'
import { defaultDesign, type PortalDesign } from '../schema'
import type { StyleProps } from '../style-tokens'

/** A grey at about 3.5:1 on white: large text reads in it, body text does not. */
const GREY = '#8a8a8a'

function headline(props: StyleProps, phone?: StyleProps): PortalDesign {
  const d = defaultDesign()
  d.mode = 'light'
  d.brand.light.background = '#ffffff'
  d.style = { headline: { base: { color: GREY, ...props } } }
  if (phone) d.stylePhone = { headline: { base: phone } }
  return d
}

const check = (d: PortalDesign) =>
  resolveDesign(d).styled.find((c) => c.where === 'style.headline.base' && c.mode === 'light')!

describe('a headline’s colour', () => {
  it('keeps a colour at 3:1 while the headline is large', () => {
    expect(contrastRatio(GREY, '#ffffff')).toBeGreaterThan(3)
    expect(contrastRatio(GREY, '#ffffff')).toBeLessThan(4.5)
    const c = check(headline({}))
    expect(c.target).toBe(3)
    expect(c.used).toBe(GREY)
  })

  it('reads at 4.5:1 when set under 24px', () => {
    const c = check(headline({ size: 20 }))
    expect(c.target).toBe(4.5)
    expect(contrastRatio(c.used!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps 3:1 at 18.66px and more when bold', () => {
    expect(check(headline({ size: 20, weight: 700 })).target).toBe(3)
    expect(check(headline({ size: 18, weight: 700 })).target).toBe(4.5)
  })

  it('reads at 4.5:1 when a size that shrinks on phones ends under 24px', () => {
    // 32px scales down to 19.2px on a phone.
    expect(check(headline({ size: 32 })).target).toBe(4.5)
    expect(check(headline({ size: 48 })).target).toBe(3)
  })

  it('reads at 4.5:1 when phones set it smaller', () => {
    expect(check(headline({}, { size: 18 })).target).toBe(4.5)
  })
})

describe('a headline in the band', () => {
  it('turns light at 3:1 on a bright band only while it is large', () => {
    const band = (props: StyleProps) => {
      const d = defaultDesign()
      d.mode = 'light'
      d.layout.band = 'brand'
      // A bright orange: black passes 4.5:1 on it, white only 3:1, and white reads clearer.
      d.brand.light.accent = '#fc5f0a'
      d.brand.light.ink = '#0a0a0a'
      d.tune = { subtitle: { size: 18, colour: '#fff8eb' } }
      d.style = { headline: { base: props } }
      return resolveDesign(d).tokens.light['--qb-band-headline']
    }
    expect(band({})).toBeDefined()
    expect(band({ size: 18 })).toBeUndefined()
  })

  it('reads an exact headline colour at 4.5:1 when set small', () => {
    const d = defaultDesign()
    d.mode = 'light'
    d.tune = { headline: { colour: GREY } }
    expect(resolveDesign(d).tuned.find((t) => t.part === 'Headline')?.target).toBe(3)
    d.style = { headline: { base: { size: 18 } } }
    expect(resolveDesign(d).tuned.find((t) => t.part === 'Headline')?.target).toBe(4.5)
  })
})
