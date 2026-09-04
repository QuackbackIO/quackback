/**
 * Logo control for one custom OIDC provider — the same interaction as the
 * workspace `LogoUploader` (click the tile, crop square, save; "Remove" below),
 * but scoped to an `identity_provider` row and with the inferred brand glyph as
 * the empty state instead of a letter avatar.
 */
import { useRef, useState } from 'react'
import { ArrowPathIcon, CameraIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { ImageCropper } from '@/components/ui/image-cropper'
import { IdpLogo } from '@/components/icons/idp-provider-icons'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { inferIdpKind } from '../idp-shortcuts'
import { useProviderLogo } from './use-provider-logo'

const RASTER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export function IdentityProviderLogoUploader({ provider }: { provider: IdentityProvider }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showCropper, setShowCropper] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)

  const { uploading, removing, upload, remove } = useProviderLogo(provider)
  const kind = provider.kind ?? inferIdpKind(provider.discoveryUrl)
  const logoUrl = provider.logoUrl

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
    await upload(croppedBlob)
  }

  const handleCropperClose = (open: boolean) => {
    if (!open && cropImageSrc) {
      URL.revokeObjectURL(cropImageSrc)
      setCropImageSrc(null)
    }
    setShowCropper(open)
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="relative group cursor-pointer"
        aria-label="Change provider logo"
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="h-14 w-14 rounded-xl border border-border object-cover transition-opacity group-hover:opacity-80"
          />
        ) : (
          <IdpLogo
            kind={kind}
            className="h-14 w-14 rounded-xl border border-border transition-opacity group-hover:opacity-80"
            iconClassName="h-6 w-6"
          />
        )}
        <div
          className={
            uploading
              ? 'absolute inset-0 flex items-center justify-center rounded-xl bg-black/50'
              : 'absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 opacity-0 transition-opacity group-hover:opacity-100'
          }
        >
          {uploading ? (
            <ArrowPathIcon className="h-5 w-5 animate-spin text-white" />
          ) : (
            <CameraIcon className="h-5 w-5 text-white" />
          )}
        </div>
      </button>

      <div className="space-y-1">
        <p className="text-sm">
          Shown on the &ldquo;Sign in with {provider.label.trim() || 'this provider'}&rdquo; button
          and the provider list.
        </p>
        <p className="text-xs text-muted-foreground">
          Square image, PNG or SVG-exported raster, up to 5&nbsp;MB.
          {logoUrl && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => void remove()}
                disabled={removing}
                className="text-muted-foreground underline transition-colors hover:text-destructive"
              >
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </>
          )}
        </p>
      </div>

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
          title="Crop the provider logo"
        />
      )}
    </div>
  )
}
