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

  it.each(['pill', 'corners'])('accepts buttonShape %s', (buttonShape) => {
    expect(updateThemeSchema.parse({ brandingConfig: { buttonShape } }).brandingConfig).toEqual({
      buttonShape,
    })
  })

  it.each([['square'], [''], [7], [null], [{}]])('rejects buttonShape %j', (buttonShape) => {
    expect(updateThemeSchema.safeParse({ brandingConfig: { buttonShape } }).success).toBe(false)
  })

  describe('customFont', () => {
    const good = {
      family: 'Sohne',
      fallback: 'inter',
      files: [{ key: 'fonts/2026/10/abc-sohne.woff2', weight: 400, style: 'normal' }],
    }
    const parse = (customFont: unknown) =>
      updateThemeSchema.safeParse({ brandingConfig: { customFont } }).success

    it('accepts an uploaded family', () => {
      expect(parse(good)).toBe(true)
      expect(parse({ ...good, family: 'Noto IKEA Latin-2' })).toBe(true)
    })

    it.each([
      ['url(', 'a url(x)'],
      ['a quote', 'A"B'],
      ['an apostrophe', "A'B"],
      ['a paren', 'A)'],
      ['a semicolon', 'A;B'],
      ['a brace', 'A{B}'],
      ['a slash', 'A/B'],
      ['empty', ''],
      ['over 64 characters', 'a'.repeat(65)],
    ])('rejects a family with %s', (_label, family) => {
      expect(parse({ ...good, family })).toBe(false)
    })

    it.each([
      'fonts/../x.woff2',
      'fonts/a").x{}.woff2',
      "fonts/a'b.woff2",
      'fonts/a;b.woff2',
      'logos/a.woff2',
      '/fonts/a.woff2',
      'fonts/a.png',
      'https://evil.example/a.woff2',
    ])('rejects the key %s', (key) => {
      expect(parse({ ...good, files: [{ ...good.files[0], key }] })).toBe(false)
    })

    it('holds files, weights, styles and fallback to their sets', () => {
      expect(parse({ ...good, files: [] })).toBe(false)
      expect(parse({ ...good, files: Array(7).fill(good.files[0]) })).toBe(false)
      expect(parse({ ...good, files: [{ ...good.files[0], weight: 50 }] })).toBe(false)
      expect(parse({ ...good, files: [{ ...good.files[0], style: 'oblique' }] })).toBe(false)
      expect(parse({ ...good, fallback: 'comic-sans' })).toBe(false)
      expect(parse({ ...good, extra: 1 })).toBe(false)
      expect(parse(null)).toBe(false)
    })
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

  it('holds a headings font to a font stack, as the text font is: never a colour, never CSS', () => {
    const manrope = '"Manrope", ui-sans-serif, system-ui, sans-serif'
    expect(brandingPatchSchema.parse({ light: { fontHeading: manrope } })).toEqual({
      light: { fontHeading: manrope },
    })
    expect(
      brandingPatchSchema.safeParse({ light: { fontHeading: 'x; } body { display: none' } }).success
    ).toBe(false)
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
