import { createFileRoute, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { RoadmapPageView } from '@/components/public/roadmap-page'
import { portalQueries } from '@/lib/client/queries/portal'
import { readBatch } from '@/lib/client/queries/read-batch'
import { isProductEnabled } from '@/lib/shared/types/settings'
import {
  headSettings,
  pageShareMeta,
  pageTitle,
  portalHeadWords,
  portalSiteName,
} from '@/lib/shared/portal-head'

const searchSchema = z.object({
  roadmap: z.string().optional(),
  search: z.string().optional(),
  board: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  segments: z.array(z.string()).optional(),
  sort: z.enum(['votes', 'newest', 'oldest']).optional(),
})

/** The roadmap's search: the roadmap shown and its filters, kept in the URL. */
export type RoadmapSearch = z.infer<typeof searchSchema>

export const Route = createFileRoute('/_portal/roadmap/')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const { queryClient, settings, baseUrl, userRole } = context
    if (!isProductEnabled(settings?.featureFlags, 'feedback')) throw notFound()

    // The shell's lists in one request; the columns ask for their posts once it renders.
    const ensure = readBatch(queryClient)
    const [roadmaps] = await Promise.all([
      ensure(portalQueries.roadmaps()),
      ensure(portalQueries.statuses()),
      ensure(portalQueries.boards()),
      ensure(portalQueries.tags()),
    ])

    return {
      firstRoadmapId: roadmaps[0]?.id ?? null,
      workspaceName: settings?.name ?? 'Quackback',
      baseUrl: baseUrl ?? '',
      userRole: userRole ?? null,
    }
  },
  head: ({ loaderData, matches }) => {
    if (!loaderData) return {}
    const { baseUrl } = loaderData
    const settings = headSettings(matches)
    const title = pageTitle(settings, 'roadmap')
    const description = portalHeadWords(settings).roadmap(portalSiteName(settings))
    const canonicalUrl = baseUrl ? `${baseUrl}/roadmap` : ''
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        ...(canonicalUrl ? [{ property: 'og:url', content: canonicalUrl }] : []),
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        ...pageShareMeta(settings, baseUrl, 'roadmap'),
      ],
      links: canonicalUrl ? [{ rel: 'canonical', href: canonicalUrl }] : [],
    }
  },
  component: RoadmapPage,
})

function RoadmapPage() {
  const { firstRoadmapId, userRole } = Route.useLoaderData()
  const { roadmap: selectedRoadmapFromUrl } = Route.useSearch()
  const { data: roadmaps } = useSuspenseQuery(portalQueries.roadmaps())
  return (
    <RoadmapPageView
      roadmaps={roadmaps}
      // The URL's roadmap, else the first.
      selectedId={selectedRoadmapFromUrl ?? firstRoadmapId}
      isTeamMember={userRole === 'admin' || userRole === 'member'}
    />
  )
}
