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
import { NewButton } from '@/components/shared/new-button'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import { FeedbackEmailCard } from '@/components/admin/settings/boards/feedback-email-card'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { adminPageHead } from '@/lib/client/admin-head'
import { seedAdminAreas } from '@/lib/shared/i18n'

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
    assertSettingsPageAccess(context.permissions, '/admin/settings/boards')
    // Loaded here, not imported above, so it stays out of every page's script.
    const { surfaceSenderQuery } = await import('@/lib/client/queries/channel-accounts')
    await Promise.all([
      context.queryClient.ensureQueryData(adminQueries.boardsWithCounts()),
      // The Email card's "Sent from" line, so it renders from the document.
      warmQuery(context.queryClient, surfaceSenderQuery('feedback')),
    ])
    return seedAdminAreas(context.personLocale, 'adminChannelSettings')
  },
  component: BoardsSettingsPage,
})

function BoardsSettingsPage() {
  const { data: boards } = useSuspenseQuery(adminQueries.boardsWithCounts())
  const planFrozen = boards.some((board) => board.planReadOnly !== undefined)
  const openBoards = boards.filter((board) => !board.readOnly && board.planReadOnly === undefined)
  // At the plan's cap a new board is refused, so the action says so up front.
  const atCap = boards.find((board) => board.atCap)?.atCap
  const newBoard = atCap ? (
    <NewButton
      noun="board"
      disabled
      title={
        atCap.planName
          ? `The ${atCap.planName} plan allows ${atCap.cap} boards.`
          : `Your workspace allows ${atCap.cap} boards.`
      }
    />
  ) : (
    <CreateBoardDialog />
  )

  return (
    <SettingsPage page="/admin/settings/boards" actions={boards.length > 0 ? newBoard : undefined}>
      <SettingsCard flush>
        {boards.length === 0 ? (
          <EmptyState
            size="compact"
            icon={ChatBubbleLeftIcon}
            title="No boards yet"
            description="Create a board to start collecting feedback."
            action={newBoard}
          />
        ) : (
          <BoardsList boards={boards} />
        )}
      </SettingsCard>
      {planFrozen && boards.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Read-only boards keep their posts visible. Nobody can post, vote or comment on them. You
          can still change statuses, merge, export, or move posts into{' '}
          {openBoards.length > 0
            ? openBoards.map((board) => board.name).join(', ')
            : 'an open board'}
          . To open another board instead,{' '}
          <a
            href="/admin/settings/billing/limits"
            className="font-medium text-foreground hover:underline"
          >
            change the open board
          </a>
          .
        </p>
      )}
      <FeedbackEmailCard />
    </SettingsPage>
  )
}
