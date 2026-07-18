import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { z } from 'zod'
import { adminQueries } from '@/lib/client/queries/admin'
import { settingsQueries } from '@/lib/client/queries/settings'
import {
  Squares2X2Icon,
  ChatBubbleLeftIcon,
  Cog6ToothIcon,
  LockClosedIcon,
  ShieldCheckIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/solid'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { BackLink } from '@/components/ui/back-link'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import { BoardSettingsHeader } from '@/components/admin/settings/boards/board-settings-header'
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
import { isProductEnabled } from '@/lib/shared/types/settings'

const searchSchema = z.object({
  board: z.string().optional(),
  tab: z.enum(['general', 'access', 'moderation', 'import', 'export']).optional(),
})

export const Route = createFileRoute('/admin/settings/boards/')({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
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
  const { selectedBoardSlug, selectedTab, setSelectedBoard, setSelectedTab } = useBoardSelection()

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
    <div className="space-y-6 max-w-5xl w-full">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <BoardSettingsHeader currentBoard={currentBoard} allBoards={boards} />

      <Tabs
        value={selectedTab}
        onValueChange={(next) => setSelectedTab(next as BoardTab)}
        variant="line"
        className="space-y-6"
      >
        <TabsList>
          <TabsTrigger value="general">
            <Cog6ToothIcon />
            General
          </TabsTrigger>
          <TabsTrigger value="access">
            <LockClosedIcon />
            Access
          </TabsTrigger>
          <TabsTrigger value="moderation">
            <ShieldCheckIcon />
            Moderation
          </TabsTrigger>
          <TabsTrigger value="import">
            <ArrowUpTrayIcon />
            Import Data
          </TabsTrigger>
          <TabsTrigger value="export">
            <ArrowDownTrayIcon />
            Export Data
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <SettingsCard>
            <BoardGeneralForm key={currentBoard.id} board={currentBoard} />
          </SettingsCard>

          <SettingsCard title="Danger Zone" variant="danger">
            <DeleteBoardForm key={currentBoard.id} board={currentBoard} />
          </SettingsCard>
        </TabsContent>

        <TabsContent value="access">
          <SettingsCard>
            <BoardAccessForm key={currentBoard.id} board={currentBoard} />
          </SettingsCard>
        </TabsContent>

        <TabsContent value="moderation">
          <SettingsCard>
            <BoardModerationForm key={currentBoard.id} board={currentBoard} />
          </SettingsCard>
        </TabsContent>

        <TabsContent value="import">
          <SettingsCard description="Import posts from a CSV file into this board">
            <BoardImportSection boardId={currentBoard.id} />
          </SettingsCard>
        </TabsContent>

        <TabsContent value="export">
          <SettingsCard description="Download all posts from this board as CSV">
            <BoardExportSection boardId={currentBoard.id} />
          </SettingsCard>
        </TabsContent>
      </Tabs>
    </div>
  )
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
