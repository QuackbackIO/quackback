import { describe, expect, it } from 'vitest'
import { unbrandedTheme } from '@/lib/shared/theme/expand'
import { brandingPatchSchema, updateThemeSchema } from '../settings'

/**
 * Branding configs the settings page has always been able to save. The page
 * stores whatever its theme editor produces, so its validator accepts any
 * value that cannot escape its CSS declaration; only model-proposed patches
 * are held to the strict schema.
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

  it('accepts a cleared token', () => {
    const brandingConfig = { light: { primary: null } }
    expect(updateThemeSchema.parse({ brandingConfig }).brandingConfig).toEqual(brandingConfig)
  })

  it('accepts the config the editor saves', () => {
    // The shape saveTheme builds: every minimal variable, plus font and radius.
    const brandingConfig = {
      themeMode: 'user',
      light: { ...unbrandedTheme('light'), radius: '0.5rem' },
      dark: { ...unbrandedTheme('dark'), radius: '0.5rem' },
    }
    expect(updateThemeSchema.parse({ brandingConfig }).brandingConfig).toEqual(brandingConfig)
  })

  it.each([
    ['a colour that ends its declaration', { light: { primary: 'red; } body { display: none' } }],
    ['a closing brace', { dark: { accent: 'red}' } }],
    ['markup in a font stack', { light: { fontSans: 'Inter</style><script>x</script>' } }],
    ['a resource load in a radius', { light: { radius: 'url(https://example.com/x.png)' } }],
    ['a token in an unknown key', { light: { legacyToken: 'red;}' } }],
    ['a non-string token', { light: { primary: { r: 255 } } }],
    ['an unsafe preset name', { preset: 'x;}body{display:none' }],
    ['an unknown theme mode', { themeMode: 'sepia' }],
  ])('refuses %s', (_label, brandingConfig) => {
    expect(updateThemeSchema.safeParse({ brandingConfig }).success).toBe(false)
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
