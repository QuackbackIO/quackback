import { useState, useEffect, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { settingsQueries } from '@/lib/client/queries/settings'
import {
  SunIcon,
  MoonIcon,
  CheckIcon,
  ArrowPathIcon,
  CameraIcon,
  PaintBrushIcon,
  CodeBracketIcon,
} from '@heroicons/react/24/solid'
import type { BrandingMode } from '@/lib/server/domains/settings/settings.types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { ImageCropper } from '@/components/ui/image-cropper'
import CodeMirror from '@uiw/react-codemirror'
import { css } from '@codemirror/lang-css'
import { color } from '@uiw/codemirror-extensions-color'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { cn } from '@/lib/shared/utils'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import {
  BrandingLayout,
  BrandingControlsPanel,
  BrandingPreviewPanel,
} from '@/components/admin/settings/branding/branding-layout'
import { ThemePreview } from '@/components/admin/settings/branding/theme-preview'
import {
  useBrandingState,
  ALL_FONTS_URL,
  FONT_OPTIONS,
} from '@/components/admin/settings/branding/use-branding-state'
import type { ThemeConfig } from '@/lib/shared/theme'
import { useWorkspaceLogo } from '@/lib/client/hooks/use-settings-queries'
import { useUploadWorkspaceLogo, useDeleteWorkspaceLogo } from '@/lib/client/mutations/settings'
import { updateWorkspaceNameFn } from '@/lib/server/functions/settings'

// ==============================================
// Theme Presets (from tweakcn.com)
// ==============================================
const THEME_PRESETS = [
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    colors: { primary: '#8839ef', background: '#eff1f5' },
    css: `:root {
  --background: #eff1f5;
  --foreground: #4c4f69;
  --card: #ffffff;
  --card-foreground: #4c4f69;
  --popover: #ccd0da;
  --popover-foreground: #4c4f69;
  --primary: #8839ef;
  --primary-foreground: #ffffff;
  --secondary: #ccd0da;
  --secondary-foreground: #4c4f69;
  --muted: #dce0e8;
  --muted-foreground: #6c6f85;
  --accent: #04a5e5;
  --accent-foreground: #ffffff;
  --destructive: #d20f39;
  --destructive-foreground: #ffffff;
  --border: #bcc0cc;
  --input: #ccd0da;
  --ring: #8839ef;
  --radius: 0.35rem;
  --chart-1: #8839ef;
  --chart-2: #04a5e5;
  --chart-3: #40a02b;
  --chart-4: #fe640b;
  --chart-5: #dc8a78;
}
.dark {
  --background: #181825;
  --foreground: #cdd6f4;
  --card: #1e1e2e;
  --card-foreground: #cdd6f4;
  --popover: #45475a;
  --popover-foreground: #cdd6f4;
  --primary: #cba6f7;
  --primary-foreground: #1e1e2e;
  --secondary: #585b70;
  --secondary-foreground: #cdd6f4;
  --muted: #292c3c;
  --muted-foreground: #a6adc8;
  --accent: #89dceb;
  --accent-foreground: #1e1e2e;
  --destructive: #f38ba8;
  --destructive-foreground: #1e1e2e;
  --border: #313244;
  --input: #313244;
  --ring: #cba6f7;
  --radius: 0.35rem;
  --chart-1: #cba6f7;
  --chart-2: #89dceb;
  --chart-3: #a6e3a1;
  --chart-4: #fab387;
  --chart-5: #f5e0dc;
}`,
  },
  {
    id: 'supabase',
    name: 'Supabase',
    colors: { primary: '#72e3ad', background: '#fcfcfc' },
    css: `:root {
  --background: #fcfcfc;
  --foreground: #171717;
  --card: #fcfcfc;
  --card-foreground: #171717;
  --popover: #fcfcfc;
  --popover-foreground: #525252;
  --primary: #72e3ad;
  --primary-foreground: #1e2723;
  --secondary: #fdfdfd;
  --secondary-foreground: #171717;
  --muted: #ededed;
  --muted-foreground: #202020;
  --accent: #ededed;
  --accent-foreground: #202020;
  --destructive: #ca3214;
  --destructive-foreground: #fffcfc;
  --border: #dfdfdf;
  --input: #f6f6f6;
  --ring: #72e3ad;
  --radius: 0.5rem;
  --chart-1: #72e3ad;
  --chart-2: #3b82f6;
  --chart-3: #8b5cf6;
  --chart-4: #f59e0b;
  --chart-5: #10b981;
}
.dark {
  --background: #121212;
  --foreground: #e2e8f0;
  --card: #171717;
  --card-foreground: #e2e8f0;
  --popover: #242424;
  --popover-foreground: #a9a9a9;
  --primary: #006239;
  --primary-foreground: #dde8e3;
  --secondary: #242424;
  --secondary-foreground: #fafafa;
  --muted: #1f1f1f;
  --muted-foreground: #a2a2a2;
  --accent: #313131;
  --accent-foreground: #fafafa;
  --destructive: #541c15;
  --destructive-foreground: #ede9e8;
  --border: #292929;
  --input: #242424;
  --ring: #4ade80;
  --radius: 0.5rem;
  --chart-1: #4ade80;
  --chart-2: #60a5fa;
  --chart-3: #a78bfa;
  --chart-4: #fbbf24;
  --chart-5: #2dd4bf;
}`,
  },
  {
    id: 'neo-brutalism',
    name: 'Neo Brutalism',
    colors: { primary: '#ff3333', background: '#ffffff' },
    css: `:root {
  --background: #ffffff;
  --foreground: #000000;
  --card: #ffffff;
  --card-foreground: #000000;
  --popover: #ffffff;
  --popover-foreground: #000000;
  --primary: #ff3333;
  --primary-foreground: #ffffff;
  --secondary: #ffff00;
  --secondary-foreground: #000000;
  --muted: #f0f0f0;
  --muted-foreground: #333333;
  --accent: #0066ff;
  --accent-foreground: #ffffff;
  --destructive: #000000;
  --destructive-foreground: #ffffff;
  --border: #000000;
  --input: #000000;
  --ring: #ff3333;
  --radius: 0px;
  --chart-1: #ff3333;
  --chart-2: #ffff00;
  --chart-3: #0066ff;
  --chart-4: #00cc00;
  --chart-5: #cc00cc;
}
.dark {
  --background: #000000;
  --foreground: #ffffff;
  --card: #333333;
  --card-foreground: #ffffff;
  --popover: #333333;
  --popover-foreground: #ffffff;
  --primary: #ff6666;
  --primary-foreground: #000000;
  --secondary: #ffff33;
  --secondary-foreground: #000000;
  --muted: #1a1a1a;
  --muted-foreground: #cccccc;
  --accent: #3399ff;
  --accent-foreground: #000000;
  --destructive: #ffffff;
  --destructive-foreground: #000000;
  --border: #ffffff;
  --input: #ffffff;
  --ring: #ff6666;
  --radius: 0px;
  --chart-1: #ff6666;
  --chart-2: #ffff33;
  --chart-3: #3399ff;
  --chart-4: #33cc33;
  --chart-5: #cc33cc;
}`,
  },
] as const

// ==============================================
// Custom CodeMirror theme using admin portal CSS variables
// ==============================================
const adminEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
  },
  '.cm-content': {
    caretColor: 'var(--foreground)',
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: '0.75rem',
    lineHeight: '1.625',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--foreground)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 20%, transparent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: 'none',
    color: 'var(--muted-foreground)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) - 2px)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-foreground)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 30%, transparent)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 15%, transparent)',
  },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)',
    outline: 'none',
  },
  '.cm-placeholder': {
    color: 'var(--muted-foreground)',
  },
})

const adminHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--primary)' },
    { tag: tags.propertyName, color: 'var(--chart-1, var(--primary))' },
    { tag: [tags.string, tags.inserted], color: 'var(--chart-5, var(--primary))' },
    { tag: [tags.number, tags.color], color: 'var(--chart-4, var(--primary))' },
    { tag: [tags.className, tags.tagName], color: 'var(--chart-2, var(--primary))' },
    { tag: tags.punctuation, color: 'var(--muted-foreground)' },
    { tag: tags.separator, color: 'var(--muted-foreground)' },
    { tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
    { tag: tags.invalid, color: 'var(--destructive)' },
  ])
)

const adminEditorExtensions = [css(), color, adminEditorTheme, adminHighlightStyle]

export const Route = createFileRoute('/admin/settings/branding')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.branding()),
      context.queryClient.ensureQueryData(settingsQueries.logo()),
      context.queryClient.ensureQueryData(settingsQueries.customCss()),
    ])
  },
  component: BrandingPage,
})

function BrandingPage() {
  const { settings } = Route.useRouteContext()
  const { data: brandingConfig = {} } = useSuspenseQuery(settingsQueries.branding())
  const { data: logoData } = useSuspenseQuery(settingsQueries.logo())
  const { data: customCss = '' } = useSuspenseQuery(settingsQueries.customCss())

  const initialLogoUrl = logoData?.url ?? null

  // Unified branding state
  const state = useBrandingState({
    initialLogoUrl,
    initialThemeConfig: brandingConfig as ThemeConfig,
    initialCustomCss: customCss,
    initialBrandingMode: (brandingConfig as { brandingMode?: BrandingMode }).brandingMode,
  })

  // Workspace name state
  const [workspaceName, setWorkspaceName] = useState(settings?.name || '')
  const [isSavingName, setIsSavingName] = useState(false)
  const nameTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Timer cleanup on unmount to prevent state updates after unmount
  useEffect(() => {
    return () => {
      if (nameTimeoutRef.current) clearTimeout(nameTimeoutRef.current)
    }
  }, [])

  // Debounced workspace name save
  const handleNameChange = (value: string) => {
    setWorkspaceName(value)
    if (nameTimeoutRef.current) {
      clearTimeout(nameTimeoutRef.current)
    }
    nameTimeoutRef.current = setTimeout(async () => {
      if (value.trim() && value !== settings?.name) {
        setIsSavingName(true)
        try {
          await updateWorkspaceNameFn({ data: { name: value.trim() } })
        } catch {
          toast.error('Failed to update workspace name')
        } finally {
          setIsSavingName(false)
        }
      }
    }, 800)
  }

  return (
    <>
      <link rel="stylesheet" href={ALL_FONTS_URL} />

      <div className="space-y-6">
        <div className="lg:hidden">
          <BackLink to="/admin/settings">Settings</BackLink>
        </div>
        <PageHeader
          icon={PaintBrushIcon}
          title="Branding"
          description="Customize your portal's appearance and branding"
        />

        {/* Two-Column Layout */}
        <BrandingLayout>
          <BrandingControlsPanel>
            {/* Identity Section - always visible */}
            <div className="p-5 space-y-4">
              <div>
                <h3 className="text-sm font-medium text-foreground">Identity</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  How your brand appears in the portal header
                </p>
              </div>

              <div className="flex items-start gap-4">
                <LogoUploader workspaceName={workspaceName} onLogoChange={state.setLogoUrl} />
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="workspace-name" className="text-xs text-muted-foreground">
                    Workspace Name
                  </Label>
                  <div className="relative">
                    <Input
                      id="workspace-name"
                      value={workspaceName}
                      onChange={(e) => handleNameChange(e.target.value)}
                      placeholder="My Workspace"
                    />
                    {isSavingName && (
                      <ArrowPathIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Theme Mode Section - always visible */}
            <div className="p-5 space-y-4 border-t border-border">
              <div>
                <h3 className="text-sm font-medium text-foreground">Theme Mode</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Control how light/dark mode works for portal visitors
                </p>
              </div>

              <Select value={state.themeMode} onValueChange={state.setThemeMode}>
                <SelectTrigger className="w-full h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User choice (allow toggle)</SelectItem>
                  <SelectItem value="light">Light only</SelectItem>
                  <SelectItem value="dark">Dark only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Color Scheme Section */}
            <div className="p-5 space-y-4 border-t border-border">
              <div>
                <h3 className="text-sm font-medium text-foreground">Color Scheme</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Customize your portal's color palette and typography
                </p>
              </div>

              {/* Mode Selector - Segmented Control */}
              <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
                <button
                  onClick={() => state.setBrandingMode('simple')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
                    state.brandingMode === 'simple'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <PaintBrushIcon className="h-4 w-4" />
                  Simple
                </button>
                <button
                  onClick={() => state.setBrandingMode('advanced')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all',
                    state.brandingMode === 'advanced'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <CodeBracketIcon className="h-4 w-4" />
                  Advanced
                </button>
              </div>
            </div>

            {state.brandingMode === 'simple' ? (
              <>
                {/* Colors */}
                <div className="p-5 space-y-4 border-t border-border">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Primary</Label>
                      <ColorInputInline
                        value={state.primaryColor}
                        onChange={state.setPrimaryColor}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Secondary</Label>
                      <ColorInputInline
                        value={state.secondaryColor}
                        onChange={state.setSecondaryColor}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Accent</Label>
                      <ColorInputInline value={state.accentColor} onChange={state.setAccentColor} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Background</Label>
                      <ColorInputInline
                        value={state.backgroundColor}
                        onChange={state.setBackgroundColor}
                      />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <Label className="text-xs text-muted-foreground">Foreground (Text)</Label>
                      <ColorInputInline
                        value={state.foregroundColor}
                        onChange={state.setForegroundColor}
                      />
                    </div>
                  </div>
                </div>

                {/* Typography */}
                <div className="p-5 space-y-4 border-t border-border">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Typography</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Font and corner styling</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Font</Label>
                      <Select
                        value={state.currentFontId}
                        onValueChange={(id) => {
                          const selectedFont = FONT_OPTIONS.find((f) => f.id === id)
                          if (selectedFont) state.setFont(selectedFont.value)
                        }}
                      >
                        <SelectTrigger className="w-full h-10">
                          <SelectValue>
                            <span style={{ fontFamily: state.font }}>
                              {FONT_OPTIONS.find((f) => f.id === state.currentFontId)?.name ||
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
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Corner Roundness</Label>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-12">Sharp</span>
                      <Slider
                        value={[state.radius * 100]}
                        onValueChange={([v]) => state.setRadius(v / 100)}
                        min={0}
                        max={100}
                        step={5}
                        className="flex-1"
                      />
                      <span className="text-xs text-muted-foreground w-12 text-right">Round</span>
                      <div
                        className="h-6 w-6 bg-primary shrink-0"
                        style={{ borderRadius: `${state.radius}rem` }}
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Advanced Mode: Presets */}
                <div className="p-5 space-y-3 border-t border-border">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Theme Presets</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Start from a preset or design your own at{' '}
                      <a
                        href="https://tweakcn.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        tweakcn.com
                      </a>
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {THEME_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => state.setCustomCss(preset.css)}
                        className="flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-lg border border-border bg-background text-center text-xs font-medium text-foreground hover:border-primary/50 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex gap-1 shrink-0">
                          <div
                            className="h-4 w-4 rounded-full border border-border/50"
                            style={{ backgroundColor: preset.colors.primary }}
                          />
                          <div
                            className="h-4 w-4 rounded-full border border-border/50"
                            style={{ backgroundColor: preset.colors.background }}
                          />
                        </div>
                        <span className="truncate">{preset.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Advanced Mode: CSS Editor */}
                <div className="p-5 space-y-4 border-t border-border">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Custom CSS</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Edit below or paste CSS with{' '}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">:root {'{ }'}</code>{' '}
                      and{' '}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">.dark {'{ }'}</code>{' '}
                      blocks
                    </p>
                  </div>

                  <CodeMirror
                    value={state.customCss}
                    onChange={state.setCustomCss}
                    height="160px"
                    theme="none"
                    extensions={adminEditorExtensions}
                    placeholder={`:root {
  --primary: oklch(0.623 0.214 259);
  --background: oklch(1 0 0);
}
.dark {
  --primary: oklch(0.623 0.214 259);
  --background: oklch(0.145 0 0);
}`}
                    basicSetup={{
                      lineNumbers: false,
                      foldGutter: false,
                      highlightActiveLine: false,
                      bracketMatching: true,
                      closeBrackets: true,
                      autocompletion: true,
                      tabSize: 2,
                    }}
                    className={cn(
                      'overflow-hidden rounded-md border border-input',
                      '[&_.cm-editor]:!outline-none',
                      '[&_.cm-editor.cm-focused]:ring-1 [&_.cm-editor.cm-focused]:ring-ring',
                      '[&_.cm-scroller]:overflow-auto'
                    )}
                  />
                </div>
              </>
            )}

            {/* Save Button */}
            <div className="p-5 border-t border-border">
              <Button onClick={state.saveTheme} disabled={state.isSaving} className="w-full h-10">
                {state.isSaving ? (
                  <>
                    <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : state.saveSuccess ? (
                  <>
                    <CheckIcon className="mr-2 h-4 w-4" />
                    Saved!
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </BrandingControlsPanel>

          <BrandingPreviewPanel
            label="Preview"
            headerRight={
              <div className="flex items-center gap-1 p-0.5 bg-muted rounded-md">
                <button
                  onClick={() => state.setPreviewMode('light')}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all',
                    state.previewMode === 'light'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <SunIcon className="h-3 w-3" />
                  Light
                </button>
                <button
                  onClick={() => state.setPreviewMode('dark')}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all',
                    state.previewMode === 'dark'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <MoonIcon className="h-3 w-3" />
                  Dark
                </button>
              </div>
            }
          >
            <ThemePreview
              lightVars={state.effectiveLight}
              darkVars={state.effectiveDark}
              previewMode={state.previewMode}
              radius={state.brandingMode === 'simple' ? `${state.radius}rem` : undefined}
              fontFamily={state.brandingMode === 'simple' ? state.font : undefined}
              logoUrl={state.logoUrl}
              workspaceName={workspaceName || 'My Workspace'}
              customCssVariables={
                state.brandingMode === 'advanced' ? state.parsedCssVariables : undefined
              }
            />
          </BrandingPreviewPanel>
        </BrandingLayout>
      </div>
    </>
  )
}

// ==============================================
// Inline Logo Uploader
// ==============================================
interface LogoUploaderProps {
  workspaceName: string
  onLogoChange?: (url: string | null) => void
}

function LogoUploader({ workspaceName, onLogoChange }: LogoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showCropper, setShowCropper] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)

  const { data: logoData } = useWorkspaceLogo()
  const uploadMutation = useUploadWorkspaceLogo()
  const deleteMutation = useDeleteWorkspaceLogo()

  const logoUrl = logoData?.url ?? null
  const hasCustomLogo = !!logoUrl

  // Sync logo changes to parent
  useEffect(() => {
    onLogoChange?.(logoUrl)
  }, [logoUrl, onLogoChange])

  const handleLogoClick = () => fileInputRef.current?.click()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Allowed: JPEG, PNG, GIF, WebP')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 5MB')
      return
    }

    const imageUrl = URL.createObjectURL(file)
    setCropImageSrc(imageUrl)
    setShowCropper(true)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleCropComplete = async (croppedBlob: Blob) => {
    if (cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(null)
    }
    uploadMutation.mutate(croppedBlob, {
      onSuccess: () => {
        toast.success('Logo updated')
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Failed to upload logo')
      },
    })
  }

  const handleCropperClose = (open: boolean) => {
    if (!open && cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(null)
    }
    setShowCropper(open)
  }

  const handleDeleteLogo = () => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success('Logo removed')
        onLogoChange?.(null)
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Failed to remove logo')
      },
    })
  }

  const isUploading = uploadMutation.isPending
  const isDeleting = deleteMutation.isPending

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Logo Preview */}
      <button
        type="button"
        onClick={handleLogoClick}
        disabled={isUploading}
        className="relative group cursor-pointer"
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={workspaceName}
            className="h-16 w-16 rounded-xl object-cover border border-border transition-opacity group-hover:opacity-80"
          />
        ) : (
          <div className="h-16 w-16 rounded-xl bg-primary flex items-center justify-center text-primary-foreground text-xl font-semibold border border-border transition-opacity group-hover:opacity-80">
            {workspaceName.charAt(0).toUpperCase() || 'W'}
          </div>
        )}
        {isUploading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl">
            <ArrowPathIcon className="h-5 w-5 animate-spin text-white" />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
            <CameraIcon className="h-5 w-5 text-white" />
          </div>
        )}
      </button>

      {/* Remove button */}
      {hasCustomLogo && (
        <button
          type="button"
          onClick={handleDeleteLogo}
          disabled={isDeleting}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors"
        >
          {isDeleting ? 'Removing...' : 'Remove'}
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={handleFileChange}
        className="hidden"
      />

      {cropImageSrc && (
        <ImageCropper
          imageSrc={cropImageSrc}
          open={showCropper}
          onOpenChange={handleCropperClose}
          onCropComplete={handleCropComplete}
          aspectRatio={1}
          maxOutputSize={512}
          title="Crop your logo"
        />
      )}
    </div>
  )
}

// ==============================================
// Color Input Inline (with color picker + hex)
// ==============================================
interface ColorInputInlineProps {
  value: string
  onChange: (hex: string) => void
}

function ColorInputInline({ value, onChange }: ColorInputInlineProps) {
  const [inputValue, setInputValue] = useState(value)

  useEffect(() => {
    setInputValue(value)
  }, [value])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value
    setInputValue(hex)
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      onChange(hex)
    }
  }

  const handleInputBlur = () => {
    if (!/^#[0-9A-Fa-f]{6}$/.test(inputValue)) {
      setInputValue(value)
    }
  }

  return (
    <div className="flex items-center gap-2 h-10">
      <label className="relative cursor-pointer shrink-0">
        <div
          className="h-10 w-10 rounded-lg border border-border shadow-sm"
          style={{ backgroundColor: value }}
        />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>
      <Input
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        className="font-mono text-sm flex-1"
        placeholder="#000000"
      />
    </div>
  )
}

// ==============================================
// Font Select Group
// ==============================================
type FontCategory = (typeof FONT_OPTIONS)[number]['category']

function FontSelectGroup({ category }: { category: FontCategory }) {
  const fonts = FONT_OPTIONS.filter((f) => f.category === category)
  return (
    <SelectGroup>
      <SelectLabel>{category}</SelectLabel>
      {fonts.map((f) => (
        <SelectItem key={f.id} value={f.id}>
          <span style={{ fontFamily: f.value }}>{f.name}</span>
        </SelectItem>
      ))}
    </SelectGroup>
  )
}
