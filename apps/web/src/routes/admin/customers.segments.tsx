import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { UserAttributesList } from '@/components/admin/settings/user-attributes/user-attributes-list'
import { SegmentList } from '@/components/admin/segments/segment-list'

export const Route = createFileRoute('/admin/customers/segments')({
  loader: async ({ context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    await Promise.all([
      queryClient.ensureQueryData(adminQueries.userAttributes()),
      queryClient.ensureQueryData(adminQueries.segments()),
    ])
    return {}
  },
  component: CustomerSegmentsPage,
})

function CustomerSegmentsPage() {
  const attrsQuery = useSuspenseQuery(adminQueries.userAttributes())

  return (
    <div className="space-y-6 max-w-5xl">
      <UserAttributesList initialAttributes={attrsQuery.data} />
      <SegmentList />
    </div>
  )
}
