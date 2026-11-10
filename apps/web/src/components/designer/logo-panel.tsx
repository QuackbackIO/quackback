/**
 * The logo, its own element in the header: what a click on it on the page
 * opens, under Header and menu. What the logo is (its icon and title, or a
 * full logo image) is the brand kit's, summed up here with a way there; how
 * tall it stands and its own colours are the logo's. There is one logo, on
 * every page.
 */
import type { PortalDesign } from '@/lib/shared/design/schema'
import { FIND } from './find-rows'
import { LogoColourRow, LogoHeightRow, logoImageUrl } from './logo-rows'
import { PropertiesPanel, PropertySection, type Crumb } from './properties/properties-panel'
import { SummaryRow } from './properties/summary-row'
import { THEME, WORDS } from './properties/words'

/** Changes the draft as one step, named for its undo where a name is given. */
type Update = (change: (draft: PortalDesign) => void, label?: string) => void

export function LogoPanel({
  crumbs,
  design,
  update,
  logoUrl,
  onBrandKit,
}: {
  crumbs: readonly Crumb[]
  design: PortalDesign
  update: Update
  /** The workspace's logo, shown until the portal has its own. */
  logoUrl: string | null
  /** Opens the brand kit at a row, by its find name: the logo's one writer. */
  onBrandKit: (row: string) => void
}) {
  const { logo } = design.brand
  return (
    <PropertiesPanel crumbs={crumbs} title={WORDS.logo} className="pb-24" data-logo-panel="">
      <PropertySection>
        {logo.display === 'wordmark' ? (
          <SummaryRow
            label={THEME.fullLogo}
            value={logo.wordmark.light ? THEME.image : THEME.fullLogoEmpty}
            onOpen={() => onBrandKit(FIND.fullLogo.id)}
          />
        ) : (
          <>
            <SummaryRow
              label={THEME.icon}
              value={logo.mark.light ? THEME.ownIcon : THEME.workspaceLogo}
              onOpen={() => onBrandKit(FIND.icon.id)}
            />
            <SummaryRow
              label={THEME.title}
              value={logo.name || THEME.titlePlaceholder}
              onOpen={() => onBrandKit(FIND.title.id)}
            />
          </>
        )}
        {design.brand.logo.display !== 'name' && <LogoHeightRow design={design} update={update} />}
      </PropertySection>
      <PropertySection title={THEME.sections.colours}>
        <LogoColourRow design={design} update={update} logoUrl={logoImageUrl(design, logoUrl)} />
      </PropertySection>
    </PropertiesPanel>
  )
}
