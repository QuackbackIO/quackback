import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { useAdminBoards } from '@/lib/client/hooks/use-admin-catalogues'
import { TagsSettingsPage } from '@/components/admin/settings/tags/tag-list'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { readBatch } from '@/lib/client/queries/read-batch'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/tags')({
  head: adminPageHead('Tags settings'),
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.TAG_MANAGE)
    const { queryClient } = context
    const ensure = readBatch(queryClient)
    // The backfill card's board picker needs board.manage, which tag.manage
    // does not imply.
    await Promise.all([
      ensure(adminQueries.tags()),
      context.permissions?.includes(PERMISSIONS.BOARD_MANAGE)
        ? ensure(adminQueries.boards())
        : undefined,
    ])
    return {}
  },
  component: TagsPage,
})

function TagsPage() {
  const tagsQuery = useSuspenseQuery(adminQueries.tags())
  const boardsQuery = useAdminBoards()

  return <TagsSettingsPage initialTags={tagsQuery.data} boards={boardsQuery.data ?? []} />
}
