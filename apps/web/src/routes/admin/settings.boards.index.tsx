import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { adminQueries } from '@/lib/client/queries/admin'
import { ChatBubbleLeftIcon } from '@heroicons/react/24/solid'
import { EmptyState } from '@/components/shared/empty-state'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { BoardsList } from '@/components/admin/settings/boards/boards-list'
import { boardTabSearch } from '@/components/admin/settings/boards/board-tabs'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { adminPageHead } from '@/lib/client/admin-head'

const searchSchema = z.object({
  board: z.string().optional(),
  tab: boardTabSearch,
})

export const Route = createFileRoute('/admin/settings/boards/')({
  head: adminPageHead('Boards settings'),
  validateSearch: searchSchema,
  beforeLoad: ({ context, search }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: '/admin/settings/general' })
    }
    if (search.board) {
      throw redirect({
        to: '/admin/settings/boards/$slug',
        params: { slug: search.board },
        search: search.tab ? { tab: search.tab } : {},
      })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.BOARD_MANAGE)
    await context.queryClient.ensureQueryData(adminQueries.boardsWithCounts())
    return {}
  },
  component: BoardsSettingsPage,
})

function BoardsSettingsPage() {
  const { data: boards } = useSuspenseQuery(adminQueries.boardsWithCounts())

  return (
    <SettingsPage
      page="/admin/settings/boards"
      actions={boards.length > 0 ? <CreateBoardDialog /> : undefined}
    >
      <SettingsCard flush>
        {boards.length === 0 ? (
          <EmptyState
            size="compact"
            icon={ChatBubbleLeftIcon}
            title="No boards yet"
            description="Create a board to start collecting feedback."
            action={<CreateBoardDialog />}
          />
        ) : (
          <BoardsList boards={boards} />
        )}
      </SettingsCard>
    </SettingsPage>
  )
}
