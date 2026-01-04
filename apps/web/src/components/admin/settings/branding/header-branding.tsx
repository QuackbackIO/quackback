import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Upload, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ImageCropper } from '@/components/ui/image-cropper'
import { Input } from '@/components/ui/input'
import {
  useWorkspaceHeaderLogo,
  useUploadWorkspaceHeaderLogo,
  useUpdateHeaderDisplayMode,
  useUpdateHeaderDisplayName,
  useDeleteWorkspaceHeaderLogo,
} from '@/lib/hooks/use-settings-queries'
import { cn } from '@/lib/utils'

/** Aspect ratio for header logo (4:1 landscape) */
const HEADER_LOGO_ASPECT_RATIO = 4
/** Max width for header logo output */
const HEADER_LOGO_MAX_WIDTH = 400

type HeaderDisplayMode = 'logo_and_name' | 'logo_only' | 'custom_logo'

interface HeaderBrandingProps {
  workspaceName: string
  /** Square logo URL (for preview) */
  logoUrl?: string | null
  /** Initial header logo URL from server (for SSR) */
  initialHeaderLogoUrl?: string | null
  /** Initial display mode from server (for SSR) */
  initialDisplayMode?: HeaderDisplayMode
  /** Initial display name from server (for SSR) */
  initialDisplayName?: string | null
}

export function HeaderBranding({
  workspaceName,
  logoUrl,
  initialHeaderLogoUrl,
  initialDisplayMode = 'logo_and_name',
  initialDisplayName,
}: HeaderBrandingProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showCropper, setShowCropper] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)

  // TanStack Query hooks
  const { data: headerData } = useWorkspaceHeaderLogo()
  const uploadMutation = useUploadWorkspaceHeaderLogo()
  const updateModeMutation = useUpdateHeaderDisplayMode()
  const updateNameMutation = useUpdateHeaderDisplayName()
  const deleteMutation = useDeleteWorkspaceHeaderLogo()

  // Use query data if available, fall back to initial props
  const headerLogoUrl = headerData?.headerLogoUrl ?? initialHeaderLogoUrl
  const hasHeaderLogo = headerData?.hasCustomHeaderLogo ?? !!initialHeaderLogoUrl
  const displayName = headerData?.headerDisplayName ?? initialDisplayName

  // Local state for display mode (updates optimistically on click)
  const [localDisplayMode, setLocalDisplayMode] = useState<HeaderDisplayMode>(
    (headerData?.headerDisplayMode as HeaderDisplayMode) ?? initialDisplayMode
  )

  // Local state for display name input (for debounced updates)
  const [localDisplayName, setLocalDisplayName] = useState(displayName || '')
  const displayNameTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleModeChange = (newMode: HeaderDisplayMode) => {
    // Optimistic update
    setLocalDisplayMode(newMode)
    updateModeMutation.mutate(newMode, {
      onSuccess: () => {
        toast.success('Header branding updated')
      },
      onError: (error) => {
        // Revert on error
        setLocalDisplayMode(localDisplayMode)
        toast.error(error instanceof Error ? error.message : 'Failed to update display mode')
      },
    })
  }

  const handleDisplayNameChange = (value: string) => {
    setLocalDisplayName(value)

    // Debounce the API call
    if (displayNameTimeoutRef.current) {
      clearTimeout(displayNameTimeoutRef.current)
    }

    displayNameTimeoutRef.current = setTimeout(() => {
      updateNameMutation.mutate(value || null, {
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : 'Failed to update display name')
        },
      })
    }, 500) // 500ms debounce
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type (raster images only - SVGs don't need cropping)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Allowed: JPEG, PNG, WebP')
      return
    }

    // Validate file size (5MB for cropping)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 5MB')
      return
    }

    // Create URL for cropper
    const imageUrl = URL.createObjectURL(file)
    setCropImageSrc(imageUrl)
    setShowCropper(true)

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleCropComplete = async (croppedBlob: Blob) => {
    // Clean up original image URL
    if (cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(null)
    }

    // Convert Blob to File for the upload mutation
    const file = new File([croppedBlob], 'header-logo.png', { type: croppedBlob.type })

    uploadMutation.mutate(file, {
      onSuccess: () => {
        toast.success('Header logo updated')
        // Auto-switch to custom_logo mode when uploading
        if (localDisplayMode !== 'custom_logo') {
          handleModeChange('custom_logo')
        }
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Failed to upload header logo')
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

  const handleDeleteHeaderLogo = () => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success('Header logo removed')
        // Auto-switch back to logo_and_name since custom_logo requires a header logo
        if (localDisplayMode === 'custom_logo') {
          handleModeChange('logo_and_name')
        }
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Failed to remove header logo')
      },
    })
  }

  const isUploading = uploadMutation.isPending
  const isDeleting = deleteMutation.isPending
  const isUpdating = updateModeMutation.isPending

  // Check if square logo exists
  const hasSquareLogo = !!logoUrl

  // Effective name to display (custom display name or org name)
  const effectiveDisplayName = localDisplayName || workspaceName

  // Preview component for radio options
  const LogoPreview = ({ showName = true }: { showName?: boolean }) => (
    <div className="flex items-center gap-2">
      {logoUrl ? (
        <img src={logoUrl} alt="" className="h-6 w-6 rounded object-cover" />
      ) : (
        <div className="h-6 w-6 rounded bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold">
          {effectiveDisplayName.charAt(0).toUpperCase()}
        </div>
      )}
      {showName && <span className="text-sm font-medium">{effectiveDisplayName}</span>}
    </div>
  )

  const HeaderLogoPreview = () => (
    <div className="flex items-center">
      {headerLogoUrl ? (
        <img src={headerLogoUrl} alt="" className="h-6 max-w-[120px] object-contain" />
      ) : (
        <span className="text-xs text-muted-foreground italic">Not uploaded</span>
      )}
    </div>
  )

  // Show upload prompt when custom_logo is selected but no logo uploaded
  const needsHeaderLogoUpload = localDisplayMode === 'custom_logo' && !hasHeaderLogo

  return (
    <div className="space-y-4">
      <RadioGroup
        value={localDisplayMode}
        onValueChange={(value) => handleModeChange(value as HeaderDisplayMode)}
        disabled={isUpdating}
        className="space-y-3"
      >
        {/* Logo + Name option */}
        <div
          className={cn(
            'rounded-lg border p-3 space-y-3 transition-colors',
            localDisplayMode === 'logo_and_name' ? 'border-primary bg-primary/5' : 'border-border'
          )}
        >
          <div className="flex items-center space-x-3">
            <RadioGroupItem value="logo_and_name" id="logo_and_name" />
            <Label
              htmlFor="logo_and_name"
              className="flex-1 flex items-center justify-between cursor-pointer"
            >
              <div>
                <span className="text-sm font-medium">Logo + Name</span>
                <p className="text-xs text-muted-foreground">
                  {hasSquareLogo ? 'Uses your logo from above' : 'Shows initial letter + name'}
                </p>
              </div>
              <LogoPreview showName />
            </Label>
          </div>

          {/* Display name input - always visible but more prominent when selected */}
          <div className="ml-7 space-y-1.5 max-w-[240px]">
            <Label htmlFor="display-name" className="text-xs text-muted-foreground">
              Display name
            </Label>
            <Input
              id="display-name"
              type="text"
              value={localDisplayName}
              onChange={(e) => handleDisplayNameChange(e.target.value)}
              placeholder={workspaceName}
              className="h-8 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to use your organization name
            </p>
          </div>
        </div>

        {/* Logo Only option */}
        <div
          className={cn(
            'flex items-center space-x-3 rounded-lg border p-3 transition-colors',
            localDisplayMode === 'logo_only' ? 'border-primary bg-primary/5' : 'border-border'
          )}
        >
          <RadioGroupItem value="logo_only" id="logo_only" />
          <Label
            htmlFor="logo_only"
            className="flex-1 flex items-center justify-between cursor-pointer"
          >
            <div>
              <span className="text-sm font-medium">Logo Only</span>
              <p className="text-xs text-muted-foreground">
                {hasSquareLogo ? 'Uses your logo from above' : 'Shows initial letter only'}
              </p>
            </div>
            <LogoPreview showName={false} />
          </Label>
        </div>

        {/* Custom Header Logo option */}
        <div
          className={cn(
            'rounded-lg border p-3 space-y-3 transition-colors',
            localDisplayMode === 'custom_logo' ? 'border-primary bg-primary/5' : 'border-border'
          )}
        >
          <div className="flex items-center space-x-3">
            <RadioGroupItem value="custom_logo" id="custom_logo" />
            <Label
              htmlFor="custom_logo"
              className="flex-1 flex items-center justify-between cursor-pointer"
            >
              <div>
                <span className="text-sm font-medium">Custom Header Logo</span>
                <p className="text-xs text-muted-foreground">
                  Upload a horizontal wordmark or lockup
                </p>
              </div>
              <HeaderLogoPreview />
            </Label>
          </div>

          {/* Header logo uploader - prominent when selected and needs upload */}
          <div className="ml-7 space-y-3">
            {/* Prompt when selected but no logo uploaded */}
            {needsHeaderLogoUpload && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Upload a logo to use this option. Currently showing logo + name as fallback.
              </p>
            )}

            <div className="flex items-center gap-3">
              {headerLogoUrl && (
                <div className="relative h-10 max-w-[200px] rounded border border-border bg-muted/30 p-1">
                  <img
                    src={headerLogoUrl}
                    alt="Header logo"
                    className="h-full w-full object-contain"
                  />
                  {isUploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded">
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={needsHeaderLogoUpload ? 'default' : 'outline'}
                  size="sm"
                  onClick={handleUploadClick}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-1.5" />
                      {hasHeaderLogo ? 'Change' : 'Upload Logo'}
                    </>
                  )}
                </Button>
                {hasHeaderLogo && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteHeaderLogo}
                    disabled={isDeleting}
                    className="text-destructive hover:text-destructive"
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Horizontal logo or wordmark (4:1 ratio). Supports JPEG, PNG, WebP.
            </p>
          </div>
        </div>
      </RadioGroup>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Image Cropper Modal */}
      {cropImageSrc && (
        <ImageCropper
          imageSrc={cropImageSrc}
          open={showCropper}
          onOpenChange={handleCropperClose}
          onCropComplete={handleCropComplete}
          aspectRatio={HEADER_LOGO_ASPECT_RATIO}
          maxOutputSize={HEADER_LOGO_MAX_WIDTH}
          cropShape="rect"
          title="Crop your header logo"
        />
      )}
    </div>
  )
}
