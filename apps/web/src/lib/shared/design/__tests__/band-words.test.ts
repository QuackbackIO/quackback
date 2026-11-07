/**
 * The headline and subtitle on a band of a bright brand colour that dark text
 * passes 4.5:1 on, while light text reads clearer but only reaches 3:1: the
 * headline is large text, so it takes the light text; the subtitle follows it,
 * set large, where the site's own subtitle was light. Buttons and the band's
 * other text keep 4.5:1.
 */
import { describe, expect, it } from 'vitest'
import { colourPairs } from '../colour-pairs'
import { modeTokens } from '../components'
import { contrastRatio } from '../contrast'
import { resolveDesign } from '../resolve'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'

/** A bright orange: black passes 4.5:1 on it, white only 3:1, and white reads clearer. */
const ORANGE = '#fc5f0a'

function orangeBand(change?: (doc: PortalDesign) => void): PortalDesign {
  const doc = defaultDesign()
  doc.brand.light.accent = ORANGE
  doc.brand.light.ink = '#0a0a0a'
  doc.layout.band = 'brand'
  doc.tune = { subtitle: { size: 18, colour: '#fff8eb' } }
  change?.(doc)
  return portalDesign.parse(doc)
}

const tokensOf = (doc: PortalDesign, mode: 'light' | 'dark') =>
  modeTokens(doc, resolveDesign(doc)[mode]!, mode)
const isLight = (c: string) => contrastRatio(c, '#000000') > contrastRatio(c, '#ffffff')

describe('words on a bright band', () => {
  it('draws the headline and subtitle light, the subtitle large, in light and dark', () => {
    expect(contrastRatio('#ffffff', ORANGE)).toBeLessThan(4.5)
    expect(contrastRatio('#ffffff', ORANGE)).toBeGreaterThanOrEqual(3)
    const doc = orangeBand()
    for (const mode of ['light', 'dark'] as const) {
      const tokens = tokensOf(doc, mode)
      expect(isLight(tokens['--qb-band-headline']!), mode).toBe(true)
      expect(tokens['--qb-band-subtitle'], mode).toBe(tokens['--qb-band-headline'])
      expect(contrastRatio(tokens['--qb-band-headline']!, ORANGE)).toBeGreaterThanOrEqual(3)
      // Large text by WCAG: at least 18.66px bold.
      expect(tokens['--qb-band-subtitle-weight']).toBe('700')
      expect(tokens['--qb-band-subtitle-size']).toMatch(/1\.1667rem/)
    }
  })

  it('draws the site’s subtitle colour as the band’s light subtitle, never moved dark over it', () => {
    const doc = orangeBand()
    const resolved = resolveDesign(doc)
    const tuned = resolved.tuned.find((c) => c.part === 'Subtitle')!
    expect(tuned.used).toBe(tokensOf(doc, 'light')['--qb-band-subtitle'])
    expect(tuned.target).toBe(3)
    expect(resolved.tuneCss).toContain(`[data-qb-part=subtitle] { color: ${tuned.used}; }`)
  })

  it('keeps the band’s other text and the buttons at 4.5:1', () => {
    const doc = orangeBand()
    const resolved = resolveDesign(doc)
    const tokens = tokensOf(doc, 'light')
    expect(contrastRatio(tokens['--qb-band-ink']!, ORANGE)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(resolved.light!.primaryForeground!, ORANGE)).toBeGreaterThanOrEqual(4.5)
  })

  it('checks the headline and the large subtitle at 3:1, and every check passes', () => {
    const pairs = colourPairs(orangeBand())
    const headline = pairs.find((p) => p.mode === 'light' && p.text === 'Headline')!
    expect(headline.target).toBe(3)
    expect(isLight(headline.foreground)).toBe(true)
    const subtitle = pairs.find((p) => p.mode === 'light' && p.text === 'Subtitle')!
    expect(subtitle.target).toBe(3)
    expect(pairs.filter((p) => !p.passes && !p.unused)).toEqual([])
    expect(resolveDesign(orangeBand()).errors).toEqual([])
  })

  it('keeps both dark where the site’s subtitle was not light, never a light headline over a dark subtitle', () => {
    for (const doc of [
      orangeBand((d) => (d.tune = undefined)),
      orangeBand((d) => (d.tune = { subtitle: { colour: '#3a2a20' } })),
    ]) {
      const tokens = tokensOf(doc, 'light')
      expect(tokens['--qb-band-headline']).toBeUndefined()
      expect(tokens['--qb-band-subtitle']).toBeUndefined()
      const headline = colourPairs(doc).find((p) => p.mode === 'light' && p.text === 'Headline')!
      expect(headline.target).toBe(4.5)
    }
  })

  it('sets the subtitle at 24px where the tune gives it a lighter weight, which wins over bold', () => {
    const tokens = tokensOf(
      orangeBand((d) => (d.tune = { subtitle: { colour: '#fff8eb', weight: 400 } })),
      'light'
    )
    expect(tokens['--qb-band-subtitle-weight']).toBeUndefined()
    expect(tokens['--qb-band-subtitle-size']).toMatch(/1\.5rem/)
  })

  it('leaves words on a panel as they are', () => {
    const tokens = tokensOf(
      orangeBand((d) => (d.layout.bandShape = 'panel')),
      'light'
    )
    expect(tokens['--qb-band-headline']).toBeUndefined()
  })

  it('leaves a band dark text cannot pass 4.5:1 on as the band picks', () => {
    // On a deep blue the band's own text is light already.
    const tokens = tokensOf(
      orangeBand((d) => (d.brand.light.accent = '#1e3a8a')),
      'light'
    )
    expect(tokens['--qb-band-headline']).toBeUndefined()
    expect(isLight(tokens['--qb-band-ink']!)).toBe(true)
  })
})
