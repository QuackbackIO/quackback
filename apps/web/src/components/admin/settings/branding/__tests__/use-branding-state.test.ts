// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

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
