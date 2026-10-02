import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { TagsSettingsPage } from '@/components/admin/settings/tags/tag-list'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { readBatch } from '@/lib/client/queries/read-batch'

export const Route = createFileRoute('/admin/settings/tags')({
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.TAG_MANAGE)
    const { queryClient } = context
    const ensure = readBatch(queryClient)
    await Promise.all([ensure(adminQueries.tags()), ensure(adminQueries.boards())])
    return {}
  },
  component: TagsPage,
})

function TagsPage() {
  const tagsQuery = useSuspenseQuery(adminQueries.tags())
  const boardsQuery = useSuspenseQuery(adminQueries.boards())

  return <TagsSettingsPage initialTags={tagsQuery.data} boards={boardsQuery.data} />
}
