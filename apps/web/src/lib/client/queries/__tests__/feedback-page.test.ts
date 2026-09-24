/**
 * The admin feedback route warms everything its page renders on first paint,
 * so the server-rendered page is complete and the browser has nothing left to
 * fetch: the list and its facet counts, the reference data, the segment filter
 * and the viewer's own votes (the rows' vote buttons).
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

const calls: string[] = []
function stub<T>(name: string, value: T) {
  return () => {
    calls.push(name)
    return Promise.resolve(value)
  }
}

vi.mock('@/lib/server/functions/posts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/posts')>()),
  fetchInboxPostsForAdmin: stub('list', {
    items: [],
    nextCursor: null,
    hasMore: false,
    duplicateCounts: [],
  }),
  fetchInboxFilterCounts: stub('facets', {}),
}))
vi.mock('@/lib/server/functions/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/admin')>()),
  fetchTagsList: stub('tags', []),
  fetchStatusesList: stub('statuses', []),
  fetchTeamMembers: stub('members', []),
  listSegmentsFn: stub('segments', [{ id: 'segment_1' }]),
}))
vi.mock('@/lib/server/functions/boards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/boards')>()),
  fetchBoardsFn: stub('boards', []),
}))
vi.mock('@/lib/server/functions/merge-suggestions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/merge-suggestions')>()),
  fetchMergeSuggestionSummaryFn: stub('summary', { count: 0 }),
}))
vi.mock('@/lib/server/functions/moderation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/moderation')>()),
  getModerationStatus: stub('moderation', {}),
}))
vi.mock('@/lib/server/functions/public-posts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/public-posts')>()),
  getVotedPostsFn: stub('voted', { votedPostIds: ['post_1'] }),
}))

const { warmFeedbackPage } = await import('../feedback-page')
const { adminQueries } = await import('../admin')
const { votedPostsKeys } = await import('@/lib/client/hooks/use-portal-posts-query')

let client: QueryClient
beforeEach(() => {
  calls.length = 0
  client = new QueryClient()
})

describe('warmFeedbackPage', () => {
  it('warms the segment filter and the viewer votes with the rest of the page', async () => {
    await warmFeedbackPage(client, [PERMISSIONS.SEGMENT_VIEW])

    expect(client.getQueryData(adminQueries.segments().queryKey)).toEqual([{ id: 'segment_1' }])
    expect(client.getQueryData(votedPostsKeys.byWorkspace())).toEqual(new Set(['post_1']))
    expect(calls.sort()).toEqual(
      [
        'boards',
        'facets',
        'list',
        'members',
        'moderation',
        'segments',
        'statuses',
        'summary',
        'tags',
        'voted',
      ].sort()
    )
  })

  it('leaves the segments to the page without segment.view', async () => {
    await warmFeedbackPage(client, [])

    expect(calls).not.toContain('segments')
    expect(client.getQueryData(adminQueries.segments().queryKey)).toBeUndefined()
  })
})
