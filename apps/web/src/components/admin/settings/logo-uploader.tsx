import { useEffect, useRef, useState } from 'react'
import { ArrowPathIcon, CameraIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { ImageCropper } from '@/components/ui/image-cropper'
import { useSettingsLogo } from '@/lib/client/hooks/use-settings-queries'
import { useUploadWorkspaceLogo, useDeleteWorkspaceLogo } from '@/lib/client/mutations/settings'

const RASTER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

interface LogoUploaderProps {
  workspaceName: string
  onLogoChange?: (url: string | null) => void
}

export function LogoUploader({ workspaceName, onLogoChange }: LogoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showCropper, setShowCropper] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)

  const { data: logoData } = useSettingsLogo()
  const uploadMutation = useUploadWorkspaceLogo()
  const deleteMutation = useDeleteWorkspaceLogo()

  const logoUrl = logoData?.url ?? null
  const hasCustomLogo = !!logoUrl

  useEffect(() => {
    onLogoChange?.(logoUrl)
  }, [logoUrl, onLogoChange])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!RASTER_IMAGE_TYPES.includes(file.type)) {
      toast.error('Invalid file type. Allowed: JPEG, PNG, GIF, WebP')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 5MB')
      return
    }

    setCropImageSrc(URL.createObjectURL(file))
    setShowCropper(true)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleCropComplete = async (croppedBlob: Blob) => {
    if (cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(null)
    }
    uploadMutation.mutate(croppedBlob, {
      onSuccess: () => toast.success('Logo updated'),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : 'Failed to upload logo'),
    })
  }

  const handleCropperClose = (open: boolean) => {
    if (!open && cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(null)
    }
    setShowCropper(open)
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploadMutation.isPending}
        className="relative group cursor-pointer"
        aria-label="Change workspace logo"
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={workspaceName}
            className="h-14 w-14 rounded-xl object-cover border border-border transition-opacity group-hover:opacity-80"
          />
        ) : (
          <div className="h-14 w-14 rounded-xl bg-primary flex items-center justify-center text-primary-foreground text-xl font-semibold border border-border transition-opacity group-hover:opacity-80">
            {workspaceName.charAt(0).toUpperCase() || 'W'}
          </div>
        )}
        {uploadMutation.isPending ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
            <ArrowPathIcon className="h-5 w-5 animate-spin text-white" />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <CameraIcon className="h-5 w-5 text-white" />
          </div>
        )}
      </button>
      {hasCustomLogo && (
        <button
          type="button"
          onClick={() =>
            deleteMutation.mutate(undefined, {
              onSuccess: () => {
                toast.success('Logo removed')
                onLogoChange?.(null)
              },
              onError: (error) =>
                toast.error(error instanceof Error ? error.message : 'Failed to remove logo'),
            })
          }
          disabled={deleteMutation.isPending}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors"
        >
          {deleteMutation.isPending ? 'Removing…' : 'Remove'}
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
