/**
 * What a website gave, used as the person checks it: the logo (an icon
 * beside the title, or a full logo by its shape), the favicon, the share
 * image and one brand colour, each only when checked, all in one change
 * that records a match has run.
 */
import { describe, expect, it } from 'vitest'
import { applySiteBrand, offeredPicks, type SiteBrandOffer } from '../site-brand'
import { defaultDesign } from '../schema'

const offer: SiteBrandOffer = {
  host: 'acme.test',
  name: 'Acme',
  logo: { key: 'logos/logo.svg', full: false },
  favicon: { key: 'logos/favicon.png' },
  shareImage: { key: 'logos/share.jpg' },
  colour: '#0058a3',
}
const at = new Date('2026-11-07T12:00:00.000Z')

describe('offeredPicks', () => {
  it('lists what the site gave, in order', () => {
    expect(offeredPicks(offer)).toEqual(['logo', 'favicon', 'shareImage', 'colour'])
    expect(offeredPicks({ ...offer, logo: null, colour: null })).toEqual(['favicon', 'shareImage'])
  })
})

describe('applySiteBrand', () => {
  it('uses every checked part and records that a match ran', () => {
    const design = defaultDesign()
    applySiteBrand(design, offer, new Set(offeredPicks(offer)), at)
    expect(design.brand.logo.mark.light).toEqual({ key: 'logos/logo.svg' })
    expect(design.brand.logo.display).toBe('mark_and_name')
    expect(design.brand.logo.name).toBe('Acme')
    expect(design.brand.favicon).toEqual({ key: 'logos/favicon.png' })
    expect(design.brand.shareImage).toEqual({ key: 'logos/share.jpg' })
    expect(design.brand.light.accent).toBe('#0058a3')
    expect(design.brand.matchedAt).toBe('2026-11-07T12:00:00.000Z')
  })

  it('leaves out what is unchecked, and keeps a title already set', () => {
    const design = defaultDesign()
    design.brand.logo.name = 'Acme Support'
    const accent = design.brand.light.accent
    applySiteBrand(design, offer, new Set(['logo', 'favicon'] as const), at)
    expect(design.brand.logo.name).toBe('Acme Support')
    expect(design.brand.light.accent).toBe(accent)
    expect(design.brand.shareImage ?? null).toBeNull()
  })

  it('places a wide logo as the full logo', () => {
    const design = defaultDesign()
    applySiteBrand(
      design,
      { ...offer, logo: { key: 'logos/wide.svg', full: true } },
      new Set(['logo'] as const),
      at
    )
    expect(design.brand.logo.wordmark.light).toEqual({ key: 'logos/wide.svg' })
    expect(design.brand.logo.display).toBe('wordmark')
  })

  it('changes nothing when nothing is checked', () => {
    const design = defaultDesign()
    applySiteBrand(design, offer, new Set(), at)
    expect(design).toEqual(defaultDesign())
  })
})
