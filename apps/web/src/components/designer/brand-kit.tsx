import { ChevronRightIcon } from '@heroicons/react/16/solid'
import { cn } from '@/lib/shared/utils'
import type { Update } from '@/components/admin/settings/appearance/design-update'
import { getFaviconUploadUrlFn, getShareImageUploadUrlFn } from '@/lib/server/functions/uploads'
import { designAssetUrl } from '@/lib/shared/design/design-view'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { BrandKitColours } from './brand-kit-colours'
import { BrandKitFonts } from './brand-kit-fonts'
import { BrandMatchRow } from './brand-match-row'
import { FIND } from './find-rows'
import { KitImageTile } from './kit-image-tile'
import { LinkPreview } from './link-preview'
import { FullLogoRows, LogoIconRow, LogoTitleRow } from './logo-rows'
import { PropertyRow, PropertySection, ROW_INDENT } from './properties/properties-panel'
import { THEME, resetToValue } from './properties/words'

type Asset = { key: string } | null

const presignWith =
  (fn: typeof getFaviconUploadUrlFn) =>
  async (file: File): Promise<{ uploadUrl: string; key: string }> =>
    fn({ data: { filename: file.name, contentType: file.type, fileSize: file.size } })

const url = (asset: Asset | undefined) => (asset ? designAssetUrl(asset.key) : null)

/**
 * The brand kit: what the customer brings: Match your brand first, the icon
 * and title (the logo's source; its size and placement are the logo's own,
 * picked in the header), then the colours and fonts as variables. Everything
 * here goes into the draft; the admin and emails keep the workspace logo
 * unless a publish says otherwise, which the icon says on hover.
 */
export function BrandKit({
  design,
  update,
  logoUrl,
  onLogo,
}: {
  design: PortalDesign
  update: Update
  /** The workspace's logo, shown until the portal has its own. */
  logoUrl: string | null
  /** Picks the logo on the page, where its size and placement are set. */
  onLogo?: () => void
}) {
  return (
    <>
      <PropertySection title={THEME.sections.brandKit}>
        <BrandMatchRow design={design} update={update} />
        <LogoIconRow design={design} update={update} logoUrl={logoUrl} />
        <LogoTitleRow design={design} update={update} />
        <FullLogoRows design={design} update={update} />
        {onLogo && (
          <button
            type="button"
            onClick={onLogo}
            className={cn(
              'flex min-h-7 w-full items-center gap-1 rounded-md text-start text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none',
              ROW_INDENT
            )}
          >
            {THEME.sizeAndPlacement}
            <ChevronRightIcon className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </PropertySection>

      <BrandKitColours design={design} update={update} />

      <BrandKitFonts design={design} update={update} />
    </>
  )
}

/**
 * The brand's other images, open in Theme: the favicon and the image a
 * shared link shows, each saying what shows while there is none: the
 * favicon falls back to the icon, then the workspace logo; the share image
 * is a card drawn from the brand. Under them, a link to the portal as it
 * shows when shared. Each image is drafted like the icon.
 */
export function BrandKitImages({
  update,
  design,
  logoUrl = null,
}: {
  design: PortalDesign
  update: Update
  /** The workspace's logo, which a portal without its own favicon or icon shows. */
  logoUrl?: string | null
}) {
  const { favicon, shareImage } = design.brand
  const { mark } = design.brand.logo
  const iconUrl = url(mark.light ?? mark.dark)
  const faviconFallback = iconUrl
    ? { url: iconUrl, caption: THEME.fromIcon }
    : logoUrl
      ? { url: logoUrl, caption: THEME.workspaceLogo }
      : null
  return (
    <PropertySection title={THEME.sections.siteImages}>
      <PropertyRow
        label={FIND.favicon.label}
        find={FIND.favicon.id}
        set={!!favicon}
        resetLabel={
          faviconFallback ? resetToValue(faviconFallback.caption.toLowerCase()) : undefined
        }
        onReset={() => update((draft) => void (draft.brand.favicon = null))}
      >
        <KitImageTile
          label={THEME.favicon}
          url={url(favicon)}
          fallbackUrl={faviconFallback?.url ?? null}
          fallbackCaption={faviconFallback?.caption}
          accept="image/png,image/svg+xml,image/x-icon,image/webp"
          presign={presignWith(getFaviconUploadUrlFn)}
          onUploaded={(key) => update((draft) => void (draft.brand.favicon = { key }))}
        />
      </PropertyRow>
      <PropertyRow
        label={FIND.shareImage.label}
        find={FIND.shareImage.id}
        set={!!shareImage}
        resetLabel={resetToValue(THEME.automatic.toLowerCase())}
        onReset={() => update((draft) => void (draft.brand.shareImage = null))}
      >
        <KitImageTile
          wide
          label={THEME.shareImage}
          url={url(shareImage)}
          fallbackCaption={THEME.automatic}
          accept="image/png,image/jpeg,image/webp"
          presign={presignWith(getShareImageUploadUrlFn)}
          onUploaded={(key) => update((draft) => void (draft.brand.shareImage = { key }))}
        />
      </PropertyRow>
      <PropertyRow label={THEME.linkPreview}>
        <LinkPreview design={design} className="min-w-0 flex-1" />
      </PropertyRow>
    </PropertySection>
  )
}
