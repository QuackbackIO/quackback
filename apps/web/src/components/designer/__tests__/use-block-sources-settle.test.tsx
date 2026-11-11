// @vitest-environment happy-dom
/**
 * The picked block's lists load as four requests. Each one landing on its own
 * would draw the whole panel again, so the hook hands them over once all four
 * have settled, and still follows a later change to any of them.
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, queryOptions } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const pending = vi.hoisted(() => {
  const resolvers = new Map<string, (value: unknown) => void>()
  return {
    resolvers,
    load: (name: string) =>
      new Promise<unknown>((resolve) => {
        resolvers.set(name, resolve)
      }),
  }
})

const listQuery = (name: string) =>
  queryOptions({ queryKey: ['test', name], queryFn: () => pending.load(name) })

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    roadmaps: () => listQuery('roadmaps'),
    boardsForSettings: () => listQuery('boards'),
    statuses: () => listQuery('statuses'),
  },
}))
vi.mock('@/lib/client/queries/help-center', () => ({
  publicHelpCenterQueries: { categories: () => listQuery('categories') },
}))

const { settledSources, useBlockSources } = await import('../use-block-sources')

const LISTS = {
  roadmaps: [{ id: 'r1', name: 'Product', visibility: 'public' }],
  boards: [{ id: 'b1', name: 'Mobile', access: { view: 'anonymous' } }],
  categories: [{ id: 'c1', name: 'Getting started' }],
  statuses: [{ id: 's1', name: 'Complete', category: 'complete' }],
} as const

/** Lands one list, then lets TanStack Query's batched notifications run (a timer). */
async function land(name: keyof typeof LISTS) {
  await act(async () => {
    pending.resolvers.get(name)!(LISTS[name])
    await new Promise((done) => setTimeout(done, 20))
  })
}

function setup() {
  pending.resolvers.clear()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  let renders = 0
  const view = renderHook(
    () => {
      renders++
      return useBlockSources()
    },
    { wrapper }
  )
  return { client, view, renders: () => renders }
}

describe('useBlockSources', () => {
  it('draws once when all four lists have landed, not once per list', async () => {
    const { view, renders } = setup()
    await waitFor(() => expect(pending.resolvers.size).toBe(4))
    const before = renders()

    for (const name of ['roadmaps', 'boards', 'categories'] as const) await land(name)
    expect(renders()).toBe(before)
    expect(view.result.current.boards).toEqual([])

    await land('statuses')
    expect(view.result.current.boards).toEqual([['b1', 'Mobile']])
    expect(renders()).toBe(before + 1)
    expect(view.result.current.roadmaps).toEqual([['r1', 'Product']])
    expect(view.result.current.categories).toEqual([['c1', 'Getting started']])
    expect(view.result.current.shipped).toEqual(['s1'])
  })

  it('follows a list that changes after they have all landed', async () => {
    const { client, view } = setup()
    await waitFor(() => expect(pending.resolvers.size).toBe(4))
    for (const name of Object.keys(LISTS) as (keyof typeof LISTS)[]) await land(name)
    expect(view.result.current.boards).toEqual([['b1', 'Mobile']])

    act(() => {
      client.setQueryData(
        ['test', 'boards'],
        [...LISTS.boards, { id: 'b2', name: 'Web', access: { view: 'anonymous' } }]
      )
    })
    await waitFor(() =>
      expect(view.result.current.boards).toEqual([
        ['b1', 'Mobile'],
        ['b2', 'Web'],
      ])
    )
  })
})

describe('settledSources', () => {
  it('holds every list back while any one is still loading', () => {
    expect(
      settledSources([
        { data: ['a'], isPending: false },
        { data: undefined, isPending: true },
        { data: ['c'], isPending: false },
        { data: ['d'], isPending: false },
      ])
    ).toEqual({})
  })

  it('hands over what loaded once none is pending, a failed list as nothing', () => {
    expect(
      settledSources([
        { data: ['a'], isPending: false },
        { data: undefined, isPending: false },
        { data: ['c'], isPending: false },
        { data: ['d'], isPending: false },
      ])
    ).toEqual({ roadmaps: ['a'], boards: undefined, categories: ['c'], statuses: ['d'] })
  })
})
