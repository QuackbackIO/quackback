import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { PageHeader } from '@/components/shared/page-header'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { SsoPage } from '@/components/admin/settings/security/sso/sso-page'

export const Route = createFileRoute('/admin/settings/security/sso')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.authConfig()),
      context.queryClient.ensureQueryData(settingsQueries.verifiedDomains()),
      context.queryClient.ensureQueryData(adminQueries.ssoStatus()),
      context.queryClient.ensureQueryData(adminQueries.recoveryCodes()),
    ])
    return {}
  },
  component: SsoRoute,
})

function SsoRoute() {
  const authConfig = useSuspenseQuery(settingsQueries.authConfig())
  const ssoStatus = useSuspenseQuery(adminQueries.ssoStatus())

  const ctx = Route.useRouteContext()
  const customOidcProviderTier =
    (ctx as { tierLimits?: { features?: { customOidcProvider?: boolean } } }).tierLimits?.features
      ?.customOidcProvider !== false

  return (
    <div className="space-y-6 max-w-5xl">
      <Breadcrumbs
        segments={[
          { label: 'Settings', to: '/admin/settings' },
          { label: 'Security', to: '/admin/settings/security/authentication' },
          { label: 'Single sign-on' },
        ]}
      />
      <PageHeader
        icon={ShieldCheckIcon}
        title="Single sign-on"
        description="Connect your identity provider, verify domains, and configure role attribution."
      />
      <SsoPage
        authConfig={authConfig.data}
        ssoStatus={ssoStatus.data}
        customOidcProviderTier={customOidcProviderTier}
      />
    </div>
  )
}
