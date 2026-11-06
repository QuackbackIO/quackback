import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStarCountReader } from '../github-star-count'

const ok = (stars: number) =>
  new Response(JSON.stringify({ stargazers_count: stars }), { status: 200 })

describe('the GitHub star count', () => {
  let now = 0
  beforeEach(() => {
    now = 1_000_000
  })
  afterEach(() => vi.restoreAllMocks())

  it('reads the repo once an hour', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok(341)).mockResolvedValueOnce(ok(342))
    const read = createStarCountReader({ fetcher, now: () => now })
    expect(await read()).toBe(341)
    now += 59 * 60 * 1000
    expect(await read()).toBe(341)
    expect(fetcher).toHaveBeenCalledTimes(1)
    now += 2 * 60 * 1000
    expect(await read()).toBe(342)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('shows no count when GitHub cannot be reached, and waits before asking again', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(ok(400))
    const read = createStarCountReader({ fetcher, now: () => now })
    expect(await read()).toBeNull()
    now += 60 * 1000
    expect(await read()).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    now += 5 * 60 * 1000
    expect(await read()).toBeNull()
    now += 5 * 60 * 1000
    expect(await read()).toBe(400)
  })

  it('ignores a reply without a count', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    expect(await createStarCountReader({ fetcher, now: () => now })()).toBeNull()
  })
})
