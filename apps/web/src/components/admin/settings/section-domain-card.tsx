/**
 * A product page's custom domain, read-only: the hostname its section is
 * served at, or the primary domain. Custom domains are set only on the Custom
 * domains tab of Settings > Portal, behind settings.custom_domain, so a viewer
 * who holds it gets a link there and nobody edits it here.
 */
import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { INLINE_LINK } from '@/components/admin/settings/inline-link'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { StateBadge } from '@/components/shared/state-badge'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PortalSection } from '@/lib/shared/custom-domains'
import { CUSTOM_DOMAINS_LINK } from '@/lib/shared/portal-settings-tabs'
import {
  effectiveSectionDomains,
  normalizeHost,
  notAnsweringNote,
  sectionDomainState,
  type SectionDomainMap,
} from '@/lib/shared/section-domains'
import {
  useBaseUrl,
  useHasPermission,
  useWorkspaceSettings,
} from '@/lib/client/hooks/use-root-context'

export function SectionDomainCard({
  section,
  map,
  primaryHost,
  canManage,
}: {
  section: PortalSection
  map: SectionDomainMap
  primaryHost: string | null
  /** Holds settings.custom_domain: may change it on Settings > Portal, Custom domains. */
  canManage: boolean
}) {
  const entry = map[section]
  const state = entry ? sectionDomainState(entry) : null
  const note = entry ? notAnsweringNote(entry) : null
  // Label left, value right, as a detail row reads; kept plain, it sits on many pages.
  return (
    <SettingsCard>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-sm">
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium">
            Custom domain
            {state === 'pending' && <StateBadge state="pending" />}
            {state === 'not-answering' && <StateBadge state="attention" />}
          </span>
          {note && <span className="text-[13px] text-muted-foreground">{note}</span>}
        </span>
        <span className="flex items-center gap-3">
          <span className={entry ? undefined : 'text-muted-foreground'}>
            {entry?.hostname ?? `${primaryHost} (primary domain)`}
          </span>
          {canManage && (
            <Link
              to={CUSTOM_DOMAINS_LINK.to}
              search={CUSTOM_DOMAINS_LINK.search}
              className={`${INLINE_LINK} text-[13px]`}
            >
              Custom domains
            </Link>
          )}
        </span>
      </div>
    </SettingsCard>
  )
}

/** The card as a settings page shows it, read from the workspace settings already loaded. */
export function SectionDomainSettingsCard({ section }: { section: PortalSection }) {
  const settings = useWorkspaceSettings()
  const baseUrl = useBaseUrl()
  const canManage = useHasPermission(PERMISSIONS.SETTINGS_CUSTOM_DOMAIN)
  const map = useMemo(
    () =>
      effectiveSectionDomains({
        sectionDomains: settings?.portalConfig?.sectionDomains,
        legacyHelpDomain: settings?.helpCenterConfig?.domain,
      }),
    [settings]
  )
  const primaryHost = useMemo(() => {
    try {
      return baseUrl ? normalizeHost(new URL(baseUrl).host) : null
    } catch {
      return null
    }
  }, [baseUrl])
  return (
    <SectionDomainCard
      section={section}
      map={map}
      primaryHost={primaryHost}
      canManage={canManage}
    />
  )
}
