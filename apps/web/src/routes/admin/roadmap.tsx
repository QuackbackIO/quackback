import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import type { QueryClient } from '@tanstack/react-query'
import type { RoadmapId } from '@quackback/ids'
import { adminQueries } from '@/lib/client/queries/admin'
import { RoadmapAdmin } from '@/components/admin/roadmap-admin'
import { RoadmapModal } from '@/components/admin/roadmap-modal'
import { blankOmittedSearchKeys } from '@/lib/shared/route-search'
import { getFirstEnabledAdminProductPath, isProductEnabled } from '@/lib/shared/types/settings'

/** The URL params that filter the board's columns. */
const COLUMN_FILTER_PARAMS = ['search', 'board', 'tags', 'segments', 'sort'] as const

/**
 * Warm the board the URL opens: the roadmap list, and the first page of each
 * column of the roadmap shown (the one the URL names, else the first). A
 * filtered board, or a date roadmap's buckets, load on the page instead.
 */
async function warmRoadmapBoard(queryClient: QueryClient, search: Record<string, unknown>) {
  // Imported here rather than at the top: route loaders ship in the entry
  // chunk every page loads.
  const [{ roadmapListOptions }, { warmRoadmapColumns }] = await Promise.all([
    import('@/lib/client/hooks/use-roadmaps-query'),
    import('@/lib/client/hooks/use-roadmap-posts-query'),
  ])
  const roadmaps = await queryClient.ensureQueryData(roadmapListOptions())
  const selectedId = typeof search.roadmap === 'string' ? search.roadmap : roadmaps[0]?.id
  const roadmap = roadmaps.find((r) => r.id === selectedId)
  if (!roadmap || roadmap.type !== 'column') return
  if (COLUMN_FILTER_PARAMS.some((param) => search[param] !== undefined)) return
  await warmRoadmapColumns(queryClient, roadmap.id as RoadmapId, roadmap.columns, {})
}

const searchSchema = z.object({
  roadmap: z.string().optional(),
  post: z.string().optional(),
  search: z.string().optional(),
  board: z.array(z.string()).optional().catch(undefined),
  tags: z.array(z.string()).optional().catch(undefined),
  segments: z.array(z.string()).optional().catch(undefined),
  sort: z.enum(['votes', 'newest', 'oldest']).optional().catch(undefined),
})

export const Route = createFileRoute('/admin/roadmap')({
  validateSearch: (raw: Record<string, unknown>) =>
    blankOmittedSearchKeys(raw, searchSchema.parse(raw)),
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'feedback')) {
      throw redirect({ to: getFirstEnabledAdminProductPath(context.settings?.featureFlags) })
    }
  },
  loader: async ({ context, location }) => {
    const { queryClient } = context

    const { user, principal } = context as {
      user: NonNullable<typeof context.user>
      principal: NonNullable<typeof context.principal>
      queryClient: typeof context.queryClient
    }

    await Promise.all([
      queryClient.ensureQueryData(adminQueries.statuses()),
      queryClient.ensureQueryData(adminQueries.boards()),
      queryClient.ensureQueryData(adminQueries.tags()),
      queryClient.ensureQueryData(adminQueries.segments()),
      warmRoadmapBoard(queryClient, location.search as Record<string, unknown>).catch(
        () => undefined
      ),
    ])

    return {
      currentUser: {
        name: user.name,
        email: user.email,
        principalId: principal.id,
      },
    }
  },
  component: RoadmapPage,
})

function RoadmapPage() {
  const { currentUser } = Route.useLoaderData()
  const search = Route.useSearch()

  return (
    <main className="h-full">
      <RoadmapAdmin />
      <RoadmapModal postId={search.post} currentUser={currentUser} />
    </main>
  )
}
