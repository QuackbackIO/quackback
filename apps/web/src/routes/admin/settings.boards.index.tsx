import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'
import { adminQueries } from '@/lib/queries/admin'
import { Squares2X2Icon, ChatBubbleLeftIcon } from '@heroicons/react/24/solid'
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
import type { BoardId } from '@quackback/ids'

/** Board data as returned from server functions (dates serialized as strings) */
interface BoardForSettings {
  id: BoardId
  name: string
  slug: string
  description: string | null
  isPublic: boolean
}

const searchSchema = z.object({
  board: z.string().optional(),
  tab: z.enum(['general', 'access', 'import', 'export']).optional(),
})

export const Route = createFileRoute('/admin/settings/boards/')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.boardsForSettings())
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
    <div className="space-y-6">
      <BoardSettingsHeader currentBoard={currentBoard} allBoards={boards} />

      <div className="flex gap-8">
        <BoardSettingsNav />

        <div className="flex-1 space-y-6">
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
        <div className="space-y-8">
          <section className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
            <h2 className="text-base font-semibold mb-4">Board Details</h2>
            <BoardGeneralForm board={board} />
          </section>

          <section className="rounded-xl border border-destructive/20 bg-card p-6 shadow-sm">
            <h2 className="text-base font-semibold mb-4 text-destructive">Danger Zone</h2>
            <DeleteBoardForm board={board} />
          </section>
        </div>
      )

    case 'access':
      return (
        <section className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold mb-4">Access Control</h2>
          <BoardAccessForm board={board} />
        </section>
      )

    case 'import':
      return (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Import Data</h2>
            <p className="text-sm text-muted-foreground mt-1">
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
            <p className="text-sm text-muted-foreground mt-1">
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
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Squares2X2Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Board Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure your feedback board settings and preferences
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border/50 bg-card p-8 shadow-sm text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
          <ChatBubbleLeftIcon className="h-6 w-6 text-primary" />
        </div>
        <h2 className="font-semibold text-lg mb-1">No boards yet</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Create your first feedback board to start collecting ideas from your users
        </p>
        <CreateBoardDialog />
      </div>
    </div>
  )
}
