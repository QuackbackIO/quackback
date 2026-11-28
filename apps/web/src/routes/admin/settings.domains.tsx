import { useEffect, useState } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { domainUseLinks, domainsPageSearch } from '@/lib/shared/domains-permissions'
import { legacyCustomDomainsTarget } from '@/lib/shared/portal-settings-tabs'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { VerifiedDomainsCard, domainRows } from '@/components/admin/settings/domains-overview'
import { loadDomainSummaries } from '@/lib/client/domain-summaries'
import { adminPageHead } from '@/lib/client/admin-head'
import { seedAdminAreas } from '@/lib/shared/i18n'

/**
 * Settings > Domains: the domains the workspace verified, each with its own
 * page. Custom domains are set on the Custom domains tab of Settings > Portal.
 */
export const Route = createFileRoute('/admin/settings/domains')({
  head: adminPageHead('Domains settings'),
  // `?add=1` (addDomainLink) opens Add domain on arrival, as Custom domains links here to add one.
  validateSearch: domainsPageSearch,
  loader: async ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/domains')
    // The list rows only the domains the workspace owns, so it reads no section map.
    const summaries = await loadDomainSummaries({ ...context, sectionDomains: false })
    return {
      seededAreas: await seedAdminAreas(context.personLocale, 'adminWorkspaceSettings'),
      ...summaries,
      links: domainUseLinks({ permissions: context.permissions ?? [] }),
    }
  },
  component: DomainsSettingsPage,
})

function DomainsSettingsPage() {
  const { sending, signIn, added, links } = Route.useLoaderData()
  const { permissions } = Route.useRouteContext()
  const { add } = Route.useSearch()
  const navigate = useNavigate()
  // Only settings.manage adds a bare domain; the other Domains permissions see the page without it.
  const canAdd = permissions?.includes(PERMISSIONS.SETTINGS_MANAGE) ?? false
  const rows = domainRows({ sending, signIn, added })

  // An old link to the Custom domains card (#custom-domains) opens its tab on Settings > Portal.
  // An effect, not beforeLoad: old links arrive as full page loads, rendered on
  // the server, which never sees the hash, and beforeLoad does not run again
  // when the browser hydrates.
  useEffect(() => {
    const target = legacyCustomDomainsTarget(window.location.hash, permissions)
    if (target) void navigate({ ...target, replace: true })
  }, [navigate, permissions])

  // Add domain opens once: the request leaves the URL, so going back or reloading does not reopen it.
  const [openAdd] = useState(add === '1')
  useEffect(() => {
    if (openAdd) void navigate({ to: '/admin/settings/domains', search: {}, replace: true })
  }, [navigate, openAdd])

  return (
    <SettingsPage page="/admin/settings/domains">
      <VerifiedDomainsCard rows={rows} links={links} canAdd={canAdd} openAdd={openAdd} />
    </SettingsPage>
  )
}
