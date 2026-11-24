import { useEffect, useRef, useState } from 'react'
import { TrashIcon } from '@heroicons/react/20/solid'
import { Button } from '@/components/ui/button'
import { ImageCropper } from '@/components/ui/image-cropper'
import { cn } from '@/lib/shared/utils'
import { nameInitial } from '@/lib/shared/utils/initial'
import { WIDE_LOGO_CLASS } from '@/lib/shared/portal-wide-logo'
import type { PortalIcon } from '@/lib/shared/schemas/portal-customise'
import { getHeaderLogoUploadUrlFn, getIconUploadUrlsFn } from '@/lib/server/functions/uploads'
import { putStorageUpload } from '@/lib/client/storage-upload'
import { downscaleSquareImage } from '@/lib/client/downscale-square-image'
import { errorText } from '@/lib/client/error-text'
import { measureLogoInk } from '@/lib/shared/theme/logo-ink-count'
import { logoShowsOn } from '@/lib/shared/theme/logo-ink'
import { iconUrl, wideLogoUrl, type LogoDraft } from './portal-draft'

const LOGO_TYPES = ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg']
const ICON_TYPES = ['image/png', 'image/webp', 'image/jpeg', 'image/gif']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** The favicon made from the icon, in px. */
const FAVICON_SIZE = 64

interface LogoTilesProps {
  workspaceName: string
  logo: LogoDraft
  /** Whether this person may change the icon (it is in emails and the browser tab too). */
  canChangeIcon: boolean
  onLogoUploaded: (key: string) => void
  /** A dark mode version just uploaded, and its removal. */
  onDarkUploaded: (key: string) => void
  onRemoveDark: () => void
  /** The header's colour where the portal is dark, or null for a portal never drawn dark. */
  darkSurface?: string | null
  onIconUploaded: (icon: PortalIcon) => void
  onShowLogo: () => void
  onShowIconAndName: () => void
  onRemoveLogo: () => void
}

/**
 * Whether the logo at `src` would be hard to see on `surface`: its pixels are
 * counted here as Import counts a site's (the share of the logo drawn in inks
 * that stand off the surface). False until it is known, and when the picture
 * cannot be read: a warning is only ever shown for what was measured.
 */
function useHardToSee(src: string | null, surface: string | null): boolean {
  const [hard, setHard] = useState(false)
  useEffect(() => {
    setHard(false)
    if (!src || !surface) return
    let current = true
    void measureLogoInk(src, 0, 0)
      .then((inks) => {
        if (current) setHard(logoShowsOn(inks ?? undefined, surface) === false)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [src, surface])
  return hard
}

/**
 * The brand's artwork, named as brand guidelines name it: the logo (the full
 * logo, a wordmark or the mark and name together, usually wide) and the icon
 * (the mark alone, in a square, for small places). Then which of the two the
 * header shows. Uploads wait in the draft for Publish; the icon brings the
 * favicon made from it.
 */
export function LogoTiles({
  workspaceName,
  logo,
  canChangeIcon,
  onLogoUploaded,
  onDarkUploaded,
  onRemoveDark,
  darkSurface = null,
  onIconUploaded,
  onShowLogo,
  onShowIconAndName,
  onRemoveLogo,
}: LogoTilesProps) {
  const logoInput = useRef<HTMLInputElement>(null)
  const darkInput = useRef<HTMLInputElement>(null)
  const iconInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<'logo' | 'dark' | 'icon' | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [cropSrc, setCropSrc] = useState<string | null>(null)

  const showsLogo = logo.mode === 'custom_logo' && logo.wideKey !== null
  const logoSrc = logo.wideKey ? wideLogoUrl(logo.wideKey) : null
  const iconSrc = logo.icon ? iconUrl(logo.icon.key) : null
  const darkSrc = logo.darkKey ? wideLogoUrl(logo.darkKey) : null
  // Only while there is no dark version: with one, the logo is not drawn on the dark header.
  const hardToSee = useHardToSee(darkSrc ? null : logoSrc, darkSurface)

  async function uploadLogo(file: File, slot: 'logo' | 'dark' = 'logo') {
    setRefusal(null)
    if (!LOGO_TYPES.includes(file.type)) {
      setRefusal('Choose an SVG, PNG or WebP file.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setRefusal('Choose a file under 5 MB.')
      return
    }
    setUploading(slot)
    try {
      // The dark mode version is a logo upload like any other: the same checks, the same place.
      const { uploadUrl, key } = await getHeaderLogoUploadUrlFn({
        data: { filename: file.name || 'logo', contentType: file.type, fileSize: file.size },
      })
      await putStorageUpload(uploadUrl, file, "Couldn't upload the logo. Try again.")
      if (slot === 'dark') onDarkUploaded(key)
      else onLogoUploaded(key)
    } catch (error) {
      setRefusal(errorText(error, "Couldn't upload the logo. Try again."))
    } finally {
      setUploading(null)
    }
  }

  function pickIcon(file: File) {
    setRefusal(null)
    if (!ICON_TYPES.includes(file.type)) {
      setRefusal('Choose a PNG, WebP or JPEG file for the icon.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setRefusal('Choose a file under 5 MB.')
      return
    }
    setCropSrc(URL.createObjectURL(file))
  }

  function closeCropper() {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc(null)
  }

  async function uploadIcon(icon: Blob) {
    setUploading('icon')
    try {
      const favicon = await downscaleSquareImage(icon, FAVICON_SIZE)
      const urls = await getIconUploadUrlsFn({
        data: {
          icon: {
            filename: 'icon.png',
            contentType: icon.type || 'image/png',
            fileSize: icon.size,
          },
          favicon: { filename: 'favicon.png', contentType: 'image/png', fileSize: favicon.size },
        },
      })
      await putStorageUpload(urls.icon.uploadUrl, icon, "Couldn't upload the icon. Try again.")
      await putStorageUpload(
        urls.favicon.uploadUrl,
        favicon,
        "Couldn't upload the icon. Try again."
      )
      onIconUploaded({ key: urls.icon.key, faviconKey: urls.favicon.key })
    } catch (error) {
      setRefusal(errorText(error, "Couldn't upload the icon. Try again."))
    } finally {
      setUploading(null)
    }
  }

  const iconMark = iconSrc ? (
    <img src={iconSrc} alt="" className="size-6 shrink-0 rounded-md object-cover" />
  ) : (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
      {nameInitial(workspaceName)}
    </span>
  )

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Artwork label="Logo" hint="Your full logo">
          <ArtworkFrame>
            {logoSrc ? (
              <img src={logoSrc} alt="" className={cn(WIDE_LOGO_CLASS, 'h-6 max-w-full')} />
            ) : (
              <span className="text-xs text-muted-foreground">None yet</span>
            )}
          </ArtworkFrame>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading === 'logo'}
              onClick={() => logoInput.current?.click()}
            >
              {uploading === 'logo' ? 'Uploading…' : logo.wideKey ? 'Replace' : 'Upload logo'}
            </Button>
            {logo.wideKey ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove logo"
                onClick={onRemoveLogo}
              >
                <TrashIcon className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </Artwork>

        <Artwork label="Icon" hint="Square, for small places">
          <ArtworkFrame>{iconMark}</ArtworkFrame>
          {canChangeIcon ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading === 'icon'}
                onClick={() => iconInput.current?.click()}
              >
                {uploading === 'icon' ? 'Uploading…' : logo.icon ? 'Replace' : 'Upload icon'}
              </Button>
            </div>
          ) : (
            <p className="text-[11px] leading-tight text-muted-foreground">
              Only an owner can change the icon.
            </p>
          )}
        </Artwork>
      </div>

      {logo.wideKey ? (
        <div role="group" aria-label="Dark mode version" className="space-y-1.5">
          <span className="text-[13px] font-medium">
            Dark mode version <span className="font-normal text-muted-foreground">Optional</span>
          </span>
          {darkSrc ? (
            <div
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2"
              style={{ backgroundColor: darkSurface ?? '#18181b' }}
            >
              <img src={darkSrc} alt="" className={cn(WIDE_LOGO_CLASS, 'h-6 max-w-[60%]')} />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="ms-auto h-7"
                onClick={onRemoveDark}
              >
                Remove
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1">Uses the logo above until you add one</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0"
                disabled={uploading === 'dark'}
                onClick={() => darkInput.current?.click()}
              >
                {uploading === 'dark' ? 'Uploading…' : 'Upload'}
              </Button>
            </div>
          )}
          {hardToSee ? (
            <p role="status" className="text-xs text-warning">
              Your logo is hard to see in dark mode. Add a dark mode version.
            </p>
          ) : null}
        </div>
      ) : null}

      <div role="group" aria-label="In the header" className="space-y-1.5">
        <span className="text-[13px] font-medium">In the header</span>
        <div className="grid grid-cols-2 gap-2">
          <Tile
            title="Logo"
            pressed={showsLogo}
            onClick={() => (logo.wideKey ? onShowLogo() : logoInput.current?.click())}
          >
            {logoSrc ? (
              <img src={logoSrc} alt="" className={cn(WIDE_LOGO_CLASS, 'h-5 max-w-full')} />
            ) : (
              <span className="text-xs text-muted-foreground">Your logo</span>
            )}
          </Tile>
          <Tile title="Icon and name" pressed={!showsLogo} onClick={onShowIconAndName}>
            {iconMark}
            <span className="truncate text-xs font-semibold">{workspaceName}</span>
          </Tile>
        </div>
      </div>

      {refusal ? (
        <p role="alert" className="text-xs text-destructive">
          {refusal}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">Both go live when you publish.</p>

      <input
        ref={logoInput}
        type="file"
        accept={LOGO_TYPES.join(',')}
        aria-label="Logo file"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void uploadLogo(file)
        }}
      />
      <input
        ref={darkInput}
        type="file"
        accept={LOGO_TYPES.join(',')}
        aria-label="Dark mode version file"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void uploadLogo(file, 'dark')
        }}
      />
      {canChangeIcon ? (
        <input
          ref={iconInput}
          type="file"
          accept={ICON_TYPES.join(',')}
          aria-label="Icon file"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) pickIcon(file)
          }}
        />
      ) : null}
      {cropSrc ? (
        <ImageCropper
          imageSrc={cropSrc}
          open
          onOpenChange={(open) => {
            if (!open) closeCropper()
          }}
          onCropComplete={(blob) => {
            closeCropper()
            void uploadIcon(blob)
          }}
          aspectRatio={1}
          maxOutputSize={512}
          title="Crop your icon"
        />
      ) : null}
    </div>
  )
}

/** One piece of artwork: its name, what it is for, and what it looks like. */
function Artwork({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      <span className="-mt-1 text-[11px] leading-tight text-muted-foreground">{hint}</span>
      {children}
    </div>
  )
}

function ArtworkFrame({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-10 min-w-0 items-center justify-center rounded-md border border-border bg-muted/40 px-2">
      {children}
    </span>
  )
}

function Tile({
  title,
  pressed,
  onClick,
  children,
}: {
  title: string
  pressed: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        pressed ? 'border-foreground ring-1 ring-foreground' : 'border-border hover:bg-muted/40'
      )}
    >
      <span className="flex h-8 min-w-0 items-center gap-1.5 rounded-md bg-muted/50 px-2">
        {children}
      </span>
      <span className="text-xs font-medium">{title}</span>
    </button>
  )
}
