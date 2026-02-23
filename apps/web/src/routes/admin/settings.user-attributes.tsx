import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { AdjustmentsHorizontalIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { UserAttributesList } from '@/components/admin/settings/user-attributes/user-attributes-list'

export const Route = createFileRoute('/admin/settings/user-attributes')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.userAttributes())
    return {}
  },
  component: UserAttributesPage,
})

function UserAttributesPage() {
  const attrsQuery = useSuspenseQuery(adminQueries.userAttributes())

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={AdjustmentsHorizontalIcon}
        title="User Attributes"
        description="Define custom attributes to enrich user profiles and power segment rules"
      />

      <UserAttributesList initialAttributes={attrsQuery.data} />
    </div>
  )
}
