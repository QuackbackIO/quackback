import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  draftIcon,
  readLogo,
  setLogoColours,
} from '@/components/admin/settings/appearance/logo-extras'
import { setIcon, setLogoInk, setTitle, showFullLogo } from '@/lib/shared/design/logo'
import type { Update } from '@/components/admin/settings/appearance/section-controls'
import {
  getFaviconUploadUrlFn,
  getShareImageUploadUrlFn,
  getWordmarkUploadUrlFn,
} from '@/lib/server/functions/uploads'
import { designAssetUrl } from '@/lib/shared/design/design-view'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { BrandKitColours } from './brand-kit-colours'
import { BrandKitFonts } from './brand-kit-fonts'
import { BrandMatchRow } from './brand-match-row'
import { KitImageTile } from './kit-image-tile'
import { PropertyRow, PropertySection } from './properties/properties-panel'
import { THEME, WORDS, resetToValue } from './properties/words'

type Asset = { key: string } | null

const IMAGES = 'image/svg+xml,image/png,image/jpeg,image/webp'
const presignWith =
  (fn: typeof getFaviconUploadUrlFn) =>
  async (file: File): Promise<{ uploadUrl: string; key: string }> =>
    fn({ data: { filename: file.name, contentType: file.type, fileSize: file.size } })
const presignLogo = presignWith(getWordmarkUploadUrlFn)

const url = (asset: Asset | undefined) => (asset ? designAssetUrl(asset.key) : null)

/**
 * The brand kit: what the customer brings: Match your brand first, the icon
 * and title, then the colours and fonts as variables. Everything here goes into the draft; the
 * admin and emails keep the workspace logo unless a publish says otherwise,
 * which the icon says on hover.
 */
export function BrandKit({
  design,
  update,
  logoUrl,
}: {
  design: PortalDesign
  update: Update
  /** The workspace's logo, shown until the portal has its own. */
  logoUrl: string | null
}) {
  const { logo } = design.brand
  const own = logo.mark.light
  return (
    <>
      <PropertySection title={THEME.sections.brandKit}>
        <BrandMatchRow design={design} update={update} />
        <PropertyRow
          label={THEME.icon}
          set={!!own}
          source={THEME.draftNote}
          resetLabel={resetToValue(THEME.workspaceLogo.toLowerCase())}
          onReset={() => update((draft) => setIcon(draft, null, null))}
        >
          <KitImageTile
            label={THEME.icon}
            url={url(own)}
            // Until the portal has its own icon, the workspace's shows.
            fallbackUrl={logoUrl}
            fallbackCaption={THEME.workspaceLogo}
            accept={IMAGES}
            presign={presignLogo}
            backdrop={design.brand.light.background}
            onUploaded={(key, file) => void draftIcon(update, key, file)}
          />
        </PropertyRow>
        <PropertyRow label={THEME.title} htmlFor="design-logo-name">
          <Input
            id="design-logo-name"
            value={logo.name ?? ''}
            maxLength={60}
            placeholder={THEME.titlePlaceholder}
            onChange={(event) => update((draft) => setTitle(draft, event.target.value))}
            className="h-7 min-w-0 flex-1 px-1.5 text-xs"
          />
        </PropertyRow>
      </PropertySection>

      <BrandKitColours design={design} update={update} logoUrl={url(own) ?? logoUrl} />

      <BrandKitFonts design={design} update={update} />
    </>
  )
}

/**
 * The brand's other images, open in Theme: the favicon and the image a
 * shared link shows, each saying what shows while there is none, and a full
 * logo in place of the icon and title. Each is drafted like the icon.
 */
export function BrandKitImages({
  update,
  design,
  logoUrl = null,
}: {
  design: PortalDesign
  update: Update
  /** The workspace's logo, which a portal without its own favicon shows. */
  logoUrl?: string | null
}) {
  const { favicon, shareImage, logo } = design.brand
  const full = logo.display === 'wordmark'
  const wordmark = logo.wordmark.light
  return (
    <PropertySection title={THEME.sections.siteImages}>
      <PropertyRow
        label={THEME.favicon}
        set={!!favicon}
        resetLabel={resetToValue(THEME.workspaceLogo.toLowerCase())}
        onReset={() => update((draft) => void (draft.brand.favicon = null))}
      >
        <KitImageTile
          label={THEME.favicon}
          url={url(favicon)}
          fallbackUrl={logoUrl}
          fallbackCaption={THEME.workspaceLogo}
          accept="image/png,image/svg+xml,image/x-icon,image/webp"
          presign={presignWith(getFaviconUploadUrlFn)}
          onUploaded={(key) => update((draft) => void (draft.brand.favicon = { key }))}
        />
      </PropertyRow>
      <PropertyRow
        label={THEME.shareImage}
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
      <PropertyRow label={THEME.fullLogo} htmlFor="design-full-logo">
        <Switch
          id="design-full-logo"
          aria-label={THEME.fullLogoSwitch}
          checked={full}
          onCheckedChange={(next) => update((draft) => showFullLogo(draft, next))}
        />
      </PropertyRow>
      {full && (
        <PropertyRow
          label={THEME.image}
          set={!!wordmark}
          resetLabel={`${WORDS.reset}: ${THEME.fullLogoEmpty.toLowerCase()}`}
          onReset={() => update((draft) => void (draft.brand.logo.wordmark.light = null))}
        >
          <KitImageTile
            wide
            label={THEME.fullLogo}
            url={url(wordmark)}
            fallbackCaption={THEME.fullLogoEmpty}
            accept={IMAGES}
            presign={presignLogo}
            backdrop={design.brand.light.background}
            onUploaded={(key, upload) =>
              void readLogo(upload).then(({ ink, colours }) =>
                update((draft) => {
                  draft.brand.logo.wordmark.light = { key }
                  setLogoInk(draft.brand.logo, ink)
                  setLogoColours(draft, colours)
                })
              )
            }
          />
        </PropertyRow>
      )}
    </PropertySection>
  )
}
