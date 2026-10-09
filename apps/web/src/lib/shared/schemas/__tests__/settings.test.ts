import { describe, expect, it } from 'vitest'
import { brandingPatchSchema, updateThemeSchema } from '../settings'

/**
 * Branding configs the settings page has always been able to save. The page
 * stores whatever its theme editor produces, so its validator stays as wide as
 * before; only model-proposed patches are held to the strict schema.
 */
const PAGE_SAVED_CONFIGS: Array<[string, Record<string, unknown>]> = [
  ['a named color', { light: { primary: 'white' } }],
  ['an hsl color with angle units', { light: { primary: 'hsl(220deg 50% 40%)' } }],
  ['a color-mix() color', { light: { primary: 'color-mix(in oklch, white 40%, black)' } }],
  ['a CSS variable', { dark: { accent: 'var(--brand)' } }],
  ['a lab() color', { light: { primary: 'lab(52% 40 59)' } }],
  ['a preset that no longer ships', { preset: 'retired-preset', themeMode: 'user' }],
  ['a token the current editor does not know', { light: { legacyToken: '#123456' } }],
  ['a unitless radius', { light: { radius: '0' } }],
]

describe('updateThemeSchema (settings page save)', () => {
  it.each(PAGE_SAVED_CONFIGS)('accepts %s', (_label, brandingConfig) => {
    expect(updateThemeSchema.parse({ brandingConfig }).brandingConfig).toEqual(brandingConfig)
  })

  it('still requires an object', () => {
    expect(() => updateThemeSchema.parse({ brandingConfig: 'white' })).toThrow()
  })
})

describe('brandingPatchSchema (model proposals)', () => {
  it('accepts the colors and theme mode the model may propose', () => {
    expect(
      brandingPatchSchema.parse({ themeMode: 'light', light: { primary: '#0F766E' } })
    ).toEqual({ themeMode: 'light', light: { primary: '#0F766E' } })
  })

  it.each([
    ['a named color', { light: { primary: 'white' } }],
    ['a CSS variable', { light: { primary: 'var(--brand)' } }],
    ['an unknown token', { light: { legacyToken: '#123456' } }],
    ['a preset', { preset: 'default' }],
  ])('rejects %s', (_label, patch) => {
    expect(brandingPatchSchema.safeParse(patch).success).toBe(false)
  })
})
