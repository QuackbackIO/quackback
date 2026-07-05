import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { AuthSettings, type AuthTab } from '@/components/admin/settings/security/auth-settings'
import { rangeToFromIso } from '@/components/admin/settings/security/audit-log-page'

const searchSchema = z.object({
  // The Access & Security page splits by CONCERN, not by surface:
  //   - portal-access: who can view the portal (visibility, domains,
  //                    invites, segments, widget sign-in)
  //   - sign-in:       authentication methods for both surfaces in one
  //                    place (password + 2FA, magic link, social, OIDC)
  //                    with per-surface toggles inline.
  //   - audit-log:     admin action history (merged from the retired
  //                    standalone route).
  //
  // Backward compat: the old `team-access` tab is coerced to `sign-in`
  // so stale bookmarks don't crash.
  tab: z.preprocess(
    (v) => (v === 'team-access' ? 'sign-in' : v),
    z.enum(['portal-access', 'sign-in', 'audit-log']).optional()
  ),
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
      // Prefetch for <IdentityProvidersSection> (Sign-in tab) which suspends.
      queryClient.ensureQueryData(settingsQueries.identityProviders()),
      // Prefetch for <RecoveryCodesSection> (Sign-in tab) which suspends.
      queryClient.ensureQueryData(adminQueries.recoveryCodes()),
      // Prefetch the audit tab's default view (same defaults as <AuditLogPage>).
      queryClient.ensureQueryData(
        adminQueries.auditEvents({ from: rangeToFromIso('30d'), limit: 200 })
      ),
    ])

    return {}
  },
  component: AuthenticationPage,
})

function AuthenticationPage() {
  const search = Route.useSearch()
  const tab: AuthTab = search.tab ?? 'portal-access'

  const authConfigQuery = useSuspenseQuery(settingsQueries.authConfig())
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const credentialStatusQuery = useSuspenseQuery(adminQueries.authProviderStatus())

  // Tier flag from the root context (already populated by BootstrapData
  // for every admin route).
  const ctx = Route.useRouteContext()
  const customOidcProviderTier =
    (ctx as { tierLimits?: { features?: { customOidcProvider?: boolean } } }).tierLimits?.features
      ?.customOidcProvider !== false

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ShieldCheckIcon}
        title="Access & Security"
        description="Who can reach the portal, how everyone signs in, and what admins changed."
      />
      <AuthSettings
        tab={tab}
        teamAuthConfig={authConfigQuery.data}
        portalConfig={portalConfigQuery.data}
        credentialStatus={credentialStatusQuery.data}
        customOidcProviderTier={customOidcProviderTier}
      />
    </div>
  )
}
