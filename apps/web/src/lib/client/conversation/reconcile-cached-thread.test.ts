import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { reconcileCachedThread } from './reconcile-cached-thread'

const key = ['thread', 'c1'] as const

type Row = { n: number }

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('reconcileCachedThread', () => {
  it('no-ops when the query was never created', () => {
    const queryClient = makeClient()
    reconcileCachedThread<Row>(queryClient, key, () => ({ n: 1 }))
    expect(queryClient.getQueryState(key)).toBeUndefined()
  })

  it('patches an existing cache', () => {
    const queryClient = makeClient()
    queryClient.setQueryData<Row>(key, { n: 1 })
    reconcileCachedThread<Row>(queryClient, key, (prev) => (prev ? { n: prev.n + 1 } : prev))
    expect(queryClient.getQueryData(key)).toEqual({ n: 2 })
  })

  it('cancels an in-flight prefetch so a late response cannot pin', async () => {
    const queryClient = makeClient()
    let resolve!: (value: Row) => void
    const pending = new Promise<Row>((r) => {
      resolve = r
    })
    const prefetch = queryClient.prefetchQuery({ queryKey: key, queryFn: () => pending })
    expect(queryClient.getQueryState(key)?.data).toBeUndefined()

    reconcileCachedThread<Row>(queryClient, key, (prev) => prev)

    resolve({ n: 99 })
    await prefetch.catch(() => {})
    expect(queryClient.getQueryData(key)).toBeUndefined()
  })

  it('does not cancel a mounted in-flight fetch; applies after it settles', async () => {
    const queryClient = makeClient()
    let resolve!: (value: Row) => void
    const pending = new Promise<Row>((r) => {
      resolve = r
    })
    const observer = new QueryObserver<Row>(queryClient, {
      queryKey: key,
      queryFn: () => pending,
    })
    const unsubscribe = observer.subscribe(() => {})
    expect(queryClient.getQueryState(key)?.data).toBeUndefined()
    expect(
      queryClient.getQueryCache().find({ queryKey: key })?.getObserversCount()
    ).toBeGreaterThan(0)

    reconcileCachedThread<Row>(queryClient, key, (prev) => (prev ? { n: prev.n + 1 } : prev))

    resolve({ n: 10 })
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(key)).toEqual({ n: 11 })
    })
    unsubscribe()
  })

  it('reapplies after a stale-cache refetch so the response cannot drop the event', async () => {
    const queryClient = makeClient()
    queryClient.setQueryData<Row>(key, { n: 1 })
    let resolve!: (value: Row) => void
    const pending = new Promise<Row>((r) => {
      resolve = r
    })
    const refetch = queryClient.fetchQuery({ queryKey: key, queryFn: () => pending })
    expect(queryClient.getQueryState(key)?.fetchStatus).toBe('fetching')

    reconcileCachedThread<Row>(queryClient, key, (prev) => (prev ? { n: prev.n + 1 } : prev))
    expect(queryClient.getQueryData(key)).toEqual({ n: 2 })

    resolve({ n: 10 })
    await refetch
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(key)).toEqual({ n: 11 })
    })
  })
})
