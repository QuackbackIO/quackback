import { createFileRoute } from '@tanstack/react-router'
import type { IdentityProviderId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { ProviderDetailPage } from '@/components/admin/settings/security/identity-providers/provider-detail-page'

// The trailing underscore on "sso_" escapes nesting under
// /admin/settings/security/sso, which is a redirect-only route for stale
// bookmarks. The URL is still /admin/settings/security/sso/:providerId.
export const Route = createFileRoute('/admin/settings/security/sso_/$providerId')({
  beforeLoad: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.AUTH_MANAGE)
  },
  loader: async ({ context, params }) => {
    const providerId = params.providerId as IdentityProviderId
    // Everything the page suspends on: the provider row itself, the two
    // queries behind the "keep one sign-in method enabled" guard, and the
    // linked-account count the Remove card states up front.
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.identityProviders()),
      context.queryClient.ensureQueryData(settingsQueries.authConfig()),
      context.queryClient.ensureQueryData(adminQueries.authProviderStatus()),
      context.queryClient.ensureQueryData(settingsQueries.providerAccountCount(providerId)),
    ])
    return {}
  },
  component: ProviderDetailRoute,
})

function ProviderDetailRoute() {
  const { providerId } = Route.useParams()
  return <ProviderDetailPage key={providerId} providerId={providerId as IdentityProviderId} />
}
