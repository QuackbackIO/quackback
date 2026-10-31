/**
 * Starts the queries Home's blocks read, without waiting on them, so the
 * blocks stream into the first response as the feed does. Loaded only when
 * the portal starts on Home.
 */
import type { QueryClient } from '@tanstack/react-query'
import { loadAreaMessages, type SupportedLocale } from '@/lib/shared/i18n'
import { portalQueries } from '@/lib/client/queries/portal'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import { publicStatusPageQueries } from '@/lib/client/queries/status'
import { listPopularPublicArticlesFn } from '@/lib/server/functions/help-center'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'

/** The popular articles a Help search block lists. */
export const popularArticlesQuery = () => ({
  queryKey: ['help-center', 'public', 'popular', 5] as const,
  queryFn: () => listPopularPublicArticlesFn({ data: { limit: 5 } }),
  staleTime: 5 * 60 * 1000,
})

/** The strings Home's help and status blocks speak, which stay out of the catalog every page seeds. */
export type HomeAreaMessages = Partial<Record<'helpCenter' | 'statusPage', Record<string, string>>>

/** Starts the blocks' data and loads their pages' strings, for the route loader. */
export async function loadHome(
  queryClient: QueryClient,
  blocks: PortalDesign['pages']['home']['blocks'],
  gates: PortalPageGates,
  locale: SupportedLocale
): Promise<HomeAreaMessages> {
  prefetchHome(queryClient, blocks, gates)
  const areas = [
    blocks.some((block) => block.type === 'help_search' || block.type === 'help_topics') &&
      ('helpCenter' as const),
    blocks.some((block) => block.type === 'status') && ('statusPage' as const),
  ].filter((area): area is 'helpCenter' | 'statusPage' => !!area)
  const loaded = await Promise.all(areas.map((area) => loadAreaMessages(locale, area)))
  return Object.fromEntries(areas.map((area, index) => [area, loaded[index]]))
}

export function prefetchHome(
  queryClient: QueryClient,
  blocks: PortalDesign['pages']['home']['blocks'],
  gates: PortalPageGates
): void {
  for (const block of blocks) {
    if (block.type === 'ideas' && gates.feedback) {
      void queryClient.prefetchQuery(portalQueries.posts({ sort: block.sort }))
      void queryClient.prefetchQuery(portalQueries.statuses())
    }
    if (block.type === 'roadmap' && gates.roadmap)
      void queryClient.prefetchQuery(portalQueries.roadmaps())
    if (block.type === 'updates' && gates.changelog)
      void queryClient.prefetchInfiniteQuery(publicChangelogQueries.list())
    if (block.type === 'help_search' && gates.help)
      void queryClient.prefetchQuery(popularArticlesQuery())
    if (block.type === 'help_topics' && gates.help)
      void queryClient.prefetchQuery(publicHelpCenterQueries.categories())
    if (block.type === 'status' && gates.status)
      void queryClient.prefetchQuery(publicStatusPageQueries.get())
  }
}
