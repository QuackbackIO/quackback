// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('@/lib/client/mutations/settings', () => ({
  useSaveBrandingTheme: () => ({ mutateAsync: vi.fn() }),
}))

import { useBrandingState } from '../use-branding-state'

describe('useBrandingState setThemeMode', () => {
  it('regenerates cssText when it is still generated CSS for the previous mode', () => {
    const { result } = renderHook(() =>
      useBrandingState({
        initialLogoUrl: null,
        initialThemeConfig: { themeMode: 'user' },
        initialCustomCss: '',
      })
    )

    expect(result.current.cssText).toContain(':root')
    expect(result.current.cssText).toContain('.dark')

    act(() => {
      result.current.setThemeMode('light')
    })

    expect(result.current.themeMode).toBe('light')
    expect(result.current.cssText).toContain(':root')
    expect(result.current.cssText).not.toMatch(/\.dark\s*\{/)
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
})
