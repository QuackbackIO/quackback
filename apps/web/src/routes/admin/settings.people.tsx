import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { adminQueries } from '@/lib/client/queries/admin'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { UserAttributesList } from '@/components/admin/settings/user-attributes/user-attributes-list'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/people')({
  head: adminPageHead('People settings'),
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
    <SettingsPage
      page="/admin/settings/people"
      description="Custom attributes on users, used in segments."
    >
      <UserAttributesList initialAttributes={attrsQuery.data} />
    </SettingsPage>
  )
}
