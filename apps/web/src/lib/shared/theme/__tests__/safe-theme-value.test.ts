import { describe, expect, it } from 'vitest'
import { isSafeThemeValue, THEME_VALUE_MAX_LENGTH } from '../safe-theme-value'

describe('isSafeThemeValue', () => {
  it.each([
    ['a hex colour', '#0F766E'],
    ['an oklch colour', 'oklch(0.55 0.12 180)'],
    ['an hsl colour with angle units', 'hsl(220deg 50% 40%)'],
    ['a named colour', 'rebeccapurple'],
    ['a color-mix() colour', 'color-mix(in oklch, white 40%, black)'],
    ['a CSS variable', 'var(--brand)'],
    ['a quoted font stack', '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif'],
    ['a radius', '0.625rem'],
    ['a unitless radius', '0'],
  ])('accepts %s', (_label, value) => {
    expect(isSafeThemeValue(value)).toBe(true)
  })

  it.each([
    ['a semicolon that ends the declaration', 'red; } body { display: none'],
    ['a closing brace', 'red}'],
    ['an opening brace', 'red { color: blue'],
    ['markup that closes the style element', 'red</style><script>alert(1)</script>'],
    ['a comment', 'red /* hidden */'],
    ['a resource load', 'url(https://example.com/track.png)'],
    ['an at-rule', '@import "https://example.com/x.css"'],
    ['a CSS escape', 'red\\3b'],
    ['a newline', 'red\nblue'],
    ['an over-long value', 'a'.repeat(THEME_VALUE_MAX_LENGTH + 1)],
  ])('refuses %s', (_label, value) => {
    expect(isSafeThemeValue(value)).toBe(false)
  })
})
