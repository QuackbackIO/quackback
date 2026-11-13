import { createFileRoute, Navigate, useNavigate, useRouter } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRouteAnyPermission } from '@/lib/shared/route-permission'
import { DOMAINS_PAGE_PERMISSIONS, domainUseLinks } from '@/lib/shared/domains-permissions'
import { visibleDomainUses } from '@/lib/shared/domain-uses'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { adminPageHead } from '@/lib/client/admin-head'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { DomainView } from '@/components/admin/settings/domain-view'
import { domainRows } from '@/components/admin/settings/domains-overview'

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

function DomainPage() {
  const { sending, signIn, helpCenterDomain, added, domain } = Route.useLoaderData()
  const params = Route.useParams()
  const context = Route.useRouteContext()
  const permissions = context.permissions ?? []
  const router = useRouter()
  const navigate = useNavigate()
  const name = (domain?.name ?? params.domain).trim().toLowerCase()
  // An added domain has its page with no use at all; a name only uses hold is
  // shown while one of them the viewer may see still holds it.
  const row = domainRows({ sending, signIn, helpCenterDomain, added }).find((r) => r.name === name)
  if (!row) return <Navigate to="/admin/settings/domains" replace />

  return (
    <SettingsPage title={row.name} crumbs={[{ label: 'Domains', to: '/admin/settings/domains' }]}>
      <DomainView
        row={row}
        links={domainUseLinks({
          permissions,
          cloudEnabled: !!context.cloudEnabled,
          helpCenterOn: isProductEnabled(context.settings?.featureFlags, 'helpCenter'),
        })}
        visibleUses={visibleDomainUses(permissions)}
        domain={domain}
        canManage={permissions.includes(PERMISSIONS.SETTINGS_MANAGE)}
        onChanged={() => void router.invalidate()}
        onRemoved={() => void navigate({ to: '/admin/settings/domains', replace: true })}
      />
    </SettingsPage>
  )
}
