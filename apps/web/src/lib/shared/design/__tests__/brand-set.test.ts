import { describe, expect, it } from 'vitest'
import { brandIsSet } from '../brand-set'
import { defaultDesign, type PortalDesign } from '../schema'

const withIcon = (design: PortalDesign): PortalDesign => {
  design.brand.logo.mark.light = { key: 'logos/acme.png' }
  return design
}

describe('brandIsSet', () => {
  it('is false for the default design', () => {
    expect(brandIsSet(defaultDesign())).toBe(false)
  })

  it('is true once a brand match has run, whatever the design holds', () => {
    const design = defaultDesign()
    design.brand.matchedAt = '2026-11-07T10:00:00.000Z'
    expect(brandIsSet(design)).toBe(true)
  })

  it('is false with only a logo, as onboarding used to leave it', () => {
    expect(brandIsSet(withIcon(defaultDesign()))).toBe(false)
  })

  it('is false with an icon and a colour but the default font', () => {
    const design = withIcon(defaultDesign())
    design.brand.light.accent = '#0c862c'
    expect(brandIsSet(design)).toBe(false)
  })

  it('is false with an icon and a font but the default colour', () => {
    const design = withIcon(defaultDesign())
    design.brand.fonts.heading = { kind: 'bundled', id: 'source-serif' }
    expect(brandIsSet(design)).toBe(false)
  })

  it('is true with an icon, a brand colour and a font of its own', () => {
    const design = withIcon(defaultDesign())
    design.brand.light.accent = '#0c862c'
    design.brand.fonts.body = { kind: 'bundled', id: 'source-serif' }
    expect(brandIsSet(design)).toBe(true)
  })

  it('counts a dark icon as the icon', () => {
    const design = defaultDesign()
    design.brand.logo.mark.dark = { key: 'logos/acme-dark.png' }
    design.brand.light.accent = '#0c862c'
    design.brand.fonts.heading = { kind: 'bundled', id: 'source-serif' }
    expect(brandIsSet(design)).toBe(true)
  })
})
