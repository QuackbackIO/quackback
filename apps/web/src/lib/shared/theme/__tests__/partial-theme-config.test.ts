import { describe, expect, it } from 'vitest'
import { generateThemeCSS, parseThemeConfig } from '../generator'
import type { ThemeConfig } from '../types'

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
 * Byte-for-byte output of FULLY_SPECIFIED, recorded before partial configs were
 * made safe. A complete config must be unaffected by that work: if this literal
 * needs editing, the change stopped being additive and started rewriting the
 * CSS every already-branded workspace is served.
 */
const FULLY_SPECIFIED_CSS =
  ':root { --primary: oklch(0.55 0.2 250); --background: oklch(0.99 0.01 250); --foreground: oklch(0.2 0.02 250); --card: oklch(0.98 0.01 250); --muted: oklch(0.95 0.01 250); --muted-foreground: oklch(0.5 0.02 250); --border: oklch(0.9 0.01 250); --destructive: oklch(0.6 0.24 27); --success: oklch(0.7 0.15 163); --primary-foreground: oklch(0.985 0 0); --ring: oklch(0.6 0.19 250); --card-foreground: oklch(0.2 0.02 250); --popover: oklch(0.98 0.01 250); --popover-foreground: oklch(0.2 0.02 250); --secondary: oklch(0.93 0.02 250); --secondary-foreground: oklch(0.2 0.02 250); --accent: oklch(0.92 0.03 250); --accent-foreground: oklch(0.2 0.02 250); --input: oklch(0.9 0.01 250); --destructive-foreground: oklch(0.985 0 0); --chart-1: oklch(0.55 0.2 250); --chart-2: oklch(0.550 0.200 28); --chart-3: oklch(0.550 0.200 165); --chart-4: oklch(0.550 0.200 303); --chart-5: oklch(0.550 0.200 80); --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif; --radius: 0.75rem; --shadow-2xs: 0 1px oklch(0 0 0 / 0.05); --shadow-xs: 0 1px 2px 0 oklch(0 0 0 / 0.05); --shadow-sm: 0 1px 3px 0 oklch(0 0 0 / 0.1), 0 1px 2px -1px oklch(0 0 0 / 0.1); --shadow: 0 1px 3px 0 oklch(0 0 0 / 0.1), 0 1px 2px -1px oklch(0 0 0 / 0.1); --shadow-md: 0 4px 6px -1px oklch(0 0 0 / 0.1), 0 2px 4px -2px oklch(0 0 0 / 0.1); --shadow-lg: 0 10px 15px -3px oklch(0 0 0 / 0.1), 0 4px 6px -4px oklch(0 0 0 / 0.1); --shadow-xl: 0 20px 25px -5px oklch(0 0 0 / 0.1), 0 8px 10px -6px oklch(0 0 0 / 0.1); --shadow-2xl: 0 25px 50px -12px oklch(0 0 0 / 0.25); } ' +
  '.dark { --primary: oklch(0.7 0.18 250); --background: oklch(0.16 0.02 250); --foreground: oklch(0.97 0.01 250); --card: oklch(0.19 0.02 250); --muted: oklch(0.28 0.02 250); --muted-foreground: oklch(0.72 0.02 250); --border: oklch(0.3 0.02 250); --destructive: oklch(0.42 0.14 25); --success: oklch(0.68 0.14 163); --primary-foreground: oklch(0.145 0 0); --ring: oklch(0.62 0.17 250); --card-foreground: oklch(0.97 0.01 250); --popover: oklch(0.19 0.02 250); --popover-foreground: oklch(0.97 0.01 250); --secondary: oklch(0.3 0.03 250); --secondary-foreground: oklch(0.97 0.01 250); --accent: oklch(0.32 0.04 250); --accent-foreground: oklch(0.97 0.01 250); --input: oklch(0.3 0.02 250); --destructive-foreground: oklch(0.985 0 0); --chart-1: oklch(0.7 0.18 250); --chart-2: oklch(0.700 0.180 28); --chart-3: oklch(0.700 0.180 165); --chart-4: oklch(0.700 0.180 303); --chart-5: oklch(0.700 0.180 80); --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif; --radius: 0.75rem; --shadow-2xs: 0 1px oklch(0 0 0 / 0.15); --shadow-xs: 0 1px 2px 0 oklch(0 0 0 / 0.15); --shadow-sm: 0 1px 3px 0 oklch(0 0 0 / 0.25), 0 1px 2px -1px oklch(0 0 0 / 0.25); --shadow: 0 1px 3px 0 oklch(0 0 0 / 0.25), 0 1px 2px -1px oklch(0 0 0 / 0.25); --shadow-md: 0 4px 6px -1px oklch(0 0 0 / 0.25), 0 2px 4px -2px oklch(0 0 0 / 0.25); --shadow-lg: 0 10px 15px -3px oklch(0 0 0 / 0.25), 0 4px 6px -4px oklch(0 0 0 / 0.25); --shadow-xl: 0 20px 25px -5px oklch(0 0 0 / 0.25), 0 8px 10px -6px oklch(0 0 0 / 0.25); --shadow-2xl: 0 25px 50px -12px oklch(0 0 0 / 0.5); } ' +
  'body { --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif; --radius: 0.75rem; } ' +
  'html body { font-family: "Inter", ui-sans-serif, system-ui, sans-serif !important; }'

/** Read one declaration out of a generated block, e.g. `:root`, `--ring`. */
function readVar(css: string, selector: string, cssVar: string): string | null {
  const block = new RegExp(`(?:^|\\})\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(
    css
  )
  if (!block) return null
  const declaration = new RegExp(`${cssVar}:\\s*([^;]+);`).exec(block[1])
  return declaration ? declaration[1] : null
}

describe('generateThemeCSS with a partially-specified config', () => {
  it('renders a light config that sets only a primary colour', () => {
    const config = parseThemeConfig(SINGLE_COLOUR_LIGHT)
    expect(config).not.toBeNull()

    const css = generateThemeCSS(config as ThemeConfig)

    expect(readVar(css, ':root', '--primary')).toBe('#ff5722')
    // Everything the workspace left out still gets a value, so the page paints
    // a complete theme rather than a half-applied one.
    expect(readVar(css, ':root', '--background')).toBe('oklch(1 0 0)')
    expect(readVar(css, ':root', '--foreground')).toBe('oklch(0.145 0 0)')
    expect(readVar(css, ':root', '--card')).toBe('oklch(1 0 0)')
    expect(readVar(css, ':root', '--muted')).toBe('oklch(0.97 0 0)')
    expect(readVar(css, ':root', '--muted-foreground')).toBe('oklch(0.556 0 0)')
    expect(readVar(css, ':root', '--border')).toBe('oklch(0.922 0 0)')
    expect(readVar(css, ':root', '--destructive')).toBe('oklch(0.577 0.245 27)')
    expect(readVar(css, ':root', '--success')).toBe('oklch(0.696 0.149 163)')
    // Derived variables follow the colour that was chosen, not the base's.
    // (Only the pass-through ones: the derivations that read a colour's
    // lightness and hue expect oklch, and fall back when handed hex.)
    expect(readVar(css, ':root', '--ring')).toBe('#ff5722')
    // A config with no dark half emits no dark block.
    expect(css).not.toContain('.dark {')
  })

  it('renders a dark config that sets only a primary colour', () => {
    const config = parseThemeConfig(SINGLE_COLOUR_DARK)
    expect(config).not.toBeNull()

    const css = generateThemeCSS(config as ThemeConfig)

    expect(readVar(css, '.dark', '--primary')).toBe('#ff5722')
    // The dark gaps fill from the dark base, not the light one.
    expect(readVar(css, '.dark', '--background')).toBe('oklch(0.145 0 0)')
    expect(readVar(css, '.dark', '--foreground')).toBe('oklch(0.985 0 0)')
    expect(readVar(css, '.dark', '--card')).toBe('oklch(0.17 0 0)')
    expect(readVar(css, '.dark', '--muted')).toBe('oklch(0.269 0 0)')
    expect(readVar(css, '.dark', '--muted-foreground')).toBe('oklch(0.708 0 0)')
    expect(readVar(css, '.dark', '--border')).toBe('oklch(0.269 0 0)')
    expect(readVar(css, '.dark', '--destructive')).toBe('oklch(0.396 0.141 25)')
    expect(readVar(css, '.dark', '--success')).toBe('oklch(0.696 0.149 163)')
    expect(readVar(css, '.dark', '--ring')).toBe('#ff5722')
    expect(css).not.toContain(':root {')
  })

  it('fills both halves when both halves are partial', () => {
    const css = generateThemeCSS({
      themeMode: 'user',
      light: { primary: 'oklch(0.55 0.2 250)' },
      dark: { primary: 'oklch(0.7 0.18 250)' },
    })

    expect(readVar(css, ':root', '--background')).toBe('oklch(1 0 0)')
    expect(readVar(css, '.dark', '--background')).toBe('oklch(0.145 0 0)')
    expect(readVar(css, ':root', '--primary')).toBe('oklch(0.55 0.2 250)')
    expect(readVar(css, '.dark', '--primary')).toBe('oklch(0.7 0.18 250)')
    // Derived from the chosen primary in each half, not from the base's.
    expect(readVar(css, ':root', '--chart-1')).toBe('oklch(0.55 0.2 250)')
    expect(readVar(css, '.dark', '--chart-1')).toBe('oklch(0.7 0.18 250)')
  })

  it('renders a forced-dark partial config into the :root block', () => {
    const css = generateThemeCSS({ themeMode: 'dark', dark: { primary: '#ff5722' } })

    expect(readVar(css, ':root', '--primary')).toBe('#ff5722')
    expect(readVar(css, ':root', '--background')).toBe('oklch(0.145 0 0)')
    expect(css).not.toContain('.dark {')
  })

  it('never overwrites a variable the workspace set', () => {
    // A pale destructive is nothing like the base's, and its foreground is
    // computed from it — proof the chosen value reached the expander intact.
    const css = generateThemeCSS({ light: { destructive: 'oklch(0.95 0.05 27)' } })

    expect(readVar(css, ':root', '--destructive')).toBe('oklch(0.95 0.05 27)')
    expect(readVar(css, ':root', '--destructive-foreground')).toBe('oklch(0.145 0 0)')
    expect(readVar(css, ':root', '--primary')).toBe('oklch(0.886 0.176 86)')
  })

  it('treats a null-valued variable as unset rather than as a choice', () => {
    // JSON has no undefined, so a cleared variable arrives as null.
    const config = parseThemeConfig('{"light":{"primary":null,"card":"oklch(0.98 0 0)"}}')

    const css = generateThemeCSS(config as ThemeConfig)

    expect(readVar(css, ':root', '--primary')).toBe('oklch(0.886 0.176 86)')
    expect(readVar(css, ':root', '--card')).toBe('oklch(0.98 0 0)')
  })

  it('leaves a fully-specified config byte-for-byte unchanged', () => {
    expect(generateThemeCSS(FULLY_SPECIFIED)).toBe(FULLY_SPECIFIED_CSS)
  })

  it('handles an empty or absent config', () => {
    expect(generateThemeCSS({})).toBe('')
    expect(generateThemeCSS(null as unknown as ThemeConfig)).toBe('')
    expect(parseThemeConfig(null)).toBeNull()
    expect(parseThemeConfig('not json')).toBeNull()

    // An empty half is still a half: it renders the base theme, not a crash.
    const css = generateThemeCSS({ light: {} })
    expect(readVar(css, ':root', '--primary')).toBe('oklch(0.886 0.176 86)')
    expect(readVar(css, ':root', '--background')).toBe('oklch(1 0 0)')
    // No font or radius was chosen, so neither is forced onto the page.
    expect(css).not.toContain('--font-sans')
    expect(css).not.toContain('--radius')
    expect(css).not.toContain('font-family')
  })
})
