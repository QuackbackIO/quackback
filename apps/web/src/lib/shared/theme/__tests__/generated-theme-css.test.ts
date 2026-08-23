import { describe, expect, it } from 'vitest'
import { extractMinimal } from '../expand'
import { advancedCssRemainder, generateReadableCSS, isGeneratedThemeCss } from '../generator'
import { themePresets } from '../presets'
import type { ThemeMode } from '../types'

const lightMinimal = extractMinimal(themePresets.default.light)
const darkMinimal = extractMinimal(themePresets.default.dark)
const THEME_MODES: ThemeMode[] = ['user', 'light', 'dark']

describe('isGeneratedThemeCss', () => {
  it('returns true for generated CSS in every theme mode', () => {
    for (const mode of THEME_MODES) {
      const css = generateReadableCSS(lightMinimal, darkMinimal, mode)
      expect(isGeneratedThemeCss(css, lightMinimal, darkMinimal)).toBe(true)
    }
  })

  it('returns false when generated CSS has an extra rule', () => {
    const css = generateReadableCSS(lightMinimal, darkMinimal, 'user')
    expect(isGeneratedThemeCss(`${css}\n.brand { color: red; }\n`, lightMinimal, darkMinimal)).toBe(
      false
    )
  })

  it('treats CSS generated for a different mode as generated, not Advanced CSS', () => {
    const userCss = generateReadableCSS(lightMinimal, darkMinimal, 'user')
    const lightCss = generateReadableCSS(lightMinimal, darkMinimal, 'light')
    expect(userCss).not.toBe(lightCss)
    expect(isGeneratedThemeCss(userCss, lightMinimal, darkMinimal)).toBe(true)
    expect(isGeneratedThemeCss(lightCss, lightMinimal, darkMinimal)).toBe(true)
  })
})

describe('advancedCssRemainder', () => {
  it('returns empty for generated CSS', () => {
    const css = generateReadableCSS(lightMinimal, darkMinimal, 'user')
    expect(advancedCssRemainder(css)).toBe('')
  })

  it('returns extra rules after stripping theme blocks', () => {
    const css = generateReadableCSS(lightMinimal, darkMinimal, 'user')
    expect(advancedCssRemainder(`${css}\n.brand { color: red; }\n`)).toBe('.brand { color: red; }')
  })

  it('keeps unknown declarations inside :root after stripping generated vars', () => {
    const css = ':root { --primary: oklch(0.5 0.2 250); color-scheme: dark; }\n'
    const remainder = advancedCssRemainder(css)
    expect(remainder).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/)
    expect(remainder).not.toContain('--primary')
  })

  it('does not split on a semicolon inside a declaration value', () => {
    const css = ':root { --primary: oklch(0.5 0.2 250); --logo: url(data:image/png;base64,abc); }\n'
    const remainder = advancedCssRemainder(css)
    expect(remainder).toContain('--logo: url(data:image/png;base64,abc)')
    expect(remainder).not.toContain('--primary')
  })

  it('does not end a :root block on a quoted brace', () => {
    const css = ':root { --token: "}"; color-scheme: dark; }\n'
    const remainder = advancedCssRemainder(css)
    expect(remainder).toContain('--token: "}"')
    expect(remainder).toMatch(/color-scheme:\s*dark/)
  })
})
