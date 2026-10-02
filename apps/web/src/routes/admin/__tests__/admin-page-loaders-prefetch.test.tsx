// @vitest-environment happy-dom
/**
 * The moderation queue and the help center article list are warmed by their
 * route loaders, so the server-rendered page is complete and the browser
 * fetches nothing more for them after hydration. The reads mounted here use
 * the same query definitions as the pages, with the arguments the pages derive
 * from the URL, so a read the loader misses (or warms under different
 * arguments) shows up as a fetch on mount.
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
function stub<T>(name: string, value: T) {
  return () => {
    calls.push(name)
    return Promise.resolve(value)
  }
}

vi.mock('@/lib/server/functions/moderation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/moderation')>()),
  listPendingPostsFn: stub('pendingPosts', { posts: [] }),
  listPendingCommentsFn: stub('pendingComments', { comments: [] }),
}))
vi.mock('@/lib/server/functions/posts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/posts')>()),
  fetchInboxFilterCounts: stub('facetCounts', {}),
}))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    segments: () => ({ queryKey: ['admin', 'segments'], queryFn: stub('segments', []) }),
    boards: () => ({ queryKey: ['admin', 'boards'], queryFn: stub('boards', []) }),
    tags: () => ({ queryKey: ['admin', 'tags'], queryFn: stub('tags', []) }),
    statuses: () => ({ queryKey: ['admin', 'statuses'], queryFn: stub('statuses', []) }),
  },
}))
vi.mock('@/lib/server/functions/help-center', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/help-center')>()),
  listCategoriesFn: stub('categories', []),
  listArticlesFn: stub('articles', { items: [], nextCursor: null }),
}))

const { moderationQueueQueries } = await import('@/lib/client/queries/moderation')
const { adminQueries } = await import('@/lib/client/queries/admin')
const { defaultInboxFilters, inboxFacetCountsOptions } =
  await import('@/lib/client/hooks/use-inbox-query')
const { helpCenterQueries } = await import('@/lib/client/queries/help-center')

type Loader = (ctx: {
  context: Record<string, unknown>
  location: { search: Record<string, unknown> }
}) => Promise<unknown>
async function loaderOf(path: string): Promise<Loader> {
  const { Route } = await import(/* @vite-ignore */ path)
  return (Route as { options: { loader: Loader } }).options.loader
}

let client: QueryClient
beforeEach(() => {
  calls.length = 0
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** Run a route's loader for a URL, then mount the page's reads and list what they fetched. */
async function fetchesAfterLoader(
  path: string,
  search: Record<string, unknown>,
  useReads: () => void,
  permissions: string[] = []
) {
  const loader = await loaderOf(path)
  await loader({ context: { queryClient: client, permissions }, location: { search } })
  const warmed = [...calls].sort()
  calls.length = 0
  renderHook(useReads, { wrapper })
  await waitFor(() => expect(client.isFetching()).toBe(0))
  return { warmed, afterMount: [...calls] }
}

describe('admin list loaders', () => {
  const moderationReads = () => {
    useQuery(moderationQueueQueries.posts())
    useQuery(moderationQueueQueries.comments())
    useQuery(adminQueries.boards())
    useQuery(adminQueries.tags())
    useQuery(adminQueries.statuses())
    useQuery(inboxFacetCountsOptions(defaultInboxFilters))
  }

  it('/admin/feedback/moderation warms the queue and the feedback pane', async () => {
    const { warmed, afterMount } = await fetchesAfterLoader(
      '@/routes/admin/feedback.moderation',
      {},
      moderationReads
    )
    expect(afterMount).toEqual([])
    expect(warmed).toEqual([
      'boards',
      'facetCounts',
      'pendingComments',
      'pendingPosts',
      'statuses',
      'tags',
    ])
  })

  it('/admin/feedback/moderation warms the segment filter for a viewer who can see segments', async () => {
    const { warmed, afterMount } = await fetchesAfterLoader(
      '@/routes/admin/feedback.moderation',
      {},
      () => {
        moderationReads()
        useQuery(adminQueries.segments())
      },
      ['segment.view']
    )
    expect(afterMount).toEqual([])
    expect(warmed).toContain('segments')
  })

  it('/admin/help-center warms the article list the finder reads', async () => {
    const { warmed, afterMount } = await fetchesAfterLoader(
      '@/routes/admin/help-center.index',
      { status: 'published', sort: 'oldest' },
      () => {
        useQuery(helpCenterQueries.categories())
        useInfiniteQuery(
          helpCenterQueries.articleList({
            categoryId: undefined,
            status: 'published',
            search: undefined,
            sort: 'oldest',
          })
        )
      }
    )
    expect(afterMount).toEqual([])
    expect(warmed).toEqual(['articles', 'categories'])
  })

  it('/admin/help-center?deleted=true leaves the article list to the deleted view', async () => {
    const loader = await loaderOf('@/routes/admin/help-center.index')
    await loader({ context: { queryClient: client }, location: { search: { deleted: true } } })
    expect(calls).toEqual(['categories'])
  })
})
