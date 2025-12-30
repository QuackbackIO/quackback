import type { ThemePreset, ThemeVariables } from './types'

/**
 * Light mode shadows
 */
const lightShadows: Partial<ThemeVariables> = {
  shadow2xs: '0 1px oklch(0 0 0 / 0.05)',
  shadowXs: '0 1px 2px 0 oklch(0 0 0 / 0.05)',
  shadowSm: '0 1px 3px 0 oklch(0 0 0 / 0.1), 0 1px 2px -1px oklch(0 0 0 / 0.1)',
  shadow: '0 1px 3px 0 oklch(0 0 0 / 0.1), 0 1px 2px -1px oklch(0 0 0 / 0.1)',
  shadowMd: '0 4px 6px -1px oklch(0 0 0 / 0.1), 0 2px 4px -2px oklch(0 0 0 / 0.1)',
  shadowLg: '0 10px 15px -3px oklch(0 0 0 / 0.1), 0 4px 6px -4px oklch(0 0 0 / 0.1)',
  shadowXl: '0 20px 25px -5px oklch(0 0 0 / 0.1), 0 8px 10px -6px oklch(0 0 0 / 0.1)',
  shadow2xl: '0 25px 50px -12px oklch(0 0 0 / 0.25)',
}

/**
 * Dark mode shadows (more pronounced)
 */
const darkShadows: Partial<ThemeVariables> = {
  shadow2xs: '0 1px oklch(0 0 0 / 0.15)',
  shadowXs: '0 1px 2px 0 oklch(0 0 0 / 0.15)',
  shadowSm: '0 1px 3px 0 oklch(0 0 0 / 0.25), 0 1px 2px -1px oklch(0 0 0 / 0.25)',
  shadow: '0 1px 3px 0 oklch(0 0 0 / 0.25), 0 1px 2px -1px oklch(0 0 0 / 0.25)',
  shadowMd: '0 4px 6px -1px oklch(0 0 0 / 0.25), 0 2px 4px -2px oklch(0 0 0 / 0.25)',
  shadowLg: '0 10px 15px -3px oklch(0 0 0 / 0.25), 0 4px 6px -4px oklch(0 0 0 / 0.25)',
  shadowXl: '0 20px 25px -5px oklch(0 0 0 / 0.25), 0 8px 10px -6px oklch(0 0 0 / 0.25)',
  shadow2xl: '0 25px 50px -12px oklch(0 0 0 / 0.5)',
}

// Font stacks
const FONTS = {
  inter: '"Inter", ui-sans-serif, system-ui, sans-serif',
  system: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  geist: '"Geist", ui-sans-serif, system-ui, sans-serif',
  jakarta: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
  dmSans: '"DM Sans", ui-sans-serif, system-ui, sans-serif',
  nunito: '"Nunito", ui-sans-serif, system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
}

const fontSerif = 'ui-serif, Georgia, Cambria, serif'
const fontMono = 'ui-monospace, SFMono-Regular, monospace'

/**
 * Helper to create a full theme preset
 */
function createPreset(config: {
  name: string
  description: string
  color: string
  font: string
  radius: string
  light: {
    primary: string
    primaryForeground: string
    background?: string
    foreground?: string
    card?: string
    cardForeground?: string
    secondary?: string
    secondaryForeground?: string
    muted?: string
    mutedForeground?: string
    accent?: string
    accentForeground?: string
    border?: string
    input?: string
    ring?: string
    charts: [string, string, string, string, string]
  }
  dark: {
    primary: string
    primaryForeground: string
    background?: string
    foreground?: string
    card?: string
    cardForeground?: string
    secondary?: string
    secondaryForeground?: string
    muted?: string
    mutedForeground?: string
    accent?: string
    accentForeground?: string
    border?: string
    input?: string
    ring?: string
    charts: [string, string, string, string, string]
  }
}): ThemePreset {
  const lightBase = {
    background: config.light.background ?? 'oklch(1 0 0)',
    foreground: config.light.foreground ?? 'oklch(0.145 0 0)',
    card: config.light.card ?? 'oklch(1 0 0)',
    cardForeground: config.light.cardForeground ?? 'oklch(0.145 0 0)',
    popover: config.light.card ?? 'oklch(1 0 0)',
    popoverForeground: config.light.cardForeground ?? 'oklch(0.145 0 0)',
    secondary: config.light.secondary ?? 'oklch(0.97 0 0)',
    secondaryForeground: config.light.secondaryForeground ?? 'oklch(0.145 0 0)',
    muted: config.light.muted ?? 'oklch(0.97 0 0)',
    mutedForeground: config.light.mutedForeground ?? 'oklch(0.556 0 0)',
    accent: config.light.accent ?? 'oklch(0.97 0 0)',
    accentForeground: config.light.accentForeground ?? 'oklch(0.145 0 0)',
    destructive: 'oklch(0.577 0.245 27)',
    destructiveForeground: 'oklch(0.577 0.245 27)',
    success: 'oklch(0.696 0.149 163)',
    successForeground: 'oklch(0.985 0 0)',
    border: config.light.border ?? 'oklch(0.922 0 0)',
    input: config.light.input ?? 'oklch(0.922 0 0)',
  }

  const darkBase = {
    background: config.dark.background ?? 'oklch(0.145 0 0)',
    foreground: config.dark.foreground ?? 'oklch(0.985 0 0)',
    card: config.dark.card ?? 'oklch(0.17 0 0)',
    cardForeground: config.dark.cardForeground ?? 'oklch(0.985 0 0)',
    popover: config.dark.card ?? 'oklch(0.17 0 0)',
    popoverForeground: config.dark.cardForeground ?? 'oklch(0.985 0 0)',
    secondary: config.dark.secondary ?? 'oklch(0.269 0 0)',
    secondaryForeground: config.dark.secondaryForeground ?? 'oklch(0.985 0 0)',
    muted: config.dark.muted ?? 'oklch(0.269 0 0)',
    mutedForeground: config.dark.mutedForeground ?? 'oklch(0.708 0 0)',
    accent: config.dark.accent ?? 'oklch(0.269 0 0)',
    accentForeground: config.dark.accentForeground ?? 'oklch(0.985 0 0)',
    destructive: 'oklch(0.396 0.141 25)',
    destructiveForeground: 'oklch(0.637 0.237 25)',
    success: 'oklch(0.696 0.149 163)',
    successForeground: 'oklch(0.985 0 0)',
    border: config.dark.border ?? 'oklch(0.269 0 0)',
    input: config.dark.input ?? 'oklch(0.269 0 0)',
  }

  return {
    name: config.name,
    description: config.description,
    color: config.color,
    light: {
      ...lightBase,
      ...lightShadows,
      fontSans: config.font,
      fontSerif,
      fontMono,
      radius: config.radius,
      primary: config.light.primary,
      primaryForeground: config.light.primaryForeground,
      ring: config.light.ring ?? config.light.primary,
      sidebarBackground: 'oklch(0.985 0 0)',
      sidebarForeground: lightBase.foreground,
      sidebarPrimary: config.light.primary,
      sidebarPrimaryForeground: config.light.primaryForeground,
      sidebarAccent: lightBase.accent,
      sidebarAccentForeground: lightBase.accentForeground,
      sidebarBorder: lightBase.border,
      sidebarRing: config.light.ring ?? config.light.primary,
      chart1: config.light.charts[0],
      chart2: config.light.charts[1],
      chart3: config.light.charts[2],
      chart4: config.light.charts[3],
      chart5: config.light.charts[4],
    } as ThemeVariables,
    dark: {
      ...darkBase,
      ...darkShadows,
      fontSans: config.font,
      fontSerif,
      fontMono,
      radius: config.radius,
      primary: config.dark.primary,
      primaryForeground: config.dark.primaryForeground,
      ring: config.dark.ring ?? 'oklch(0.556 0 0)',
      sidebarBackground: darkBase.background,
      sidebarForeground: darkBase.foreground,
      sidebarPrimary: config.dark.primary,
      sidebarPrimaryForeground: config.dark.primaryForeground,
      sidebarAccent: darkBase.accent,
      sidebarAccentForeground: darkBase.accentForeground,
      sidebarBorder: darkBase.border,
      sidebarRing: config.dark.ring ?? 'oklch(0.556 0 0)',
      chart1: config.dark.charts[0],
      chart2: config.dark.charts[1],
      chart3: config.dark.charts[2],
      chart4: config.dark.charts[3],
      chart5: config.dark.charts[4],
    } as ThemeVariables,
  }
}

/**
 * Theme presets with full variable sets for light and dark modes
 * Each preset has a distinct aesthetic: colors, typography, and border radius
 */
export const themePresets: Record<string, ThemePreset> = {
  // ============================================================================
  // DEFAULT - Clean blue, professional
  // ============================================================================
  default: createPreset({
    name: 'Default',
    description: 'Clean and professional',
    color: '#3b82f6',
    font: FONTS.inter,
    radius: '0.625rem',
    light: {
      primary: 'oklch(0.623 0.188 260)',
      primaryForeground: 'oklch(0.985 0 0)',
      charts: [
        'oklch(0.623 0.188 260)', // Blue
        'oklch(0.696 0.149 163)', // Emerald
        'oklch(0.769 0.165 70)', // Amber
        'oklch(0.645 0.215 16)', // Rose
        'oklch(0.606 0.219 293)', // Violet
      ],
    },
    dark: {
      primary: 'oklch(0.623 0.188 260)',
      primaryForeground: 'oklch(0.985 0 0)',
      charts: [
        'oklch(0.623 0.188 260)',
        'oklch(0.696 0.149 163)',
        'oklch(0.769 0.165 70)',
        'oklch(0.645 0.215 16)',
        'oklch(0.606 0.219 293)',
      ],
    },
  }),

  // ============================================================================
  // MINIMAL - Black/white, geometric, sharp corners
  // ============================================================================
  minimal: createPreset({
    name: 'Minimal',
    description: 'Sharp and geometric',
    color: '#171717',
    font: FONTS.system,
    radius: '0rem',
    light: {
      primary: 'oklch(0.205 0 0)', // Near black
      primaryForeground: 'oklch(0.985 0 0)',
      border: 'oklch(0.85 0 0)', // Slightly darker border
      charts: [
        'oklch(0.205 0 0)',
        'oklch(0.4 0 0)',
        'oklch(0.55 0 0)',
        'oklch(0.7 0 0)',
        'oklch(0.85 0 0)',
      ],
    },
    dark: {
      primary: 'oklch(0.985 0 0)', // White on dark
      primaryForeground: 'oklch(0.145 0 0)',
      charts: [
        'oklch(0.985 0 0)',
        'oklch(0.8 0 0)',
        'oklch(0.6 0 0)',
        'oklch(0.45 0 0)',
        'oklch(0.3 0 0)',
      ],
    },
  }),

  // ============================================================================
  // PLAYFUL - Vibrant, rounded, friendly (Nunito font)
  // ============================================================================
  playful: createPreset({
    name: 'Playful',
    description: 'Vibrant & friendly',
    color: '#f43f5e',
    font: FONTS.nunito,
    radius: '1rem',
    light: {
      primary: 'oklch(0.645 0.215 16)', // Rose
      primaryForeground: 'oklch(0.985 0 0)',
      background: 'oklch(0.995 0.003 350)', // Very slight warm tint
      muted: 'oklch(0.97 0.008 350)',
      charts: [
        'oklch(0.645 0.215 16)', // Rose
        'oklch(0.7 0.18 280)', // Purple
        'oklch(0.75 0.15 195)', // Teal
        'oklch(0.8 0.16 85)', // Yellow
        'oklch(0.65 0.2 145)', // Green
      ],
    },
    dark: {
      primary: 'oklch(0.7 0.2 16)',
      primaryForeground: 'oklch(0.985 0 0)',
      charts: [
        'oklch(0.7 0.2 16)',
        'oklch(0.75 0.18 280)',
        'oklch(0.8 0.15 195)',
        'oklch(0.85 0.16 85)',
        'oklch(0.7 0.2 145)',
      ],
    },
  }),

  // ============================================================================
  // EDITORIAL - Sophisticated, serif typography, subtle
  // ============================================================================
  editorial: createPreset({
    name: 'Editorial',
    description: 'Refined & classic',
    color: '#374151',
    font: '"Merriweather", ui-serif, Georgia, serif',
    radius: '0.25rem',
    light: {
      primary: 'oklch(0.373 0.034 259)', // Slate gray-blue
      primaryForeground: 'oklch(0.985 0 0)',
      background: 'oklch(0.99 0.005 85)', // Warm off-white
      foreground: 'oklch(0.2 0.01 50)', // Warm dark
      card: 'oklch(0.995 0.003 85)',
      muted: 'oklch(0.96 0.008 85)',
      mutedForeground: 'oklch(0.45 0.02 50)',
      border: 'oklch(0.88 0.01 85)',
      charts: [
        'oklch(0.373 0.034 259)', // Slate
        'oklch(0.5 0.08 30)', // Warm brown
        'oklch(0.55 0.1 160)', // Sage
        'oklch(0.45 0.06 250)', // Steel blue
        'oklch(0.6 0.08 350)', // Dusty rose
      ],
    },
    dark: {
      primary: 'oklch(0.65 0.05 259)',
      primaryForeground: 'oklch(0.985 0 0)',
      background: 'oklch(0.15 0.01 50)', // Warm dark
      foreground: 'oklch(0.92 0.008 85)',
      card: 'oklch(0.18 0.012 50)',
      muted: 'oklch(0.25 0.015 50)',
      mutedForeground: 'oklch(0.6 0.015 85)',
      border: 'oklch(0.28 0.012 50)',
      charts: [
        'oklch(0.65 0.05 259)',
        'oklch(0.6 0.08 30)',
        'oklch(0.6 0.1 160)',
        'oklch(0.55 0.06 250)',
        'oklch(0.65 0.08 350)',
      ],
    },
  }),

  // ============================================================================
  // TECH - Modern, sharp, monospace accents
  // ============================================================================
  tech: createPreset({
    name: 'Tech',
    description: 'Modern & precise',
    color: '#06b6d4',
    font: '"JetBrains Mono", ui-monospace, monospace',
    radius: '0.375rem',
    light: {
      primary: 'oklch(0.715 0.126 195)', // Cyan
      primaryForeground: 'oklch(0.1 0 0)',
      background: 'oklch(0.99 0 0)',
      foreground: 'oklch(0.15 0 0)',
      border: 'oklch(0.88 0 0)',
      charts: [
        'oklch(0.715 0.126 195)', // Cyan
        'oklch(0.6 0.2 145)', // Green
        'oklch(0.55 0.18 280)', // Purple
        'oklch(0.75 0.15 60)', // Orange
        'oklch(0.5 0.15 250)', // Blue
      ],
    },
    dark: {
      primary: 'oklch(0.75 0.14 195)',
      primaryForeground: 'oklch(0.1 0 0)',
      background: 'oklch(0.12 0 0)',
      foreground: 'oklch(0.9 0 0)',
      card: 'oklch(0.16 0 0)',
      muted: 'oklch(0.22 0 0)',
      mutedForeground: 'oklch(0.6 0 0)',
      border: 'oklch(0.25 0 0)',
      charts: [
        'oklch(0.8 0.14 195)',
        'oklch(0.7 0.2 145)',
        'oklch(0.65 0.18 280)',
        'oklch(0.8 0.15 60)',
        'oklch(0.6 0.15 250)',
      ],
    },
  }),

  // ============================================================================
  // COZY - Warm pastels, soft, comfortable (catppuccin-inspired)
  // ============================================================================
  cozy: createPreset({
    name: 'Cozy',
    description: 'Soft & warm',
    color: '#c4a7e7',
    font: '"DM Sans", ui-sans-serif, system-ui, sans-serif',
    radius: '0.75rem',
    light: {
      primary: 'oklch(0.68 0.12 300)', // Soft lavender
      primaryForeground: 'oklch(0.985 0 0)',
      background: 'oklch(0.98 0.008 300)', // Very slight lavender tint
      card: 'oklch(0.99 0.005 300)',
      foreground: 'oklch(0.25 0.02 280)',
      muted: 'oklch(0.94 0.012 300)',
      mutedForeground: 'oklch(0.5 0.03 280)',
      border: 'oklch(0.9 0.015 300)',
      charts: [
        'oklch(0.68 0.12 300)', // Lavender
        'oklch(0.75 0.12 200)', // Sky
        'oklch(0.7 0.12 160)', // Mint
        'oklch(0.8 0.1 80)', // Peach
        'oklch(0.7 0.12 350)', // Rose
      ],
    },
    dark: {
      primary: 'oklch(0.75 0.12 300)',
      primaryForeground: 'oklch(0.985 0 0)',
      background: 'oklch(0.2 0.02 280)',
      foreground: 'oklch(0.92 0.015 300)',
      card: 'oklch(0.24 0.022 280)',
      muted: 'oklch(0.3 0.025 280)',
      mutedForeground: 'oklch(0.65 0.025 300)',
      border: 'oklch(0.33 0.025 280)',
      charts: [
        'oklch(0.75 0.12 300)',
        'oklch(0.8 0.12 200)',
        'oklch(0.75 0.12 160)',
        'oklch(0.85 0.1 80)',
        'oklch(0.75 0.12 350)',
      ],
    },
  }),

  // ============================================================================
  // LEGACY PRESETS (kept for backward compatibility, not shown in UI)
  // ============================================================================
  emerald: createPreset({
    name: 'Emerald',
    description: 'Fresh and natural',
    color: '#10b981',
    font: FONTS.jakarta,
    radius: '0.75rem',
    light: {
      primary: 'oklch(0.696 0.149 163)',
      primaryForeground: 'oklch(0.985 0 0)',
      charts: [
        'oklch(0.696 0.149 163)',
        'oklch(0.6 0.118 184)',
        'oklch(0.828 0.189 84)',
        'oklch(0.398 0.07 227)',
        'oklch(0.769 0.165 70)',
      ],
    },
    dark: {
      primary: 'oklch(0.696 0.149 163)',
      primaryForeground: 'oklch(0.985 0 0)',
      charts: [
        'oklch(0.696 0.149 163)',
        'oklch(0.6 0.118 184)',
        'oklch(0.828 0.189 84)',
        'oklch(0.398 0.07 227)',
        'oklch(0.769 0.165 70)',
      ],
    },
  }),

  rose: createPreset({
    name: 'Rose',
    description: 'Soft and friendly',
    color: '#f43f5e',
    font: FONTS.dmSans,
    radius: '1rem',
    light: {
      primary: 'oklch(0.645 0.215 16)',
      primaryForeground: 'oklch(0.985 0 0)',
      muted: 'oklch(0.975 0.005 16)',
      charts: [
        'oklch(0.645 0.215 16)',
        'oklch(0.7 0.15 350)',
        'oklch(0.6 0.118 184)',
        'oklch(0.769 0.165 70)',
        'oklch(0.606 0.219 293)',
      ],
    },
    dark: {
      primary: 'oklch(0.645 0.215 16)',
      primaryForeground: 'oklch(0.985 0 0)',
      charts: [
        'oklch(0.645 0.215 16)',
        'oklch(0.7 0.15 350)',
        'oklch(0.6 0.118 184)',
        'oklch(0.769 0.165 70)',
        'oklch(0.606 0.219 293)',
      ],
    },
  }),

  amber: createPreset({
    name: 'Amber',
    description: 'Warm and energetic',
    color: '#f59e0b',
    font: FONTS.inter,
    radius: '0.5rem',
    light: {
      primary: 'oklch(0.769 0.165 70)',
      primaryForeground: 'oklch(0.145 0 0)',
      charts: [
        'oklch(0.769 0.165 70)',
        'oklch(0.623 0.188 260)',
        'oklch(0.696 0.149 163)',
        'oklch(0.645 0.215 16)',
        'oklch(0.606 0.219 293)',
      ],
    },
    dark: {
      primary: 'oklch(0.769 0.165 70)',
      primaryForeground: 'oklch(0.145 0 0)',
      charts: [
        'oklch(0.769 0.165 70)',
        'oklch(0.623 0.188 260)',
        'oklch(0.696 0.149 163)',
        'oklch(0.645 0.215 16)',
        'oklch(0.606 0.219 293)',
      ],
    },
  }),

  violet: createPreset({
    name: 'Violet',
    description: 'Creative and modern',
    color: '#8b5cf6',
    font: FONTS.geist,
    radius: '0.625rem',
    light: {
      primary: 'oklch(0.606 0.219 293)',
      primaryForeground: 'oklch(0.985 0 0)',
      charts: [
        'oklch(0.606 0.219 293)',
        'oklch(0.585 0.204 277)',
        'oklch(0.645 0.215 16)',
        'oklch(0.623 0.188 260)',
        'oklch(0.696 0.149 163)',
      ],
    },
    dark: {
      primary: 'oklch(0.606 0.219 293)',
      primaryForeground: 'oklch(0.985 0 0)',
      charts: [
        'oklch(0.606 0.219 293)',
        'oklch(0.585 0.204 277)',
        'oklch(0.645 0.215 16)',
        'oklch(0.623 0.188 260)',
        'oklch(0.696 0.149 163)',
      ],
    },
  }),

  catppuccin: createPreset({
    name: 'Catppuccin',
    description: 'Pastel and cozy',
    color: '#cba6f7',
    font: FONTS.nunito,
    radius: '0.75rem',
    light: {
      primary: 'oklch(0.711 0.106 313)',
      primaryForeground: 'oklch(0.985 0 0)',
      background: 'oklch(0.97 0.003 290)',
      card: 'oklch(0.985 0.002 290)',
      muted: 'oklch(0.94 0.005 290)',
      border: 'oklch(0.9 0.008 290)',
      charts: [
        'oklch(0.711 0.106 313)',
        'oklch(0.7 0.15 220)',
        'oklch(0.75 0.12 170)',
        'oklch(0.8 0.14 100)',
        'oklch(0.7 0.15 350)',
      ],
    },
    dark: {
      primary: 'oklch(0.711 0.106 313)',
      primaryForeground: 'oklch(0.985 0 0)',
      background: 'oklch(0.22 0.015 290)',
      card: 'oklch(0.26 0.018 290)',
      foreground: 'oklch(0.93 0.01 290)',
      muted: 'oklch(0.32 0.02 290)',
      mutedForeground: 'oklch(0.7 0.02 290)',
      border: 'oklch(0.35 0.02 290)',
      charts: [
        'oklch(0.711 0.106 313)',
        'oklch(0.7 0.15 220)',
        'oklch(0.75 0.12 170)',
        'oklch(0.8 0.14 100)',
        'oklch(0.7 0.15 350)',
      ],
    },
  }),

  cyberpunk: createPreset({
    name: 'Cyberpunk',
    description: 'Neon and bold',
    color: '#ff00ff',
    font: FONTS.mono,
    radius: '0rem',
    light: {
      primary: 'oklch(0.7 0.3 328)',
      primaryForeground: 'oklch(0.985 0 0)',
      background: 'oklch(0.98 0 0)',
      border: 'oklch(0.8 0.05 328)',
      charts: [
        'oklch(0.7 0.3 328)',
        'oklch(0.8 0.2 195)',
        'oklch(0.9 0.2 110)',
        'oklch(0.6 0.25 280)',
        'oklch(0.7 0.25 145)',
      ],
    },
    dark: {
      primary: 'oklch(0.8 0.3 328)',
      primaryForeground: 'oklch(0.1 0 0)',
      background: 'oklch(0.1 0.02 280)',
      foreground: 'oklch(0.95 0.02 195)',
      card: 'oklch(0.15 0.025 280)',
      border: 'oklch(0.3 0.05 328)',
      muted: 'oklch(0.2 0.03 280)',
      mutedForeground: 'oklch(0.6 0.05 195)',
      charts: [
        'oklch(0.8 0.3 328)',
        'oklch(0.85 0.2 195)',
        'oklch(0.95 0.2 110)',
        'oklch(0.7 0.25 280)',
        'oklch(0.8 0.25 145)',
      ],
    },
  }),

  claude: createPreset({
    name: 'Claude',
    description: 'Warm earth tones',
    color: '#c96442',
    font: FONTS.inter,
    radius: '0.5rem',
    light: {
      primary: 'oklch(0.637 0.137 29)',
      primaryForeground: 'oklch(0.985 0 0)',
      background: 'oklch(0.985 0.01 85)',
      card: 'oklch(0.99 0.008 85)',
      foreground: 'oklch(0.25 0.02 50)',
      muted: 'oklch(0.95 0.015 85)',
      mutedForeground: 'oklch(0.5 0.03 50)',
      border: 'oklch(0.9 0.02 85)',
      charts: [
        'oklch(0.637 0.137 29)',
        'oklch(0.7 0.1 80)',
        'oklch(0.55 0.12 160)',
        'oklch(0.6 0.08 250)',
        'oklch(0.65 0.1 350)',
      ],
    },
    dark: {
      primary: 'oklch(0.7 0.137 29)',
      primaryForeground: 'oklch(0.985 0 0)',
      background: 'oklch(0.18 0.015 50)',
      foreground: 'oklch(0.95 0.01 85)',
      card: 'oklch(0.22 0.018 50)',
      muted: 'oklch(0.28 0.02 50)',
      mutedForeground: 'oklch(0.65 0.02 85)',
      border: 'oklch(0.32 0.02 50)',
      charts: [
        'oklch(0.7 0.137 29)',
        'oklch(0.75 0.1 80)',
        'oklch(0.6 0.12 160)',
        'oklch(0.65 0.08 250)',
        'oklch(0.7 0.1 350)',
      ],
    },
  }),

  ocean: createPreset({
    name: 'Ocean',
    description: 'Deep and calming',
    color: '#0891b2',
    font: FONTS.nunito,
    radius: '0.875rem',
    light: {
      primary: 'oklch(0.609 0.126 221)',
      primaryForeground: 'oklch(0.985 0 0)',
      background: 'oklch(0.99 0.005 220)',
      muted: 'oklch(0.96 0.008 220)',
      border: 'oklch(0.92 0.01 220)',
      charts: [
        'oklch(0.609 0.126 221)',
        'oklch(0.55 0.15 250)',
        'oklch(0.5 0.12 280)',
        'oklch(0.65 0.1 195)',
        'oklch(0.7 0.08 170)',
      ],
    },
    dark: {
      primary: 'oklch(0.7 0.126 221)',
      primaryForeground: 'oklch(0.985 0 0)',
      background: 'oklch(0.15 0.02 230)',
      foreground: 'oklch(0.95 0.01 220)',
      card: 'oklch(0.19 0.025 230)',
      muted: 'oklch(0.25 0.03 230)',
      mutedForeground: 'oklch(0.65 0.03 220)',
      border: 'oklch(0.3 0.03 230)',
      charts: [
        'oklch(0.7 0.126 221)',
        'oklch(0.6 0.15 250)',
        'oklch(0.55 0.12 280)',
        'oklch(0.7 0.1 195)',
        'oklch(0.75 0.08 170)',
      ],
    },
  }),

  // ============================================================================
  // LEGACY ALIASES (for backward compatibility)
  // ============================================================================
  indigo: createPreset({
    name: 'Indigo',
    description: 'Deep and focused',
    color: '#6366f1',
    font: FONTS.inter,
    radius: '0.625rem',
    light: {
      primary: 'oklch(0.585 0.204 277)',
      primaryForeground: 'oklch(0.985 0 0)',
      charts: [
        'oklch(0.585 0.204 277)',
        'oklch(0.696 0.149 163)',
        'oklch(0.769 0.165 70)',
        'oklch(0.645 0.215 16)',
        'oklch(0.606 0.219 293)',
      ],
    },
    dark: {
      primary: 'oklch(0.585 0.204 277)',
      primaryForeground: 'oklch(0.985 0 0)',
      charts: [
        'oklch(0.585 0.204 277)',
        'oklch(0.696 0.149 163)',
        'oklch(0.769 0.165 70)',
        'oklch(0.645 0.215 16)',
        'oklch(0.606 0.219 293)',
      ],
    },
  }),

  cyan: createPreset({
    name: 'Cyan',
    description: 'Bright and fresh',
    color: '#06b6d4',
    font: FONTS.inter,
    radius: '0.625rem',
    light: {
      primary: 'oklch(0.715 0.126 215)',
      primaryForeground: 'oklch(0.985 0 0)',
      charts: [
        'oklch(0.715 0.126 215)',
        'oklch(0.623 0.188 260)',
        'oklch(0.696 0.149 163)',
        'oklch(0.769 0.165 70)',
        'oklch(0.645 0.215 16)',
      ],
    },
    dark: {
      primary: 'oklch(0.715 0.126 215)',
      primaryForeground: 'oklch(0.985 0 0)',
      charts: [
        'oklch(0.715 0.126 215)',
        'oklch(0.623 0.188 260)',
        'oklch(0.696 0.149 163)',
        'oklch(0.769 0.165 70)',
        'oklch(0.645 0.215 16)',
      ],
    },
  }),
}

/** Get list of preset names */
export const presetNames = Object.keys(themePresets) as Array<keyof typeof themePresets>

/** Get preset by name, returns undefined if not found */
export function getPreset(name: string): ThemePreset | undefined {
  return themePresets[name]
}

/** Primary presets to show in the UI - curated set of distinctive themes */
export const primaryPresetIds = [
  'default',
  'minimal',
  'playful',
  'editorial',
  'tech',
  'cozy',
] as const
