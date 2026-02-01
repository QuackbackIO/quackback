import { useState, useMemo, useCallback } from 'react'
import {
  themePresets,
  expandTheme,
  extractMinimal,
  hexToOklch,
  oklchToHex,
  type ThemeConfig,
  type ThemeVariables,
  type MinimalThemeVariables,
} from '@/lib/shared/theme'
import { updateThemeFn } from '@/lib/server/functions/settings'

export const FONT_OPTIONS = [
  {
    id: 'inter',
    name: 'Inter',
    value: '"Inter", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Inter',
  },
  {
    id: 'system',
    name: 'System UI',
    value: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    category: 'System',
    googleName: null,
  },
  {
    id: 'roboto',
    name: 'Roboto',
    value: '"Roboto", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Roboto',
  },
  {
    id: 'open-sans',
    name: 'Open Sans',
    value: '"Open Sans", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Open+Sans',
  },
  {
    id: 'lato',
    name: 'Lato',
    value: '"Lato", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Lato',
  },
  {
    id: 'poppins',
    name: 'Poppins',
    value: '"Poppins", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Poppins',
  },
  {
    id: 'dm-sans',
    name: 'DM Sans',
    value: '"DM Sans", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'DM+Sans',
  },
  {
    id: 'jakarta',
    name: 'Plus Jakarta Sans',
    value: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Plus+Jakarta+Sans',
  },
  {
    id: 'geist',
    name: 'Geist',
    value: '"Geist", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Geist',
  },
  {
    id: 'manrope',
    name: 'Manrope',
    value: '"Manrope", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Manrope',
  },
  {
    id: 'space-grotesk',
    name: 'Space Grotesk',
    value: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Space+Grotesk',
  },
  {
    id: 'playfair',
    name: 'Playfair Display',
    value: '"Playfair Display", ui-serif, Georgia, serif',
    category: 'Serif',
    googleName: 'Playfair+Display',
  },
  {
    id: 'merriweather',
    name: 'Merriweather',
    value: '"Merriweather", ui-serif, Georgia, serif',
    category: 'Serif',
    googleName: 'Merriweather',
  },
  {
    id: 'lora',
    name: 'Lora',
    value: '"Lora", ui-serif, Georgia, serif',
    category: 'Serif',
    googleName: 'Lora',
  },
  {
    id: 'fira-code',
    name: 'Fira Code',
    value: '"Fira Code", ui-monospace, monospace',
    category: 'Monospace',
    googleName: 'Fira+Code',
  },
  {
    id: 'jetbrains',
    name: 'JetBrains Mono',
    value: '"JetBrains Mono", ui-monospace, monospace',
    category: 'Monospace',
    googleName: 'JetBrains+Mono',
  },
] as const

export const ALL_FONTS_URL = `https://fonts.googleapis.com/css2?family=${FONT_OPTIONS.filter(
  (f) => f.googleName
)
  .map((f) => f.googleName)
  .join('&family=')}&display=swap`

const DEFAULT_FONT = '"Inter", ui-sans-serif, system-ui, sans-serif'

interface UseBrandingStateOptions {
  initialLogoUrl: string | null
  initialThemeConfig: ThemeConfig
}

export interface BrandingState {
  // Logo
  logoUrl: string | null
  setLogoUrl: (url: string | null) => void

  // Preview mode (light/dark) - for previewing the theme
  previewMode: 'light' | 'dark'
  setPreviewMode: (mode: 'light' | 'dark') => void

  // Brand color (shared across light/dark modes)
  brandColor: string
  setBrandColor: (hexColor: string) => void

  // Typography
  font: string
  setFont: (font: string) => void
  currentFontId: string
  radius: number
  setRadius: (radius: number) => void

  // Computed theme variables for preview
  effectiveLight: ThemeVariables
  effectiveDark: ThemeVariables

  // Save
  saveTheme: () => Promise<void>
  isSaving: boolean
  saveSuccess: boolean
}

export function useBrandingState(options: UseBrandingStateOptions): BrandingState {
  const { initialLogoUrl, initialThemeConfig } = options

  // ============================================
  // Logo state
  // ============================================
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl)

  // ============================================
  // Theme state
  // ============================================
  const [editMode, setEditMode] = useState<'light' | 'dark'>('light')

  const defaultPreset = themePresets.default

  const [lightValues, setLightValues] = useState<MinimalThemeVariables>(() => {
    if (initialThemeConfig.light && Object.keys(initialThemeConfig.light).length > 0) {
      return extractMinimal({ ...defaultPreset.light, ...initialThemeConfig.light })
    }
    return extractMinimal(defaultPreset.light)
  })

  const [darkValues, setDarkValues] = useState<MinimalThemeVariables>(() => {
    if (initialThemeConfig.dark && Object.keys(initialThemeConfig.dark).length > 0) {
      return extractMinimal({ ...defaultPreset.dark, ...initialThemeConfig.dark })
    }
    return extractMinimal(defaultPreset.dark)
  })

  const [font, setFont] = useState(() => lightValues.fontSans || DEFAULT_FONT)
  const [radius, setRadius] = useState(() => {
    const match = lightValues.radius?.match(/^([\d.]+)rem$/)
    return match ? parseFloat(match[1]) : 0.625
  })

  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // ============================================
  // Computed values
  // ============================================
  const effectiveLight = useMemo(
    () =>
      expandTheme({ ...lightValues, fontSans: font, radius: `${radius}rem` }, { mode: 'light' }),
    [lightValues, font, radius]
  )

  const effectiveDark = useMemo(
    () => expandTheme({ ...darkValues, fontSans: font, radius: `${radius}rem` }, { mode: 'dark' }),
    [darkValues, font, radius]
  )

  const currentFontId = FONT_OPTIONS.find((f) => f.value === font)?.id || 'inter'

  // ============================================
  // Color management
  // ============================================
  // Brand color is shared across both light and dark modes
  const setBrandColor = useCallback((hexColor: string) => {
    const oklchColor = hexToOklch(hexColor)
    setLightValues((prev: MinimalThemeVariables) => ({ ...prev, primary: oklchColor }))
    setDarkValues((prev: MinimalThemeVariables) => ({ ...prev, primary: oklchColor }))
  }, [])

  const getBrandColor = useCallback((): string => {
    const oklch = lightValues.primary
    if (!oklch || typeof oklch !== 'string') return '#3b82f6'
    try {
      return oklchToHex(oklch)
    } catch {
      return '#3b82f6'
    }
  }, [lightValues.primary])

  // ============================================
  // Save
  // ============================================
  const saveTheme = useCallback(async () => {
    setIsSaving(true)
    setSaveSuccess(false)

    try {
      const themeConfig: ThemeConfig = {
        light: { ...lightValues, fontSans: font, radius: `${radius}rem` },
        dark: { ...darkValues, fontSans: font, radius: `${radius}rem` },
      }
      await updateThemeFn({
        data: { brandingConfig: themeConfig as Record<string, unknown> },
      })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch (error) {
      console.error('Failed to save theme:', error)
    } finally {
      setIsSaving(false)
    }
  }, [lightValues, darkValues, font, radius])

  return {
    // Logo
    logoUrl,
    setLogoUrl,

    // Preview mode
    previewMode: editMode,
    setPreviewMode: setEditMode,

    // Brand color
    brandColor: getBrandColor(),
    setBrandColor,

    // Typography
    font,
    setFont,
    currentFontId,
    radius,
    setRadius,

    // Computed
    effectiveLight,
    effectiveDark,

    // Save
    saveTheme,
    isSaving,
    saveSuccess,
  }
}
