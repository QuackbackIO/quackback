// @vitest-environment happy-dom
/**
 * A portal can force a theme; the admin never does. Moving between them in the
 * browser keeps one ThemeProvider mounted and changes its props, so the
 * provider has to show the visitor's own theme the moment the force lifts,
 * without a reload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme-provider'
import { documentThemeProviderProps } from '@/lib/shared/theme'

function mockSystemTheme(scheme: 'light' | 'dark') {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' && scheme === 'dark',
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }))
  )
}

function Doc({ forcedTheme }: { forcedTheme?: 'light' | 'dark' }) {
  return (
    <ThemeProvider
      attribute="class"
      {...documentThemeProviderProps({ forcedTheme, themeCookie: undefined })}
      syncCookie={false}
    >
      <p>page</p>
    </ThemeProvider>
  )
}

const htmlClasses = () => [...document.documentElement.classList]

describe('leaving a portal that forces a theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the dark system theme in the admin after a forced-dark portal', () => {
    mockSystemTheme('dark')
    localStorage.setItem('theme', 'system')
    const { rerender } = render(<Doc forcedTheme="dark" />)
    expect(htmlClasses()).toContain('dark')

    rerender(<Doc />)
    expect(htmlClasses()).toContain('dark')
    expect(htmlClasses()).not.toContain('system')
  })

  it('shows the dark system theme in the admin after a forced-light portal', () => {
    mockSystemTheme('dark')
    const { rerender } = render(<Doc forcedTheme="light" />)
    expect(htmlClasses()).toContain('light')

    rerender(<Doc />)
    expect(htmlClasses()).toEqual(['dark'])
  })

  it("never takes the portal's forced theme as the visitor's own", () => {
    mockSystemTheme('light')
    const { rerender } = render(<Doc forcedTheme="dark" />)
    rerender(<Doc />)
    // No stored preference: the visitor's theme is their system's, not the portal's.
    expect(htmlClasses()).toEqual(['light'])
  })
})

describe('documentThemeProviderProps', () => {
  it('keeps system resolution on and the default on the preference, forced or not', () => {
    expect(documentThemeProviderProps({ forcedTheme: 'dark', themeCookie: 'light' })).toEqual({
      defaultTheme: 'light',
      enableSystem: true,
      forcedTheme: 'dark',
    })
    expect(documentThemeProviderProps({ forcedTheme: undefined, themeCookie: undefined })).toEqual({
      defaultTheme: 'system',
      enableSystem: true,
      forcedTheme: undefined,
    })
  })
})
