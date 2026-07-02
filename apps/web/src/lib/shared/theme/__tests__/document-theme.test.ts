import { describe, it, expect } from 'vitest'
import { resolveDocumentTheme, parsePrefersColorScheme } from '../index'

// resolveDocumentTheme decides what `class` and `color-scheme` the server puts
// on <html> so the very first paint already matches the chosen theme. Without
// it the browser shows its default (light) canvas during load and we get a
// white flash before next-themes' inline script swaps in the dark class.
describe('resolveDocumentTheme', () => {
  it('renders the dark class and a dark UA canvas for an explicit dark theme', () => {
    // The server knows the answer (forced-dark portal, or a `theme=dark`
    // cookie), so it must commit to it — color-scheme:dark stops the white
    // canvas even on a light-mode OS.
    expect(resolveDocumentTheme('dark')).toEqual({ className: 'dark', colorScheme: 'dark' })
  })

  it('renders the light class and a light UA canvas for an explicit light theme', () => {
    // Mirrors what next-themes adds client-side (the `light` class) so the
    // class never flips on hydration.
    expect(resolveDocumentTheme('light')).toEqual({ className: 'light', colorScheme: 'light' })
  })

  it('defers the class but lets the OS pick the canvas for system theme without a hint', () => {
    // With no client hint the resolved value is unknowable server-side, so we
    // leave the class off (the inline script adds it) but advertise `light
    // dark` so the browser paints the canvas from the OS preference instead of
    // defaulting to white.
    expect(resolveDocumentTheme('system')).toEqual({
      className: undefined,
      colorScheme: 'light dark',
    })
  })

  it('resolves system to dark when the client hint says dark', () => {
    // Sec-CH-Prefers-Color-Scheme: dark lets the server render the real class
    // and canvas, so even a system user gets a fully server-rendered theme.
    expect(resolveDocumentTheme('system', 'dark')).toEqual({
      className: 'dark',
      colorScheme: 'dark',
    })
  })

  it('resolves system to light when the client hint says light', () => {
    expect(resolveDocumentTheme('system', 'light')).toEqual({
      className: 'light',
      colorScheme: 'light',
    })
  })

  it('ignores the system hint for an explicit theme', () => {
    // An explicit cookie/forced theme always wins; a stale hint never overrides it.
    expect(resolveDocumentTheme('dark', 'light')).toEqual({
      className: 'dark',
      colorScheme: 'dark',
    })
  })
})

describe('parsePrefersColorScheme', () => {
  it('parses the dark and light tokens', () => {
    expect(parsePrefersColorScheme('dark')).toBe('dark')
    expect(parsePrefersColorScheme('light')).toBe('light')
  })

  it('tolerates surrounding whitespace, quotes, and casing', () => {
    expect(parsePrefersColorScheme(' "Dark" ')).toBe('dark')
  })

  it('returns null when the hint is absent or unrecognized', () => {
    expect(parsePrefersColorScheme(null)).toBeNull()
    expect(parsePrefersColorScheme(undefined)).toBeNull()
    expect(parsePrefersColorScheme('')).toBeNull()
    expect(parsePrefersColorScheme('no-preference')).toBeNull()
  })
})
