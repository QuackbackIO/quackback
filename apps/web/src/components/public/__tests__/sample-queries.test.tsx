// @vitest-environment happy-dom
/**
 * The designer's sample answers every query from the sample: a page's own
 * fetch never runs, whatever its options say, and no change is sent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import {
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { sampleContent } from '@/lib/server/domains/design/sample-content'
import { SampleQueries, sampleAnswers, sampleQueryClient } from '../sample-queries'

afterEach(cleanup)

const now = new Date('2026-11-02T12:00:00Z')

function wrapper(answers: (key: readonly unknown[]) => unknown) {
  const client = sampleQueryClient(answers)
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('sampleQueryClient', () => {
  it('answers a query from the sample and never runs its own fetch', async () => {
    const fetch = vi.fn(async () => ['from the server'])
    const { result } = renderHook(
      () => useQuery({ queryKey: ['portal', 'boards'], queryFn: fetch, staleTime: 0 }),
      { wrapper: wrapper(() => ['from the sample']) }
    )
    expect(result.current.data).toEqual(['from the sample'])
    await result.current.refetch()
    expect(result.current.data).toEqual(['from the sample'])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('draws a suspense query at once, without suspending', () => {
    const fetch = vi.fn(async () => 'server')
    function Shows() {
      const { data } = useSuspenseQuery({ queryKey: ['portal', 'tags'], queryFn: fetch })
      return <p>{data}</p>
    }
    render(<Shows />, { wrapper: wrapper(() => 'sample') })
    expect(screen.getByText('sample')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fails a query the sample has no answer for, still without fetching', async () => {
    const fetch = vi.fn(async () => 'server')
    const { result } = renderHook(() => useQuery({ queryKey: ['other'], queryFn: fetch }), {
      wrapper: wrapper(() => undefined),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('answers an infinite query and keeps the page given up front', () => {
    const fetch = vi.fn(async () => ({ items: ['server'] }))
    const { result } = renderHook(
      () =>
        useInfiniteQuery({
          queryKey: ['changelogs', 'public', 'list'],
          queryFn: fetch,
          initialPageParam: undefined as string | undefined,
          getNextPageParam: () => undefined,
        }),
      { wrapper: wrapper(() => ({ pages: [{ items: ['sample'] }], pageParams: [undefined] })) }
    )
    expect(result.current.data?.pages[0]).toEqual({ items: ['sample'] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends no change', async () => {
    const send = vi.fn(async () => 'sent')
    const { result } = renderHook(() => useMutation({ mutationFn: send }), {
      wrapper: wrapper(() => undefined),
    })
    await expect(result.current.mutateAsync()).rejects.toThrow(/sends nothing/)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('sampleAnswers', () => {
  it('answers the feed, its lists and the viewer’s votes from the feedback sample', () => {
    const sample = sampleContent('feedback', now)
    if (sample.page !== 'feedback') throw new Error('feedback')
    const answer = sampleAnswers(sample)
    const feed = answer(['portal', 'data', undefined, undefined, 'trending']) as {
      posts: { items: Array<{ createdAt: Date }> }
    }
    expect(feed.posts.items.length).toBeGreaterThan(0)
    expect(feed.posts.items[0]!.createdAt).toBeInstanceOf(Date)
    expect(answer(['portal', 'boards'])).toEqual(sample.feedback.boards)
    expect(answer(['votedPosts'])).toEqual(new Set())
    expect(answer(['admin', 'anything'])).toBeUndefined()
  })

  it('answers each roadmap column with its own posts', () => {
    const sample = sampleContent('roadmap', now)
    if (sample.page !== 'roadmap') throw new Error('roadmap')
    const answer = sampleAnswers(sample)
    const [roadmap] = sample.roadmap.roadmaps
    for (const column of roadmap!.columns) {
      const data = answer(['portal', 'roadmapPosts', roadmap!.id, column.statusId, {}]) as {
        pages: Array<{ items: Array<{ statusId: string }> }>
      }
      expect(data.pages[0]!.items.every((post) => post.statusId === column.statusId)).toBe(true)
    }
    expect(answer(['portal', 'roadmapPosts', roadmap!.id, 'sample_none', {}])).toBeUndefined()
  })

  it('answers the changelog’s entries and labels', () => {
    const sample = sampleContent('changelog', now)
    if (sample.page !== 'changelog') throw new Error('changelog')
    const answer = sampleAnswers(sample)
    const list = answer(['changelogs', 'public', 'list']) as { pages: Array<{ items: unknown[] }> }
    expect(list.pages[0]!.items).toEqual(sample.changelog.entries)
    expect(answer(['changelogs', 'categories'])).toEqual(sample.changelog.categories)
  })
})

describe('SampleQueries', () => {
  it('gives its children the sample’s client', () => {
    const sample = sampleContent('changelog', now)
    const fetch = vi.fn(async () => [])
    function Labels() {
      const { data } = useQuery({ queryKey: ['changelogs', 'categories'], queryFn: fetch })
      return <p>{(data as Array<{ name: string }>).map((label) => label.name).join(', ')}</p>
    }
    render(
      <SampleQueries sample={sample}>
        <Labels />
      </SampleQueries>
    )
    expect(screen.getByText('New, Improved')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })
})
