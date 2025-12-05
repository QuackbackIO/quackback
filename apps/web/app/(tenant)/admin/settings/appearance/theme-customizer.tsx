'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Check, Loader2, RotateCcw } from 'lucide-react'
import {
  theme,
  type ThemeConfig,
  type ThemeVariables,
  type CoreThemeVariable,
} from '@quackback/shared'

interface ThemeCustomizerProps {
  organizationId: string
  initialThemeConfig: ThemeConfig
}

/** Core variables exposed in advanced mode with labels */
const coreVariableLabels: Record<CoreThemeVariable, string> = {
  primary: 'Primary',
  primaryForeground: 'Primary Text',
  background: 'Background',
  foreground: 'Text',
  card: 'Card Background',
  cardForeground: 'Card Text',
  border: 'Border',
  muted: 'Muted Background',
  mutedForeground: 'Muted Text',
  accent: 'Accent',
  ring: 'Focus Ring',
}

/** Get preset list for UI */
const presetList = theme.presetNames.map((id) => ({
  id,
  ...theme.themePresets[id],
}))

export function ThemeCustomizer({ organizationId, initialThemeConfig }: ThemeCustomizerProps) {
  // Preset selection
  const [selectedPreset, setSelectedPreset] = useState(initialThemeConfig.preset || 'indigo')

  // Advanced mode toggle
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(initialThemeConfig.light || initialThemeConfig.dark)
  )

  // Custom overrides (only used in advanced mode)
  const [lightOverrides, setLightOverrides] = useState<Partial<ThemeVariables>>(
    initialThemeConfig.light || {}
  )
  const [darkOverrides, setDarkOverrides] = useState<Partial<ThemeVariables>>(
    initialThemeConfig.dark || {}
  )

  // Save state
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Get current preset data
  const currentPreset = theme.themePresets[selectedPreset] || theme.themePresets.indigo

  // Compute effective colors for preview (preset + overrides)
  const effectiveLight = useMemo(() => {
    if (!showAdvanced) return currentPreset.light
    return { ...currentPreset.light, ...lightOverrides }
  }, [currentPreset, lightOverrides, showAdvanced])

  const effectiveDark = useMemo(() => {
    if (!showAdvanced) return currentPreset.dark
    return { ...currentPreset.dark, ...darkOverrides }
  }, [currentPreset, darkOverrides, showAdvanced])

  // Handle color change for a variable
  function handleColorChange(
    mode: 'light' | 'dark',
    variable: CoreThemeVariable,
    hexColor: string
  ) {
    const oklchColor = theme.hexToOklch(hexColor)
    if (mode === 'light') {
      setLightOverrides((prev) => ({ ...prev, [variable]: oklchColor }))
    } else {
      setDarkOverrides((prev) => ({ ...prev, [variable]: oklchColor }))
    }
  }

  // Get hex value for color picker (convert from OKLCH)
  function getHexValue(mode: 'light' | 'dark', variable: CoreThemeVariable): string {
    const vars = mode === 'light' ? effectiveLight : effectiveDark
    const oklch = vars[variable]
    if (!oklch) return '#000000'
    try {
      return theme.oklchToHex(oklch)
    } catch {
      return '#000000'
    }
  }

  // Reset a variable to preset default
  function resetVariable(mode: 'light' | 'dark', variable: CoreThemeVariable) {
    if (mode === 'light') {
      setLightOverrides((prev) => {
        const next = { ...prev }
        delete next[variable]
        return next
      })
    } else {
      setDarkOverrides((prev) => {
        const next = { ...prev }
        delete next[variable]
        return next
      })
    }
  }

  // Check if a variable has been customized
  function isCustomized(mode: 'light' | 'dark', variable: CoreThemeVariable): boolean {
    const overrides = mode === 'light' ? lightOverrides : darkOverrides
    return variable in overrides
  }

  // Reset all customizations
  function resetAllCustomizations() {
    setLightOverrides({})
    setDarkOverrides({})
  }

  async function handleSave() {
    setIsSaving(true)
    setSaveSuccess(false)

    try {
      const themeConfig: ThemeConfig = {
        preset: selectedPreset,
      }

      // Only include overrides if in advanced mode and there are customizations
      if (showAdvanced) {
        if (Object.keys(lightOverrides).length > 0) {
          themeConfig.light = lightOverrides
        }
        if (Object.keys(darkOverrides).length > 0) {
          themeConfig.dark = darkOverrides
        }
      }

      const response = await fetch('/api/organization/theme', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          themeConfig,
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

  return (
    <div className="space-y-6">
      {/* Theme Presets */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Theme</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Choose a color scheme for your public portal
        </p>

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {presetList.map((preset) => {
            const isSelected = selectedPreset === preset.id
            return (
              <button
                key={preset.id}
                onClick={() => setSelectedPreset(preset.id)}
                className={`group relative flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border/50 hover:border-border hover:bg-muted/30'
                }`}
              >
                <div
                  className="h-8 w-8 rounded-full shadow-sm ring-2 ring-white dark:ring-zinc-900"
                  style={{ backgroundColor: preset.color }}
                />
                <span className="text-xs font-medium">{preset.name}</span>
                {isSelected && (
                  <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Advanced Mode Toggle */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Custom Colors</h2>
            <p className="text-sm text-muted-foreground">
              Fine-tune individual colors beyond the preset
            </p>
          </div>
          <Switch checked={showAdvanced} onCheckedChange={setShowAdvanced} />
        </div>

        {showAdvanced && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Customize colors for light and dark modes
              </p>
              {(Object.keys(lightOverrides).length > 0 ||
                Object.keys(darkOverrides).length > 0) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetAllCustomizations}
                  className="text-muted-foreground"
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  Reset all
                </Button>
              )}
            </div>

            <Tabs defaultValue="light" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="light">Light Mode</TabsTrigger>
                <TabsTrigger value="dark">Dark Mode</TabsTrigger>
              </TabsList>

              <TabsContent value="light" className="mt-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {theme.CORE_THEME_VARIABLES.map((variable) => (
                    <ColorPicker
                      key={variable}
                      label={coreVariableLabels[variable]}
                      value={getHexValue('light', variable)}
                      onChange={(hex) => handleColorChange('light', variable, hex)}
                      onReset={() => resetVariable('light', variable)}
                      isCustomized={isCustomized('light', variable)}
                    />
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="dark" className="mt-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {theme.CORE_THEME_VARIABLES.map((variable) => (
                    <ColorPicker
                      key={variable}
                      label={coreVariableLabels[variable]}
                      value={getHexValue('dark', variable)}
                      onChange={(hex) => handleColorChange('dark', variable, hex)}
                      onReset={() => resetVariable('dark', variable)}
                      isCustomized={isCustomized('dark', variable)}
                    />
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {/* Preview */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Preview</h2>
        <p className="text-sm text-muted-foreground mb-4">
          See how your portal will look with the selected theme
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Light mode preview */}
          <div
            className="rounded-lg border p-4"
            style={
              {
                backgroundColor: theme.oklchToHex(effectiveLight.background || ''),
                borderColor: theme.oklchToHex(effectiveLight.border || ''),
                color: theme.oklchToHex(effectiveLight.foreground || ''),
              } as React.CSSProperties
            }
          >
            <div className="text-xs text-muted-foreground mb-2">Light Mode</div>
            <div
              className="rounded-md border p-3 mb-3"
              style={{
                backgroundColor: theme.oklchToHex(effectiveLight.card || ''),
                borderColor: theme.oklchToHex(effectiveLight.border || ''),
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="h-6 w-6 rounded"
                  style={{
                    backgroundColor: theme.oklchToHex(effectiveLight.primary || ''),
                  }}
                />
                <span className="text-sm font-medium">Demo Workspace</span>
              </div>
              <div
                className="text-xs mb-2"
                style={{ color: theme.oklchToHex(effectiveLight.mutedForeground || '') }}
              >
                Sample muted text
              </div>
              <button
                className="px-3 py-1.5 rounded text-xs font-medium"
                style={{
                  backgroundColor: theme.oklchToHex(effectiveLight.primary || ''),
                  color: theme.oklchToHex(effectiveLight.primaryForeground || ''),
                }}
              >
                Submit Feedback
              </button>
            </div>
          </div>

          {/* Dark mode preview */}
          <div
            className="rounded-lg border p-4"
            style={
              {
                backgroundColor: theme.oklchToHex(effectiveDark.background || ''),
                borderColor: theme.oklchToHex(effectiveDark.border || ''),
                color: theme.oklchToHex(effectiveDark.foreground || ''),
              } as React.CSSProperties
            }
          >
            <div
              className="text-xs mb-2"
              style={{ color: theme.oklchToHex(effectiveDark.mutedForeground || '') }}
            >
              Dark Mode
            </div>
            <div
              className="rounded-md border p-3 mb-3"
              style={{
                backgroundColor: theme.oklchToHex(effectiveDark.card || ''),
                borderColor: theme.oklchToHex(effectiveDark.border || ''),
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="h-6 w-6 rounded"
                  style={{
                    backgroundColor: theme.oklchToHex(effectiveDark.primary || ''),
                  }}
                />
                <span className="text-sm font-medium">Demo Workspace</span>
              </div>
              <div
                className="text-xs mb-2"
                style={{ color: theme.oklchToHex(effectiveDark.mutedForeground || '') }}
              >
                Sample muted text
              </div>
              <button
                className="px-3 py-1.5 rounded text-xs font-medium"
                style={{
                  backgroundColor: theme.oklchToHex(effectiveDark.primary || ''),
                  color: theme.oklchToHex(effectiveDark.primaryForeground || ''),
                }}
              >
                Submit Feedback
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving}>
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
            'Save changes'
          )}
        </Button>
      </div>
    </div>
  )
}

/** Color picker component with reset button */
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
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-background p-3">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <Label className="flex-1 text-sm">{label}</Label>
      {isCustomized && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}
