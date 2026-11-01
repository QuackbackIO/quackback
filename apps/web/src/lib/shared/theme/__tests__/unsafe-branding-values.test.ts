import { describe, expect, it } from 'vitest'
import { generateThemeCSS } from '../generator'

/**
 * A branding row saved before values were checked can still hold text that
 * would end its declaration. Rendering treats such a value as absent, so the
 * row loads and the base palette fills the gap.
 */
describe('generateThemeCSS with unsafe stored values', () => {
  it('ignores a colour that would end its declaration', () => {
    const css = generateThemeCSS({ light: { primary: 'red; } body { display: none' } })
    expect(css).not.toContain('display: none')
    expect(css).toBe(generateThemeCSS({}))
  })

  it('ignores a font stack that would close the style element', () => {
    const css = generateThemeCSS({ light: { fontSans: 'Inter</style><script>x</script>' } })
    expect(css).not.toContain('</style>')
    expect(css).toBe(generateThemeCSS({}))
  })

  it('ignores an unsafe dark value and keeps the safe ones beside it', () => {
    const css = generateThemeCSS({
      themeMode: 'user',
      dark: { primary: '#0F766E', background: 'black}' },
    })
    expect(css).not.toContain('black}')
    expect(css).toBe(generateThemeCSS({ themeMode: 'user', dark: { primary: '#0F766E' } }))
  })

  it('still writes a safe colour', () => {
    expect(generateThemeCSS({ light: { primary: '#0F766E' } })).toContain('--primary: #0F766E;')
  })
})
