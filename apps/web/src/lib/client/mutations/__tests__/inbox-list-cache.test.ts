import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { PostId } from '@quackback/ids'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import {
  isInboxInfiniteList,
  removePostFromInboxLists,
  updatePostInInboxLists,
} from '../inbox-list-cache'
import type { InboxPostListResult, PostListItem } from '@/lib/shared/db-types'

const POST_A = 'post_aaaaaaaaaaaaaaaaaaaaaaaaaa' as PostId
const POST_B = 'post_bbbbbbbbbbbbbbbbbbbbbbbbbb' as PostId

function listItem(id: PostId, title: string): PostListItem {
  return { id, title } as PostListItem
}

function infiniteList(items: PostListItem[]) {
  return {
    pages: [{ items, nextCursor: null, hasMore: false } satisfies InboxPostListResult],
    pageParams: [undefined],
  }
}

describe('isInboxInfiniteList', () => {
  it('accepts infinite list pages', () => {
    expect(isInboxInfiniteList(infiniteList([listItem(POST_A, 'One')]))).toBe(true)
  })

  it('rejects facet-count payloads and other non-page entries', () => {
    expect(isInboxInfiniteList(undefined)).toBe(false)
    expect(isInboxInfiniteList({ statuses: { open: 2 }, boards: {} })).toBe(false)
    expect(isInboxInfiniteList({ pages: [{ items: undefined }] })).toBe(false)
    expect(isInboxInfiniteList({ pages: [null] })).toBe(false)
  })
})

describe('updatePostInInboxLists', () => {
  it('patches the matching list row and leaves sibling prefix entries untouched', () => {
    const queryClient = new QueryClient()
    const listKey = inboxKeys.list({})
    const facetKey = inboxKeys.facetCounts({})
    const facets = { statuses: { open: 1 }, boards: {}, tags: {} }

    queryClient.setQueryData(
      listKey,
      infiniteList([listItem(POST_A, 'Before'), listItem(POST_B, 'Other')])
    )
    queryClient.setQueryData(facetKey, facets)

    expect(() => {
      updatePostInInboxLists(queryClient, POST_A, (post) => ({ ...post, title: 'After' }))
    }).not.toThrow()

    const list = queryClient.getQueryData<ReturnType<typeof infiniteList>>(listKey)
    expect(list?.pages[0]?.items.map((p) => p.title)).toEqual(['After', 'Other'])
    expect(queryClient.getQueryData(facetKey)).toEqual(facets)
  })
})

describe('removePostFromInboxLists', () => {
  it('drops the post from list pages without touching sibling prefix entries', () => {
    const queryClient = new QueryClient()
    const listKey = inboxKeys.list({})
    const facetKey = inboxKeys.facetCounts({})
    const facets = { statuses: { open: 1 } }

    queryClient.setQueryData(
      listKey,
      infiniteList([listItem(POST_A, 'Keep-me-not'), listItem(POST_B, 'Stay')])
    )
    queryClient.setQueryData(facetKey, facets)

    expect(() => {
      removePostFromInboxLists(queryClient, POST_A)
    }).not.toThrow()

    const list = queryClient.getQueryData<ReturnType<typeof infiniteList>>(listKey)
    expect(list?.pages[0]?.items.map((p) => p.id)).toEqual([POST_B])
    expect(queryClient.getQueryData(facetKey)).toEqual(facets)
  })
})
