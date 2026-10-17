/**
 * Portal filter panel counts. The first set ships with fetchPortalData; this
 * refetches them when the viewer changes a filter.
 */
import { createServerFn } from '@tanstack/react-start'
import type { PostTagId } from '@quackback/ids'
import { listPublicPostsSchema, type ListPublicPostsInput } from '@/lib/shared/schemas/posts'
import { countPublicPostFacets } from '@/lib/server/domains/posts/post.public.facets'
import { teamOnlyFeedFilters } from '@/lib/server/domains/posts/post.public.team-filters'
import { getOptionalAuth, policyActorFromAuth } from './auth-helpers'
import { resolvePortalAccessForRequest } from './portal-access'

export const fetchPublicPostFacetsFn = createServerFn({ method: 'GET' })
  .validator(listPublicPostsSchema)
  .handler(async ({ data }: { data: ListPublicPostsInput }) => {
    const access = await resolvePortalAccessForRequest()
    if (!access.granted) return null
    const actor = await policyActorFromAuth(await getOptionalAuth())
    return countPublicPostFacets(
      {
        boardSlug: data.boardSlug,
        search: data.search,
        statusSlugs: data.statusSlugs,
        tagIds: data.tagIds as PostTagId[] | undefined,
        minVotes: data.minVotes,
        dateFrom: data.dateFrom,
        responded: data.responded,
        view: data.view,
        portalFeed: true,
        ...teamOnlyFeedFilters(actor, data),
      },
      actor
    )
  })
