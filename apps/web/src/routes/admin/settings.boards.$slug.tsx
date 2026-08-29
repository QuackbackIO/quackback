import { createFileRoute, Navigate, redirect } from '@tanstack/react-router'
import { useRef } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { adminQueries } from '@/lib/client/queries/admin'
import { settingsQueries } from '@/lib/client/queries/settings'
import {
  ChatBubbleLeftIcon,
  Cog6ToothIcon,
  LockClosedIcon,
  ShieldCheckIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/solid'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { BackLink } from '@/components/ui/back-link'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { BoardSettingsCrumb } from '@/components/admin/settings/channel-settings-crumb'
import { BoardGeneralForm } from '@/components/admin/settings/boards/board-general-form'
import { BoardAccessForm } from '@/components/admin/settings/boards/board-access-form'
import { BoardModerationForm } from '@/components/admin/settings/boards/board-moderation-form'
import { BoardImportSection } from '@/components/admin/settings/boards/board-import-section'
import { BoardExportSection } from '@/components/admin/settings/boards/board-export-section'
import { DeleteBoardForm } from '@/components/admin/settings/boards/delete-board-form'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { isProductEnabled } from '@/lib/shared/types/settings'

const BOARD_TABS = ['general', 'access', 'moderation', 'import', 'export'] as const
export type BoardTab = (typeof BOARD_TABS)[number]

const searchSchema = z.object({
  tab: z.enum(BOARD_TABS).optional(),
})

export const Route = createFileRoute('/admin/settings/boards/$slug')({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context, params }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.BOARD_MANAGE)
    const { queryClient } = context
    // Warm both queries the board forms read so they render with real data
    // on first paint (no flash). portalConfig backs the Moderation tab's
    // inherit-from-workspace pills and the Access tab's workspace ceiling;
    // without prefetch the moderation pills flicker Off -> the real default.
    const [cachedBoards] = await Promise.all([
      queryClient.ensureQueryData(adminQueries.boardsForSettings()),
      queryClient.ensureQueryData(settingsQueries.portalConfig()),
    ])
    let boards = cachedBoards
    if (!boards.some((b) => b.slug === params.slug)) {
      boards = await queryClient.fetchQuery(adminQueries.boardsForSettings())
    }
    if (!boards.some((b) => b.slug === params.slug)) {
      throw redirect({ to: '/admin/settings/boards' })
    }
    return {}
  },
  component: BoardSettingsPage,
})

function BoardSettingsPage() {
  const { slug } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: boards } = useSuspenseQuery(adminQueries.boardsForSettings())
  const matchedBoard = boards.find((b) => b.slug === slug)
  const lastBoardRef = useRef(matchedBoard)
  if (matchedBoard) lastBoardRef.current = matchedBoard
  // A rename updates the slug in the cached list before the form navigates
  // to the new URL. Keep showing the same board (by id) until that lands,
  // instead of bouncing to the list.
  const heldBoard = lastBoardRef.current
  const currentBoard =
    matchedBoard ?? (heldBoard && boards.some((b) => b.id === heldBoard.id) ? heldBoard : undefined)
  const selectedTab: BoardTab = tab ?? 'general'

  if (!currentBoard) {
    return <Navigate to="/admin/settings/boards" />
  }

  return (
    <div className="space-y-6 max-w-5xl w-full">
      <div className="lg:hidden">
        <BackLink to="/admin/settings/boards">Boards</BackLink>
      </div>
      <div className="space-y-1.5">
        <BoardSettingsCrumb page={currentBoard.name} />
        <PageHeader
          icon={ChatBubbleLeftIcon}
          title={currentBoard.name}
          description={currentBoard.description || undefined}
        />
      </div>

      <Tabs
        value={selectedTab}
        onValueChange={(next) => {
          const nextTab = next as BoardTab
          void navigate({
            search: { tab: nextTab === 'general' ? undefined : nextTab },
            replace: true,
          })
        }}
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
