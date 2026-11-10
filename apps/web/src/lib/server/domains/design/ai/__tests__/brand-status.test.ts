/**
 * Status markers in the brand's own voice, as the approved goal designs set
 * them: a logo of several colours (Chatterly, Hemla, and the fictional Harbor,
 * Petal Post and Voltline) draws its statuses in the logo's colours; a
 * monochrome brand draws them in its ink, not a rainbow; a brand of one
 * colour keeps the coloured dots (Paylane, Coralbank, Fernway).
 */
import { describe, expect, it } from 'vitest'
import { statusMarkers } from '../colour-changes'

const value = (roles: Parameters<typeof statusMarkers>[0]) => statusMarkers(roles).value

describe('status markers from the brand', () => {
  it('a logo of several colours gives the statuses the logo’s colours', () => {
    // Chatterly's logo, as the goal design stores it.
    expect(
      value({ monochrome: false, logoColours: ['#36c5f0', '#2eb67d', '#ecb22e', '#e01e5a'] })
    ).toBe('brand')
    // Hemla's blue and yellow, with black type.
    expect(value({ monochrome: false, logoColours: ['#0058a3', '#ffdb00', '#111111'] })).toBe(
      'brand'
    )
    // Harbor's deep green, rust and sage.
    expect(value({ monochrome: false, logoColours: ['#1f4d3a', '#a95632', '#8fa98a'] })).toBe(
      'brand'
    )
  })

  it('a monochrome brand draws its statuses in its ink', () => {
    expect(value({ monochrome: true, logoColours: ['#1b1b1b'] })).toBe('ink')
    expect(value({ monochrome: true, logoColours: [] })).toBe('ink')
    // A black and white brand with one signature accent keeps its restraint.
    expect(value({ monochrome: false, signature: true, logoColours: ['#111111'] })).toBe('ink')
  })

  it('a brand of one colour keeps the coloured dots', () => {
    // Paylane's two navies are one hue; an orange in two shades is one colour.
    expect(value({ monochrome: false, logoColours: ['#031323', '#061b31'] })).toBe('colour')
    expect(value({ monochrome: false, logoColours: ['#fc5f0a', '#262626', '#fc9912'] })).toBe(
      'colour'
    )
    expect(value({ monochrome: false, logoColours: [] })).toBe('colour')
  })

  it('says why, for the reply', () => {
    expect(statusMarkers({ monochrome: true, logoColours: [] })).toMatchObject({
      path: 'layout.status',
      why: expect.stringMatching(/monochrome/),
    })
  })
})
