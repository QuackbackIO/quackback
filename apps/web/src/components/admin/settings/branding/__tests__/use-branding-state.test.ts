// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { generateWorkspaceThemeCSS, replaceCssVar, type ThemeConfig } from '@/lib/shared/theme'

const { saveBrandingTheme } = vi.hoisted(() => ({
  saveBrandingTheme: vi.fn(
    async (_input: {
      brandingConfig: Record<string, unknown>
      customCss: string
      customCssWrite: 'persist' | 'clear' | 'rewrite'
    }) => undefined
  ),
}))

vi.mock('@/lib/client/mutations/settings', () => ({
  useSaveBrandingTheme: () => ({ mutateAsync: saveBrandingTheme }),
}))

import { useBrandingState } from '../use-branding-state'

beforeEach(() => {
  saveBrandingTheme.mockClear()
})

describe('useBrandingState setThemeMode', () => {
  it('keeps both palettes in cssText when switching from user to light', () => {
    const { result } = renderHook(() =>
      useBrandingState({
        initialLogoUrl: null,
        initialThemeConfig: { themeMode: 'user' },
        initialCustomCss: '',
      })
    )

    expect(result.current.cssText).toContain(':root')
    expect(result.current.cssText).toMatch(/\.dark\s*\{/)

    act(() => {
      result.current.setThemeMode('light')
    })

    expect(result.current.themeMode).toBe('light')
    expect(result.current.cssText).toContain(':root')
    expect(result.current.cssText).toMatch(/\.dark\s*\{/)
  })

  it('leaves Advanced CSS extra rules untouched', () => {
    const custom = ':root { --primary: oklch(0.5 0.2 250); }\n.brand { color: red; }\n'
    const { result } = renderHook(() =>
      useBrandingState({
        initialLogoUrl: null,
        initialThemeConfig: { themeMode: 'user' },
        initialCustomCss: custom,
      })
    )

    const before = result.current.cssText
    act(() => {
      result.current.setThemeMode('dark')
    })

    expect(result.current.cssText).toBe(before)
    expect(result.current.cssText).toContain('.brand { color: red; }')
  })

  it('rewrites leftover Advanced CSS as remainder-only when extras are unchanged', async () => {
    const leftover = ':root { --primary: oklch(0.5 0.2 250); }\n.brand { color: red; }\n'
    const { result } = renderHook(() =>
      useBrandingState({
        initialLogoUrl: null,
        initialThemeConfig: { themeMode: 'user' },
        initialCustomCss: leftover,
      })
    )

    act(() => {
      result.current.setThemeMode('light')
    })
    await act(async () => {
      await result.current.saveTheme()
    })

    expect(saveBrandingTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        customCssWrite: 'rewrite',
        customCss: expect.stringContaining('.brand { color: red; }'),
      })
    )
    expect(saveBrandingTheme.mock.calls[0]?.[0].customCss).not.toContain('--primary')
  })

  it('rewrites remainder-only CSS after a colour/var edit that leaves extras unchanged', async () => {
    const leftover = [
      ':root { --primary: oklch(0.5 0.2 250); --radius: 0.625rem; }',
      '.dark { --primary: oklch(0.7 0.2 250); --radius: 0.625rem; }',
      '.brand { color: red; }',
      '',
    ].join('\n')
    const { result } = renderHook(() =>
      useBrandingState({
        initialLogoUrl: null,
        initialThemeConfig: { themeMode: 'user' },
        initialCustomCss: leftover,
      })
    )

    act(() => {
      result.current.setRadius(1.25)
    })
    await act(async () => {
      await result.current.saveTheme()
    })

    expect(result.current.cssText).toContain('1.25rem')
    expect(result.current.cssText).toContain('.brand { color: red; }')
    expect(saveBrandingTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        customCssWrite: 'rewrite',
        customCss: expect.stringContaining('.brand { color: red; }'),
      })
    )
    expect(saveBrandingTheme.mock.calls[0]?.[0].customCss).not.toContain('--primary')
    expect(saveBrandingTheme.mock.calls[0]?.[0].customCss).not.toContain('--radius')
  })

  it('clears stored customCss when cssText is generated theme CSS', async () => {
    const { result } = renderHook(() =>
      useBrandingState({
        initialLogoUrl: null,
        initialThemeConfig: { themeMode: 'user' },
        initialCustomCss: '',
      })
    )

    await act(async () => {
      await result.current.saveTheme()
    })

    expect(saveBrandingTheme).toHaveBeenCalledWith(
      expect.objectContaining({ customCssWrite: 'clear' })
    )
  })

  it('persists when leftover extra rules themselves change', async () => {
    const leftover = ':root { --primary: oklch(0.5 0.2 250); }\n.brand { color: red; }\n'
    const { result } = renderHook(() =>
      useBrandingState({
        initialLogoUrl: null,
        initialThemeConfig: { themeMode: 'user' },
        initialCustomCss: leftover,
      })
    )

    act(() => {
      result.current.setCssText(`${leftover}.hero { color: blue; }\n`)
    })
    await act(async () => {
      await result.current.saveTheme()
    })

    expect(saveBrandingTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        customCssWrite: 'persist',
        customCss: expect.stringContaining('.hero { color: blue; }'),
      })
    )
    expect(saveBrandingTheme.mock.calls[0]?.[0].customCss).not.toContain('--primary')
  })
})

describe('useBrandingState typography', () => {
  it('reads font and radius from the dark block in dark-only CSS', () => {
    const { result } = renderHook(() =>
      useBrandingState({
        initialLogoUrl: null,
        initialThemeConfig: {
          themeMode: 'dark',
          dark: {
            fontSans: '"Lora", ui-serif, Georgia, serif',
            radius: '1.25rem',
          },
        },
        initialCustomCss: '',
      })
    )

    expect(result.current.font).toBe('"Lora", ui-serif, Georgia, serif')
    expect(result.current.radius).toBe(1.25)
  })
})

describe('useBrandingState initial cssText', () => {
  it('seeds generated theme CSS from brandingConfig and appends remainder-only custom CSS', () => {
    const customPrimary = 'oklch(0.55 0.2 250)'
    const { result } = renderHook(() =>
      useBrandingState({
        initialLogoUrl: null,
        initialThemeConfig: {
          themeMode: 'user',
          light: { primary: customPrimary },
          dark: { primary: customPrimary },
        },
        initialCustomCss: '.brand { color: red; }',
      })
    )

    expect(result.current.cssText).toContain(`--primary: ${customPrimary}`)
    expect(result.current.cssText).toContain('.brand { color: red; }')
    expect(result.current.cssText).not.toBe('.brand { color: red; }')
  })

  it('seeds both palettes when themeMode is light so the dark side survives', () => {
    const darkPrimary = 'oklch(0.4 0.2 250)'
    const { result } = renderHook(() =>
      useBrandingState({
        initialLogoUrl: null,
        initialThemeConfig: {
          themeMode: 'light',
          dark: { primary: darkPrimary },
        },
        initialCustomCss: '',
      })
    )

    expect(result.current.themeMode).toBe('light')
    expect(result.current.cssText).toMatch(/\.dark\s*\{/)
    expect(result.current.parsedCssVariables.dark['--primary']).toBe(darkPrimary)
  })

  it('keeps a CSS-only palette when brandingConfig is empty', () => {
    const cssPrimary = 'oklch(0.55 0.2 250)'
    const { result } = renderHook(() =>
      useBrandingState({
        initialLogoUrl: null,
        initialThemeConfig: { themeMode: 'user' },
        initialCustomCss: `:root { --primary: ${cssPrimary}; }\n.brand { color: red; }\n`,
      })
    )

    expect(result.current.parsedCssVariables.light['--primary']).toBe(cssPrimary)
    expect(result.current.cssText).toContain('.brand { color: red; }')
  })
})

// What a visitor sees on a workspace that never customised its theme comes
// from the stylesheets: globals.css, and for the refined baseline its Labs
// stylesheet on top. The editor has to start from exactly that.
const SRC = join(__dirname, '../../../../..')
const globalsCss = readFileSync(join(SRC, 'globals.css'), 'utf8')
const refinedCss = readFileSync(join(SRC, 'styles/labs/refined-theme.css'), 'utf8')

function cssBlock(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no ${selector} block`)
  const body = css.slice(start + selector.length + 2, css.indexOf('}', start))
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
  )
}

const STYLESHEETS = {
  globalsLight: cssBlock(globalsCss, ':root'),
  globalsDark: cssBlock(globalsCss, '.dark'),
  refinedLight: cssBlock(refinedCss, ":root:where([data-visual-theme='refined'])"),
  refinedDark: cssBlock(refinedCss, ".dark:where([data-visual-theme='refined'])"),
}

/** The value an unbranded page resolves for `cssVar`. */
function unbranded(baseline: 'legacy' | 'refined', mode: 'light' | 'dark', cssVar: string) {
  const { globalsLight, globalsDark, refinedLight, refinedDark } = STYLESHEETS
  const refined = baseline === 'refined'
  const layers =
    mode === 'dark'
      ? [refined ? refinedDark : {}, globalsDark, refined ? refinedLight : {}, globalsLight]
      : [refined ? refinedLight : {}, globalsLight]
  return layers.find((layer) => layer[cssVar])?.[cssVar]
}

/** The theme a workspace stores, and the variable each key is rendered as. */
const STORED_AS = {
  primary: '--primary',
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  border: '--border',
  destructive: '--destructive',
  success: '--success',
  radius: '--radius',
  fontSans: '--font-sans',
}

/** Declarations per selector in generated theme CSS. */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    for (const decl of body.split(';')) {
      const at = decl.indexOf(':')
      if (at < 0) continue
      out.set(`${selector.trim()} ${decl.slice(0, at).trim()}`, decl.slice(at + 1).trim())
    }
  }
  return out
}

function renderUntouched(baseline: 'legacy' | 'refined') {
  return renderHook(() =>
    useBrandingState({
      initialLogoUrl: null,
      initialThemeConfig: {},
      initialCustomCss: '',
      baseline,
    })
  )
}

describe.each(['legacy', 'refined'] as const)(
  'useBrandingState on an uncustomised %s workspace',
  (baseline) => {
    it('saves what visitors already see when one colour changes', async () => {
      const { result } = renderUntouched(baseline)
      const primary = 'oklch(0.55 0.2 250)'
      act(() => {
        result.current.setCssText(replaceCssVar(result.current.cssText, '--primary', primary))
      })
      await act(async () => {
        await result.current.saveTheme()
      })

      const saved = saveBrandingTheme.mock.calls[0]![0].brandingConfig as ThemeConfig
      for (const mode of ['light', 'dark'] as const) {
        const stored = saved[mode] as Record<string, string>
        for (const [key, cssVar] of Object.entries(STORED_AS)) {
          const expected = key === 'primary' ? primary : unbranded(baseline, mode, cssVar)
          expect(stored[key], `${mode} ${key}`).toBe(expected)
        }
      }
    })

    it('shows the font and radius visitors see, with Default as the preset', () => {
      const { result } = renderUntouched(baseline)
      expect(result.current.font).toBe(unbranded(baseline, 'light', '--font-sans'))
      expect(result.current.currentFontId).toBe('inter')
      expect(`${result.current.radius}rem`).toBe(unbranded(baseline, 'light', '--radius'))
      expect(result.current.activePresetId).toBe('default')
    })
  }
)

describe('useBrandingState on an uncustomised refined workspace', () => {
  it('saves a theme the portal renders exactly as the unbranded one', async () => {
    const { result } = renderUntouched('refined')
    await act(async () => {
      await result.current.saveTheme()
    })

    const saved = saveBrandingTheme.mock.calls[0]![0].brandingConfig as ThemeConfig
    const before = declarations(generateWorkspaceThemeCSS({}, 'refined'))
    const after = declarations(generateWorkspaceThemeCSS(saved, 'refined'))
    expect(before.size).toBeGreaterThan(0)
    for (const [declaration, value] of before) {
      expect(after.get(declaration), declaration).toBe(value)
    }
  })
})
