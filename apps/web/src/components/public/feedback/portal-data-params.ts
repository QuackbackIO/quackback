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

/**
 * The filters the server's first page of posts was fetched for: the search as
 * the visitor sent it, with the feed's default sort when they named none. The
 * feed seeds itself from those posts (and their filter counts) only when its
 * own filters match these, so a feed whose default sort is not trending still
 * draws its posts and counts with the page instead of fetching them again.
 */
export function postsFetchedFor<T extends Pick<FeedSearch, 'sort'>>(
  searchParams: T,
  defaultSort: 'trending' | 'top' | 'new'
): T {
  return { ...searchParams, sort: searchParams.sort ?? defaultSort }
}
