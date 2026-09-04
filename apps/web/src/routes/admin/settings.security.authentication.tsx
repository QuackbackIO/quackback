import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { AuthSettings, type AuthTab } from '@/components/admin/settings/security/auth-settings'

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
    assertRoutePermission(context.permissions, PERMISSIONS.AUTH_MANAGE)

    const { queryClient } = context
    // Auth + SSO reads are cheap and never 402. The audit feed is an Enterprise
    // entitlement: prefetching it here took down Portal access and Sign-in
    // on every other plan. The audit tab loads that query only when entitled.
    const { listEntitlementsFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const [, entitlements] = await Promise.all([
      Promise.all([
        queryClient.ensureQueryData(settingsQueries.authConfig()),
        queryClient.ensureQueryData(settingsQueries.verifiedDomains()),
        queryClient.ensureQueryData(settingsQueries.portalConfig()),
        queryClient.ensureQueryData(adminQueries.authProviderStatus()),
        queryClient.ensureQueryData(settingsQueries.identityProviders()),
        queryClient.ensureQueryData(adminQueries.recoveryCodes()),
      ]),
      listEntitlementsFn(),
      ensureBillingCatalogue(queryClient, context.billingEnabled),
    ])

    return { ssoEntitled: entitlements.sso, auditEntitled: entitlements.auditLog }
  },
  component: AuthenticationPage,
})

function AuthenticationPage() {
  const search = Route.useSearch()
  const tab: AuthTab = search.tab ?? 'portal-access'

  const authConfigQuery = useSuspenseQuery(settingsQueries.authConfig())
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const credentialStatusQuery = useSuspenseQuery(adminQueries.authProviderStatus())

  const { ssoEntitled, auditEntitled } = Route.useLoaderData()

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
        customOidcProviderTier={ssoEntitled}
        auditEntitled={auditEntitled}
      />
    </div>
  )
}
