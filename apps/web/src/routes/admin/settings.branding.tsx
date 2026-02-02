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
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/shared/utils'
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
        {/* Page Header */}
        <div>
          <h1 className="text-xl font-semibold text-foreground">Branding</h1>
          <p className="text-sm text-muted-foreground">
            Customize your portal's appearance and branding
          </p>
        </div>

        {/* Two-Column Layout */}
        <BrandingLayout>
          <BrandingControlsPanel>
            {/* Mode Selector - Segmented Control */}
            <div className="p-5">
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
                {/* Identity Section */}
                <div className="p-5 space-y-4 border-t border-border">
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

                {/* Theme Mode Section */}
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

                {/* Colors Section */}
                <div className="p-5 space-y-4 border-t border-border">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Colors</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Customize your portal's color palette
                    </p>
                  </div>

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

                {/* Typography Section */}
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
                {/* Advanced Mode: Instructions */}
                <div className="p-5 space-y-4 border-t border-border">
                  <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                    <p className="text-sm text-foreground font-medium">Custom CSS Mode</p>
                    <p className="text-xs text-muted-foreground">
                      Design your theme at{' '}
                      <a
                        href="https://tweakcn.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        tweakcn.com
                      </a>{' '}
                      then paste the CSS below. Your CSS should include{' '}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">:root {'{ }'}</code>{' '}
                      and{' '}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">.dark {'{ }'}</code>{' '}
                      blocks.
                    </p>
                  </div>
                </div>

                {/* Advanced Mode: Theme Mode (shared setting) */}
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

                {/* Advanced Mode: CSS Editor */}
                <div className="p-5 space-y-4 border-t border-border">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Custom CSS</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Paste your theme CSS from tweakcn or write your own
                    </p>
                  </div>

                  <Textarea
                    value={state.customCss}
                    onChange={(e) => state.setCustomCss(e.target.value)}
                    placeholder={`:root {
  --primary: oklch(0.623 0.214 259);
  --background: oklch(1 0 0);
}
.dark {
  --primary: oklch(0.623 0.214 259);
  --background: oklch(0.145 0 0);
}`}
                    className="font-mono text-xs min-h-[300px] resize-y"
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
          className="h-10 w-10 rounded-lg border border-border shadow-sm transition-transform hover:scale-105"
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
