import { useMemo } from 'react'
import { useQueries, type QueryObserverResult } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import type { BlockSources } from './block-settings-panel'

type Named = { id: string; name: string }
type Column = { name: string; statusId?: string | null }

/**
 * What a block can point at, as the portal shows it to a signed-out visitor:
 * public roadmaps and their columns, top-level help topics, and boards
 * anyone can view. The columns are those of the roadmap the block shows: its
 * own, or the first public one.
 */
export function blockSources({
  roadmaps = [],
  boards = [],
  categories = [],
  statuses = [],
  roadmapId = null,
}: {
  roadmaps?: ReadonlyArray<Named & { visibility: string; columns?: readonly Column[] }>
  boards?: ReadonlyArray<Named & { access?: { view?: string } | null }>
  categories?: ReadonlyArray<Named & { parentId?: string | null }>
  statuses?: ReadonlyArray<Named>
  roadmapId?: string | null
}): Required<BlockSources> {
  const pair = (each: Named) => [each.id, each.name] as const
  const open = roadmaps.filter((roadmap) => roadmap.visibility === 'public')
  const shown = open.find((roadmap) => roadmap.id === roadmapId) ?? open[0]
  return {
    roadmaps: open.map(pair),
    boards: boards.filter((board) => board.access?.view === 'anonymous').map(pair),
    // A sub-topic is never drawn on its own, so only top-level ones are offered.
    categories: categories.filter((category) => !category.parentId).map(pair),
    columns: (shown?.columns ?? []).flatMap((column) =>
      column.statusId ? [[column.statusId, column.name] as const] : []
    ),
    statuses: statuses.map(pair),
  }
}

/**
 * The four lists, once every one of them has settled; until then, none. They
 * load as four requests that land at different moments, and each landing
 * would draw the whole picked block's panel again, so they arrive as one.
 */
export function settledSources(
  results: ReadonlyArray<Pick<QueryObserverResult, 'data' | 'isPending'>>
): { roadmaps?: unknown; boards?: unknown; categories?: unknown; statuses?: unknown } {
  if (results.some((result) => result.isPending)) return {}
  const [roadmaps, boards, categories, statuses] = results.map((result) => result.data)
  return { roadmaps, boards, categories, statuses }
}

/**
 * The workspace's roadmaps, boards, help topics and statuses, for the picked
 * block's settings, and the shipped statuses, for Top posts' "Recently shipped".
 */
export function useBlockSources(
  roadmapId: string | null = null
): Required<BlockSources> & { shipped?: readonly string[] } {
  // The combined value keeps its identity until it changes, and a change to
  // it alone draws again (TanStack Query compares it deeply).
  const { roadmaps, boards, categories, statuses } = useQueries({
    queries: [
      adminQueries.roadmaps(),
      adminQueries.boardsForSettings(),
      publicHelpCenterQueries.categories(),
      adminQueries.statuses(),
    ],
    combine: settledSources,
  }) as {
    roadmaps?: Parameters<typeof blockSources>[0]['roadmaps']
    boards?: Parameters<typeof blockSources>[0]['boards']
    categories?: Parameters<typeof blockSources>[0]['categories']
    statuses?: ReadonlyArray<Named & { category: string }>
  }
  return useMemo(
    () => ({
      ...blockSources({ roadmaps, boards, categories, statuses, roadmapId }),
      shipped: shippedStatusIds(statuses),
    }),
    [roadmaps, boards, categories, statuses, roadmapId]
  )
}

/** The statuses posts are shipped in: those in the complete category, for "Recently shipped". */
export function shippedStatusIds(
  statuses: ReadonlyArray<{ id: string; category: string }> | undefined
): string[] {
  return (statuses ?? []).filter((status) => status.category === 'complete').map((s) => s.id)
}
