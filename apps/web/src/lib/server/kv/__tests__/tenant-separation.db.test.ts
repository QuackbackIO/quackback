/**
 * The successor of `__tests__/redis-key-tenant-namespacing.test.ts`.
 *
 * That suite pinned the `t:<tenantId>:` prefix on every Redis key built from an
 * identifier that only means something inside one workspace — rate-limit
 * buckets, per-user device sets, presence sets. Redis is gone, so a suite that
 * still asserted "the string handed to a fake client starts with `t:`" would be
 * asserting about a client that no longer exists: the seventeenth
 * could-not-have-failed test, dressed as a regression guard.
 *
 * The property it was protecting has not gone anywhere, so this asserts the same
 * thing one layer down and against a real server: **a value written under one
 * tenant is not observable under another, through the production functions.**
 * Every case here drives the exported API — `incrementBucket`, `isDeviceUnseen`,
 * `listOnlineAgentIds`, `cacheGet`/`cacheSet` — never the SQL directly, so a
 * discriminator dropped from any one statement fails here.
 *
 * Regression control (run before shipping): remove `tenant_id = …` from any one
 * predicate in `pg-kv.ts` or `presence.ts` and the matching case goes red.
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
import { kvGet, kvSet, kvSetNx, kvGetOrCreate, kvSetMemberClaim } from '../pg-kv'
import { currentTenantNamespace, SINGLE_TENANT_NAMESPACE } from '@/lib/server/tenancy/tenant-keyed'
import { incrementBucket, bucketRetryAfter } from '@/lib/server/utils/rate-bucket'
import { isDeviceUnseen } from '@/lib/server/auth/signin-device-tracker'
import {
  markPresent,
  listOnlineAgentIds,
  isAnyAgentOnline,
  isPrincipalOnline,
} from '@/lib/server/realtime/presence'
import { getDailySalt } from '@/lib/server/domains/analytics/visitor-hash'
import type { PrincipalId } from '@quackback/ids'

const [A, B] = tenantPair()

beforeAll(async () => {
  await ensureKvSchema()
})

afterAll(async () => {
  await cleanupTenants(A, B)
  await closeHarness()
})

describe('tenant separation — the value store', () => {
  it('a cached value written by one tenant is invisible to the other', async () => {
    const key = uniqueKey('settings:tenant')
    await withRealTenant(A, () => kvSet(key, { name: 'alpha-workspace' }, 60))

    expect(await withRealTenant(A, () => kvGet<{ name: string }>(key))).toEqual({
      name: 'alpha-workspace',
    })
    expect(await withRealTenant(B, () => kvGet(key))).toBeNull()
  })

  it('and the other direction, with the write order reversed', async () => {
    const key = uniqueKey('settings:tenant')
    await withRealTenant(B, () => kvSet(key, { name: 'bravo-workspace' }, 60))

    expect(await withRealTenant(B, () => kvGet<{ name: string }>(key))).toEqual({
      name: 'bravo-workspace',
    })
    expect(await withRealTenant(A, () => kvGet(key))).toBeNull()
  })

  it('a set-if-absent lock taken by one tenant does not throttle the other', async () => {
    const key = uniqueKey('verify-domain')
    expect(await withRealTenant(A, () => kvSetNx(key, 1, 30))).toBe(true)
    // Same tenant, same key: refused, which is what makes the next line mean
    // something. Without this, "B took it" would also be true of a broken lock.
    expect(await withRealTenant(A, () => kvSetNx(key, 1, 30))).toBe(false)
    expect(await withRealTenant(B, () => kvSetNx(key, 1, 30))).toBe(true)
  })

  it('the daily visitor salt differs per tenant for the same UTC day', async () => {
    // §4.1's hazard: one salt means the layer-1 visitor key becomes a fleet-wide
    // identifier, which is the cross-site correlation the daily rotation exists
    // to make impossible.
    const day = new Date('2026-03-04T12:00:00.000Z')
    const saltA = await withRealTenant(A, () => getDailySalt(day))
    const saltB = await withRealTenant(B, () => getDailySalt(day))
    expect(saltA).toBeTruthy()
    expect(saltB).toBeTruthy()
    expect(saltA).not.toEqual(saltB)
  })
})

describe('tenant separation — rate buckets', () => {
  it("one tenant's traffic does not spend the other's budget", async () => {
    const key = uniqueKey('signin:credential:ip')
    for (let i = 0; i < 5; i++)
      await withRealTenant(A, () => incrementBucket({ key, windowSeconds: 60 }))

    const a = await withRealTenant(A, () => incrementBucket({ key, windowSeconds: 60 }))
    const b = await withRealTenant(B, () => incrementBucket({ key, windowSeconds: 60 }))

    expect(a.count).toBe(6)
    // B's first-ever request on the same bucket name: count 1, not 7.
    expect(b.count).toBe(1)
  })

  it('retry-after is read from the asking tenant, not whichever window is longest', async () => {
    const key = uniqueKey('widget:rl')
    await withRealTenant(A, () => incrementBucket({ key, windowSeconds: 3600 }))
    const retryB = await withRealTenant(B, () => bucketRetryAfter({ key, windowSeconds: 30 }))
    // B has no bucket, so it gets its own window size back — not A's hour.
    expect(retryB).toBe(30)
  })
})

describe('tenant separation — device sets', () => {
  it("a sign-in on one tenant does not suppress the other's new-device alert", async () => {
    // User ids are only unique within a workspace database, so this is a
    // realistic collision rather than a contrived one.
    const userId = 'user_01collision'
    const fingerprint = 'ffffffffffffffffffffffffffffffff'

    expect(await withRealTenant(A, () => isDeviceUnseen(userId, fingerprint))).toBe(true)
    // Same tenant, second sighting: known. The positive control for the line below.
    expect(await withRealTenant(A, () => isDeviceUnseen(userId, fingerprint))).toBe(false)
    expect(await withRealTenant(B, () => isDeviceUnseen(userId, fingerprint))).toBe(true)

    await testSql()`DELETE FROM kv_set_member WHERE tenant_id IN (${A}, ${B})`
  })

  it('claims the member back once its window has elapsed', async () => {
    const setKey = uniqueKey('user:devices')
    expect(await withRealTenant(A, () => kvSetMemberClaim(setKey, 'm', 1))).toBe(true)
    expect(await withRealTenant(A, () => kvSetMemberClaim(setKey, 'm', 1))).toBe(false)
    await testSql()`
      UPDATE kv_set_member SET expires_at = now() - interval '1 second'
      WHERE tenant_id = ${A} AND set_key = ${setKey}
    `
    expect(await withRealTenant(A, () => kvSetMemberClaim(setKey, 'm', 60))).toBe(true)
  })
})

describe('tenant separation — presence', () => {
  const agentA = 'principal_01alphaagent' as PrincipalId
  const agentB = 'principal_01bravoagent' as PrincipalId

  it('conversation routing cannot be handed an agent from another tenant', async () => {
    // §7.4 names this one specifically: `listOnlineAgentIds` feeds routing, so a
    // foreign principal id would be assigned a conversation it cannot see.
    await withRealTenant(A, () => markPresent(agentA, 'stream-a', true))
    await withRealTenant(B, () => markPresent(agentB, 'stream-b', true))

    expect(await withRealTenant(A, () => listOnlineAgentIds())).toEqual([agentA])
    expect(await withRealTenant(B, () => listOnlineAgentIds())).toEqual([agentB])
  })

  it("one tenant's live agent does not make the other tenant read as staffed", async () => {
    const [C, D] = tenantPair()
    try {
      await withRealTenant(C, () => markPresent(agentA, 'stream-c', true))
      expect(await withRealTenant(C, () => isAnyAgentOnline())).toBe(true)
      expect(await withRealTenant(D, () => isAnyAgentOnline())).toBe(false)
      // And the per-principal read, for the same principal id in both tenants.
      expect(await withRealTenant(C, () => isPrincipalOnline(agentA))).toBe(true)
      expect(await withRealTenant(D, () => isPrincipalOnline(agentA))).toBe(false)
    } finally {
      await cleanupTenants(C, D)
    }
  })

  it('a non-agent stream never appears in the routing list', async () => {
    const [C] = tenantPair()
    try {
      const visitor = 'principal_01visitoronly' as PrincipalId
      await withRealTenant(C, () => markPresent(visitor, 'stream-v', false))
      expect(await withRealTenant(C, () => isPrincipalOnline(visitor))).toBe(true)
      expect(await withRealTenant(C, () => listOnlineAgentIds())).toEqual([])
    } finally {
      await cleanupTenants(C)
    }
  })
})

describe('the discriminator is the value that used to be the key prefix', () => {
  it('writes land under currentTenantNamespace() — the same value the Redis prefix carried', async () => {
    // `tenantKey()` built `t:<currentTenantNamespace()>:<key>`. The same function
    // now supplies `tenant_id`, so this is continuity rather than a new scheme:
    // the row's discriminator is asserted to equal what the function returns
    // inside the scope, not a literal copied from the test.
    const scoped = uniqueKey('kv:scoped')
    const observed = await withRealTenant(A, async () => {
      await kvGetOrCreate(scoped, 'v', 60)
      return currentTenantNamespace()
    })
    const scopedRows = await testSql()<{ tenant_id: string }[]>`
      SELECT tenant_id FROM kv_store WHERE key = ${scoped}
    `
    expect(observed).toBe(A)
    expect(scopedRows.map((r) => r.tenant_id)).toEqual([observed])
  })

  it('and with no tenant scope the namespace is still one stable value, not absent', () => {
    // The single-tenant identity `tenant-keyed.ts` documents. A self-hosted
    // install writes every row under `_`, exactly as every Redis key was
    // prefixed `t:_:` before this change.
    expect(currentTenantNamespace()).toBe(SINGLE_TENANT_NAMESPACE)
    expect(SINGLE_TENANT_NAMESPACE).toBe('_')
  })
})
