// @vitest-environment happy-dom
/**
 * A vote leaves the card where it is in every feed, and marks the Voted view
 * stale so it shows what the viewer voted on the next time it's shown.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PostId } from '@quackback/ids'
import { publicPostsKeys } from '@/lib/client/hooks/use-portal-posts-query'

vi.mock('@/lib/server/functions/public-posts', () => ({
  toggleVoteFn: vi.fn(async () => ({ voted: false, voteCount: 2 })),
  createPublicPostFn: vi.fn(),
  userEditPostFn: vi.fn(),
  userDeletePostFn: vi.fn(),
}))

const { useVoteMutation } = await import('../portal-posts')

const POST = 'post_aaaaaaaaaaaaaaaaaaaaaaaaaa' as PostId

function feed() {
  return {
    pages: [{ items: [{ id: POST, voteCount: 3 }], total: 1, hasMore: false }],
    pageParams: [1],
  }
}

describe('useVoteMutation', () => {
  it('keeps the card and marks only the Voted view stale', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    const votedKey = publicPostsKeys.list({ view: 'voted' })
    const allKey = publicPostsKeys.list({})
    client.setQueryData(votedKey, feed())
    client.setQueryData(allKey, feed())

    const { result } = renderHook(() => useVoteMutation(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    })
    await act(() => result.current.mutateAsync(POST))

    expect(client.getQueryState(votedKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(allKey)?.isInvalidated).toBe(false)
    const voted = client.getQueryData<ReturnType<typeof feed>>(votedKey)
    expect(voted?.pages[0]?.items).toEqual([{ id: POST, voteCount: 2 }])
  })
})
