import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { adminQueries } from '@/lib/queries/admin'

export const Route = createFileRoute('/admin/feedback')({
  loader: async ({ context }) => {
    const { queryClient } = context

    // Pre-fetch boards to check if onboarding is needed
    const orgBoards = await queryClient.ensureQueryData(adminQueries.boards())

    if (orgBoards.length === 0) {
      throw redirect({ to: '/onboarding' })
    }

    return {}
  },
  component: FeedbackLayout,
})

function FeedbackLayout() {
  return <Outlet />
}
