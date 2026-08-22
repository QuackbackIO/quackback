import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { adminQueries } from '@/lib/client/queries/admin'
import { UserGroupIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { UserAttributesList } from '@/components/admin/settings/user-attributes/user-attributes-list'

export const Route = createFileRoute('/admin/settings/people')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.USER_ATTRIBUTE_VIEW)
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.userAttributes())
    return {}
  },
  component: PeoplePage,
})

function PeoplePage() {
  const attrsQuery = useSuspenseQuery(adminQueries.userAttributes())

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={UserGroupIcon}
        title="People"
        description="Custom attributes for the people who use your portal. Segments are managed on the Users page."
      />

      {/* The list renders its own SettingsCard internally so the
       *  header action (New attribute) lives in the card header. */}
      <UserAttributesList initialAttributes={attrsQuery.data} />
    </div>
  )
}
