import { useState, useMemo, useCallback, useEffect } from 'react'
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
import {
  CheckIcon,
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  SunIcon,
  MoonIcon,
  DocumentDuplicateIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SwatchIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/utils'
import {
  themePresets,
  primaryPresetIds,
  hexToOklch,
  oklchToHex,
  expandTheme,
  extractMinimal,
  type ThemeConfig,
  type ThemeVariables,
  type MinimalThemeVariables,
} from '@/lib/theme'
import { useWorkspaceLogo, useWorkspaceHeaderLogo } from '@/lib/hooks/use-settings-queries'
import { updateThemeFn } from '@/lib/server-functions/settings'
import { ThemePreview } from '@/components/admin/settings/branding/theme-preview'

type HeaderDisplayMode = 'logo_and_name' | 'logo_only' | 'custom_logo'

interface ThemeCustomizerProps {
  initialThemeConfig: ThemeConfig
  logoUrl?: string | null
  workspaceName?: string
  headerLogoUrl?: string | null
  headerDisplayMode?: HeaderDisplayMode
}

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

const ALL_FONTS_URL = `https://fonts.googleapis.com/css2?family=${FONT_OPTIONS.filter(
  (f) => f.googleName
)
  .map((f) => f.googleName)
  .join('&family=')}&display=swap`

const ESSENTIAL_COLOR_GROUPS = [
  {
    name: 'Brand',
    description: 'Your primary brand color',
    variables: [{ key: 'primary' as const, label: 'Primary' }],
  },
  {
    name: 'Backgrounds',
    description: 'Surface colors for your portal',
    variables: [
      { key: 'background' as const, label: 'Page' },
      { key: 'card' as const, label: 'Cards' },
      { key: 'muted' as const, label: 'Subtle' },
    ],
  },
  {
    name: 'Text',
    description: 'Text colors',
    variables: [
      { key: 'foreground' as const, label: 'Primary' },
      { key: 'mutedForeground' as const, label: 'Secondary' },
    ],
  },
  {
    name: 'Accents',
    description: 'Borders and semantic colors',
    variables: [
      { key: 'border' as const, label: 'Borders' },
      { key: 'destructive' as const, label: 'Error' },
      { key: 'success' as const, label: 'Success' },
    ],
  },
] as const

type EssentialColorKey = (typeof ESSENTIAL_COLOR_GROUPS)[number]['variables'][number]['key']

export function ThemeCustomizer({
  initialThemeConfig,
  logoUrl: initialLogoUrl,
  workspaceName,
  headerLogoUrl: initialHeaderLogoUrl,
  headerDisplayMode: initialHeaderDisplayMode = 'logo_and_name',
}: ThemeCustomizerProps): React.ReactElement {
  const { data: logoData } = useWorkspaceLogo()
  const { data: headerData } = useWorkspaceHeaderLogo()

  const effectiveLogoUrl = logoData?.logoUrl ?? initialLogoUrl
  const effectiveHeaderLogoUrl = headerData?.headerLogoUrl ?? initialHeaderLogoUrl
  const effectiveHeaderDisplayMode =
    (headerData?.headerDisplayMode as HeaderDisplayMode) ?? initialHeaderDisplayMode
  const effectiveHeaderDisplayName = headerData?.headerDisplayName ?? null

  const [editMode, setEditMode] = useState<'light' | 'dark'>('light')
  const [appliedTemplate, setAppliedTemplate] = useState<string>(
    () => initialThemeConfig.preset || 'default'
  )
  const [showAdvanced, setShowAdvanced] = useState(false)

  const defaultPreset = themePresets.default
  const [lightValues, setLightValues] = useState<MinimalThemeVariables>(() => {
    if (initialThemeConfig.light && Object.keys(initialThemeConfig.light).length > 0) {
      return extractMinimal({ ...defaultPreset.light, ...initialThemeConfig.light })
    }
    if (initialThemeConfig.preset && themePresets[initialThemeConfig.preset]) {
      return extractMinimal(themePresets[initialThemeConfig.preset].light)
    }
    return extractMinimal(defaultPreset.light)
  })

  const [darkValues, setDarkValues] = useState<MinimalThemeVariables>(() => {
    if (initialThemeConfig.dark && Object.keys(initialThemeConfig.dark).length > 0) {
      return extractMinimal({ ...defaultPreset.dark, ...initialThemeConfig.dark })
    }
    if (initialThemeConfig.preset && themePresets[initialThemeConfig.preset]) {
      return extractMinimal(themePresets[initialThemeConfig.preset].dark)
    }
    return extractMinimal(defaultPreset.dark)
  })

  const [font, setFont] = useState(() => lightValues.fontSans || FONT_OPTIONS[0].value)
  const [radius, setRadius] = useState(() => {
    const match = lightValues.radius?.match(/^([\d.]+)rem$/)
    return match ? parseFloat(match[1]) : 0.625
  })

  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [exportCopied, setExportCopied] = useState(false)

  const currentValues = editMode === 'light' ? lightValues : darkValues
  const setCurrentValues = editMode === 'light' ? setLightValues : setDarkValues

  const effectiveLight = useMemo(
    () =>
      expandTheme({ ...lightValues, fontSans: font, radius: `${radius}rem` }, { mode: 'light' }),
    [lightValues, font, radius]
  )

  const effectiveDark = useMemo(
    () => expandTheme({ ...darkValues, fontSans: font, radius: `${radius}rem` }, { mode: 'dark' }),
    [darkValues, font, radius]
  )

  const applyTemplate = useCallback((presetId: string) => {
    const preset = themePresets[presetId]
    if (preset) {
      setAppliedTemplate(presetId)
      setLightValues(extractMinimal(preset.light))
      setDarkValues(extractMinimal(preset.dark))
      if (preset.light.fontSans) setFont(preset.light.fontSans)
      if (preset.light.radius) {
        const match = preset.light.radius.match(/^([\d.]+)rem$/)
        if (match) setRadius(parseFloat(match[1]))
      }
    }
  }, [])

  function handleColorChange(variable: EssentialColorKey, hexColor: string): void {
    const oklchColor = hexToOklch(hexColor)
    setCurrentValues((prev: MinimalThemeVariables) => ({ ...prev, [variable]: oklchColor }))
  }

  function getHexValue(variable: EssentialColorKey): string {
    const oklch = currentValues[variable]
    if (!oklch || typeof oklch !== 'string') return '#000000'
    try {
      return oklchToHex(oklch)
    } catch {
      return '#000000'
    }
  }

  const appliedPreset = themePresets[appliedTemplate] || defaultPreset
  const appliedMinimal = extractMinimal(
    editMode === 'light' ? appliedPreset.light : appliedPreset.dark
  )

  function isCustomized(variable: EssentialColorKey): boolean {
    return currentValues[variable] !== appliedMinimal[variable]
  }

  function resetVariable(variable: EssentialColorKey): void {
    setCurrentValues((prev: MinimalThemeVariables) => ({
      ...prev,
      [variable]: appliedMinimal[variable],
    }))
  }

  function resetAllColors(): void {
    setCurrentValues(
      extractMinimal(editMode === 'light' ? appliedPreset.light : appliedPreset.dark)
    )
  }

  const getCurrentThemeConfig = useCallback(
    (): ThemeConfig => ({
      light: { ...lightValues, fontSans: font, radius: `${radius}rem` },
      dark: { ...darkValues, fontSans: font, radius: `${radius}rem` },
    }),
    [lightValues, darkValues, font, radius]
  )

  function parseCssVariables(css: string): Partial<ThemeVariables> | null {
    const vars: Partial<ThemeVariables> = {}
    const varRegex = /--([\w-]+)\s*:\s*([^;]+);/g
    let match
    while ((match = varRegex.exec(css)) !== null) {
      const [, name, value] = match
      const camelName = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      vars[camelName as keyof ThemeVariables] = value.trim()
    }
    return Object.keys(vars).length > 0 ? vars : null
  }

  function handleImportWithCustomTemplate(): boolean {
    setImportError(null)
    const trimmed = importText.trim()
    if (!trimmed) {
      setImportError('Please paste CSS variables')
      return false
    }

    const rootMatch = trimmed.match(/:root\s*\{([^}]+)\}/s)
    const darkMatch = trimmed.match(/\.dark\s*\{([^}]+)\}/s)

    if (!rootMatch && !darkMatch) {
      setImportError('No :root or .dark CSS block found')
      return false
    }

    if (rootMatch) {
      const lightVars = parseCssVariables(rootMatch[1])
      if (lightVars) {
        const merged = { ...defaultPreset.light, ...lightVars }
        setLightValues(extractMinimal(merged))
        if (lightVars.fontSans) setFont(lightVars.fontSans)
        if (lightVars.radius) {
          const match = lightVars.radius.match(/^([\d.]+)rem$/)
          if (match) setRadius(parseFloat(match[1]))
        }
      }
    }

    if (darkMatch) {
      const darkVars = parseCssVariables(darkMatch[1])
      if (darkVars) {
        const merged = { ...defaultPreset.dark, ...darkVars }
        setDarkValues(extractMinimal(merged))
      }
    }

    setAppliedTemplate('custom')
    setImportText('')
    setImportError(null)
    return true
  }

  async function handleSave(): Promise<void> {
    setIsSaving(true)
    setSaveSuccess(false)

    try {
      const themeConfig = getCurrentThemeConfig()
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
  }

  const currentFontId = FONT_OPTIONS.find((f) => f.value === font)?.id || 'inter'

  const cssExport = useMemo(() => {
    function toKebab(str: string): string {
      return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
    }

    function formatVars(vars: Record<string, unknown>): string {
      return Object.entries(vars)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `  --${toKebab(k)}: ${v};`)
        .join('\n')
    }

    return `:root {\n${formatVars(effectiveLight)}\n}\n\n.dark {\n${formatVars(effectiveDark)}\n}`
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
      <link rel="stylesheet" href={ALL_FONTS_URL} />

      <div className="rounded-xl border border-border bg-card">
        <div className="grid grid-cols-1 xl:grid-cols-[1fr,400px]">
          <div className="xl:border-r border-border flex flex-col min-w-0">
            <div className="p-5 border-b border-border">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-medium">Template</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Start with a preset and customize
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs gap-1.5">
                      <ArrowUpTrayIcon className="h-3.5 w-3.5" />
                      Export
                      <ChevronDownIcon className="h-3 w-3 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleCopyExport}>
                      <DocumentDuplicateIcon className="h-4 w-4" />
                      {exportCopied ? 'Copied!' : 'Copy CSS'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownload}>
                      <ArrowDownTrayIcon className="h-4 w-4" />
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

            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-1 p-0.5 bg-muted rounded-lg">
                <button
                  onClick={() => setEditMode('light')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                    editMode === 'light'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <SunIcon className="h-3.5 w-3.5" />
                  Light
                </button>
                <button
                  onClick={() => setEditMode('dark')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                    editMode === 'dark'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <MoonIcon className="h-3.5 w-3.5" />
                  Dark
                </button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetAllColors}
                className="h-8 text-xs gap-1.5"
              >
                <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {ESSENTIAL_COLOR_GROUPS.map((group) => (
                <div key={group.name}>
                  <div className="mb-3">
                    <h4 className="text-sm font-medium">{group.name}</h4>
                    <p className="text-xs text-muted-foreground">{group.description}</p>
                  </div>
                  <div className="grid gap-2">
                    {group.variables.map(({ key, label }) => (
                      <ColorInput
                        key={key}
                        label={label}
                        value={getHexValue(key)}
                        onChange={(hex) => handleColorChange(key, hex)}
                        onReset={() => resetVariable(key)}
                        isCustomized={isCustomized(key)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <div className="mb-3">
                  <h4 className="text-sm font-medium">Typography</h4>
                  <p className="text-xs text-muted-foreground">Font and border radius</p>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Font Family
                    </Label>
                    <Select
                      value={currentFontId}
                      onValueChange={(id) => {
                        const selectedFont = FONT_OPTIONS.find((f) => f.id === id)
                        if (selectedFont) setFont(selectedFont.value)
                      }}
                    >
                      <SelectTrigger className="w-full h-10">
                        <SelectValue>
                          <span style={{ fontFamily: font }}>
                            {FONT_OPTIONS.find((f) => f.id === currentFontId)?.name ||
                              'Select font'}
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        <FontSelectGroup category="Sans Serif" />
                        <FontSelectGroup category="Serif" />
                        <FontSelectGroup category="Monospace" />
                        <FontSelectGroup category="System" />
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">
                      Border Radius
                    </Label>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-10">Sharp</span>
                      <Slider
                        value={[radius * 100]}
                        onValueChange={([v]) => setRadius(v / 100)}
                        min={0}
                        max={100}
                        step={5}
                        className="flex-1"
                      />
                      <span className="text-xs text-muted-foreground w-10 text-right">Round</span>
                      <div
                        className="h-8 w-10 bg-primary shrink-0"
                        style={{ borderRadius: `${radius}rem` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                  <ChevronRightIcon
                    className={cn('h-4 w-4 transition-transform', showAdvanced && 'rotate-90')}
                  />
                  <SwatchIcon className="h-4 w-4" />
                  Advanced options
                </button>

                {showAdvanced && (
                  <div className="mt-4">
                    <Label className="text-xs mb-2 block">Derived Colors (auto-generated)</Label>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[
                        { label: 'Primary FG', value: effectiveLight.primaryForeground },
                        { label: 'Card FG', value: effectiveLight.cardForeground },
                        { label: 'Popover', value: effectiveLight.popover },
                        { label: 'Secondary', value: effectiveLight.secondary },
                        { label: 'Accent', value: effectiveLight.accent },
                      ].map(({ label, value }) => (
                        <div key={label} className="text-center">
                          <div
                            className="h-6 w-full rounded border border-border mb-1"
                            style={{ backgroundColor: value ? oklchToHex(value) : '#000' }}
                          />
                          <span className="text-[10px] text-muted-foreground">{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-border mt-auto">
              <Button onClick={handleSave} disabled={isSaving} className="w-full h-10">
                <SaveButtonContent isSaving={isSaving} saveSuccess={saveSuccess} />
              </Button>
            </div>
          </div>

          <div className="border-t xl:border-t-0 border-border xl:sticky xl:top-4 xl:self-start p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium">Preview</span>
              <span className="text-xs text-muted-foreground">
                {editMode === 'light' ? 'Light mode' : 'Dark mode'}
              </span>
            </div>
            <ThemePreview
              lightVars={effectiveLight}
              darkVars={effectiveDark}
              previewMode={editMode}
              radius={`${radius}rem`}
              fontFamily={font}
              logoUrl={effectiveLogoUrl}
              workspaceName={workspaceName}
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

interface ColorInputProps {
  label: string
  value: string
  onChange: (hex: string) => void
  onReset?: () => void
  isCustomized?: boolean
}

function ColorInput({
  label,
  value,
  onChange,
  onReset,
  isCustomized,
}: ColorInputProps): React.ReactElement {
  const [inputValue, setInputValue] = useState(value)

  useEffect(() => {
    setInputValue(value)
  }, [value])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const hex = e.target.value
    setInputValue(hex)
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      onChange(hex)
    }
  }

  function handleInputBlur(): void {
    if (!/^#[0-9A-Fa-f]{6}$/.test(inputValue)) {
      setInputValue(value)
    }
  }

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg border border-border bg-background hover:border-border/80 transition-colors group">
      <label className="relative cursor-pointer">
        <div
          className="h-9 w-9 rounded-md border border-border shadow-sm transition-transform hover:scale-105"
          style={{ backgroundColor: value }}
        />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>

      <span className="flex-1 text-sm font-medium">{label}</span>

      <input
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        className="w-20 px-2 py-1 text-xs font-mono bg-muted rounded border-0 focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="#000000"
      />

      {isCustomized && onReset && (
        <button
          onClick={onReset}
          className="p-1.5 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          title="Reset to template"
        >
          <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function SaveButtonContent({
  isSaving,
  saveSuccess,
}: {
  isSaving: boolean
  saveSuccess: boolean
}): React.ReactElement {
  if (isSaving) {
    return (
      <>
        <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
        Saving...
      </>
    )
  }
  if (saveSuccess) {
    return (
      <>
        <CheckIcon className="mr-2 h-4 w-4" />
        Saved!
      </>
    )
  }
  return <>Save Theme</>
}

type FontCategory = (typeof FONT_OPTIONS)[number]['category']

function FontSelectGroup({ category }: { category: FontCategory }): React.ReactElement {
  const fonts = FONT_OPTIONS.filter((f) => f.category === category)
  return (
    <SelectGroup>
      <SelectLabel>{category}</SelectLabel>
      {fonts.map((f) => (
        <SelectItem key={f.id} value={f.id}>
          <span className="text-base" style={{ fontFamily: f.value }}>
            {f.name}
          </span>
        </SelectItem>
      ))}
    </SelectGroup>
  )
}

interface TemplateCardProps {
  preset: {
    name: string
    description: string
    color: string
    light: ThemeVariables
    dark: ThemeVariables
  }
  isSelected?: boolean
  onClick: () => void
}

function TemplateCard({ preset, isSelected, onClick }: TemplateCardProps): React.ReactElement {
  function getHex(oklch: string | undefined, fallback: string): string {
    if (!oklch) return fallback
    try {
      return oklchToHex(oklch)
    } catch {
      return fallback
    }
  }

  const colors = [
    getHex(preset.light.background, '#ffffff'),
    getHex(preset.light.primary, preset.color),
    getHex(preset.light.muted, '#f5f5f5'),
    getHex(preset.light.foreground, '#171717'),
  ]

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all',
        isSelected
          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
          : 'border-border bg-background hover:bg-muted/50 hover:border-border/80'
      )}
    >
      <div className="flex rounded-md overflow-hidden border border-border/50 shadow-sm">
        {colors.map((color, i) => (
          <div key={i} className="w-3.5 h-6" style={{ backgroundColor: color }} />
        ))}
      </div>
      <span className="text-sm font-medium">{preset.name}</span>
    </button>
  )
}

interface ImportDialogProps {
  importText: string
  setImportText: (text: string) => void
  importError: string | null
  setImportError: (error: string | null) => void
  onImport: () => boolean
  cssExport: string
}

function ImportDialog({
  importText,
  setImportText,
  importError,
  setImportError,
  onImport,
  cssExport,
}: ImportDialogProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)

  function handleImport(): void {
    const success = onImport()
    if (success) setIsOpen(false)
  }

  function handleDownloadTemplate(): void {
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
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          <ArrowDownTrayIcon className="h-3.5 w-3.5" />
          <span className="text-sm">Import</span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Theme</DialogTitle>
          <DialogDescription>
            Paste CSS variables to import a theme.{' '}
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="text-primary hover:underline"
            >
              Download a template
            </button>{' '}
            to get started.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder={`:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.623 0.188 260);
  /* ... */
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  /* ... */
}`}
          value={importText}
          onChange={(e) => {
            setImportText(e.target.value)
            setImportError(null)
          }}
          className="h-[300px] resize-none font-mono text-xs"
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
