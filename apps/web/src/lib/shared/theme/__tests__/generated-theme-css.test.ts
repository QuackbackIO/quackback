import { describe, expect, it } from 'vitest'
import { extractMinimal } from '../expand'
import { generateReadableCSS, isGeneratedThemeCss } from '../generator'
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
