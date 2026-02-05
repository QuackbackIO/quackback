import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { StatusList } from '@/components/admin/settings/statuses/status-list'

export const Route = createFileRoute('/admin/settings/statuses')({
  loader: async ({ context }) => {
    // User, member, and settings are validated in parent /admin layout
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

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={Cog6ToothIcon}
        title="Public Statuses"
        description="Customize the statuses available for feedback posts"
      />

      <StatusList initialStatuses={statusesQuery.data} />
    </div>
  )
}
