'use client'

import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ImageCropper } from '@/components/ui/image-cropper'
import {
  useOrganizationLogo,
  useUploadOrganizationLogo,
  useDeleteOrganizationLogo,
} from '@/lib/hooks/use-organization-queries'

interface LogoUploaderProps {
  organizationId: string
  organizationName: string
  /** Initial logo URL from server (for SSR) */
  initialLogoUrl?: string | null
}

export function LogoUploader({
  organizationId,
  organizationName,
  initialLogoUrl,
}: LogoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showCropper, setShowCropper] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)

  // TanStack Query hooks
  const { data: logoData } = useOrganizationLogo(organizationId)
  const uploadMutation = useUploadOrganizationLogo(organizationId)
  const deleteMutation = useDeleteOrganizationLogo(organizationId)

  // Use query data if available, fall back to initial prop
  const logoUrl = logoData?.logoUrl ?? initialLogoUrl
  const hasCustomLogo = logoData?.hasCustomLogo ?? !!initialLogoUrl

  const handleLogoClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Allowed: JPEG, PNG, GIF, WebP')
      return
    }

    // Validate file size (5MB)
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
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'Failed to remove logo')
      },
    })
  }

  const isUploading = uploadMutation.isPending
  const isDeleting = deleteMutation.isPending

  return (
    <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
      <h2 className="font-medium mb-1">Logo</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Your organization logo displayed in the portal header
      </p>

      <div className="flex items-center gap-4">
        {/* Logo Preview */}
        <div className="relative">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={organizationName}
              className="h-16 w-16 rounded-lg object-cover border border-border/50"
            />
          ) : (
            <div className="h-16 w-16 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-xl font-semibold border border-border/50">
              {organizationName.charAt(0).toUpperCase()}
            </div>
          )}
          {isUploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={handleLogoClick} disabled={isUploading}>
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Uploading...
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 mr-2" />
                {hasCustomLogo ? 'Change logo' : 'Upload logo'}
              </>
            )}
          </Button>
          {hasCustomLogo && (
            <Button
              type="button"
              variant="outline"
              onClick={handleDeleteLogo}
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

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Image Cropper Modal */}
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
