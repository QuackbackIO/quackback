import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'
import { adminQueries } from '@/lib/client/queries/admin'
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
import { BoardImportSection } from '@/components/admin/settings/boards/board-import-section'
import { BoardExportSection } from '@/components/admin/settings/boards/board-export-section'
import { DeleteBoardForm } from '@/components/admin/settings/boards/delete-board-form'
import {
  useBoardSelection,
  type BoardTab,
} from '@/components/admin/settings/boards/use-board-selection'
import type { BoardId, PrincipalId, UserId } from '@quackback/ids'
import { isAdmin } from '@/lib/shared/roles'

/** Board data as returned from server functions (dates serialized as strings) */
interface BoardForSettings {
  id: BoardId
  name: string
  slug: string
  description: string | null
  audience: import('@/lib/shared/db-types').BoardAudience
}

const searchSchema = z.object({
  board: z.string().optional(),
  tab: z.enum(['general', 'access', 'import', 'export']).optional(),
})

export const Route = createFileRoute('/admin/settings/boards/')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const { queryClient, principal } = context
    await queryClient.ensureQueryData(adminQueries.boardsForSettings())
    // Role gates the access-control form. Members see a read-only
    // audience summary; admins see the editable form.
    return {
      currentMember: principal as { id: PrincipalId; role: 'admin' | 'member'; userId: UserId },
    }
  },
  component: BoardsSettingsPage,
})

function BoardsSettingsPage() {
  const { data: boards } = useSuspenseQuery(adminQueries.boardsForSettings())
  const { currentMember } = Route.useLoaderData()
  const canEditAccess = isAdmin(currentMember.role)
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
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <BoardSettingsHeader currentBoard={currentBoard} allBoards={boards} />

      <div className="flex flex-col lg:flex-row gap-8">
        <BoardSettingsNav />

        <div className="flex-1 space-y-6">
          <BoardTabContent board={currentBoard} tab={selectedTab} canEditAccess={canEditAccess} />
        </div>
      </div>
    </div>
  )
}

interface BoardTabContentProps {
  board: BoardForSettings
  tab: BoardTab
  canEditAccess: boolean
}

function BoardTabContent({ board, tab, canEditAccess }: BoardTabContentProps): ReactNode {
  switch (tab) {
    case 'general':
      return (
        <div className="space-y-8">
          <SettingsCard title="Board Details">
            <BoardGeneralForm board={board} />
          </SettingsCard>

          <SettingsCard title="Danger Zone" variant="danger">
            <DeleteBoardForm board={board} />
          </SettingsCard>
        </div>
      )

    case 'access':
      return (
        <SettingsCard title="Access Control">
          <BoardAccessForm key={board.id} board={board} canEdit={canEditAccess} />
        </SettingsCard>
      )

    case 'import':
      return (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Import Data</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Import posts from a CSV file into this board
            </p>
          </div>
          <BoardImportSection boardId={board.id} />
        </div>
      )

    case 'export':
      return (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Export Data</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Download all posts from this board as CSV
            </p>
          </div>
          <BoardExportSection boardId={board.id} />
        </div>
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

      <div className="rounded-xl border border-border/50 bg-card p-8 shadow-sm">
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
