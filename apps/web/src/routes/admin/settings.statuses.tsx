import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { StatusesSettingsPage } from '@/components/admin/settings/statuses/status-list'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { isProductEnabled } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/settings/statuses')({
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.STATUS_MANAGE)
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
