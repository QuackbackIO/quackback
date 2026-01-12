import { createFileRoute, Outlet } from '@tanstack/react-router'
import { adminQueries } from '@/lib/queries/admin'

export const Route = createFileRoute('/admin/feedback')({
  loader: async ({ context }) => {
    const { queryClient } = context

    // Pre-fetch boards for the feedback views
    await queryClient.ensureQueryData(adminQueries.boards())

    return {}
  },
  component: FeedbackLayout,
})

function FeedbackLayout() {
  return <Outlet />
}
