import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { StatusesSettingsPage } from '@/components/admin/settings/statuses/status-list'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/statuses')({
  head: adminPageHead('Statuses settings'),
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/statuses')
    const { queryClient } = context

    // Pre-fetch statuses using React Query
    await queryClient.ensureQueryData(adminQueries.statuses())

    return {}
  },
  component: StatusesPage,
})

function StatusesPage() {
  // Read pre-fetched data from React Query cache
  const statusesQuery = useSuspenseQuery(adminQueries.statuses())

  return <StatusesSettingsPage initialStatuses={statusesQuery.data} />
}
