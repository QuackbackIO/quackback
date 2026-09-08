import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { ProviderCreatePage } from '@/components/admin/settings/security/identity-providers/provider-create-page'
import { UpgradeScreen } from '@/components/admin/upgrade'
import {
  newRegistrationId,
  SIGN_IN_TAB,
} from '@/components/admin/settings/security/identity-providers/provider-shared'

// The trailing underscore on "sso_" escapes nesting under
// /admin/settings/security/sso, which is a redirect-only route for stale
// bookmarks. The URL is still /admin/settings/security/sso/new.
export const Route = createFileRoute('/admin/settings/security/sso_/new')({
  beforeLoad: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.AUTH_MANAGE)
  },
  loader: async ({ context }) => {
    const { hasEntitlementFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const [ssoEntitled] = await Promise.all([
      hasEntitlementFn({ data: { key: 'sso' } }),
      ensureBillingCatalogue(context.queryClient, context.billingEnabled),
    ])
    // Generated here rather than in the component so the server render and
    // the client agree: the redirect URI built from it is shown before
    // hydration and may be copied into the IdP straight away.
    return { ssoEntitled, registrationId: newRegistrationId() }
  },
  component: SsoCreateRoute,
})

function SsoCreateRoute() {
  const { ssoEntitled, registrationId } = Route.useLoaderData()
  if (ssoEntitled) return <ProviderCreatePage registrationId={registrationId} />
  return (
    <div className="max-w-3xl space-y-6">
      <BackLink {...SIGN_IN_TAB}>Sign-in</BackLink>
      <PageHeader
        title="Add identity provider"
        description="Single sign-on is not included on this plan."
      />
      <UpgradeScreen entitlement="sso" />
    </div>
  )
}
