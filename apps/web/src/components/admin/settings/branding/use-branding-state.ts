import { useState, useMemo, useCallback } from 'react'
import {
  themePresets,
  primaryPresetIds,
  extractMinimal,
  extractCssVariables,
  generateReadableCSS,
  parseCssToMinimal,
  replaceCssVar,
  normalizeFontSans,
  type ThemeConfig,
  type MinimalThemeVariables,
  type ThemeMode,
  type ParsedCssVariables,
} from '@/lib/shared/theme'
import { useSaveBrandingTheme } from '@/lib/client/mutations/settings'

// Each `value` family must be self-hosted in globals.css (matching the @fontsource
// @font-face family name), or the selection falls back to the generic stack.
export const FONT_OPTIONS = [
  {
    id: 'inter',
    name: 'Inter',
    value: '"Inter", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'system',
    name: 'System UI',
    value: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    category: 'System',
  },
  {
    id: 'roboto',
    name: 'Roboto',
    value: '"Roboto", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'open-sans',
    name: 'Open Sans',
    value: '"Open Sans", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'lato',
    name: 'Lato',
    value: '"Lato", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'poppins',
    name: 'Poppins',
    value: '"Poppins", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'dm-sans',
    name: 'DM Sans',
    value: '"DM Sans", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'jakarta',
    name: 'Plus Jakarta Sans',
    value: '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'geist',
    name: 'Geist',
    // @fontsource publishes Geist as the "Geist Sans" family (see globals.css).
    value: '"Geist Sans", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'manrope',
    name: 'Manrope',
    value: '"Manrope", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'space-grotesk',
    name: 'Space Grotesk',
    value: '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
  },
  {
    id: 'playfair',
    name: 'Playfair Display',
    value: '"Playfair Display", ui-serif, Georgia, serif',
    category: 'Serif',
  },
  {
    id: 'merriweather',
    name: 'Merriweather',
    value: '"Merriweather", ui-serif, Georgia, serif',
    category: 'Serif',
  },
  {
    id: 'lora',
    name: 'Lora',
    value: '"Lora", ui-serif, Georgia, serif',
    category: 'Serif',
  },
  {
    id: 'fira-code',
    name: 'Fira Code',
    value: '"Fira Code", ui-monospace, monospace',
    category: 'Monospace',
  },
  {
    id: 'jetbrains',
    name: 'JetBrains Mono',
    value: '"JetBrains Mono", ui-monospace, monospace',
    category: 'Monospace',
  },
] as const

const DEFAULT_FONT = '"Inter", ui-sans-serif, system-ui, sans-serif'
const DEFAULT_RADIUS = 0.625

/** The 9 core color keys used for preset matching */
const CORE_COLOR_KEYS = [
  'primary',
  'background',
  'foreground',
  'card',
  'muted',
  'mutedForeground',
  'border',
  'destructive',
  'success',
] as const

interface UseBrandingStateOptions {
  initialLogoUrl: string | null
  initialThemeConfig: ThemeConfig
  initialCustomCss: string
}

export interface BrandingState {
  logoUrl: string | null
  setLogoUrl: (url: string | null) => void
  previewMode: 'light' | 'dark'
  setPreviewMode: (mode: 'light' | 'dark') => void
  /** Which preview toggle is disabled based on themeMode ('light' | 'dark' | null) */
  previewModeDisabled: 'light' | 'dark' | null
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
  activePresetId: string | null
  setPreset: (presetId: string) => void
  font: string
  setFont: (font: string) => void
  currentFontId: string
  radius: number
  setRadius: (r: number) => void
  cssText: string
  setCssText: (css: string) => void
  parsedCssVariables: ParsedCssVariables
  saveTheme: () => Promise<void>
  isSaving: boolean
  saveSuccess: boolean
}

function buildInitialCss(initialCustomCss: string, initialThemeConfig: ThemeConfig): string {
  // If user already has custom CSS, use it as-is
  if (initialCustomCss.trim()) return initialCustomCss

  // Otherwise generate readable CSS from the structured config
  const defaultPreset = themePresets.default
  const lightMinimal = extractMinimal({
    ...defaultPreset.light,
    ...(initialThemeConfig.light ?? {}),
  })
  const darkMinimal = extractMinimal({
    ...defaultPreset.dark,
    ...(initialThemeConfig.dark ?? {}),
  })

  return generateReadableCSS(lightMinimal, darkMinimal, initialThemeConfig.themeMode)
}

export function useBrandingState(options: UseBrandingStateOptions): BrandingState {
  const { initialLogoUrl, initialThemeConfig, initialCustomCss } = options
  const { mutateAsync: saveBrandingTheme } = useSaveBrandingTheme()

  // ============================================
  // Primary state: CSS text is the source of truth
  // ============================================
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl)
  const initialMode = initialThemeConfig.themeMode ?? 'user'
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>(
    initialMode === 'dark' ? 'dark' : 'light'
  )
  const [themeMode, setThemeModeRaw] = useState<ThemeMode>(() => initialMode)

  // When theme mode changes, auto-switch preview to match and regenerate CSS
  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeRaw(mode)
    if (mode === 'dark') setPreviewMode('dark')
    else if (mode === 'light') setPreviewMode('light')
  }, [])
  const [cssText, setCssText] = useState(() =>
    buildInitialCss(initialCustomCss, initialThemeConfig)
  )

  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // ============================================
  // Parsed CSS variables (derived synchronously — regex is <1ms)
  // ============================================
  const parsedCssVariables = useMemo(() => extractCssVariables(cssText), [cssText])

  // ============================================
  // Derived values from parsed CSS
  // ============================================
  const previewModeDisabled: 'light' | 'dark' | null =
    themeMode === 'dark' ? 'light' : themeMode === 'light' ? 'dark' : null

  const defaultPreset = themePresets.default
  const defaultLightMinimal = useMemo(() => extractMinimal(defaultPreset.light), [defaultPreset])
  const defaultDarkMinimal = useMemo(() => extractMinimal(defaultPreset.dark), [defaultPreset])

  const font = useMemo(
    () => parsedCssVariables.light['--font-sans'] || DEFAULT_FONT,
    [parsedCssVariables]
  )

  const currentFontId = useMemo(
    () => FONT_OPTIONS.find((f) => f.value === normalizeFontSans(font))?.id || 'inter',
    [font]
  )

  const radius = useMemo(() => {
    const raw = parsedCssVariables.light['--radius']
    if (!raw) return DEFAULT_RADIUS
    const match = raw.match(/^([\d.]+)rem$/)
    return match ? parseFloat(match[1]) : DEFAULT_RADIUS
  }, [parsedCssVariables])

  const activePresetId = useMemo(() => {
    const parsedLight = parseCssToMinimal(parsedCssVariables.light)
    for (const id of primaryPresetIds) {
      const preset = themePresets[id]
      if (!preset) continue
      const presetLight = extractMinimal(preset.light)
      const match = CORE_COLOR_KEYS.every((key) => parsedLight[key] === presetLight[key])
      if (match) return id
    }
    return null
  }, [parsedCssVariables])

  // ============================================
  // Actions — all modify cssText
  // ============================================
  const setPreset = useCallback(
    (presetId: string) => {
      const preset = themePresets[presetId]
      if (!preset) return
      const lightMinimal = extractMinimal(preset.light)
      const darkMinimal = extractMinimal(preset.dark)
      setCssText(generateReadableCSS(lightMinimal, darkMinimal, themeMode))
    },
    [themeMode]
  )

  const setFont = useCallback((fontValue: string) => {
    setCssText((prev) => replaceCssVar(prev, '--font-sans', fontValue))
  }, [])

  const setRadius = useCallback((r: number) => {
    setCssText((prev) => replaceCssVar(prev, '--radius', `${r}rem`))
  }, [])

  // ============================================
  // Save
  // ============================================
  const saveTheme = useCallback(async () => {
    setIsSaving(true)
    setSaveSuccess(false)

    try {
      // Parse cssText back to structured config for backward compat
      const parsed = extractCssVariables(cssText)
      const lightParsed = parseCssToMinimal(parsed.light)
      const darkParsed = parseCssToMinimal(parsed.dark)

      const lightMinimal: MinimalThemeVariables = { ...defaultLightMinimal, ...lightParsed }
      const darkMinimal: MinimalThemeVariables = { ...defaultDarkMinimal, ...darkParsed }

      const themeConfig: ThemeConfig = {
        themeMode,
        light: { ...lightMinimal, fontSans: font, radius: `${radius}rem` },
        dark: { ...darkMinimal, fontSans: font, radius: `${radius}rem` },
      }

      // The mutation hook invalidates the branding + customCss queries on success,
      // so the next visit reflects the save instead of re-seeding the editor from
      // the stale pre-save cache.
      await saveBrandingTheme({
        brandingConfig: themeConfig as unknown as Record<string, unknown>,
        customCss: cssText,
      })

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch (error) {
      console.error('Failed to save theme:', error)
    } finally {
      setIsSaving(false)
    }
  }, [cssText, themeMode, font, radius, defaultLightMinimal, defaultDarkMinimal, saveBrandingTheme])

  return {
    logoUrl,
    setLogoUrl,
    previewMode,
    setPreviewMode,
    previewModeDisabled,
    themeMode,
    setThemeMode,
    activePresetId,
    setPreset,
    font,
    setFont,
    currentFontId,
    radius,
    setRadius,
    cssText,
    setCssText,
    parsedCssVariables,
    saveTheme,
    isSaving,
    saveSuccess,
  }
}
