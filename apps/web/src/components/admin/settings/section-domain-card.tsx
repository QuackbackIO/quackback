/**
 * A product page's custom domain, read-only: the hostname its section is
 * served at, or the primary domain. Custom domains are set only on Settings >
 * Domains, behind settings.custom_domain, so a viewer who holds it gets a link
 * there and nobody edits it here.
 */
import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { StateBadge } from '@/components/shared/state-badge'
import { CUSTOM_DOMAINS_ANCHOR } from '@/lib/shared/domains-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PortalSection } from '@/lib/shared/custom-domains'
import {
  effectiveSectionDomains,
  normalizeHost,
  type SectionDomainMap,
} from '@/lib/shared/section-domains'
import { sectionDomainState } from '@/lib/shared/section-domain-state'
import { cn } from '@/lib/shared/utils'
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
  /** Holds settings.custom_domain: may change it on Settings > Domains. */
  canManage: boolean
}) {
  const entry = map[section]
  const state = entry ? sectionDomainState(entry) : null
  return (
    <SettingsCard title="Custom domain">
      <SettingRows>
        <SettingRow
          label="Domain"
          description={entry ? undefined : 'Primary domain'}
          badge={
            state === 'pending' ? (
              <StateBadge state="pending" />
            ) : state === 'not-answering' ? (
              <StateBadge state="attention" />
            ) : undefined
          }
          control={
            <>
              <span
                className={cn(
                  'text-sm wrap-anywhere',
                  entry ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {entry?.hostname ?? primaryHost}
              </span>
              {canManage && (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/admin/settings/domains" hash={CUSTOM_DOMAINS_ANCHOR}>
                    Custom domains
                  </Link>
                </Button>
              )}
            </>
          }
        />
      </SettingRows>
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
