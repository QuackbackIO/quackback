import { createFileRoute, Navigate, useNavigate, useRouter } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRouteAnyPermission } from '@/lib/shared/route-permission'
import { DOMAINS_PAGE_PERMISSIONS, domainUseLinks } from '@/lib/shared/domains-permissions'
import { visibleDomainUses } from '@/lib/shared/domain-uses'
import { portalSectionsEnabled } from '@/lib/shared/section-domains'
import { adminPageHead } from '@/lib/client/admin-head'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { DomainView } from '@/components/admin/settings/domain-view'
import { domainRows } from '@/components/admin/settings/domains-overview'
import { listedSections } from '@/components/admin/settings/section-domains-card'

// The trailing underscore on "domains_" escapes nesting under the Domains
// list, which has no Outlet. The URL is still /admin/settings/domains/:domain.
export const Route = createFileRoute('/admin/settings/domains_/$domain')({
  head: adminPageHead('Domain settings'),
  loader: async ({ context, params }) => {
    assertRouteAnyPermission(context.permissions, DOMAINS_PAGE_PERMISSIONS)
    const { loadDomainPage } = await import('@/lib/client/domain-page-loader')
    return loadDomainPage(context, params.domain)
  },
  component: DomainPage,
})

const DOMAIN_ROUTES = new Set<string>([Route.id, '/admin/settings/domains'])

function DomainPage() {
  const { sending, signIn, sectionDomains, webAddresses, added, domain } = Route.useLoaderData()
  const params = Route.useParams()
  const context = Route.useRouteContext()
  const permissions = context.permissions ?? []
  const router = useRouter()
  const navigate = useNavigate()
  const name = (domain?.name ?? params.domain).trim().toLowerCase()
  // An added domain has its page with no use at all; a name only uses hold is
  // shown while one of them the viewer may see still holds it.
  const row = domainRows({
    sending,
    signIn,
    sectionDomains: sectionDomains?.sectionDomains,
    webAddresses,
    added,
  }).find((r) => r.name === name)
  if (!row) return <Navigate to="/admin/settings/domains" replace />
  const settings = context.settings
  const sectionEnabled = portalSectionsEnabled({
    featureFlags: settings?.featureFlags,
    statusConfig: settings?.statusConfig,
    portalConfig: settings?.portalConfig,
  })

  return (
    <SettingsPage title={row.name} crumbs={[{ label: 'Domains', to: '/admin/settings/domains' }]}>
      <DomainView
        row={row}
        links={domainUseLinks({ permissions })}
        setup={{
          cloud: !!context.cloudEnabled,
          sectionDomains,
          sections: listedSections({
            nav: settings?.portalConfig?.nav,
            sectionEnabled,
            map: sectionDomains?.sectionDomains ?? {},
          }),
        }}
        visibleUses={visibleDomainUses(permissions)}
        domain={domain}
        canManage={permissions.includes(PERMISSIONS.SETTINGS_MANAGE)}
        onChanged={() =>
          // Only this page and the Domains list (a preload of it may be cached) read a domain.
          void router.invalidate({ filter: (m) => DOMAIN_ROUTES.has(m.routeId) })
        }
        onRemoved={() => void navigate({ to: '/admin/settings/domains', replace: true })}
      />
    </SettingsPage>
  )
}
