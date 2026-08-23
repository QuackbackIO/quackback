import { useState, useMemo, useCallback } from 'react'
import {
  themePresets,
  primaryPresetIds,
  extractMinimal,
  extractCssVariables,
  generateReadableCSS,
  isGeneratedThemeCss,
  advancedCssRemainder,
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
  const defaultPreset = themePresets.default
  const parsed = extractCssVariables(initialCustomCss)
  // Structured brandingConfig wins; CSS-parsed values fill gaps so a
  // CSS-only palette (empty/partial config) is not replaced by defaults.
  const lightMinimal: Partial<MinimalThemeVariables> = {
    ...extractMinimal(defaultPreset.light),
    ...parseCssToMinimal(parsed.light),
    ...(initialThemeConfig.light ?? {}),
  }
  const darkMinimal: Partial<MinimalThemeVariables> = {
    ...extractMinimal(defaultPreset.dark),
    ...parseCssToMinimal(parsed.dark),
    ...(initialThemeConfig.dark ?? {}),
  }

  // Always emit both palettes so a later switch back to user mode still
  // has the inactive side in cssText for saveTheme to parse. Preview
  // locking uses initialThemeConfig.themeMode separately.
  const generated = generateReadableCSS(lightMinimal, darkMinimal, 'user')
  const remainder = advancedCssRemainder(initialCustomCss)
  if (!remainder) return generated
  return `${generated.trimEnd()}\n\n${remainder}`
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

  // Forced light/dark also locks the preview toggle. cssText is left intact so
  // the inactive palette is still present when saveTheme parses brandingConfig.
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

  const font = useMemo(() => {
    const light = parsedCssVariables.light['--font-sans']
    const dark = parsedCssVariables.dark['--font-sans']
    if (themeMode === 'dark') return dark || light || DEFAULT_FONT
    return light || dark || DEFAULT_FONT
  }, [parsedCssVariables, themeMode])

  const currentFontId = useMemo(
    () => FONT_OPTIONS.find((f) => f.value === normalizeFontSans(font))?.id || 'inter',
    [font]
  )

  const radius = useMemo(() => {
    const light = parsedCssVariables.light['--radius']
    const dark = parsedCssVariables.dark['--radius']
    const raw = themeMode === 'dark' ? dark || light : light || dark
    if (!raw) return DEFAULT_RADIUS
    const match = raw.match(/^([\d.]+)rem$/)
    return match ? parseFloat(match[1]) : DEFAULT_RADIUS
  }, [parsedCssVariables, themeMode])

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

      const lightMinimal: Partial<MinimalThemeVariables> = {
        ...defaultLightMinimal,
        ...lightParsed,
      }
      const darkMinimal: Partial<MinimalThemeVariables> = { ...defaultDarkMinimal, ...darkParsed }

      const themeConfig: ThemeConfig = {
        themeMode,
        light: { ...lightMinimal, fontSans: font, radius: `${radius}rem` },
        dark: { ...darkMinimal, fontSans: font, radius: `${radius}rem` },
      }

      // Generated theme CSS is reconstructed from brandingConfig. Stored
      // customCss is remainder-only so leftover :root/.dark theme vars cannot
      // override the saved colours. Extra rules that changed still persist
      // through the Pro gate; unchanged extras are rewritten without it.
      const remainder = advancedCssRemainder(cssText)
      const customCssWrite =
        isGeneratedThemeCss(cssText, lightMinimal, darkMinimal) || !remainder
          ? 'clear'
          : remainder === advancedCssRemainder(initialCustomCss)
            ? 'rewrite'
            : 'persist'

      // The mutation hook invalidates the branding + customCss queries on success,
      // so the next visit reflects the save instead of re-seeding the editor from
      // the stale pre-save cache.
      await saveBrandingTheme({
        brandingConfig: themeConfig as unknown as Record<string, unknown>,
        customCss: remainder,
        customCssWrite,
      })

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } finally {
      setIsSaving(false)
    }
  }, [
    cssText,
    themeMode,
    font,
    radius,
    defaultLightMinimal,
    defaultDarkMinimal,
    saveBrandingTheme,
    initialCustomCss,
  ])

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
