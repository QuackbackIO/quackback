import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { AuthSettings } from '@/components/admin/settings/security/auth-settings'
import {
  AUTH_TABS,
  authTabsFor,
  resolveAuthTab,
  type AuthTab,
} from '@/lib/shared/authentication-tabs'
import { readBatch } from '@/lib/client/queries/read-batch'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { adminPageHead } from '@/lib/client/admin-head'
import { getSsoLiveFn } from '@/lib/server/functions/sso'
import { seedAdminAreas } from '@/lib/shared/i18n'

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
  tab: z.preprocess((v) => (v === 'team-access' ? 'sign-in' : v), z.enum(AUTH_TABS).optional()),
})

export const Route = createFileRoute('/admin/settings/security/authentication')({
  head: adminPageHead('Authentication settings'),
  validateSearch: searchSchema,
  loader: async ({ context, location }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/security/authentication')

    const { queryClient } = context
    // Portal access needs settings.manage and Audit log audit.view as well;
    // a viewer without one has no such tab, and its reads are not made.
    const tabs = authTabsFor(context.permissions)
    const tab = resolveAuthTab((location.search as { tab?: AuthTab }).tab, tabs)
    // The portal access tab (the default) lists the segments a private portal
    // can admit, read under segment.view.
    const warmSegments =
      tab === 'portal-access' && !!context.permissions?.includes(PERMISSIONS.SEGMENT_VIEW)
    // Auth + SSO reads are cheap and never 402. The audit feed is an Enterprise
    // entitlement: prefetching it here took down Portal access and Sign-in
    // on every other plan. The audit tab loads that query only when entitled.
    const { listEntitlementsFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const ensure = readBatch(queryClient)
    const [, entitlements, ssoLive] = await Promise.all([
      Promise.all([
        ensure(settingsQueries.authConfig()),
        ensure(settingsQueries.verifiedDomains()),
        tabs.includes('portal-access') ? ensure(settingsQueries.portalConfig()) : undefined,
        ensure(adminQueries.authProviderStatus()),
        ensure(settingsQueries.identityProviders()),
        ensure(adminQueries.recoveryCodes()),
        warmSegments ? warmQuery(ensure, adminQueries.segments()) : undefined,
      ]),
      listEntitlementsFn(),
      // Without plan billing single sign-on follows the plan alone, so the
      // page asks nothing more.
      context.cloudEnabled ? getSsoLiveFn() : undefined,
      ensureBillingCatalogue(queryClient, context.billingEnabled),
    ])

    return {
      seededAreas: await seedAdminAreas(context.personLocale, 'adminWorkspaceSettings'),
      tabs,
      ssoEntitled: entitlements.sso,
      ssoLive,
      auditEntitled: entitlements.auditLog,
    }
  },
  component: AuthenticationPage,
})

function AuthenticationPage() {
  const search = Route.useSearch()
  const { tabs, ssoEntitled, ssoLive, auditEntitled } = Route.useLoaderData()
  const tab = resolveAuthTab(search.tab, tabs)

  const authConfigQuery = useSuspenseQuery(settingsQueries.authConfig())
  // Read by the loader for a viewer with the Portal access tab, and only then.
  const portalConfigQuery = useQuery({
    ...settingsQueries.portalConfig(),
    enabled: tabs.includes('portal-access'),
  })
  const credentialStatusQuery = useSuspenseQuery(adminQueries.authProviderStatus())

  return (
    <SettingsPage
      page="/admin/settings/security/authentication"
      width={tab === 'audit-log' ? 'wide' : 'form'}
    >
      <AuthSettings
        tab={tab}
        tabs={tabs}
        teamAuthConfig={authConfigQuery.data}
        portalConfig={portalConfigQuery.data}
        credentialStatus={credentialStatusQuery.data}
        customOidcProviderTier={ssoEntitled}
        ssoLive={ssoLive}
        auditEntitled={auditEntitled}
      />
    </SettingsPage>
  )
}
