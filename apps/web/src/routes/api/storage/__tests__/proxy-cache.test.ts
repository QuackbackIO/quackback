/**
 * The proxy cache buffers full S3 objects in memory, so it must be bounded:
 * per-entry size cap (large objects are never cached), a total byte budget
 * with least-recently-used eviction, and TTL expiry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/config', () => ({ config: { s3Proxy: false } }))

const { createProxyCache } = await import('../$')

const bytes = (n: number) => new ArrayBuffer(n)

const makeCache = (overrides: Partial<Parameters<typeof createProxyCache>[0]> = {}) =>
  createProxyCache({
    ttlMs: 1000,
    maxEntryBytes: 100,
    maxTotalBytes: 250,
    ...overrides,
  })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createProxyCache', () => {
  it('returns cached entries with their content type', () => {
    const cache = makeCache()
    cache.set('a', bytes(10), 'image/png')
    const hit = cache.get('a')
    expect(hit?.contentType).toBe('image/png')
    expect(hit?.data.byteLength).toBe(10)
  })

  it('expires entries after the TTL', () => {
    const cache = makeCache({ ttlMs: 1000 })
    cache.set('a', bytes(10), 'image/png')
    vi.advanceTimersByTime(999)
    expect(cache.get('a')).toBeDefined()
    vi.advanceTimersByTime(1)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.totalBytes).toBe(0)
  })

  it('never caches entries larger than the per-entry cap', () => {
    const cache = makeCache({ maxEntryBytes: 100 })
    cache.set('big', bytes(101), 'image/png')
    expect(cache.get('big')).toBeUndefined()
    expect(cache.totalBytes).toBe(0)
  })

  it('evicts the least-recently-used entries to stay within the byte budget', () => {
    const cache = makeCache({ maxEntryBytes: 100, maxTotalBytes: 250 })
    cache.set('a', bytes(100), 'image/png')
    cache.set('b', bytes(100), 'image/png')
    cache.set('c', bytes(100), 'image/png') // 300 > 250: evicts a
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
    expect(cache.totalBytes).toBe(200)
  })

  it('treats reads as use, so recently read entries survive eviction', () => {
    const cache = makeCache({ maxEntryBytes: 100, maxTotalBytes: 250 })
    cache.set('a', bytes(100), 'image/png')
    cache.set('b', bytes(100), 'image/png')
    cache.get('a') // a is now more recently used than b
    cache.set('c', bytes(100), 'image/png') // evicts b, not a
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBeDefined()
  })

  it('replaces an existing key without double-counting its bytes', () => {
    const cache = makeCache()
    cache.set('a', bytes(80), 'image/png')
    cache.set('a', bytes(40), 'image/webp')
    expect(cache.totalBytes).toBe(40)
    expect(cache.get('a')?.contentType).toBe('image/webp')
  })

  it('frees budget on delete', () => {
    const cache = makeCache()
    cache.set('a', bytes(80), 'image/png')
    cache.delete('a')
    expect(cache.get('a')).toBeUndefined()
    expect(cache.totalBytes).toBe(0)
  })
})
