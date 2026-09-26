/**
 * Reads that ride on another request (the panels beside a post or a thread):
 * which of them the request should carry, and filling each one's cache entry
 * from what it carried back.
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { readsToLoad, seedReads } from '../read-batch'

const entry = (name: string, staleTime?: number) => ({ queryKey: ['read', name], staleTime })

describe('readsToLoad', () => {
  it('asks for an empty entry or one not yet known, and never for a skipped one', () => {
    const client = new QueryClient()
    expect(readsToLoad(client, { empty: entry('empty'), unknown: null, skipped: 'skip' })).toEqual([
      'empty',
      'unknown',
    ])
  })

  it("leaves a fresh entry alone, and asks again once it is stale by the read's own time", () => {
    const client = new QueryClient()
    client.setQueryData(['read', 'fresh'], 1)
    client.setQueryData(['read', 'stale'], 1, { updatedAt: Date.now() - 10_000 })
    expect(
      readsToLoad(client, { fresh: entry('fresh', 60_000), stale: entry('stale', 5_000) })
    ).toEqual(['stale'])
  })

  it('leaves an entry already refetching to that fetch', async () => {
    const client = new QueryClient()
    client.setQueryData(['read', 'busy'], 1, { updatedAt: 0 })
    let finish!: () => void
    const refetch = client.fetchQuery({
      queryKey: ['read', 'busy'],
      queryFn: () => new Promise<number>((resolve) => (finish = () => resolve(2))),
    })
    expect(readsToLoad(client, { busy: entry('busy') })).toEqual([])
    finish()
    await refetch
  })
})

describe('seedReads', () => {
  it('fills the entry of each read loaded, null included, and nothing else', () => {
    const client = new QueryClient()
    seedReads(
      client,
      { some: entry('some'), none: entry('none'), absent: entry('absent'), unknown: null },
      { some: [1], none: null, unknown: 'dropped' }
    )
    expect(client.getQueryData(['read', 'some'])).toEqual([1])
    expect(client.getQueryState(['read', 'none'])?.status).toBe('success')
    expect(client.getQueryData(['read', 'none'])).toBeNull()
    expect(client.getQueryState(['read', 'absent'])).toBeUndefined()
    expect(client.getQueryCache().getAll()).toHaveLength(2)
  })
})
