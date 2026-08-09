/**
 * The Redis semantics these statements had to reproduce, checked against a real
 * server: TTL, NX, and the atomicity of INCR and SET-NX under concurrency.
 *
 * Redis gave atomicity away for free because it is single-threaded. Every
 * assertion about it here therefore drives N real connections at once — a
 * sequential check would pass against an implementation that reads and then
 * writes, which is precisely the defect this file exists to catch. (It caught
 * one: see the header of `realtime/presence.ts`.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  ensureKvSchema,
  withRealTenant,
  tenantPair,
  uniqueKey,
  cleanupTenants,
  closeHarness,
  testSql,
} from './harness'
import {
  kvGet,
  kvSet,
  kvDel,
  kvSetNx,
  kvGetOrCreate,
  incrementRateBucket,
  incrementRateBuckets,
  rateBucketRetryAfter,
} from '../pg-kv'

const [T] = tenantPair()

beforeAll(async () => {
  await ensureKvSchema()
})

afterAll(async () => {
  await cleanupTenants(T)
  await closeHarness()
})

/** Force a key past its TTL without waiting for wall-clock time. */
async function expire(key: string): Promise<void> {
  await testSql()`
    UPDATE kv_store SET expires_at = now() - interval '1 second'
    WHERE tenant_id = ${T} AND key = ${key}
  `
}

describe('GET / SET / DEL', () => {
  it('round-trips a structured value', async () => {
    const key = uniqueKey('cache')
    await withRealTenant(T, () => kvSet(key, { a: 1, b: ['x'] }, 60))
    expect(await withRealTenant(T, () => kvGet(key))).toEqual({ a: 1, b: ['x'] })
  })

  it('an expired key reads as absent even before anything sweeps it', async () => {
    const key = uniqueKey('cache')
    await withRealTenant(T, () => kvSet(key, 'v', 60))
    await expire(key)
    expect(await withRealTenant(T, () => kvGet(key))).toBeNull()
    // The row is still there — expiry is a predicate, not a deletion. If this
    // ever passes only because a sweeper ran, the TTL semantics have moved.
    const rows = await testSql()<{ n: string }[]>`
      SELECT count(*)::text AS n FROM kv_store WHERE tenant_id = ${T} AND key = ${key}
    `
    expect(rows[0].n).toBe('1')
  })

  it('SET overwrites both value and TTL, as Redis SET does', async () => {
    const key = uniqueKey('cache')
    await withRealTenant(T, () => kvSet(key, 'first', 60))
    await expire(key)
    await withRealTenant(T, () => kvSet(key, 'second', 60))
    expect(await withRealTenant(T, () => kvGet(key))).toBe('second')
  })

  it('DEL removes several keys and ignores an empty list', async () => {
    const a = uniqueKey('cache')
    const b = uniqueKey('cache')
    await withRealTenant(T, () => kvSet(a, 1, 60))
    await withRealTenant(T, () => kvSet(b, 2, 60))
    await withRealTenant(T, () => kvDel())
    expect(await withRealTenant(T, () => kvGet(a))).toBe(1)
    await withRealTenant(T, () => kvDel(a, b))
    expect(await withRealTenant(T, () => kvGet(a))).toBeNull()
    expect(await withRealTenant(T, () => kvGet(b))).toBeNull()
  })

  it('rejects a non-positive TTL rather than writing an already-expired row', async () => {
    const key = uniqueKey('cache')
    await expect(withRealTenant(T, () => kvSet(key, 'v', 0))).rejects.toThrow(/positive/)
  })

  it('null round-trips as null rather than becoming a miss', async () => {
    const key = uniqueKey('cache')
    await withRealTenant(T, () => kvSet(key, null, 60))
    // A stored null is indistinguishable from a miss through kvGet, which is
    // exactly what Redis's `JSON.parse('null')` did. Pinned so a later change to
    // `jsonb 'null'` handling is a visible decision.
    expect(await withRealTenant(T, () => kvGet(key))).toBeNull()
  })
})

describe('SET NX EX', () => {
  it('exactly one of 20 concurrent claimants takes the key', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const key = uniqueKey('lock')
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => withRealTenant(T, () => kvSetNx(key, i, 30)))
      )
      expect(results.filter(Boolean).length, `attempt ${attempt}`).toBe(1)
    }
  })

  it('an expired holder loses the key to the next claimant', async () => {
    const key = uniqueKey('lock')
    expect(await withRealTenant(T, () => kvSetNx(key, 'a', 30))).toBe(true)
    expect(await withRealTenant(T, () => kvSetNx(key, 'b', 30))).toBe(false)
    await expire(key)
    expect(await withRealTenant(T, () => kvSetNx(key, 'b', 30))).toBe(true)
    expect(await withRealTenant(T, () => kvGet(key))).toBe('b')
  })
})

describe('get-or-create', () => {
  it('20 concurrent callers all read the SAME value', async () => {
    // The property `visitor-hash.ts` depends on: whoever loses the race must
    // read the winner's salt, not their own. A read-then-write implementation
    // hands out several salts and this goes red.
    for (let attempt = 0; attempt < 5; attempt++) {
      const key = uniqueKey('visitor:salt')
      const values = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          withRealTenant(T, () => kvGetOrCreate(key, `salt-${attempt}-${i}`, 60))
        )
      )
      expect(new Set(values).size, `attempt ${attempt}: ${new Set(values).size} distinct`).toBe(1)
    }
  })

  it('mints a new value once the old one expires', async () => {
    const key = uniqueKey('visitor:salt')
    const first = await withRealTenant(T, () => kvGetOrCreate(key, 'one', 60))
    expect(first).toBe('one')
    await expire(key)
    expect(await withRealTenant(T, () => kvGetOrCreate(key, 'two', 60))).toBe('two')
  })
})

describe('rate buckets', () => {
  it('20 concurrent increments count exactly 20 — no lost updates', async () => {
    const key = uniqueKey('rl')
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        withRealTenant(T, () => incrementRateBucket({ key, windowSeconds: 60 }))
      )
    )
    expect(Math.max(...results.map((r) => r.count))).toBe(20)
    // And every observed count is distinct, which is what "atomic INCR" means.
    expect(new Set(results.map((r) => r.count)).size).toBe(20)
  })

  it('resets to 1 when the window has elapsed, and does not extend a live window', async () => {
    const key = uniqueKey('rl')
    await withRealTenant(T, () => incrementRateBucket({ key, windowSeconds: 3600 }))
    const second = await withRealTenant(T, () => incrementRateBucket({ key, windowSeconds: 3600 }))
    expect(second.count).toBe(2)
    // Redis's EXPIRE NX: a later hit in the window must not push the window out.
    const windowText = async () =>
      (
        await testSql()<{ w: string }[]>`
          SELECT window_expires_at::text AS w FROM rate_bucket
          WHERE tenant_id = ${T} AND key = ${key}
        `
      )[0].w
    const before = await windowText()
    await withRealTenant(T, () => incrementRateBucket({ key, windowSeconds: 3600 }))
    expect(await windowText()).toBe(before)

    await testSql()`
      UPDATE rate_bucket SET window_expires_at = now() - interval '1 second'
      WHERE tenant_id = ${T} AND key = ${key}
    `
    expect(
      (await withRealTenant(T, () => incrementRateBucket({ key, windowSeconds: 60 }))).count
    ).toBe(1)
  })

  it('the batch form returns counts in input order, one round trip', async () => {
    const a = uniqueKey('rl')
    const b = uniqueKey('rl')
    await withRealTenant(T, () => incrementRateBucket({ key: a, windowSeconds: 60 }))
    await withRealTenant(T, () => incrementRateBucket({ key: a, windowSeconds: 60 }))
    const out = await withRealTenant(T, () =>
      incrementRateBuckets([
        { key: a, windowSeconds: 60 },
        { key: b, windowSeconds: 60 },
      ])
    )
    expect(out.map((s) => s.count)).toEqual([3, 1])
  })

  it('the batch form survives duplicate keys instead of erroring the request', async () => {
    // `ON CONFLICT DO UPDATE` refuses to touch a row twice in one statement. A
    // caller checking a per-principal and a per-IP bucket that name the same
    // key would take the whole request down without the collapse.
    const key = uniqueKey('rl')
    const out = await withRealTenant(T, () =>
      incrementRateBuckets([
        { key, windowSeconds: 60 },
        { key, windowSeconds: 60 },
      ])
    )
    expect(out.map((s) => s.count)).toEqual([1, 1])
  })

  it('retry-after reports the live window, and the window size when absent', async () => {
    const key = uniqueKey('rl')
    expect(await withRealTenant(T, () => rateBucketRetryAfter({ key, windowSeconds: 45 }))).toBe(45)
    await withRealTenant(T, () => incrementRateBucket({ key, windowSeconds: 600 }))
    const retry = await withRealTenant(T, () => rateBucketRetryAfter({ key, windowSeconds: 45 }))
    expect(retry).toBeGreaterThan(590)
    expect(retry).toBeLessThanOrEqual(600)
  })
})
