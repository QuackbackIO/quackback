import { describe, expect, it } from 'vitest'
import { extractCssVariables } from '../css-parser'
import {
  DEFAULT_DARK_BASE,
  DEFAULT_FONT_SANS,
  DEFAULT_LIGHT_BASE,
  DEFAULT_RADIUS,
  expandTheme,
  extractMinimal,
} from '../expand'
import { advancedCssRemainder, generateReadableCSS, isGeneratedThemeCss } from '../readable-css'
import type { ThemeMode } from '../types'

// The default theme, as an unbranded workspace gets it.
const shared = { fontSans: DEFAULT_FONT_SANS, radius: DEFAULT_RADIUS }
const lightMinimal = extractMinimal(
  expandTheme({ ...DEFAULT_LIGHT_BASE, ...shared }, { mode: 'light' })
)
const darkMinimal = extractMinimal(
  expandTheme({ ...DEFAULT_DARK_BASE, ...shared }, { mode: 'dark' })
)
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

  it('strips generated theme declarations nested inside at-rules', () => {
    const css = '@layer base { :root { --primary: oklch(0.5 0.2 250); color-scheme: dark; } }\n'
    const remainder = advancedCssRemainder(css)
    expect(remainder).toContain('@layer')
    expect(remainder).toMatch(/color-scheme:\s*dark/)
    expect(remainder).not.toContain('--primary')
  })

  it('treats a generated var with a leading comment as generated', () => {
    const css = ':root { /* primary */ --primary: oklch(0.5 0.2 250); }\n'
    expect(advancedCssRemainder(css)).toBe('')
  })

  it('keeps a derived var whose value differs from expandTheme output', () => {
    const light = { primary: 'oklch(0.5 0.2 250)' }
    const generated = generateReadableCSS(light, {}, 'user')
    const customFg = 'oklch(0.1 0 0)'
    const css = `:root { --primary: oklch(0.5 0.2 250); --primary-foreground: ${customFg}; }\n`
    const remainder = advancedCssRemainder(css, generated)
    expect(remainder).toContain(`--primary-foreground: ${customFg}`)
    expect(remainder).not.toMatch(/--primary:/)
  })

  it('keeps a font-family that differs from the generated stack', () => {
    const generated = generateReadableCSS(lightMinimal, darkMinimal, 'user')
    const css = ':root { --primary: oklch(0.5 0.2 250); font-family: "My Brand"; }\n'
    const remainder = advancedCssRemainder(css, generated)
    expect(remainder).toContain('font-family: "My Brand"')
  })

  it('imports a last declaration without a trailing semicolon', () => {
    const css = ':root { --primary: oklch(0.5 0.2 250); color-scheme: dark }\n'
    const remainder = advancedCssRemainder(css)
    expect(remainder).toMatch(/color-scheme:\s*dark/)
    expect(remainder).not.toContain('--primary')
  })
})

describe('extractCssVariables', () => {
  it('reads a last custom property without a trailing semicolon', () => {
    const vars = extractCssVariables(':root { --primary: oklch(0.5 0.2 250) }')
    expect(vars.light['--primary']).toBe('oklch(0.5 0.2 250)')
  })
})

describe('button shape', () => {
  it('emits --radius-button only for corners', async () => {
    const { generateWorkspaceThemeCSS } = await import('../generator')
    expect(generateWorkspaceThemeCSS({ buttonShape: 'corners' })).toContain(
      '--radius-button: calc(var(--radius) * .75)'
    )
    expect(generateWorkspaceThemeCSS({ buttonShape: 'pill' })).not.toContain('--radius-button')
    expect(generateWorkspaceThemeCSS({})).not.toContain('--radius-button')
    expect(generateWorkspaceThemeCSS(null)).not.toContain('--radius-button')
  })
})

describe('custom font', () => {
  const customFont = {
    family: 'Sohne',
    fallback: 'lora' as const,
    files: [
      { key: 'fonts/2026/10/a-400.woff2', weight: 400, style: 'normal' as const },
      { key: 'fonts/2026/10/a-700.woff2', weight: 700, style: 'normal' as const },
    ],
  }

  it('emits an @font-face per file and puts the family first in the font stack', async () => {
    const { generateWorkspaceThemeCSS } = await import('../generator')
    const css = generateWorkspaceThemeCSS({ customFont })
    expect(css.match(/@font-face/g)).toHaveLength(2)
    expect(css).toContain('url("/api/storage/fonts/2026/10/a-400.woff2") format("woff2")')
    expect(css).toContain('--font-sans: "Sohne", "Lora", ui-serif, Georgia, serif')
    expect(css).toContain('html body { font-family: "Sohne", "Lora", ui-serif, Georgia, serif')
  })

  it('stacks the family ahead of the fallback in dark mode too', async () => {
    const { generateWorkspaceThemeCSS } = await import('../generator')
    const css = generateWorkspaceThemeCSS({ themeMode: 'user', customFont })
    expect(css.match(/--font-sans: "Sohne"/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('leaves the stylesheet alone without a custom font', async () => {
    const { generateWorkspaceThemeCSS } = await import('../generator')
    expect(generateWorkspaceThemeCSS({})).not.toContain('@font-face')
    expect(generateWorkspaceThemeCSS({})).not.toContain('Sohne')
  })

  it('refuses to write a family or key that could end the rule', async () => {
    const { generateWorkspaceThemeCSS } = await import('../generator')
    const bad = generateWorkspaceThemeCSS({
      customFont: { ...customFont, family: 'A"}body{x:y' },
    })
    expect(bad).not.toContain('@font-face')
    expect(bad).not.toContain('body{x:y')
    const badKey = generateWorkspaceThemeCSS({
      customFont: {
        ...customFont,
        files: [{ key: 'fonts/a").x{}.woff2', weight: 400, style: 'normal' }],
      },
    })
    expect(badKey).not.toContain('@font-face')
  })

  it('gives the preview the same faces through the theme extras, and the stack apart', async () => {
    const { themeExtrasCss, customFontStack } = await import('../generator')
    const extras = themeExtrasCss({ customFont })
    expect(extras.match(/@font-face/g)).toHaveLength(2)
    expect(extras).not.toContain('--font-sans')
    expect(customFontStack(customFont)).toBe('"Sohne", "Lora", ui-serif, Georgia, serif')
    expect(customFontStack({ ...customFont, family: 'A"}x' })).toBeNull()
    expect(themeExtrasCss({ customFont: { ...customFont, family: 'A"}x' } })).toBe('')
  })

  it('does not change the generated theme CSS, so it is never an Advanced CSS remainder', () => {
    const generated = generateReadableCSS(lightMinimal, darkMinimal, 'user')
    expect(generated).not.toContain('Sohne')
    expect(advancedCssRemainder(generated, generated)).toBe('')
  })
})
