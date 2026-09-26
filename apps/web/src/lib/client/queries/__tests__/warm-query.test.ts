import { QueryClient, queryOptions } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { warmQuery } from '../warm-query'

describe('warmQuery', () => {
  it('fills the cache with the read', async () => {
    const client = new QueryClient()
    const read = queryOptions({ queryKey: ['warm', 'ok'], queryFn: async () => 42 })

    await expect(warmQuery(client, read)).resolves.toBe(42)
    expect(client.getQueryData(read.queryKey)).toBe(42)
  })

  it('resolves undefined when the read fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const read = queryOptions({
      queryKey: ['warm', 'fails'],
      queryFn: async (): Promise<number> => {
        throw new Error('boom')
      },
    })

    await expect(warmQuery(client, read)).resolves.toBeUndefined()
  })

  it('reads through an ensure function when given one', async () => {
    const ensure = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('x')
    const read = queryOptions({ queryKey: ['warm', 'via'], queryFn: async () => 'x' })

    await expect(warmQuery(ensure, read)).resolves.toBeUndefined()
    await expect(warmQuery(ensure, read)).resolves.toBe('x')
    expect(ensure).toHaveBeenCalledWith(read)
  })
})
