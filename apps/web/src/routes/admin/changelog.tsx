import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { ChangelogList } from '@/components/admin/changelog'

export const Route = createFileRoute('/admin/changelog')({
  loader: async ({ context }) => {
    // User, member, and settings are validated in parent /admin layout
    const { queryClient } = context

    // Pre-fetch boards list for the changelog form
    await queryClient.ensureQueryData(adminQueries.boards())

    return {}
  },
  component: ChangelogPage,
})

function ChangelogPage() {
  // Read pre-fetched data from React Query cache
  const boardsQuery = useSuspenseQuery(adminQueries.boards())

  return (
    <main className="h-full bg-card">
      <ChangelogList boards={boardsQuery.data} />
    </main>
  )
}
