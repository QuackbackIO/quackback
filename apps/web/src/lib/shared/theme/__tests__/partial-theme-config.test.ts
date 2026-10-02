import { describe, expect, it } from 'vitest'
import { generateThemeCSS, parseThemeConfig } from '../generator'
import type { ThemeConfig } from '../types'

const ROOT = ':root'
const DARK = '.dark'

/**
 * A branding config is a loose JSON blob: the picker writes whichever variables
 * the workspace actually chose, so `{"light":{"primary":"#ff5722"}}` — one
 * colour and nothing else — is an ordinary shape, not a malformed one. Every
 * variable the config leaves out has to come from the neutral base, because a
 * gap reaching the expander used to take down server rendering for every page
 * of that workspace.
 */

/** The exact config shape a workspace gets from choosing a single brand colour. */
const SINGLE_COLOUR_LIGHT = '{"preset":"custom","light":{"primary":"#ff5722"}}'
const SINGLE_COLOUR_DARK = '{"preset":"custom","dark":{"primary":"#ff5722"}}'

/** A config with every variable set, used as the untouched control. */
const FULLY_SPECIFIED: ThemeConfig = {
  themeMode: 'user',
  light: {
    primary: 'oklch(0.55 0.2 250)',
    background: 'oklch(0.99 0.01 250)',
    foreground: 'oklch(0.2 0.02 250)',
    card: 'oklch(0.98 0.01 250)',
    muted: 'oklch(0.95 0.01 250)',
    mutedForeground: 'oklch(0.5 0.02 250)',
    border: 'oklch(0.9 0.01 250)',
    destructive: 'oklch(0.6 0.24 27)',
    success: 'oklch(0.7 0.15 163)',
    ring: 'oklch(0.6 0.19 250)',
    secondary: 'oklch(0.93 0.02 250)',
    accent: 'oklch(0.92 0.03 250)',
    fontSans: '"Inter", ui-sans-serif, system-ui, sans-serif',
    radius: '0.75rem',
  },
  dark: {
    primary: 'oklch(0.7 0.18 250)',
    background: 'oklch(0.16 0.02 250)',
    foreground: 'oklch(0.97 0.01 250)',
    card: 'oklch(0.19 0.02 250)',
    muted: 'oklch(0.28 0.02 250)',
    mutedForeground: 'oklch(0.72 0.02 250)',
    border: 'oklch(0.3 0.02 250)',
    destructive: 'oklch(0.42 0.14 25)',
    success: 'oklch(0.68 0.14 163)',
    ring: 'oklch(0.62 0.17 250)',
    secondary: 'oklch(0.3 0.03 250)',
    accent: 'oklch(0.32 0.04 250)',
    fontSans: '"Inter", ui-sans-serif, system-ui, sans-serif',
    radius: '0.75rem',
  },
}

/**
 * Byte-for-byte output of FULLY_SPECIFIED. A complete config must be unaffected
 * by how gaps are filled: if this literal needs editing, the change started
 * rewriting the CSS every already-branded workspace is served.
 */
const FULLY_SPECIFIED_CSS =
  ROOT +
  ' { --primary: oklch(0.55 0.2 250); --accent-ink: oklch(0.55 0.2 250); --background: oklch(0.99 0.01 250); --foreground: oklch(0.2 0.02 250); --card: oklch(0.98 0.01 250); --muted: oklch(0.95 0.01 250); --muted-foreground: oklch(0.5 0.02 250); --border: oklch(0.9 0.01 250); --destructive: oklch(0.6 0.24 27); --success: oklch(0.7 0.15 163); --primary-foreground: oklch(0.985 0 0); --ring: oklch(0.6 0.19 250); --card-foreground: oklch(0.2 0.02 250); --popover: oklch(0.98 0.01 250); --popover-foreground: oklch(0.2 0.02 250); --secondary: oklch(0.93 0.02 250); --secondary-foreground: oklch(0.2 0.02 250); --accent: oklch(0.92 0.03 250); --accent-foreground: oklch(0.2 0.02 250); --input: oklch(0.9 0.01 250); --destructive-foreground: oklch(0.985 0 0); --chart-1: oklch(0.55 0.2 250); --chart-2: oklch(0.550 0.200 28); --chart-3: oklch(0.550 0.200 165); --chart-4: oklch(0.550 0.200 303); --chart-5: oklch(0.550 0.200 80); --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif; --radius: 0.75rem; --shadow-2xs: 0 0 0 0 transparent; --shadow-xs: 0 0 0 0 transparent; --shadow-sm: 0 0 0 1px oklch(0 0 0 / 0.04); --shadow: 0 0 0 1px oklch(0 0 0 / 0.06); --shadow-md: 0 4px 16px oklch(0 0 0 / 0.08); --shadow-lg: 0 8px 24px oklch(0 0 0 / 0.1); --shadow-xl: 0 12px 32px oklch(0 0 0 / 0.12); --shadow-2xl: 0 16px 40px oklch(0 0 0 / 0.16); } ' +
  DARK +
  ' { --primary: oklch(0.7 0.18 250); --accent-ink: oklch(0.7 0.18 250); --background: oklch(0.16 0.02 250); --foreground: oklch(0.97 0.01 250); --card: oklch(0.19 0.02 250); --muted: oklch(0.28 0.02 250); --muted-foreground: oklch(0.72 0.02 250); --border: oklch(0.3 0.02 250); --destructive: oklch(0.42 0.14 25); --success: oklch(0.68 0.14 163); --primary-foreground: oklch(0.145 0 0); --ring: oklch(0.62 0.17 250); --card-foreground: oklch(0.97 0.01 250); --popover: oklch(0.19 0.02 250); --popover-foreground: oklch(0.97 0.01 250); --secondary: oklch(0.3 0.03 250); --secondary-foreground: oklch(0.97 0.01 250); --accent: oklch(0.32 0.04 250); --accent-foreground: oklch(0.97 0.01 250); --input: oklch(0.3 0.02 250); --destructive-foreground: oklch(0.985 0 0); --chart-1: oklch(0.7 0.18 250); --chart-2: oklch(0.700 0.180 28); --chart-3: oklch(0.700 0.180 165); --chart-4: oklch(0.700 0.180 303); --chart-5: oklch(0.700 0.180 80); --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif; --radius: 0.75rem; --shadow-2xs: 0 0 0 0 transparent; --shadow-xs: 0 0 0 0 transparent; --shadow-sm: 0 0 0 1px oklch(1 0 0 / 0.06); --shadow: 0 0 0 1px oklch(1 0 0 / 0.08); --shadow-md: 0 8px 24px oklch(0 0 0 / 0.4); --shadow-lg: 0 12px 32px oklch(0 0 0 / 0.5); --shadow-xl: 0 16px 40px oklch(0 0 0 / 0.55); --shadow-2xl: 0 20px 48px oklch(0 0 0 / 0.6); } ' +
  'body { --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif; --radius: 0.75rem; } ' +
  'html body { font-family: "Inter", ui-sans-serif, system-ui, sans-serif !important; }'

/** Read one declaration out of a generated block, e.g. ROOT, `--ring`. */
function readVar(css: string, selector: string, cssVar: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  if (!block) return null
  const declaration = new RegExp(`${cssVar}:\\s*([^;]+);`).exec(block[1])
  return declaration ? declaration[1] : null
}

describe('generateThemeCSS with a partially-specified config', () => {
  it('renders a light config that sets only a primary colour', () => {
    const config = parseThemeConfig(SINGLE_COLOUR_LIGHT)
    expect(config).not.toBeNull()

    const css = generateThemeCSS(config as ThemeConfig)

    expect(readVar(css, ROOT, '--primary')).toBe('#ff5722')
    // Everything the workspace left out still gets a value, so the page paints
    // a complete theme rather than a half-applied one.
    expect(readVar(css, ROOT, '--background')).toBe('#ffffff')
    expect(readVar(css, ROOT, '--foreground')).toBe('#0a0a0a')
    expect(readVar(css, ROOT, '--card')).toBe('#ffffff')
    expect(readVar(css, ROOT, '--muted')).toBe('#f5f5f5')
    expect(readVar(css, ROOT, '--muted-foreground')).toBe('#525252')
    expect(readVar(css, ROOT, '--border')).toBe('#d4d4d4')
    expect(readVar(css, ROOT, '--destructive')).toBe('oklch(0.577 0.245 27)')
    expect(readVar(css, ROOT, '--success')).toBe('oklch(0.49 0.115 165.6)')
    // Derived variables follow the colour that was chosen, not the base's.
    // (Only the pass-through ones: the derivations that read a colour's
    // lightness and hue expect oklch, and fall back when handed hex.)
    expect(readVar(css, ROOT, '--ring')).toBe('#ff5722')
    // A config with no dark half still gets the dark base, so the page paints a
    // complete theme in either mode.
    expect(readVar(css, DARK, '--background')).toBe('#0a0a0a')
    expect(readVar(css, DARK, '--primary')).toBe('oklch(0.886 0.176 86)')
  })

  it('renders a dark config that sets only a primary colour', () => {
    const config = parseThemeConfig(SINGLE_COLOUR_DARK)
    expect(config).not.toBeNull()

    const css = generateThemeCSS(config as ThemeConfig)

    expect(readVar(css, DARK, '--primary')).toBe('#ff5722')
    // The dark gaps fill from the dark base, not the light one.
    expect(readVar(css, DARK, '--background')).toBe('#0a0a0a')
    expect(readVar(css, DARK, '--foreground')).toBe('#fafafa')
    expect(readVar(css, DARK, '--card')).toBe('#0f0f0f')
    expect(readVar(css, DARK, '--muted')).toBe('#222222')
    expect(readVar(css, DARK, '--muted-foreground')).toBe('#a1a1a1')
    expect(readVar(css, DARK, '--border')).toBe('#262626')
    expect(readVar(css, DARK, '--destructive')).toBe('oklch(0.70 0.19 25)')
    expect(readVar(css, DARK, '--success')).toBe('oklch(0.696 0.149 163)')
    expect(readVar(css, DARK, '--ring')).toBe('#ff5722')
    expect(readVar(css, ROOT, '--background')).toBe('#ffffff')
  })

  it('fills both halves when both halves are partial', () => {
    const css = generateThemeCSS({
      themeMode: 'user',
      light: { primary: 'oklch(0.55 0.2 250)' },
      dark: { primary: 'oklch(0.7 0.18 250)' },
    })

    expect(readVar(css, ROOT, '--background')).toBe('#ffffff')
    expect(readVar(css, DARK, '--background')).toBe('#0a0a0a')
    expect(readVar(css, ROOT, '--primary')).toBe('oklch(0.55 0.2 250)')
    expect(readVar(css, DARK, '--primary')).toBe('oklch(0.7 0.18 250)')
    // Derived from the chosen primary in each half, not from the base's.
    expect(readVar(css, ROOT, '--chart-1')).toBe('oklch(0.55 0.2 250)')
    expect(readVar(css, DARK, '--chart-1')).toBe('oklch(0.7 0.18 250)')
  })

  it('renders a forced-dark partial config into the :root block', () => {
    const css = generateThemeCSS({ themeMode: 'dark', dark: { primary: '#ff5722' } })

    expect(readVar(css, ROOT, '--primary')).toBe('#ff5722')
    expect(readVar(css, ROOT, '--background')).toBe('#0a0a0a')
    expect(css).not.toContain('.dark:where')
  })

  it('never overwrites a variable the workspace set', () => {
    // A pale destructive is nothing like the base's, and its foreground is
    // computed from it — proof the chosen value reached the expander intact.
    const css = generateThemeCSS({ light: { destructive: 'oklch(0.95 0.05 27)' } })

    expect(readVar(css, ROOT, '--destructive')).toBe('oklch(0.95 0.05 27)')
    expect(readVar(css, ROOT, '--destructive-foreground')).toBe('oklch(0.145 0 0)')
    expect(readVar(css, ROOT, '--primary')).toBe('oklch(0.886 0.176 86)')
  })

  it('treats a null-valued variable as unset rather than as a choice', () => {
    // JSON has no undefined, so a cleared variable arrives as null.
    const config = parseThemeConfig('{"light":{"primary":null,"card":"oklch(0.98 0 0)"}}')

    const css = generateThemeCSS(config as ThemeConfig)

    expect(readVar(css, ROOT, '--primary')).toBe('oklch(0.886 0.176 86)')
    expect(readVar(css, ROOT, '--card')).toBe('oklch(0.98 0 0)')
  })

  it('leaves a fully-specified config byte-for-byte unchanged', () => {
    expect(generateThemeCSS(FULLY_SPECIFIED)).toBe(FULLY_SPECIFIED_CSS)
  })

  it('handles an empty or absent config', () => {
    // An absent branding config still renders the default tokens.
    expect(readVar(generateThemeCSS({}), ROOT, '--background')).toBe('#ffffff')
    expect(generateThemeCSS(null as unknown as ThemeConfig)).toBe('')
    expect(parseThemeConfig(null)).toBeNull()
    expect(parseThemeConfig('not json')).toBeNull()

    // An empty half is still a half: it renders the base theme, not a crash.
    const css = generateThemeCSS({ light: {} })
    expect(readVar(css, ROOT, '--primary')).toBe('oklch(0.886 0.176 86)')
    expect(readVar(css, ROOT, '--background')).toBe('#ffffff')
    // No font was chosen, so none is forced onto the page.
    expect(css).not.toContain('--font-sans')
    expect(css).not.toContain('font-family')
  })
})
