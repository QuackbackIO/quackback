import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'
import { adminQueries } from '@/lib/client/queries/admin'
import { settingsQueries } from '@/lib/client/queries/settings'
import { Squares2X2Icon, ChatBubbleLeftIcon } from '@heroicons/react/24/solid'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { BackLink } from '@/components/ui/back-link'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import { BoardSettingsHeader } from '@/components/admin/settings/boards/board-settings-header'
import { BoardSettingsNav } from '@/components/admin/settings/boards/board-settings-nav'
import { BoardGeneralForm } from '@/components/admin/settings/boards/board-general-form'
import { BoardAccessForm } from '@/components/admin/settings/boards/board-access-form'
import { BoardModerationForm } from '@/components/admin/settings/boards/board-moderation-form'
import { BoardImportSection } from '@/components/admin/settings/boards/board-import-section'
import { BoardExportSection } from '@/components/admin/settings/boards/board-export-section'
import { DeleteBoardForm } from '@/components/admin/settings/boards/delete-board-form'
import {
  useBoardSelection,
  type BoardTab,
} from '@/components/admin/settings/boards/use-board-selection'
import type { BoardId } from '@quackback/ids'

/** Board data as returned from server functions (dates serialized as strings) */
interface BoardForSettings {
  id: BoardId
  name: string
  slug: string
  description: string | null
  access: import('@/lib/shared/db-types').BoardAccess
}

const searchSchema = z.object({
  board: z.string().optional(),
  tab: z.enum(['general', 'access', 'moderation', 'import', 'export']).optional(),
})

export const Route = createFileRoute('/admin/settings/boards/')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const { queryClient } = context
    // Warm both queries the board forms read so they render with real data
    // on first paint (no flash). portalConfig backs the Moderation tab's
    // inherit-from-workspace pills and the Access tab's workspace ceiling;
    // without prefetch the moderation pills flicker Off -> the real default.
    await Promise.all([
      queryClient.ensureQueryData(adminQueries.boardsForSettings()),
      queryClient.ensureQueryData(settingsQueries.portalConfig()),
    ])
    return {}
  },
  component: BoardsSettingsPage,
})

function BoardsSettingsPage() {
  const { data: boards } = useSuspenseQuery(adminQueries.boardsForSettings())
  const { selectedBoardSlug, selectedTab, setSelectedBoard } = useBoardSelection()

  // Auto-select first board if none selected
  useEffect(() => {
    if (boards.length > 0 && !selectedBoardSlug) {
      setSelectedBoard(boards[0].slug)
    }
  }, [boards, selectedBoardSlug, setSelectedBoard])

  const currentBoard = boards.find((b) => b.slug === selectedBoardSlug)

  // No boards - show empty state
  if (boards.length === 0) {
    return <EmptyBoardsState />
  }

  // Board not found (invalid slug in URL)
  if (!currentBoard) {
    return null // Will auto-redirect via useEffect
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto w-full">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <BoardSettingsHeader currentBoard={currentBoard} allBoards={boards} />

      <div className="flex flex-col lg:flex-row gap-6">
        <BoardSettingsNav />

        <div className="flex-1 min-w-0 space-y-6">
          <BoardTabContent board={currentBoard} tab={selectedTab} />
        </div>
      </div>
    </div>
  )
}

interface BoardTabContentProps {
  board: BoardForSettings
  tab: BoardTab
}

function BoardTabContent({ board, tab }: BoardTabContentProps): ReactNode {
  switch (tab) {
    case 'general':
      return (
        <div className="space-y-6">
          <SettingsCard title="Board Details">
            <BoardGeneralForm key={board.id} board={board} />
          </SettingsCard>

          <SettingsCard title="Danger Zone" variant="danger">
            <DeleteBoardForm key={board.id} board={board} />
          </SettingsCard>
        </div>
      )

    case 'access':
      return (
        <SettingsCard title="Access Control">
          <BoardAccessForm key={board.id} board={board} />
        </SettingsCard>
      )

    case 'moderation':
      return (
        <SettingsCard title="Moderation">
          <BoardModerationForm key={board.id} board={board} />
        </SettingsCard>
      )

    case 'import':
      return (
        <SettingsCard
          title="Import Data"
          description="Import posts from a CSV file into this board"
        >
          <BoardImportSection boardId={board.id} />
        </SettingsCard>
      )

    case 'export':
      return (
        <SettingsCard title="Export Data" description="Download all posts from this board as CSV">
          <BoardExportSection boardId={board.id} />
        </SettingsCard>
      )
  }
}

function EmptyBoardsState() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Squares2X2Icon}
        title="Board Settings"
        description="Configure your feedback board settings and preferences"
      />

      <div className="rounded-xl border border-border/50 bg-card p-4 sm:p-6 shadow-sm">
        <EmptyState
          icon={ChatBubbleLeftIcon}
          title="No boards yet"
          description="Create your first feedback board to start collecting ideas from your users"
          action={<CreateBoardDialog />}
          className="py-8"
        />
      </div>
    </div>
  )
}
