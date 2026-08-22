import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { TagIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { TagList } from '@/components/admin/settings/tags/tag-list'
import { AiBackfillCard } from '@/components/admin/settings/tags/ai-backfill-card'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { isProductEnabled } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/settings/tags')({
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.TAG_MANAGE)
    const { queryClient } = context
    await Promise.all([
      queryClient.ensureQueryData(adminQueries.tags()),
      queryClient.ensureQueryData(adminQueries.boards()),
    ])
    return {}
  },
  component: TagsPage,
})

function TagsPage() {
  const tagsQuery = useSuspenseQuery(adminQueries.tags())
  const boardsQuery = useSuspenseQuery(adminQueries.boards())

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={TagIcon}
        title="Tags"
        description="Organize and categorize feedback with tags"
      />

      <TagList initialTags={tagsQuery.data} />
      <AiBackfillCard tags={tagsQuery.data} boards={boardsQuery.data} />
    </div>
  )
}
