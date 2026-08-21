/**
 * A cache failure must read as a miss, never as an exception.
 *
 * `settings.service.ts` reads through `cacheGet` on the SSR hot path, so a
 * throw here is a 500 on every page. The Redis version swallowed and the callers
 * were written for that; this pins the same contract on the Postgres one.
 *
 * The direction has a sharper edge now: under pooled tenancy `db` throws
 * `TenantScopeMissingError` where Redis would quietly have used the `_`
 * namespace, so an unscoped background caller degrades to a permanent miss.
 * That is the correct trade — a miss is slow, a shared namespace is one tenant's
 * settings served to another — and the last case pins it explicitly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/lib/server/kv/pg-kv', () => ({
  kvGet: hoisted.get,
  kvSet: hoisted.set,
  kvDel: hoisted.del,
}))

const { cacheGet, cacheSet, cacheDel } = await import('../cache')

beforeEach(() => vi.clearAllMocks())

describe('when the store throws', () => {
  it('cacheGet returns null instead of propagating', async () => {
    hoisted.get.mockRejectedValueOnce(new Error('database unreachable'))
    expect(await cacheGet('k')).toBeNull()
  })

  it('cacheSet resolves instead of propagating', async () => {
    hoisted.set.mockRejectedValueOnce(new Error('database unreachable'))
    await expect(cacheSet('k', 1, 60)).resolves.toBeUndefined()
  })

  it('cacheDel resolves instead of propagating', async () => {
    hoisted.del.mockRejectedValueOnce(new Error('database unreachable'))
    await expect(cacheDel('k')).resolves.toBeUndefined()
  })

  it('a missing tenant scope is swallowed the same way — a miss, not a 500', async () => {
    class TenantScopeMissingError extends Error {}
    hoisted.get.mockRejectedValueOnce(new TenantScopeMissingError('no scope'))
    expect(await cacheGet('settings:tenant')).toBeNull()
  })
})

describe('when the store works', () => {
  it('the same calls pass values through — the positive control', async () => {
    // Without this, every assertion above is satisfied by helpers that always
    // return null and never call the store at all.
    hoisted.get.mockResolvedValueOnce({ a: 1 })
    expect(await cacheGet('k')).toEqual({ a: 1 })
    expect(hoisted.get).toHaveBeenCalledWith('k')

    await cacheSet('k', { a: 1 }, 60)
    expect(hoisted.set).toHaveBeenCalledWith('k', { a: 1 }, 60)

    await cacheDel('a', 'b')
    expect(hoisted.del).toHaveBeenCalledWith('a', 'b')
  })
})
