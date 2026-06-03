import { createFileRoute } from '@tanstack/react-router'
import { HelpCenterList } from '@/components/admin/help-center/help-center-list'
import { helpCenterQueries } from '@/lib/client/queries/help-center'

export const Route = createFileRoute('/admin/help-center/')({
  loader: async ({ context }) => {
    const { queryClient } = context
    // Warm categories so the finder's category list renders real data on
    // first paint instead of flipping from its empty-array default.
    await Promise.all([queryClient.ensureQueryData(helpCenterQueries.categories())])
    return {}
  },
  component: HelpCenterIndexPage,
})

function HelpCenterIndexPage() {
  return (
    <main className="h-full">
      <HelpCenterList />
    </main>
  )
}
