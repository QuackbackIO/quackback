// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useTheme } from 'next-themes'
import { ThemeProvider } from '@/components/theme-provider'

function clearThemeCookie() {
  document.cookie = 'theme=; Path=/; Max-Age=0'
}

function Probe() {
  const { setTheme } = useTheme()
  return (
    <button type="button" onClick={() => setTheme('dark')}>
      switch dark
    </button>
  )
}

describe('ThemeProvider cookie sync (#965)', () => {
  beforeEach(() => {
    localStorage.clear()
    clearThemeCookie()
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      }))
    )
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    clearThemeCookie()
    vi.unstubAllGlobals()
  })

  it('does not write a theme cookie on initial mount, and writes one when the user changes theme', async () => {
    render(
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <Probe />
      </ThemeProvider>
    )
    expect(document.cookie).toBe('')

    await act(async () => {
      screen.getByRole('button', { name: 'switch dark' }).click()
    })
    expect(document.cookie).toContain('theme=dark')
  })
})
