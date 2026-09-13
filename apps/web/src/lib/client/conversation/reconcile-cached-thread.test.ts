import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { reconcileCachedThread } from './reconcile-cached-thread'

const key = ['thread', 'c1'] as const

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('reconcileCachedThread', () => {
  it('no-ops when the query was never created', () => {
    const queryClient = makeClient()
    reconcileCachedThread(queryClient, key, () => ({ n: 1 }))
    expect(queryClient.getQueryState(key)).toBeUndefined()
  })

  it('patches an existing cache', () => {
    const queryClient = makeClient()
    queryClient.setQueryData(key, { n: 1 })
    reconcileCachedThread(queryClient, key, (prev) => (prev ? { n: prev.n + 1 } : prev))
    expect(queryClient.getQueryData(key)).toEqual({ n: 2 })
  })

  it('cancels an in-flight prefetch so a late response cannot pin', async () => {
    const queryClient = makeClient()
    let resolve!: (value: { n: number }) => void
    const pending = new Promise<{ n: number }>((r) => {
      resolve = r
    })
    const prefetch = queryClient.prefetchQuery({ queryKey: key, queryFn: () => pending })
    expect(queryClient.getQueryState(key)?.data).toBeUndefined()

    reconcileCachedThread(queryClient, key, (prev) => prev)

    resolve({ n: 99 })
    await prefetch.catch(() => {})
    expect(queryClient.getQueryData(key)).toBeUndefined()
  })
})
