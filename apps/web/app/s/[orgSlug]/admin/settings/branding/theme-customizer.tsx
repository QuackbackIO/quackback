'use client'

import { useState, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CollapsibleSection } from '@/components/ui/collapsible'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Check, Loader2, RotateCcw, Upload, Download, Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  themePresets,
  primaryPresetIds,
  hexToOklch,
  oklchToHex,
  type ThemeConfig,
  type ThemeVariables,
} from '@quackback/domain/theme'
import { ThemePreview } from './theme-preview'

interface ThemeCustomizerProps {
  organizationId: string
  initialThemeConfig: ThemeConfig
  logoUrl?: string | null
  organizationName?: string
  /** Branding assets section (logo uploader) */
  brandingAssets?: React.ReactNode
}

/** Font options - Popular Google Fonts */
const FONT_OPTIONS = [
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
    id: 'montserrat',
    name: 'Montserrat',
    value: '"Montserrat", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Montserrat',
  },
  {
    id: 'poppins',
    name: 'Poppins',
    value: '"Poppins", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Poppins',
  },
  {
    id: 'nunito',
    name: 'Nunito',
    value: '"Nunito", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Nunito',
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
    id: 'work-sans',
    name: 'Work Sans',
    value: '"Work Sans", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Work+Sans',
  },
  {
    id: 'raleway',
    name: 'Raleway',
    value: '"Raleway", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Raleway',
  },
  {
    id: 'source-sans',
    name: 'Source Sans 3',
    value: '"Source Sans 3", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Source+Sans+3',
  },
  {
    id: 'outfit',
    name: 'Outfit',
    value: '"Outfit", ui-sans-serif, system-ui, sans-serif',
    category: 'Sans Serif',
    googleName: 'Outfit',
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
    id: 'crimson',
    name: 'Crimson Text',
    value: '"Crimson Text", ui-serif, Georgia, serif',
    category: 'Serif',
    googleName: 'Crimson+Text',
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

/** Google Fonts URL with all fonts for the dropdown preview */
const ALL_FONTS_URL = `https://fonts.googleapis.com/css2?family=${FONT_OPTIONS.filter(
  (f) => f.googleName
)
  .map((f) => f.googleName)
  .join('&family=')}&display=swap`

/** Color variable groups for organized palette editor - matching tweakcn structure */
const COLOR_GROUPS = [
  {
    name: 'Primary Colors',
    variables: [
      { key: 'primary', label: 'Primary' },
      { key: 'primaryForeground', label: 'Primary Foreground' },
    ],
  },
  {
    name: 'Secondary Colors',
    variables: [
      { key: 'secondary', label: 'Secondary' },
      { key: 'secondaryForeground', label: 'Secondary Foreground' },
    ],
  },
  {
    name: 'Accent Colors',
    variables: [
      { key: 'accent', label: 'Accent' },
      { key: 'accentForeground', label: 'Accent Foreground' },
    ],
  },
  {
    name: 'Base Colors',
    variables: [
      { key: 'background', label: 'Background' },
      { key: 'foreground', label: 'Foreground' },
    ],
  },
  {
    name: 'Card Colors',
    variables: [
      { key: 'card', label: 'Card' },
      { key: 'cardForeground', label: 'Card Foreground' },
    ],
  },
  {
    name: 'Popover Colors',
    variables: [
      { key: 'popover', label: 'Popover' },
      { key: 'popoverForeground', label: 'Popover Foreground' },
    ],
  },
  {
    name: 'Muted Colors',
    variables: [
      { key: 'muted', label: 'Muted' },
      { key: 'mutedForeground', label: 'Muted Foreground' },
    ],
  },
  {
    name: 'Destructive Colors',
    variables: [
      { key: 'destructive', label: 'Destructive' },
      { key: 'destructiveForeground', label: 'Destructive Foreground' },
    ],
  },
  {
    name: 'Border & Input',
    variables: [
      { key: 'border', label: 'Border' },
      { key: 'input', label: 'Input' },
      { key: 'ring', label: 'Ring' },
    ],
  },
  {
    name: 'Chart Colors',
    variables: [
      { key: 'chart1', label: 'Chart 1' },
      { key: 'chart2', label: 'Chart 2' },
      { key: 'chart3', label: 'Chart 3' },
      { key: 'chart4', label: 'Chart 4' },
      { key: 'chart5', label: 'Chart 5' },
    ],
  },
  {
    name: 'Sidebar Colors',
    variables: [
      { key: 'sidebarBackground', label: 'Sidebar' },
      { key: 'sidebarForeground', label: 'Sidebar Foreground' },
      { key: 'sidebarPrimary', label: 'Sidebar Primary' },
      { key: 'sidebarPrimaryForeground', label: 'Sidebar Primary FG' },
      { key: 'sidebarAccent', label: 'Sidebar Accent' },
      { key: 'sidebarAccentForeground', label: 'Sidebar Accent FG' },
      { key: 'sidebarBorder', label: 'Sidebar Border' },
      { key: 'sidebarRing', label: 'Sidebar Ring' },
    ],
  },
] as const

/** Flat list of all color variables for type safety */
const ALL_COLOR_KEYS = COLOR_GROUPS.flatMap((g) => g.variables.map((v) => v.key))

type ColorVariable = (typeof ALL_COLOR_KEYS)[number]

export function ThemeCustomizer({
  organizationId,
  initialThemeConfig,
  logoUrl,
  organizationName,
  brandingAssets,
}: ThemeCustomizerProps) {
  // Preset selection
  const [selectedPreset, setSelectedPreset] = useState(initialThemeConfig.preset || 'default')

  // Preview mode (light/dark)
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>('light')

  // Custom overrides
  const [lightOverrides, setLightOverrides] = useState<Partial<ThemeVariables>>(
    initialThemeConfig.light || {}
  )
  const [darkOverrides, setDarkOverrides] = useState<Partial<ThemeVariables>>(
    initialThemeConfig.dark || {}
  )

  // Typography settings - initialize from preset if no override
  const currentPreset = themePresets[selectedPreset] || themePresets.default
  const [fontSans, setFontSans] = useState(() => {
    if (initialThemeConfig.light?.fontSans) return initialThemeConfig.light.fontSans
    return currentPreset.light.fontSans || FONT_OPTIONS[0].value
  })
  const [fontSerif, setFontSerif] = useState(() => {
    if (initialThemeConfig.light?.fontSerif) return initialThemeConfig.light.fontSerif
    return currentPreset.light.fontSerif || 'ui-serif, Georgia, Cambria, serif'
  })
  const [fontMono, setFontMono] = useState(() => {
    if (initialThemeConfig.light?.fontMono) return initialThemeConfig.light.fontMono
    return currentPreset.light.fontMono || 'ui-monospace, SFMono-Regular, monospace'
  })
  const [radius, setRadius] = useState(() => {
    const r = initialThemeConfig.light?.radius || currentPreset.light.radius
    if (r) {
      const match = r.match(/^([\d.]+)rem$/)
      if (match) return parseFloat(match[1])
    }
    return 0.625 // default
  })

  // Save state
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Import/export state
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [exportCopied, setExportCopied] = useState(false)

  // Handle preset selection - apply preset's font and radius
  const handlePresetSelect = useCallback((presetId: string) => {
    setSelectedPreset(presetId)
    const preset = themePresets[presetId]
    if (preset) {
      // Apply the preset's typography
      if (preset.light.fontSans) setFontSans(preset.light.fontSans)
      if (preset.light.fontSerif) setFontSerif(preset.light.fontSerif)
      if (preset.light.fontMono) setFontMono(preset.light.fontMono)
      if (preset.light.radius) {
        const match = preset.light.radius.match(/^([\d.]+)rem$/)
        if (match) setRadius(parseFloat(match[1]))
      }
      // Clear color overrides when switching presets
      setLightOverrides({})
      setDarkOverrides({})
    }
  }, [])

  // Compute effective colors for preview (preset + overrides)
  const effectiveLight = useMemo(() => {
    return {
      ...currentPreset.light,
      ...lightOverrides,
      fontSans,
      fontSerif,
      fontMono,
      radius: `${radius}rem`,
    }
  }, [currentPreset.light, lightOverrides, fontSans, fontSerif, fontMono, radius])

  const effectiveDark = useMemo(() => {
    return {
      ...currentPreset.dark,
      ...darkOverrides,
      fontSans,
      fontSerif,
      fontMono,
      radius: `${radius}rem`,
    }
  }, [currentPreset.dark, darkOverrides, fontSans, fontSerif, fontMono, radius])

  // Handle color change for a variable
  function handleColorChange(mode: 'light' | 'dark', variable: ColorVariable, hexColor: string) {
    const oklchColor = hexToOklch(hexColor)
    if (mode === 'light') {
      setLightOverrides((prev) => ({ ...prev, [variable]: oklchColor }))
    } else {
      setDarkOverrides((prev) => ({ ...prev, [variable]: oklchColor }))
    }
  }

  // Get hex value for color picker (convert from OKLCH)
  function getHexValue(mode: 'light' | 'dark', variable: ColorVariable): string {
    const vars = mode === 'light' ? effectiveLight : effectiveDark
    const oklch = vars[variable as keyof ThemeVariables]
    if (!oklch || typeof oklch !== 'string') return '#000000'
    try {
      return oklchToHex(oklch)
    } catch {
      return '#000000'
    }
  }

  // Reset a variable to preset default
  function resetVariable(mode: 'light' | 'dark', variable: ColorVariable) {
    if (mode === 'light') {
      setLightOverrides((prev) => {
        const next = { ...prev }
        delete next[variable as keyof ThemeVariables]
        return next
      })
    } else {
      setDarkOverrides((prev) => {
        const next = { ...prev }
        delete next[variable as keyof ThemeVariables]
        return next
      })
    }
  }

  // Check if a variable has been customized
  function isCustomized(mode: 'light' | 'dark', variable: ColorVariable): boolean {
    const overrides = mode === 'light' ? lightOverrides : darkOverrides
    return variable in overrides
  }

  // Reset all color customizations
  function resetAllColors() {
    setLightOverrides({})
    setDarkOverrides({})
  }

  // Check if any colors have been customized
  const hasColorCustomizations =
    Object.keys(lightOverrides).filter((k) => ALL_COLOR_KEYS.includes(k as ColorVariable)).length >
      0 ||
    Object.keys(darkOverrides).filter((k) => ALL_COLOR_KEYS.includes(k as ColorVariable)).length > 0

  // Generate current theme config for export
  // Always save radius and fonts explicitly to ensure portal gets correct values
  const getCurrentThemeConfig = useCallback((): ThemeConfig => {
    const config: ThemeConfig = {
      preset: selectedPreset,
    }

    // Build light overrides - always include radius and fonts for reliability
    const light: Partial<ThemeVariables> = {
      ...lightOverrides,
      // Always save these values explicitly to avoid floating point comparison issues
      // and ensure the portal always gets the intended values
      fontSans,
      radius: `${radius}rem`,
    }

    if (Object.keys(light).length > 0) {
      config.light = light
    }

    // Build dark overrides (only colors, typography shared)
    if (Object.keys(darkOverrides).length > 0) {
      config.dark = darkOverrides
    }

    return config
  }, [selectedPreset, lightOverrides, darkOverrides, fontSans, radius])

  // Parse CSS variables from :root { } block
  function parseCssVariables(css: string): Partial<ThemeVariables> | null {
    const vars: Partial<ThemeVariables> = {}

    // Match CSS variable declarations like --primary: oklch(...);
    const varRegex = /--([\w-]+)\s*:\s*([^;]+);/g
    let match

    while ((match = varRegex.exec(css)) !== null) {
      const [, name, value] = match
      // Convert kebab-case to camelCase
      const camelName = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      vars[camelName as keyof ThemeVariables] = value.trim()
    }

    return Object.keys(vars).length > 0 ? vars : null
  }

  // Import theme from CSS
  function handleImport() {
    setImportError(null)

    const trimmed = importText.trim()
    if (!trimmed) {
      setImportError('Please paste CSS variables')
      return
    }

    // Extract :root block
    const rootMatch = trimmed.match(/:root\s*\{([^}]+)\}/s)
    const darkMatch = trimmed.match(/\.dark\s*\{([^}]+)\}/s)

    if (!rootMatch && !darkMatch) {
      setImportError('No :root or .dark CSS block found')
      return
    }

    // Parse light mode variables
    if (rootMatch) {
      const lightVars = parseCssVariables(rootMatch[1])
      if (lightVars) {
        setLightOverrides(lightVars)
        // Extract typography settings
        if (lightVars.fontSans) {
          setFontSans(lightVars.fontSans)
        }
        if (lightVars.fontSerif) {
          setFontSerif(lightVars.fontSerif)
        }
        if (lightVars.fontMono) {
          setFontMono(lightVars.fontMono)
        }
        if (lightVars.radius) {
          const match = lightVars.radius.match(/^([\d.]+)rem$/)
          if (match) setRadius(parseFloat(match[1]))
        }
      }
    }

    // Parse dark mode variables
    if (darkMatch) {
      const darkVars = parseCssVariables(darkMatch[1])
      if (darkVars) {
        setDarkOverrides(darkVars)
      }
    }

    // Reset to default preset since we're importing custom values
    setSelectedPreset('default')
    setImportText('')
    setImportError(null)
  }

  async function handleSave() {
    setIsSaving(true)
    setSaveSuccess(false)

    try {
      const themeConfig = getCurrentThemeConfig()

      const response = await fetch('/api/organization/theme', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          brandingConfig: themeConfig,
        }),
      })

      if (response.ok) {
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2000)
      }
    } catch (error) {
      console.error('Failed to save theme:', error)
    } finally {
      setIsSaving(false)
    }
  }

  // Find current fonts
  const currentSansFontId = FONT_OPTIONS.find((f) => f.value === fontSans)?.id || 'inter'
  const currentSerifFontId = FONT_OPTIONS.find((f) => f.value === fontSerif)?.id || 'merriweather'
  const currentMonoFontId = FONT_OPTIONS.find((f) => f.value === fontMono)?.id || 'fira-code'

  // Generate CSS variables export
  const cssExport = useMemo(() => {
    const toKebab = (str: string) => str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()

    const lightVars = Object.entries(effectiveLight)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => `  --${toKebab(k)}: ${v};`)
      .join('\n')

    const darkVars = Object.entries(effectiveDark)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => `  --${toKebab(k)}: ${v};`)
      .join('\n')

    return `:root {
${lightVars}
}

.dark {
${darkVars}
}`
  }, [effectiveLight, effectiveDark])

  const handleCopyExport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(cssExport)
      setExportCopied(true)
      setTimeout(() => setExportCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [cssExport])

  const handleDownload = useCallback(() => {
    const blob = new Blob([cssExport], { type: 'text/css' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'theme.css'
    a.click()
    URL.revokeObjectURL(url)
  }, [cssExport])

  return (
    <>
      {/* Preload all Google Fonts for dropdown preview */}
      <link rel="stylesheet" href={ALL_FONTS_URL} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6">
        {/* Left: Controls */}
        <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden flex flex-col">
          <Tabs defaultValue="brand" className="flex flex-col flex-1">
            {/* Tab Headers */}
            <div className="px-4 pt-3 border-b border-border/50">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="brand">Brand</TabsTrigger>
                <TabsTrigger value="colors">Colors</TabsTrigger>
                <TabsTrigger value="typography">Typography</TabsTrigger>
              </TabsList>
            </div>

            {/* Brand Tab */}
            <TabsContent value="brand" className="flex-1 overflow-auto pt-0 mt-0">
              <div className="p-4 space-y-4">
                {/* Theme Preset */}
                <div>
                  <Label className="text-sm font-medium mb-2 block">Theme Preset</Label>
                  <Select value={selectedPreset} onValueChange={handlePresetSelect}>
                    <SelectTrigger className="w-full h-auto py-2">
                      <SelectValue>
                        <ThemePresetCard preset={themePresets[selectedPreset]} compact />
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="w-[var(--radix-select-trigger-width)] p-1.5 space-y-1">
                      {primaryPresetIds.map((presetId) => {
                        const preset = themePresets[presetId]
                        if (!preset) return null
                        return (
                          <SelectItem
                            key={presetId}
                            value={presetId}
                            className="p-0 focus:bg-transparent data-[highlighted]:bg-transparent [&>span:first-child]:hidden"
                          >
                            <ThemePresetCard
                              preset={preset}
                              selected={selectedPreset === presetId}
                            />
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Logo (from brandingAssets) */}
                {brandingAssets}

                {/* Import / Export */}
                <CollapsibleSection
                  title="Import / Export"
                  description="CSS variables"
                  className="border rounded-lg"
                >
                  <div className="space-y-3">
                    {/* Export */}
                    <div className="relative">
                      <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-x-auto max-h-40 font-mono">
                        {cssExport}
                      </pre>
                      <div className="absolute top-2 right-2 flex gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleCopyExport}
                          className="h-6 px-2 text-xs"
                        >
                          {exportCopied ? (
                            <>
                              <Check className="mr-1 h-3 w-3" />
                              Copied
                            </>
                          ) : (
                            'Copy'
                          )}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleDownload}
                          className="h-6 px-2"
                        >
                          <Download className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Import */}
                    <div className="space-y-2">
                      <Textarea
                        placeholder={`:root {
  --primary: oklch(0.6 0.2 265);
  --background: oklch(1 0 0);
}`}
                        value={importText}
                        onChange={(e) => {
                          setImportText(e.target.value)
                          setImportError(null)
                        }}
                        className="min-h-[80px] font-mono text-xs"
                      />
                      {importError && <p className="text-xs text-destructive">{importError}</p>}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleImport}
                        disabled={!importText.trim()}
                        className="w-full"
                      >
                        <Upload className="mr-2 h-3.5 w-3.5" />
                        Import CSS
                      </Button>
                    </div>
                  </div>
                </CollapsibleSection>
              </div>
            </TabsContent>

            {/* Colors Tab */}
            <TabsContent value="colors" className="flex-1 overflow-auto pt-0 mt-0">
              {/* Color Mode Toggle */}
              <div className="px-4 py-3 flex items-center justify-between border-b border-border/50 sticky top-0 bg-card z-10">
                <div className="flex gap-1 p-1 rounded-lg border border-border bg-muted/30">
                  <button
                    onClick={() => setPreviewMode('light')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                      previewMode === 'light'
                        ? 'bg-background shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Sun className="h-3.5 w-3.5" />
                    Light
                  </button>
                  <button
                    onClick={() => setPreviewMode('dark')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                      previewMode === 'dark'
                        ? 'bg-background shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Moon className="h-3.5 w-3.5" />
                    Dark
                  </button>
                </div>
                {hasColorCustomizations && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetAllColors}
                    className="h-7 text-xs"
                  >
                    <RotateCcw className="mr-1.5 h-3 w-3" />
                    Reset
                  </Button>
                )}
              </div>

              {/* Color Groups */}
              <div className="divide-y divide-border/50">
                {COLOR_GROUPS.map((group, idx) => (
                  <CollapsibleSection key={group.name} title={group.name} defaultOpen={idx < 4}>
                    <div className="grid grid-cols-2 gap-2">
                      {group.variables.map(({ key, label }) => (
                        <ColorPicker
                          key={key}
                          label={label}
                          value={getHexValue(previewMode, key as ColorVariable)}
                          onChange={(hex) =>
                            handleColorChange(previewMode, key as ColorVariable, hex)
                          }
                          onReset={() => resetVariable(previewMode, key as ColorVariable)}
                          isCustomized={isCustomized(previewMode, key as ColorVariable)}
                        />
                      ))}
                    </div>
                  </CollapsibleSection>
                ))}
              </div>
            </TabsContent>

            {/* Typography Tab */}
            <TabsContent value="typography" className="flex-1 overflow-auto pt-0 mt-0">
              <div className="p-4 space-y-6">
                {/* Fonts */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium">Font Families</h3>

                  {/* Sans-Serif Font */}
                  <div>
                    <Label className="text-xs mb-1.5 block text-muted-foreground">Sans-Serif</Label>
                    <Select
                      value={currentSansFontId}
                      onValueChange={(id) => {
                        const font = FONT_OPTIONS.find((f) => f.id === id)
                        if (font) setFontSans(font.value)
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          <span style={{ fontFamily: fontSans }}>
                            {FONT_OPTIONS.find((f) => f.id === currentSansFontId)?.name ||
                              'Select font'}
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        <SelectGroup>
                          <SelectLabel>Sans Serif</SelectLabel>
                          {FONT_OPTIONS.filter((f) => f.category === 'Sans Serif').map((font) => (
                            <SelectItem key={font.id} value={font.id}>
                              <span className="text-base" style={{ fontFamily: font.value }}>
                                {font.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>System</SelectLabel>
                          {FONT_OPTIONS.filter((f) => f.category === 'System').map((font) => (
                            <SelectItem key={font.id} value={font.id}>
                              <span className="text-base" style={{ fontFamily: font.value }}>
                                {font.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Serif Font */}
                  <div>
                    <Label className="text-xs mb-1.5 block text-muted-foreground">Serif</Label>
                    <Select
                      value={currentSerifFontId}
                      onValueChange={(id) => {
                        const font = FONT_OPTIONS.find((f) => f.id === id)
                        if (font) setFontSerif(font.value)
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          <span style={{ fontFamily: fontSerif }}>
                            {FONT_OPTIONS.find((f) => f.id === currentSerifFontId)?.name ||
                              'Select font'}
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {FONT_OPTIONS.filter((f) => f.category === 'Serif').map((font) => (
                          <SelectItem key={font.id} value={font.id}>
                            <span className="text-base" style={{ fontFamily: font.value }}>
                              {font.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Monospace Font */}
                  <div>
                    <Label className="text-xs mb-1.5 block text-muted-foreground">Monospace</Label>
                    <Select
                      value={currentMonoFontId}
                      onValueChange={(id) => {
                        const font = FONT_OPTIONS.find((f) => f.id === id)
                        if (font) setFontMono(font.value)
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          <span style={{ fontFamily: fontMono }}>
                            {FONT_OPTIONS.find((f) => f.id === currentMonoFontId)?.name ||
                              'Select font'}
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {FONT_OPTIONS.filter((f) => f.category === 'Monospace').map((font) => (
                          <SelectItem key={font.id} value={font.id}>
                            <span className="text-base" style={{ fontFamily: font.value }}>
                              {font.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Border Radius */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Border Radius</h3>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-muted-foreground w-12">Sharp</span>
                    <Slider
                      value={[radius * 100]}
                      onValueChange={([v]) => setRadius(v / 100)}
                      min={0}
                      max={100}
                      step={5}
                      className="flex-1"
                    />
                    <span className="text-xs text-muted-foreground w-12 text-right">Round</span>
                    <div
                      className="h-8 w-12 bg-primary flex-shrink-0"
                      style={{ borderRadius: `${radius}rem` }}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* Save Button - Always visible */}
          <div className="p-4 border-t border-border/50 mt-auto">
            <Button onClick={handleSave} disabled={isSaving} className="w-full">
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : saveSuccess ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Saved!
                </>
              ) : (
                'Save Theme'
              )}
            </Button>
          </div>
        </div>

        {/* Right: Preview (sticky) */}
        <div className="lg:sticky lg:top-4 lg:self-start lg:row-span-2">
          <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
            <div className="p-3 border-b border-border/50 flex items-center justify-between">
              <span className="text-sm font-medium">Preview</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPreviewMode('light')}
                  className={cn(
                    'p-1.5 rounded-md transition-colors',
                    previewMode === 'light' ? 'bg-muted' : 'hover:bg-muted/50'
                  )}
                >
                  <Sun className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPreviewMode('dark')}
                  className={cn(
                    'p-1.5 rounded-md transition-colors',
                    previewMode === 'dark' ? 'bg-muted' : 'hover:bg-muted/50'
                  )}
                >
                  <Moon className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="p-3">
              <ThemePreview
                lightVars={effectiveLight}
                darkVars={effectiveDark}
                previewMode={previewMode}
                radius={`${radius}rem`}
                fontFamily={fontSans}
                logoUrl={logoUrl}
                organizationName={organizationName}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/** Compact color picker component */
function ColorPicker({
  label,
  value,
  onChange,
  onReset,
  isCustomized,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
  onReset: () => void
  isCustomized: boolean
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/50 bg-background p-1.5">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <span className="flex-1 text-xs truncate">{label}</span>
      {isCustomized && (
        <button
          onClick={onReset}
          className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

/** Visual theme preset card for dropdown - shows 4 colors like tweakcn */
function ThemePresetCard({
  preset,
  selected,
  compact,
}: {
  preset: {
    name: string
    description: string
    color: string
    light: ThemeVariables
    dark: ThemeVariables
  }
  selected?: boolean
  compact?: boolean
}) {
  if (!preset) return null

  // Get colors for preview swatches
  const getHex = (oklch: string | undefined, fallback: string) => {
    if (!oklch) return fallback
    try {
      return oklchToHex(oklch)
    } catch {
      return fallback
    }
  }

  // 4 key colors: background, foreground, primary, secondary/muted
  const colors = [
    getHex(preset.light.background, '#ffffff'),
    getHex(preset.light.foreground, '#171717'),
    getHex(preset.light.primary, preset.color),
    getHex(preset.light.secondary || preset.light.muted, '#f5f5f5'),
  ]

  if (compact) {
    return (
      <div className="flex items-center gap-2.5">
        {/* 4-color swatch */}
        <div className="flex rounded overflow-hidden border border-border/40">
          {colors.map((color, i) => (
            <div key={i} className="w-3 h-5" style={{ backgroundColor: color }} />
          ))}
        </div>
        <span className="text-sm font-medium">{preset.name}</span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex gap-3 p-2.5 rounded-lg w-full transition-colors cursor-pointer',
        selected ? 'bg-accent' : 'hover:bg-muted/50'
      )}
    >
      {/* 4-color swatch preview */}
      <div className="flex-shrink-0 rounded-md overflow-hidden border border-border/40 shadow-sm flex">
        {colors.map((color, i) => (
          <div key={i} className="w-4 h-9" style={{ backgroundColor: color }} />
        ))}
      </div>
      {/* Text */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="text-sm font-medium">{preset.name}</div>
        <div className="text-xs text-muted-foreground">{preset.description}</div>
      </div>
      {/* Selected indicator */}
      {selected && (
        <div className="flex-shrink-0 flex items-center">
          <Check className="h-4 w-4 text-primary" />
        </div>
      )}
    </div>
  )
}
