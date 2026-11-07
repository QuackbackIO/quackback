import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { imageInk, imagePalette } from '@/lib/client/image-palette'
import { setIcon, setLogoInk, setTitle, showFullLogo } from '@/lib/shared/design/logo'
import { SettingRow } from '@/components/admin/settings/setting-row'
import { Switch } from '@/components/ui/switch'
import {
  getFaviconUploadUrlFn,
  getShareImageUploadUrlFn,
  getWordmarkUploadUrlFn,
} from '@/lib/server/functions/uploads'
import { designAssetUrl } from '@/lib/shared/design/design-view'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { ImageSlot } from './image-slot'

type Update = (change: (draft: PortalDesign) => void) => void

const presignWith = (fn: typeof getFaviconUploadUrlFn) => async (file: File) =>
  fn({ data: { filename: file.name, contentType: file.type, fileSize: file.size } })

/**
 * The portal's icon: its own once one is uploaded, else the workspace's. A new
 * one is part of the draft; the admin and emails keep the workspace's logo
 * unless a publish is asked to use this one there too.
 */
export function PortalLogoRow({
  design,
  update,
  logoUrl,
}: {
  design: PortalDesign
  update: Update
  /** The workspace's logo, which the admin and emails use. */
  logoUrl: string | null
}) {
  const own = design.brand.logo.mark.light
  return (
    <div className="space-y-1">
      <ImageSlot
        label="Icon"
        url={own ? designAssetUrl(own.key) : logoUrl}
        accept="image/svg+xml,image/png,image/jpeg,image/webp"
        presign={presignWith(getWordmarkUploadUrlFn)}
        onUploaded={(key, file) => void draftIcon(update, key, file)}
        onRemove={() => update((draft) => setIcon(draft, null, null))}
        removable={!!own}
      />
      <p className="text-xs text-muted-foreground">
        {own
          ? 'In this draft. Publishing can use it in the admin and emails too.'
          : 'Using the workspace logo. Upload one to give the portal its own.'}
      </p>
    </div>
  )
}

/** An uploaded icon into the draft, with its ink so it reads on any header. */
export async function draftIcon(update: Update, key: string, file: File) {
  const ink = await imageInk(file)
  update((draft) => setIcon(draft, { key }, ink))
}

/** The title beside the icon, in the theme's font; empty shows the workspace's name. */
export function LogoNameField({ design, update }: { design: PortalDesign; update: Update }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="design-logo-name" className="w-32 shrink-0 text-[13px]">
        Title
      </label>
      <Input
        id="design-logo-name"
        value={design.brand.logo.name ?? ''}
        maxLength={60}
        placeholder="Your workspace name"
        onChange={(event) => update((draft) => setTitle(draft, event.target.value))}
        className="h-8 text-[13px]"
      />
    </div>
  )
}

/**
 * A full logo image in place of the icon and title, for a brand whose logo
 * is a wordmark. Designs that already show one keep it.
 */
export function FullLogoChoice({ design, update }: { design: PortalDesign; update: Update }) {
  const { logo } = design.brand
  const on = logo.display === 'wordmark'
  const file = logo.wordmark.light
  return (
    <div className="space-y-2">
      <SettingRow
        label="Use a full logo image instead"
        htmlFor="design-full-logo"
        control={
          <Switch
            id="design-full-logo"
            checked={on}
            onCheckedChange={(next) => update((draft) => showFullLogo(draft, next))}
          />
        }
      />
      {on && (
        <ImageSlot
          label="Full logo"
          url={file ? designAssetUrl(file.key) : null}
          accept="image/svg+xml,image/png,image/jpeg,image/webp"
          presign={presignWith(getWordmarkUploadUrlFn)}
          onUploaded={(key, upload) =>
            void imageInk(upload).then((ink) =>
              update((draft) => {
                draft.brand.logo.wordmark.light = { key }
                setLogoInk(draft.brand.logo, ink)
              })
            )
          }
          onRemove={() => update((draft) => void (draft.brand.logo.wordmark.light = null))}
        />
      )}
      {on && !file && (
        <p className="text-xs text-muted-foreground">
          Until one is added, the header shows the icon and title.
        </p>
      )}
    </div>
  )
}

/**
 * The logo's own colours, taken from the logo, for status markers drawn in
 * the brand's colours. Status can use them once there are two or more.
 */
export function LogoColours({
  design,
  update,
  logoUrl,
}: {
  design: PortalDesign
  update: Update
  logoUrl: string | null
}) {
  const colours = design.brand.logoColours ?? []
  const [busy, setBusy] = useState(false)
  const take = async () => {
    if (!logoUrl) return
    setBusy(true)
    try {
      const blob = await (await fetch(logoUrl)).blob()
      const found = (await imagePalette(blob, 6)).map((colour) => colour.toLowerCase())
      update((draft) => {
        if (found.length) draft.brand.logoColours = found.slice(0, 6)
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-[13px]">Logo colours</span>
      {colours.length > 0 ? (
        <span role="img" className="flex gap-1" aria-label={`Logo colours: ${colours.join(', ')}`}>
          {colours.map((colour) => (
            <span
              key={colour}
              title={colour}
              className="size-5 rounded border border-border"
              style={{ background: colour }}
            />
          ))}
        </span>
      ) : (
        <span className="text-[13px] text-muted-foreground">None</span>
      )}
      <div className="ms-auto flex gap-1">
        {logoUrl && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void take()}>
            {busy ? 'Reading…' : 'Take from the logo'}
          </Button>
        )}
        {colours.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update((draft) => void delete draft.brand.logoColours)}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}

/** The design's own favicon and the image its pages are shared with. */
export function SiteIcons({ design, update }: { design: PortalDesign; update: Update }) {
  const { favicon, shareImage } = design.brand
  return (
    <div className="space-y-2">
      <ImageSlot
        label="Favicon"
        url={favicon ? designAssetUrl(favicon.key) : null}
        accept="image/png,image/svg+xml,image/x-icon,image/webp"
        presign={presignWith(getFaviconUploadUrlFn)}
        onUploaded={(key) => update((draft) => void (draft.brand.favicon = { key }))}
        onRemove={() => update((draft) => void (draft.brand.favicon = null))}
      />
      <ImageSlot
        label="Share image"
        url={shareImage ? designAssetUrl(shareImage.key) : null}
        accept="image/png,image/jpeg,image/webp"
        presign={presignWith(getShareImageUploadUrlFn)}
        onUploaded={(key) => update((draft) => void (draft.brand.shareImage = { key }))}
        onRemove={() => update((draft) => void (draft.brand.shareImage = null))}
      />
    </div>
  )
}
