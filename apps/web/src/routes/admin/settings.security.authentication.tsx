import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { AuthSettings, type AuthTab } from '@/components/admin/settings/security/auth-settings'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/shared/types/settings'

const searchSchema = z.object({
  tab: z.enum(['team', 'portal']).optional(),
})

export const Route = createFileRoute('/admin/settings/security/authentication')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context
    // Both tabs are loaded up front so switching tabs doesn't trigger
    // a server round-trip. Auth config + portal config + provider
    // credential status are cheap (settings cache hits).
    await Promise.all([
      queryClient.ensureQueryData(settingsQueries.authConfig()),
      queryClient.ensureQueryData(settingsQueries.portalConfig()),
      queryClient.ensureQueryData(adminQueries.authProviderStatus()),
      // Prefetch for <AuthSettingsSsoCallout> which suspends on this query.
      queryClient.ensureQueryData(settingsQueries.verifiedDomains()),
    ])

    return {}
  },
  component: AuthenticationPage,
})

function AuthenticationPage() {
  const search = Route.useSearch()
  const tab: AuthTab = search.tab ?? 'team'

  const authConfigQuery = useSuspenseQuery(settingsQueries.authConfig())
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const credentialStatusQuery = useSuspenseQuery(adminQueries.authProviderStatus())

  // Tier flag from the root context (already populated by BootstrapData
  // for every admin route).
  const ctx = Route.useRouteContext()
  const customOidcProviderTier =
    (ctx as { tierLimits?: { features?: { customOidcProvider?: boolean } } }).tierLimits?.features
      ?.customOidcProvider !== false

  const portalOauth = portalConfigQuery.data?.oauth ?? DEFAULT_PORTAL_CONFIG.oauth

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ShieldCheckIcon}
        title="Security"
        description="Choose how your team and end users sign in."
      />
      <AuthSettings
        tab={tab}
        teamAuthConfig={authConfigQuery.data}
        portalOauth={portalOauth}
        credentialStatus={credentialStatusQuery.data}
        customOidcProviderTier={customOidcProviderTier}
      />
    </div>
  )
}
