import { useState, useEffect, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { settingsQueries } from '@/lib/client/queries/settings'
import { SunIcon, MoonIcon, CheckIcon, ArrowPathIcon, CameraIcon } from '@heroicons/react/24/solid'
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
    ])
  },
  component: BrandingPage,
})

function BrandingPage() {
  const { settings } = Route.useRouteContext()
  const { data: brandingConfig = {} } = useSuspenseQuery(settingsQueries.branding())
  const { data: logoData } = useSuspenseQuery(settingsQueries.logo())

  const initialLogoUrl = logoData?.url ?? null

  // Unified branding state
  const state = useBrandingState({
    initialLogoUrl,
    initialThemeConfig: brandingConfig as ThemeConfig,
  })

  // Workspace name state
  const [workspaceName, setWorkspaceName] = useState(settings?.name || '')
  const [isSavingName, setIsSavingName] = useState(false)
  const nameTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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
            {/* Identity Section */}
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

            {/* Appearance Section */}
            <div className="p-5 space-y-4 border-t border-border">
              <div>
                <h3 className="text-sm font-medium text-foreground">Appearance</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Customize colors and typography
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Brand Color</Label>
                  <ColorInputInline value={state.brandColor} onChange={state.setBrandColor} />
                </div>

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
              radius={`${state.radius}rem`}
              fontFamily={state.font}
              logoUrl={state.logoUrl}
              workspaceName={workspaceName || 'My Workspace'}
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
