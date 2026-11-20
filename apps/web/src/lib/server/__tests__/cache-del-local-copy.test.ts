/**
 * cacheDel leaves no local copy behind, including one taken by a read that ran
 * while the shared copy was being deleted: that read may have found the shared
 * copy the delete was removing, and the process would serve it for the local
 * window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'test:cache-del-local-copy'

const kv = vi.hoisted(() => ({ duringDelete: null as null | (() => void) }))

vi.mock('@/lib/server/kv/pg-kv', () => ({
  kvGet: async () => null,
  kvSet: async () => {},
  kvSetIf: async () => true,
  kvDel: async () => {
    kv.duringDelete?.()
  },
}))

import { cacheDel } from '../cache'
import { localCacheGeneration, localCacheGet, localCacheSet } from '../local-cache'

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
})

afterEach(() => {
  kv.duringDelete = null
  vi.unstubAllEnvs()
})

describe('cacheDel', () => {
  it('drops a local copy a read took while the shared copy was being deleted', async () => {
    kv.duringDelete = () => {
      // A read that starts after the local copy was forgotten and finds the
      // shared copy not yet deleted.
      const readSince = localCacheGeneration()
      localCacheSet(KEY, 'replaced', 5_000, readSince)
    }

    await cacheDel(KEY)

    expect(localCacheGet(KEY)).toBeUndefined()
  })
})
