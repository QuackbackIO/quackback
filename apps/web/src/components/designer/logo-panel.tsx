/**
 * The logo, its own element in the header: what a click on it on the page
 * opens, under Header and menu. The icon and title (the brand kit's rows),
 * a full logo image in their place, how tall it stands and its own colours.
 * There is one logo, on every page.
 */
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  FullLogoRows,
  LogoColourRow,
  LogoHeightRow,
  LogoIconRow,
  LogoTitleRow,
  logoImageUrl,
} from './logo-rows'
import { PropertiesPanel, PropertySection, type Crumb } from './properties/properties-panel'
import { THEME, WORDS } from './properties/words'

/** Changes the draft as one step, named for its undo where a name is given. */
type Update = (change: (draft: PortalDesign) => void, label?: string) => void

export function LogoPanel({
  crumbs,
  design,
  update,
  logoUrl,
}: {
  crumbs: readonly Crumb[]
  design: PortalDesign
  update: Update
  /** The workspace's logo, shown until the portal has its own. */
  logoUrl: string | null
}) {
  return (
    <PropertiesPanel
      crumbs={crumbs}
      title={WORDS.logo}
      kind={WORDS.everyPage}
      className="pb-24"
      data-logo-panel=""
    >
      <PropertySection>
        <LogoIconRow design={design} update={update} logoUrl={logoUrl} />
        <LogoTitleRow design={design} update={update} />
        <FullLogoRows design={design} update={update} />
        {design.brand.logo.display !== 'name' && <LogoHeightRow design={design} update={update} />}
      </PropertySection>
      <PropertySection title={THEME.sections.colours}>
        <LogoColourRow design={design} update={update} logoUrl={logoImageUrl(design, logoUrl)} />
      </PropertySection>
    </PropertiesPanel>
  )
}
