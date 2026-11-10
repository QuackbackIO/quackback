import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../contrast'
import { defaultDesign, type PortalDesign } from '../schema'
import { emailIconKey, emailPalette } from '../email-palette'

function design(edit: (doc: PortalDesign) => void): PortalDesign {
  const doc = defaultDesign()
  edit(doc)
  return doc
}

describe('emailPalette', () => {
  it('fills buttons with the brand colour and white text where white reads', () => {
    const palette = emailPalette(design((d) => (d.brand.light.accent = '#0c862c')))
    expect(palette.accent).toBe('#0c862c')
    expect(palette.accentText.toLowerCase()).toMatch(/^#f/)
    expect(contrastRatio(palette.accentText, palette.accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('puts dark text on a pale brand colour', () => {
    const palette = emailPalette(design((d) => (d.brand.light.accent = '#ffe066')))
    expect(palette.accent).toBe('#ffe066')
    expect(contrastRatio(palette.accentText, palette.accent)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(palette.accentText, '#000000')).toBeLessThan(2)
  })

  it('darkens links until they read on the white email card', () => {
    const palette = emailPalette(design((d) => (d.brand.light.accent = '#ffe066')))
    expect(palette.link).toMatch(/^#[0-9a-f]{6}$/)
    expect(contrastRatio(palette.link, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('gives hex colours for an oklch brand, as mail clients need', () => {
    const palette = emailPalette(defaultDesign())
    for (const colour of Object.values(palette)) expect(colour).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('reads a dark-only design from its dark colours', () => {
    const palette = emailPalette(
      design((d) => {
        d.mode = 'dark'
        d.brand.dark = { accent: '#7c3aed' }
      })
    )
    expect(palette.accent).toBe('#7c3aed')
  })
})

describe('emailIconKey', () => {
  it('sends the brand icon when it is a PNG', () => {
    const doc = design((d) => (d.brand.logo.mark.light = { key: 'design/icon.png' }))
    expect(emailIconKey(doc)).toBe('design/icon.png')
  })

  it('never sends an SVG icon, which mail clients do not draw', () => {
    const doc = design((d) => (d.brand.logo.mark.light = { key: 'design/icon.svg' }))
    expect(emailIconKey(doc)).toBeNull()
  })

  it('is null without an icon', () => {
    expect(emailIconKey(defaultDesign())).toBeNull()
  })
})
