import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { adminQueries } from '@/lib/client/queries/admin'
import { Squares2X2Icon, ChatBubbleLeftIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { BackLink } from '@/components/ui/back-link'
import { Badge } from '@/components/ui/badge'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { normalizeBoardAccess, presetForAccess } from '@/lib/shared/schemas/boards'
import type { BoardAccess } from '@/lib/shared/db-types'

const BOARD_TABS = ['general', 'access', 'moderation', 'import', 'export'] as const

const searchSchema = z.object({
  board: z.string().optional(),
  tab: z.enum(BOARD_TABS).optional(),
})

export const Route = createFileRoute('/admin/settings/boards/')({
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

  if (boards.length === 0) {
    return <EmptyBoardsState />
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={Squares2X2Icon}
        title="Boards"
        description="Where feedback is collected and organized."
        action={<CreateBoardDialog />}
      />

      <div className="divide-y divide-border rounded-xl border border-border/60 bg-card">
        {boards.map((board) => (
          <Link
            key={board.id}
            to="/admin/settings/boards/$slug"
            params={{ slug: board.slug }}
            className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"
          >
            <div className="flex min-w-0 items-center gap-3">
              <ChatBubbleLeftIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{board.name}</p>
                {board.description ? (
                  <p className="text-xs text-muted-foreground truncate">{board.description}</p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <BoardAccessBadge access={board.access} />
              <span className="text-xs text-muted-foreground tabular-nums">
                {board.postCount === 1 ? '1 post' : `${board.postCount} posts`}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function BoardAccessBadge({ access }: { access: BoardAccess }) {
  const preset = presetForAccess(normalizeBoardAccess(access))
  if (preset === 'public') return null
  return (
    <Badge size="sm" shape="pill" variant="secondary">
      {preset === 'private' ? (
        <>
          <LockClosedIcon />
          Team only
        </>
      ) : (
        'Custom'
      )}
    </Badge>
  )
}

function EmptyBoardsState() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={Squares2X2Icon}
        title="Boards"
        description="Where feedback is collected and organized."
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
