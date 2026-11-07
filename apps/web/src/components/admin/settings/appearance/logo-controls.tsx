import type { PortalDesign } from '@/lib/shared/design/schema'
import { FullLogoChoice, LogoColours, LogoNameField, PortalLogoRow, SiteIcons } from './logo-extras'

type Update = (change: (draft: PortalDesign) => void) => void

/**
 * The logo: the icon and the title beside it, how tall it stands, a full
 * logo image in their place, the logo's colours, and the favicon and share image.
 */
export function LogoControls({
  design,
  update,
  logoUrl = null,
}: {
  design: PortalDesign
  update: Update
  logoUrl?: string | null
}) {
  return (
    <>
      <PortalLogoRow design={design} update={update} logoUrl={logoUrl} />
      <LogoNameField design={design} update={update} />
      <LogoHeight design={design} update={update} />
      <FullLogoChoice design={design} update={update} />
      <LogoColours design={design} update={update} logoUrl={logoUrl} />
      <SiteIcons design={design} update={update} />
    </>
  )
}

/** How tall the logo stands in the header, as a brand's own site sets it. */
export function LogoHeight({ design, update }: { design: PortalDesign; update: Update }) {
  const height = design.brand.logo.height ?? 32
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="design-logo-height" className="w-32 shrink-0 text-[13px]">
        Height
      </label>
      <input
        id="design-logo-height"
        type="range"
        min={16}
        max={64}
        step={1}
        value={height}
        aria-valuetext={`${height} px`}
        onChange={(event) =>
          update((draft) => {
            const next = Number(event.target.value)
            if (next === 32) delete draft.brand.logo.height
            else draft.brand.logo.height = next
          })
        }
        className="flex-1 accent-foreground"
      />
      <span className="w-12 text-end text-xs text-muted-foreground tabular-nums">{height} px</span>
    </div>
  )
}
