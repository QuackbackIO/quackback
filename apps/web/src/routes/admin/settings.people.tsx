import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { UserGroupIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { UserAttributesList } from '@/components/admin/settings/user-attributes/user-attributes-list'
import { SegmentList } from '@/components/admin/segments/segment-list'

export const Route = createFileRoute('/admin/settings/people')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await Promise.all([
      queryClient.ensureQueryData(adminQueries.userAttributes()),
      queryClient.ensureQueryData(adminQueries.segments()),
    ])
    return {}
  },
  component: PeoplePage,
})

function PeoplePage() {
  const attrsQuery = useSuspenseQuery(adminQueries.userAttributes())

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={UserGroupIcon}
        title="People"
        description="Custom attributes and segments for the people who use your portal."
      />

      {/* Both lists render their own SettingsCard internally so the
       *  header actions (New attribute / New segment / Re-evaluate)
       *  live in the card header next to the title. */}
      <UserAttributesList initialAttributes={attrsQuery.data} />
      <SegmentList />
    </div>
  )
}
