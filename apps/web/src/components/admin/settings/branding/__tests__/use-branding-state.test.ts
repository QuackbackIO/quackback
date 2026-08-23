// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const { saveBrandingTheme } = vi.hoisted(() => ({
  saveBrandingTheme: vi.fn(async () => undefined),
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

    act(() => {
      result.current.setThemeMode('dark')
    })

    expect(result.current.cssText).toBe(custom)
  })

  it('skips the customCss write when leftover Advanced CSS is unchanged', async () => {
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
      expect.objectContaining({ customCssWrite: 'skip' })
    )
  })

  it('skips the customCss write when leftover extra rules are unchanged after a var edit', async () => {
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
      expect.objectContaining({ customCssWrite: 'skip' })
    )
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
      expect.objectContaining({ customCssWrite: 'persist' })
    )
  })
})

describe('useBrandingState typography', () => {
  it('reads font and radius from the dark block in dark-only CSS', () => {
    const custom = [
      '.dark {',
      '  --font-sans: "Lora", ui-serif, Georgia, serif;',
      '  --radius: 1.25rem;',
      '}',
      '',
    ].join('\n')
    const { result } = renderHook(() =>
      useBrandingState({
        initialLogoUrl: null,
        initialThemeConfig: { themeMode: 'dark' },
        initialCustomCss: custom,
      })
    )

    expect(result.current.font).toBe('"Lora", ui-serif, Georgia, serif')
    expect(result.current.radius).toBe(1.25)
  })
})
