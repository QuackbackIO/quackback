import { useId } from 'react'
import { Link } from '@tanstack/react-router'
import { Input } from '@/components/ui/input'
import { PortalNavEditor } from '@/components/admin/settings/branding/portal-nav-editor'
import type { PortalNavItemConfig } from '@/lib/shared/types/settings'
import type { PortalSection } from '@/lib/shared/custom-domains'
import { LogoTiles } from './logo-tiles'
import type { PortalIcon } from '@/lib/shared/schemas/portal-customise'
import type { LogoDraft } from './portal-draft'

export interface LogoControls {
  logo: LogoDraft
  canChangeIcon: boolean
  onLogoUploaded: (key: string) => void
  onDarkUploaded: (key: string) => void
  onRemoveDark: () => void
  /** The header's colour where the portal is dark, or null for a portal never drawn dark. */
  darkSurface: string | null
  onIconUploaded: (icon: PortalIcon) => void
  onShowLogo: () => void
  onShowIconAndName: () => void
  onRemoveLogo: () => void
}

interface HeaderTabsSectionProps {
  workspaceName: string
  /** The name the header shows in the workspace name's place; empty for none. */
  headerName: string
  setHeaderName: (name: string) => void
  nav: PortalNavItemConfig[]
  setNav: (items: PortalNavItemConfig[]) => void
  resetNav: () => void
  gatedTypes: ReadonlySet<string>
  logo: LogoControls
  /** The web address a tab is served at, when it has its own. */
  sectionHosts?: Partial<Record<PortalSection, string>>
  /** The viewer has the Custom domains tab: each address links there. */
  linkSectionHosts?: boolean
}

/** The header: the logo and icon, the name it shows and the tabs. */
export function HeaderTabsSection({
  workspaceName,
  headerName,
  setHeaderName,
  nav,
  setNav,
  resetNav,
  gatedTypes,
  logo,
  sectionHosts,
  linkSectionHosts,
}: HeaderTabsSectionProps) {
  const nameId = useId()
  return (
    <div className="space-y-4">
      <LogoTiles workspaceName={headerName.trim() || workspaceName} {...logo} />
      <div className="space-y-1.5">
        <label htmlFor={nameId} className="text-[13px] font-medium">
          Name in the header
        </label>
        <Input
          id={nameId}
          value={headerName}
          placeholder={workspaceName}
          maxLength={100}
          onChange={(event) => setHeaderName(event.target.value)}
          className="h-8"
        />
        <p className="text-xs text-muted-foreground">
          Emails and sign-in use the workspace name, {workspaceName}. Change it in{' '}
          <Link to="/admin/settings/general" className="underline underline-offset-2">
            General
          </Link>
          .
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-medium">Tabs</span>
        </div>
        <PortalNavEditor
          items={nav}
          onChange={setNav}
          gatedTypes={gatedTypes}
          onReset={resetNav}
          sectionHosts={sectionHosts}
          linkSectionHosts={linkSectionHosts}
        />
        <p className="text-xs text-muted-foreground">
          A new link shows once it has an address. Renamed tabs show your text in every language.
          The Help Center adds its own links on its pages.
        </p>
      </div>
    </div>
  )
}
