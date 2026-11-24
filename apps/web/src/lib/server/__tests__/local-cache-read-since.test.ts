/**
 * A copy read before a write dropped its key is not kept after the drop: it
 * may be what the write replaced, and every request in this process would be
 * served it until it expired.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetCachedKeys,
  localCacheGeneration,
  localCacheGet,
  localCacheSet,
} from '../local-cache'

const KEY = 'test:local-cache-read-since'

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  forgetCachedKeys(KEY)
})

afterEach(() => {
  forgetCachedKeys(KEY)
  vi.unstubAllEnvs()
})

const OTHER = 'test:local-cache-read-since:other'

describe('localCacheSet with readSince', () => {
  it('keeps a copy when nothing was dropped while it was read', () => {
    const readSince = localCacheGeneration(KEY)
    localCacheSet(KEY, 'current', 5_000, readSince)
    expect(localCacheGet(KEY)).toBe('current')
  })

  it('does not keep a copy read before a drop', () => {
    const readSince = localCacheGeneration(KEY)
    // A write commits and drops the key while the read is in flight.
    forgetCachedKeys(KEY)
    localCacheSet(KEY, 'replaced', 5_000, readSince)
    expect(localCacheGet(KEY)).toBeUndefined()
  })

  it('keeps a copy when only another key was dropped while it was read', () => {
    const readSince = localCacheGeneration(KEY)
    // Some unrelated cache (a principal, an auth list) is dropped meanwhile.
    forgetCachedKeys(OTHER)
    localCacheSet(KEY, 'current', 5_000, readSince)
    expect(localCacheGet(KEY)).toBe('current')
  })
})
