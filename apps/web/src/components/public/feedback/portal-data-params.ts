import type { FeedSearch } from '@/components/public/feedback/feed-route'

// Kept apart from feed-page.tsx: the feedback route's loader uses it, and
// importing it from the page would pull the whole feed into the entry chunk.
/** Build the portalData query params from the current search + session. */
export function portalDataParams(
  searchParams: FeedSearch,
  userId: string | undefined,
  defaultSort: 'trending' | 'top' | 'new'
) {
  return {
    boardSlug: searchParams.board,
    search: searchParams.search,
    sort: searchParams.sort ?? defaultSort,
    statusSlugs: searchParams.status?.length ? searchParams.status : undefined,
    tagIds: searchParams.tagIds?.length ? searchParams.tagIds : undefined,
    userId,
    minVotes: searchParams.minVotes,
    dateFrom: searchParams.dateFrom,
    responded: searchParams.responded,
    owner: searchParams.owner,
    segmentIds: searchParams.segmentIds?.length ? searchParams.segmentIds : undefined,
    view: searchParams.view,
  }
}
