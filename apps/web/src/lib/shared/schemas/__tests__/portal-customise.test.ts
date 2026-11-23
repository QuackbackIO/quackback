import { describe, expect, it } from 'vitest'
import { portalThemeSchema } from '../portal-customise'

const lightWith = (key: string, value: string) => ({ light: { [key]: value } })
const accepts = (theme: unknown) => portalThemeSchema.safeParse(theme).success

describe('portalThemeSchema', () => {
  it.each([
    ['primary', 'oklch(0.55 0.2 250)'],
    ['primary', '#0f766e'],
    ['primary', 'rebeccapurple'],
    ['background', 'var(--brand-bg, #fff)'],
    ['fontSans', '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif'],
    ['radius', '0.5rem'],
  ])('accepts %s: %s', (key, value) => {
    expect(accepts(lightWith(key, value))).toBe(true)
  })

  it.each([
    ['a comment that swallows the rest', 'red /*'],
    ['a comment close', 'red */'],
    ['an escape', 'red\\'],
    ['an unclosed bracket', 'rgb(1 2 3'],
    ['a stray closing bracket', 'red)'],
    ['an unclosed quote', '"Inter, sans-serif'],
    ['a block close', 'red } body { color: red'],
    ['a declaration end', 'red; color: blue'],
    ['markup', '<style>'],
  ])('refuses %s', (_name, value) => {
    expect(accepts(lightWith('primary', value))).toBe(false)
  })

  it('takes only the variables the stylesheet generator writes', () => {
    expect(accepts(lightWith('chart1', '#fff'))).toBe(true)
    expect(accepts(lightWith('notAVariable', '#fff'))).toBe(false)
    expect(accepts({ extra: true })).toBe(false)
  })

  it('carries the button shape', () => {
    expect(accepts({ buttonShape: 'pill' })).toBe(true)
    expect(accepts({ buttonShape: 'corners' })).toBe(true)
    expect(accepts({ buttonShape: 'round' })).toBe(false)
  })

  it('carries a custom font, validated like the page save', () => {
    const customFont = {
      family: 'Sohne',
      fallback: 'inter',
      files: [{ key: 'fonts/2026/10/abc-sohne.woff2', weight: 400, style: 'normal' }],
    }
    expect(accepts({ customFont })).toBe(true)
    expect(accepts({ customFont: { ...customFont, family: 'A"B' } })).toBe(false)
    expect(
      accepts({
        customFont: { ...customFont, files: [{ ...customFont.files[0], key: 'fonts/../a.woff2' }] },
      })
    ).toBe(false)
  })
})
