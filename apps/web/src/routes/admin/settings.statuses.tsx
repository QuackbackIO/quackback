import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
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
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Cog6ToothIcon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Public Statuses</h1>
          <p className="text-sm text-muted-foreground">
            Customize the statuses available for feedback posts
          </p>
        </div>
      </div>

      <StatusList initialStatuses={statusesQuery.data} />
    </div>
  )
}
