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
  // `?test=1` is set by "Save and test" on the create page and the connection
  // editor: the page opens the connection test once, then drops the flag so a
  // reload does not re-open it.
  validateSearch: (search: Record<string, unknown>): { test?: boolean } =>
    search.test === true || search.test === 'true' || search.test === 1 || search.test === '1'
      ? { test: true }
      : {},
  beforeLoad: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.AUTH_MANAGE)
  },
  loader: async ({ context, params }) => {
    const providerId = params.providerId as IdentityProviderId
    // Everything the page suspends on: the provider row itself, the two
    // queries behind the "keep one sign-in method enabled" guard, and the
    // linked-account count the Remove dialog states up front.
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
  const { test } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <ProviderDetailPage
      key={providerId}
      providerId={providerId as IdentityProviderId}
      autoTest={test === true}
      onAutoTestConsumed={() => void navigate({ search: {}, replace: true })}
    />
  )
}
