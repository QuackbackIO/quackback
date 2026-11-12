import { createFileRoute, Navigate, useRouter } from '@tanstack/react-router'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'
import { assertRouteAnyPermission } from '@/lib/shared/route-permission'
import { DOMAINS_PAGE_PERMISSIONS, domainUseLinks } from '@/lib/shared/domains-permissions'
import { visibleDomainUses } from '@/lib/shared/domain-uses'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { loadDomainSummaries } from '@/lib/client/domain-summaries'
import { adminPageHead } from '@/lib/client/admin-head'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { DomainView } from '@/components/admin/settings/domain-view'
import { domainRows } from '@/components/admin/settings/domains-overview'

// The trailing underscore on "domains_" escapes nesting under the Domains
// list, which has no Outlet. The URL is still /admin/settings/domains/:domain.
export const Route = createFileRoute('/admin/settings/domains_/$domain')({
  head: adminPageHead('Domain settings'),
  loader: async ({ context }) => {
    assertRouteAnyPermission(context.permissions, DOMAINS_PAGE_PERMISSIONS)
    const [summaries] = await Promise.all([
      loadDomainSummaries(context),
      // The records and addresses the email card shows. The card says where
      // the domain stands without them, so a failed read does not fail the page.
      context.permissions?.includes(EMAIL_SENDING_PERMISSION)
        ? import('@/lib/client/queries/channel-accounts').then(({ emailChannelConfigQuery }) =>
            context.queryClient.ensureQueryData(emailChannelConfigQuery()).catch(() => null)
          )
        : null,
    ])
    return summaries
  },
  component: DomainPage,
})

function DomainPage() {
  const { sending, signIn, helpCenterDomain } = Route.useLoaderData()
  const { domain } = Route.useParams()
  const context = Route.useRouteContext()
  const permissions = context.permissions ?? []
  const router = useRouter()
  const name = domain.trim().toLowerCase()
  const row = domainRows({ sending, signIn, helpCenterDomain }).find((r) => r.name === name)
  // No use left that this viewer may see: the domain is off the list, so back to it.
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
        onChanged={() => void router.invalidate()}
      />
    </SettingsPage>
  )
}
