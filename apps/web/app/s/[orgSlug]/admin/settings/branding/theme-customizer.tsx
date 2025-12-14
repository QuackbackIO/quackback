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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { CollapsibleSection } from '@/components/ui/collapsible'
import {
  Check,
  Loader2,
  RotateCcw,
  Upload,
  Download,
  Sun,
  Moon,
  Copy,
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  themePresets,
  primaryPresetIds,
  hexToOklch,
  oklchToHex,
  type ThemeConfig,
  type ThemeVariables,
} from '@quackback/domain/theme'
import {
  useOrganizationLogo,
  useOrganizationHeaderLogo,
} from '@/lib/hooks/use-organization-queries'
import { ThemePreview } from './theme-preview'

type HeaderDisplayMode = 'logo_and_name' | 'logo_only' | 'custom_logo'

interface ThemeCustomizerProps {
  organizationId: string
  initialThemeConfig: ThemeConfig
  logoUrl?: string | null
  organizationName?: string
  headerLogoUrl?: string | null
  headerDisplayMode?: HeaderDisplayMode
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
  logoUrl: initialLogoUrl,
  organizationName,
  headerLogoUrl: initialHeaderLogoUrl,
  headerDisplayMode: initialHeaderDisplayMode = 'logo_and_name',
}: ThemeCustomizerProps) {
  // Fetch logo data reactively so preview stays in sync
  // when LogoUploader component updates the logo
  const { data: logoData } = useOrganizationLogo(organizationId)
  const effectiveLogoUrl = logoData?.logoUrl ?? initialLogoUrl

  // Fetch header branding data reactively so preview stays in sync
  // when HeaderBranding component updates settings
  const { data: headerData } = useOrganizationHeaderLogo(organizationId)
  const effectiveHeaderLogoUrl = headerData?.headerLogoUrl ?? initialHeaderLogoUrl
  const effectiveHeaderDisplayMode =
    (headerData?.headerDisplayMode as HeaderDisplayMode) ?? initialHeaderDisplayMode
  const effectiveHeaderDisplayName = headerData?.headerDisplayName ?? null

  // Preview mode (light/dark) - used for preview panel only
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>('light')

  // Track which template the theme is based on
  const [appliedTemplate, setAppliedTemplate] = useState<string>(() => {
    return initialThemeConfig.preset || 'default'
  })

  // Full theme values - expanded from saved config or preset
  const defaultPreset = themePresets.default
  const [lightValues, setLightValues] = useState<ThemeVariables>(() => {
    // If saved config has light values, use them directly
    if (initialThemeConfig.light && Object.keys(initialThemeConfig.light).length > 0) {
      return { ...defaultPreset.light, ...initialThemeConfig.light }
    }
    // Otherwise expand from preset if specified
    if (initialThemeConfig.preset && themePresets[initialThemeConfig.preset]) {
      return { ...themePresets[initialThemeConfig.preset].light }
    }
    // Default preset
    return { ...defaultPreset.light }
  })
  const [darkValues, setDarkValues] = useState<ThemeVariables>(() => {
    // If saved config has dark values, use them directly
    if (initialThemeConfig.dark && Object.keys(initialThemeConfig.dark).length > 0) {
      return { ...defaultPreset.dark, ...initialThemeConfig.dark }
    }
    // Otherwise expand from preset if specified
    if (initialThemeConfig.preset && themePresets[initialThemeConfig.preset]) {
      return { ...themePresets[initialThemeConfig.preset].dark }
    }
    // Default preset
    return { ...defaultPreset.dark }
  })

  // Typography settings - extracted from lightValues for convenience
  const [font, setFont] = useState(() => {
    return lightValues.fontSans || FONT_OPTIONS[0].value
  })
  const [radius, setRadius] = useState(() => {
    const r = lightValues.radius
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

  // Apply a template - populate all values from a preset
  const applyTemplate = useCallback((presetId: string) => {
    const preset = themePresets[presetId]
    if (preset) {
      // Track which template is applied
      setAppliedTemplate(presetId)
      // Apply all values from the preset
      setLightValues({ ...preset.light })
      setDarkValues({ ...preset.dark })
      // Update typography convenience state
      if (preset.light.fontSans) setFont(preset.light.fontSans)
      if (preset.light.radius) {
        const match = preset.light.radius.match(/^([\d.]+)rem$/)
        if (match) setRadius(parseFloat(match[1]))
      }
    }
  }, [])

  // Compute effective colors for preview (current values + typography)
  const effectiveLight = useMemo(() => {
    return {
      ...lightValues,
      fontSans: font,
      radius: `${radius}rem`,
    }
  }, [lightValues, font, radius])

  const effectiveDark = useMemo(() => {
    return {
      ...darkValues,
      fontSans: font,
      radius: `${radius}rem`,
    }
  }, [darkValues, font, radius])

  // Handle color change for a variable
  function handleColorChange(mode: 'light' | 'dark', variable: ColorVariable, hexColor: string) {
    const oklchColor = hexToOklch(hexColor)
    if (mode === 'light') {
      setLightValues((prev) => ({ ...prev, [variable]: oklchColor }))
    } else {
      setDarkValues((prev) => ({ ...prev, [variable]: oklchColor }))
    }
  }

  // Get hex value for color picker (convert from OKLCH)
  function getHexValue(mode: 'light' | 'dark', variable: ColorVariable): string {
    const vars = mode === 'light' ? lightValues : darkValues
    const oklch = vars[variable as keyof ThemeVariables]
    if (!oklch || typeof oklch !== 'string') return '#000000'
    try {
      return oklchToHex(oklch)
    } catch {
      return '#000000'
    }
  }

  // Reset a variable to applied template value
  function resetVariable(mode: 'light' | 'dark', variable: ColorVariable) {
    const preset = themePresets[appliedTemplate] || defaultPreset
    const templateValue =
      mode === 'light'
        ? preset.light[variable as keyof ThemeVariables]
        : preset.dark[variable as keyof ThemeVariables]
    if (mode === 'light') {
      setLightValues((prev) => ({ ...prev, [variable]: templateValue }))
    } else {
      setDarkValues((prev) => ({ ...prev, [variable]: templateValue }))
    }
  }

  // Get the current applied template preset
  const appliedPreset = themePresets[appliedTemplate] || defaultPreset

  // Check if a variable differs from the applied template
  function isCustomized(mode: 'light' | 'dark', variable: ColorVariable): boolean {
    const currentValue =
      mode === 'light'
        ? lightValues[variable as keyof ThemeVariables]
        : darkValues[variable as keyof ThemeVariables]
    const templateValue =
      mode === 'light'
        ? appliedPreset.light[variable as keyof ThemeVariables]
        : appliedPreset.dark[variable as keyof ThemeVariables]
    return currentValue !== templateValue
  }

  // Check if theme has any customizations from the applied template
  const isThemeCustomized = useMemo(() => {
    // Check if font or radius differs
    if (font !== appliedPreset.light.fontSans) return true
    if (`${radius}rem` !== appliedPreset.light.radius) return true
    // Check color values
    for (const key of ALL_COLOR_KEYS) {
      if (
        lightValues[key as keyof ThemeVariables] !==
        appliedPreset.light[key as keyof ThemeVariables]
      )
        return true
      if (
        darkValues[key as keyof ThemeVariables] !== appliedPreset.dark[key as keyof ThemeVariables]
      )
        return true
    }
    return false
  }, [lightValues, darkValues, font, radius, appliedPreset])

  // Reset all colors to applied template
  function resetAllColors(mode: 'light' | 'dark') {
    if (mode === 'light') {
      setLightValues({ ...appliedPreset.light })
      if (appliedPreset.light.fontSans) setFont(appliedPreset.light.fontSans)
      if (appliedPreset.light.radius) {
        const match = appliedPreset.light.radius.match(/^([\d.]+)rem$/)
        if (match) setRadius(parseFloat(match[1]))
      }
    } else {
      setDarkValues({ ...appliedPreset.dark })
    }
  }

  // Generate current theme config for saving
  // Saves full expanded values (no preset reference)
  const getCurrentThemeConfig = useCallback((): ThemeConfig => {
    return {
      light: {
        ...lightValues,
        fontSans: font,
        radius: `${radius}rem`,
      },
      dark: {
        ...darkValues,
      },
    }
  }, [lightValues, darkValues, font, radius])

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

  // Import theme from CSS and set as custom template
  function handleImportWithCustomTemplate(): boolean {
    setImportError(null)

    const trimmed = importText.trim()
    if (!trimmed) {
      setImportError('Please paste CSS variables')
      return false
    }

    // Extract :root block
    const rootMatch = trimmed.match(/:root\s*\{([^}]+)\}/s)
    const darkMatch = trimmed.match(/\.dark\s*\{([^}]+)\}/s)

    if (!rootMatch && !darkMatch) {
      setImportError('No :root or .dark CSS block found')
      return false
    }

    // Parse light mode variables
    if (rootMatch) {
      const lightVars = parseCssVariables(rootMatch[1])
      if (lightVars) {
        setLightValues((prev) => ({ ...prev, ...lightVars }))
        // Extract typography settings
        if (lightVars.fontSans) {
          setFont(lightVars.fontSans)
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
        setDarkValues((prev) => ({ ...prev, ...darkVars }))
      }
    }

    // Mark as custom import
    setAppliedTemplate('custom')
    setImportText('')
    setImportError(null)
    return true
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

  // Find current font
  const currentFontId = FONT_OPTIONS.find((f) => f.value === font)?.id || 'inter'

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

      <div className="rounded-xl border border-border bg-card">
        <div className="grid grid-cols-1 xl:grid-cols-2">
          {/* Left: Controls */}
          <div className="xl:border-r border-border flex flex-col min-w-0 overflow-hidden">
            {/* Template selector */}
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm">
                  <span className="text-muted-foreground">Based on: </span>
                  <span className="font-medium">
                    {appliedTemplate === 'custom' ? 'Custom' : appliedPreset.name}
                  </span>
                  {isThemeCustomized && (
                    <span className="text-muted-foreground ml-1">(customized)</span>
                  )}
                </p>
                {/* Export dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                      <Upload className="h-3.5 w-3.5" />
                      Export
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleCopyExport}>
                      <Copy className="h-4 w-4" />
                      {exportCopied ? 'Copied!' : 'Copy CSS'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownload}>
                      <Download className="h-4 w-4" />
                      Download .css
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex flex-wrap gap-2">
                {primaryPresetIds.map((presetId) => {
                  const preset = themePresets[presetId]
                  if (!preset) return null
                  return (
                    <TemplateCard
                      key={presetId}
                      preset={preset}
                      isSelected={appliedTemplate === presetId}
                      onClick={() => applyTemplate(presetId)}
                    />
                  )
                })}
                {/* Import button with modal */}
                <ImportDialog
                  importText={importText}
                  setImportText={setImportText}
                  importError={importError}
                  setImportError={setImportError}
                  onImport={handleImportWithCustomTemplate}
                  cssExport={cssExport}
                />
              </div>
            </div>

            {/* Collapsible Sections: Typography first, then Colors */}
            <div className="divide-y divide-border flex-1 overflow-y-auto overflow-x-hidden">
              {/* Typography Section */}
              <CollapsibleSection title="Typography" defaultOpen>
                <div className="space-y-4">
                  {/* Font */}
                  <div>
                    <Label className="text-xs mb-1.5 block text-muted-foreground">Font</Label>
                    <Select
                      value={currentFontId}
                      onValueChange={(id) => {
                        const selectedFont = FONT_OPTIONS.find((f) => f.id === id)
                        if (selectedFont) setFont(selectedFont.value)
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          <span style={{ fontFamily: font }}>
                            {FONT_OPTIONS.find((f) => f.id === currentFontId)?.name ||
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
                          <SelectLabel>Serif</SelectLabel>
                          {FONT_OPTIONS.filter((f) => f.category === 'Serif').map((font) => (
                            <SelectItem key={font.id} value={font.id}>
                              <span className="text-base" style={{ fontFamily: font.value }}>
                                {font.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                        <SelectGroup>
                          <SelectLabel>Monospace</SelectLabel>
                          {FONT_OPTIONS.filter((f) => f.category === 'Monospace').map((font) => (
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

                  {/* Border Radius */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Border Radius</Label>
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
              </CollapsibleSection>

              {/* Light Mode Section */}
              <CollapsibleSection
                title="Light Mode"
                icon={<Sun className="h-4 w-4" />}
                defaultOpen
                headerAction={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => resetAllColors('light')}
                    className="h-6 px-2 text-xs"
                  >
                    <RotateCcw className="mr-1 h-3 w-3" />
                    Reset
                  </Button>
                }
              >
                <div className="space-y-3">
                  {COLOR_GROUPS.map((group) => (
                    <div key={group.name}>
                      <div className="text-xs font-medium text-muted-foreground mb-1.5">
                        {group.name}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {group.variables.map(({ key, label }) => (
                          <ColorPicker
                            key={key}
                            label={label}
                            value={getHexValue('light', key as ColorVariable)}
                            onChange={(hex) =>
                              handleColorChange('light', key as ColorVariable, hex)
                            }
                            onReset={() => resetVariable('light', key as ColorVariable)}
                            isCustomized={isCustomized('light', key as ColorVariable)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>

              {/* Dark Mode Section */}
              <CollapsibleSection
                title="Dark Mode"
                icon={<Moon className="h-4 w-4" />}
                defaultOpen
                headerAction={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => resetAllColors('dark')}
                    className="h-6 px-2 text-xs"
                  >
                    <RotateCcw className="mr-1 h-3 w-3" />
                    Reset
                  </Button>
                }
              >
                <div className="space-y-3">
                  {COLOR_GROUPS.map((group) => (
                    <div key={group.name}>
                      <div className="text-xs font-medium text-muted-foreground mb-1.5">
                        {group.name}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {group.variables.map(({ key, label }) => (
                          <ColorPicker
                            key={key}
                            label={label}
                            value={getHexValue('dark', key as ColorVariable)}
                            onChange={(hex) => handleColorChange('dark', key as ColorVariable, hex)}
                            onReset={() => resetVariable('dark', key as ColorVariable)}
                            isCustomized={isCustomized('dark', key as ColorVariable)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            </div>

            {/* Save Button - Always visible */}
            <div className="p-4 border-t border-border mt-auto">
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

          {/* Right: Preview (sticky - follows scroll) */}
          <div className="border-t xl:border-t-0 xl:border-l border-border xl:sticky xl:top-4 xl:self-start p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Preview</span>
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
            <ThemePreview
              lightVars={effectiveLight}
              darkVars={effectiveDark}
              previewMode={previewMode}
              radius={`${radius}rem`}
              fontFamily={font}
              logoUrl={effectiveLogoUrl}
              organizationName={organizationName}
              headerLogoUrl={effectiveHeaderLogoUrl}
              headerDisplayMode={effectiveHeaderDisplayMode}
              headerDisplayName={effectiveHeaderDisplayName}
            />
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

/** Compact template card/pill for template selection */
function TemplateCard({
  preset,
  isSelected,
  onClick,
}: {
  preset: {
    name: string
    description: string
    color: string
    light: ThemeVariables
    dark: ThemeVariables
  }
  isSelected?: boolean
  onClick: () => void
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
    getHex(preset.light.primary, preset.color),
    getHex(preset.light.secondary || preset.light.muted, '#f5f5f5'),
    getHex(preset.light.foreground, '#171717'),
  ]

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-colors',
        isSelected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
          : 'border-border bg-background hover:bg-muted/50'
      )}
    >
      {/* Color swatches */}
      <div className="flex rounded overflow-hidden border border-border/40">
        {colors.map((color, i) => (
          <div key={i} className="w-3 h-5" style={{ backgroundColor: color }} />
        ))}
      </div>
      {/* Name */}
      <span className="text-sm font-medium">{preset.name}</span>
    </button>
  )
}

/** Import dialog button for importing CSS themes */
function ImportDialog({
  importText,
  setImportText,
  importError,
  setImportError,
  onImport,
  cssExport,
}: {
  importText: string
  setImportText: (text: string) => void
  importError: string | null
  setImportError: (error: string | null) => void
  onImport: () => boolean
  cssExport: string
}) {
  const [isOpen, setIsOpen] = useState(false)

  const handleImport = () => {
    const success = onImport()
    if (success) {
      setIsOpen(false)
    }
  }

  const handleDownloadTemplate = () => {
    const blob = new Blob([cssExport], { type: 'text/css' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'theme-template.css'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          <span className="text-sm">Import</span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Theme</DialogTitle>
          <DialogDescription>
            <span className="block">Paste CSS variables to import a theme.</span>
            <span>
              Not sure what to include?{' '}
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="text-primary hover:underline"
              >
                Download a template
              </button>{' '}
              to get started.
            </span>
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder={`:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  /* ... other variables */
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  /* ... other variables */
}`}
          value={importText}
          onChange={(e) => {
            setImportText(e.target.value)
            setImportError(null)
          }}
          className="h-[200px] sm:h-[400px] resize-none font-mono text-xs"
        />
        {importError && <p className="text-sm text-destructive">{importError}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!importText.trim()}>
            Apply Theme
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
