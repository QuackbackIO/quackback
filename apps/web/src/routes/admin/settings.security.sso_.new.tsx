import { createFileRoute } from '@tanstack/react-router'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { ProviderCreatePage } from '@/components/admin/settings/security/identity-providers/provider-create-page'
import { UpgradeScreen } from '@/components/admin/upgrade'
import { SSO_CRUMBS } from '@/components/admin/settings/security/identity-providers/provider-shared'
import { adminPageHead } from '@/lib/client/admin-head'
import { seedAdminAreas } from '@/lib/shared/i18n'

// The trailing underscore on "sso_" escapes nesting under
// /admin/settings/security/sso, which is a redirect-only route for stale
// bookmarks. The URL is still /admin/settings/security/sso/new.
export const Route = createFileRoute('/admin/settings/security/sso_/new')({
  head: adminPageHead('New single sign-on provider'),
  beforeLoad: ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/security/sso/new')
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
    const { newRegistrationId } =
      await import('@/components/admin/settings/security/identity-providers/provider-shared')
    return {
      ssoEntitled,
      registrationId: newRegistrationId(),
      seededAreas: await seedAdminAreas(context.personLocale, 'adminWorkspaceSettings'),
    }
  },
  component: SsoCreateRoute,
})

function SsoCreateRoute() {
  const { ssoEntitled, registrationId } = Route.useLoaderData()
  if (ssoEntitled) return <ProviderCreatePage registrationId={registrationId} />
  return (
    <SettingsPage
      title="New identity provider"
      description="Single sign-on is not included on this plan."
      crumbs={SSO_CRUMBS}
    >
      <UpgradeScreen entitlement="sso" />
    </SettingsPage>
  )
}
