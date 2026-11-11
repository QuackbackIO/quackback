/**
 * The logo's rows, the one place each logo field is written: the icon, the
 * title and a full logo image in their place (the brand kit draws these; the
 * logo's panel sums them up), how tall the header draws it, and its own
 * colours (the logo's panel draws these).
 */
import { useState } from 'react'
import { EyeDropperIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  draftIcon,
  readLogo,
  setLogoColours,
} from '@/components/admin/settings/appearance/logo-extras'
import { imagePalette } from '@/lib/client/image-palette'
import { getWordmarkUploadUrlFn } from '@/lib/server/functions/uploads'
import { designAssetUrl } from '@/lib/shared/design/design-view'
import { setIcon, setLogoInk, setTitle, showFullLogo } from '@/lib/shared/design/logo'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { FIND } from './find-rows'
import { KitImageTile } from './kit-image-tile'
import { PropertyRow } from './properties/properties-panel'
import { ScrubNumber } from './properties/scrub-number'
import { THEME, WORDS, resetToValue } from './properties/words'
import { Swatch } from './swatch'

/** Changes the draft as one step, named for its undo where a name is given. */
type Update = (change: (draft: PortalDesign) => void, label?: string) => void

const IMAGES = 'image/svg+xml,image/png,image/jpeg,image/webp'
const presignLogo = async (file: File): Promise<{ uploadUrl: string; key: string }> =>
  getWordmarkUploadUrlFn({
    data: { filename: file.name, contentType: file.type, fileSize: file.size },
  })
const assetUrl = (asset: { key: string } | null | undefined) =>
  asset ? designAssetUrl(asset.key) : null

/** The header's logo height when none is set, and its bounds. */
export const LOGO_HEIGHT = { usual: 32, min: 16, max: 64 } as const

/** The icon: the portal's own once uploaded, else the workspace's. Drafted, never live. */
export function LogoIconRow({
  design,
  update,
  logoUrl,
}: {
  design: PortalDesign
  update: Update
  /** The workspace's logo, shown until the portal has its own. */
  logoUrl: string | null
}) {
  const own = design.brand.logo.mark.light
  return (
    <PropertyRow
      label={FIND.icon.label}
      find={FIND.icon.id}
      set={!!own}
      source={THEME.draftNote}
      resetLabel={resetToValue(THEME.workspaceLogo.toLowerCase())}
      onReset={() => update((draft) => setIcon(draft, null, null))}
    >
      <KitImageTile
        label={THEME.icon}
        url={assetUrl(own)}
        // Until the portal has its own icon, the workspace's shows.
        fallbackUrl={logoUrl}
        fallbackCaption={THEME.workspaceLogo}
        accept={IMAGES}
        presign={presignLogo}
        backdrop={design.brand.light.background}
        onUploaded={(key, file) => void draftIcon(update, key, file)}
      />
    </PropertyRow>
  )
}

/** The title beside the icon, in the theme's font; empty shows the workspace's name. */
export function LogoTitleRow({ design, update }: { design: PortalDesign; update: Update }) {
  return (
    <PropertyRow label={FIND.title.label} find={FIND.title.id} htmlFor="design-logo-name">
      <Input
        id="design-logo-name"
        value={design.brand.logo.name ?? ''}
        maxLength={60}
        placeholder={THEME.titlePlaceholder}
        onChange={(event) => update((draft) => setTitle(draft, event.target.value))}
        className="h-7 min-w-0 flex-1 px-1.5 text-xs"
      />
    </PropertyRow>
  )
}

/**
 * A full logo image in place of the icon and title, for a brand whose logo
 * is a wordmark, and its file once asked for. A design that already shows
 * one keeps it.
 */
export function FullLogoRows({ design, update }: { design: PortalDesign; update: Update }) {
  const { logo } = design.brand
  const full = logo.display === 'wordmark'
  const wordmark = logo.wordmark.light
  return (
    <>
      <PropertyRow label={FIND.fullLogo.label} find={FIND.fullLogo.id} htmlFor="design-full-logo">
        <Switch
          id="design-full-logo"
          aria-label={THEME.fullLogoSwitch}
          checked={full}
          onCheckedChange={(next) => update((draft) => showFullLogo(draft, next))}
        />
      </PropertyRow>
      {full && (
        <PropertyRow
          label={FIND.logoImage.label}
          find={FIND.logoImage.id}
          set={!!wordmark}
          resetLabel={`${WORDS.reset}: ${THEME.fullLogoEmpty.toLowerCase()}`}
          onReset={() => update((draft) => void (draft.brand.logo.wordmark.light = null))}
        >
          <KitImageTile
            wide
            label={THEME.fullLogo}
            url={assetUrl(wordmark)}
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
    </>
  )
}

/** How tall the header draws the logo, 16 to 64 px; the usual 32 stores nothing. */
export function LogoHeightRow({ design, update }: { design: PortalDesign; update: Update }) {
  const height = design.brand.logo.height
  const write = (next: number | undefined) =>
    update((draft) => {
      if (next === undefined || next === LOGO_HEIGHT.usual) delete draft.brand.logo.height
      else draft.brand.logo.height = next
    }, 'Logo height')
  return (
    <PropertyRow
      label={FIND.logoHeight.label}
      find={FIND.logoHeight.id}
      htmlFor="design-logo-height"
      set={height !== undefined}
      resetLabel={resetToValue(`${LOGO_HEIGHT.usual} px`)}
      onReset={() => write(undefined)}
    >
      <ScrubNumber
        id="design-logo-height"
        label={THEME.height}
        value={height}
        inherited={LOGO_HEIGHT.usual}
        min={LOGO_HEIGHT.min}
        max={LOGO_HEIGHT.max}
        unit="px"
        onChange={write}
      />
    </PropertyRow>
  )
}

/**
 * The logo's own colours, taken from the logo, for status markers drawn in
 * the brand's colours: swatches, a pick from the logo, and Clear.
 */
export function LogoColourRow({
  design,
  update,
  logoUrl,
}: {
  design: PortalDesign
  update: Update
  /** The logo image the colours are read from. */
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
    <PropertyRow
      label={FIND.logoColours.label}
      find={FIND.logoColours.id}
      source={THEME.logoColoursHelp}
    >
      {colours.length > 0 ? (
        <span
          role="img"
          className="flex gap-1 px-1.5"
          aria-label={`${THEME.logoColours}: ${colours.join(', ')}`}
        >
          {colours.map((colour) => (
            <Swatch key={colour} colour={colour} />
          ))}
        </span>
      ) : (
        <span className="px-1.5 text-xs text-muted-foreground">{WORDS.none}</span>
      )}
      <span className="ms-auto flex items-center gap-0.5">
        {logoUrl && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            disabled={busy}
            aria-label={busy ? THEME.reading : THEME.pickFromLogo}
            onClick={() => void take()}
          >
            <EyeDropperIcon className="size-3.5" aria-hidden="true" />
          </Button>
        )}
        {colours.length > 0 && (
          <button
            type="button"
            onClick={() => update((draft) => void delete draft.brand.logoColours)}
            className="rounded px-1 text-2xs text-muted-foreground hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
          >
            {THEME.clear}
          </button>
        )}
      </span>
    </PropertyRow>
  )
}

/** The logo image its colours are read from: the full logo while shown, else the icon, else the workspace's. */
export function logoImageUrl(design: PortalDesign, logoUrl: string | null): string | null {
  const { logo } = design.brand
  if (logo.display === 'wordmark' && logo.wordmark.light) return assetUrl(logo.wordmark.light)
  return assetUrl(logo.mark.light) ?? logoUrl
}
