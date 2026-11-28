import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { adminQueries } from '@/lib/client/queries/admin'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { UserAttributesList } from '@/components/admin/settings/user-attributes/user-attributes-list'
import { adminPageHead } from '@/lib/client/admin-head'
import { seedAdminAreas } from '@/lib/shared/i18n'

export const Route = createFileRoute('/admin/settings/people')({
  head: adminPageHead('People settings'),
  loader: async ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/people')
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.userAttributes())
    return seedAdminAreas(context.personLocale, 'adminIntegrationSettings')
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
