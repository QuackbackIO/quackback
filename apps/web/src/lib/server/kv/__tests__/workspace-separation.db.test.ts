/**
 * The successor of `__tests__/redis-key-workspace-namespacing.test.ts`.
 *
 * That suite pinned the `t:<workspaceKey>:` prefix on every Redis key built from an
 * identifier that only means something inside one workspace — rate-limit
 * buckets, per-user device sets, presence sets. Redis is gone, so a suite that
 * still asserted "the string handed to a fake client starts with `t:`" would be
 * asserting about a client that no longer exists: the seventeenth
 * could-not-have-failed test, dressed as a regression guard.
 *
 * The property it was protecting has not gone anywhere, so this asserts the same
 * thing one layer down and against a real server: **a value written under one
 * workspace is not observable under another, through the production functions.**
 * Every case here drives the exported API — `incrementBucket`, `isDeviceUnseen`,
 * `listOnlineAgentIds`, `cacheGet`/`cacheSet` — never the SQL directly, so a
 * discriminator dropped from any one statement fails here.
 *
 * Regression control (run before shipping): remove `workspace_key = …` from any one
 * predicate in `pg-kv.ts` or `presence.ts` and the matching case goes red.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  ensureKvSchema,
  withRealWorkspace,
  workspacePair,
  uniqueKey,
  cleanupWorkspaces,
  closeHarness,
  testSql,
} from './harness'
import { kvGet, kvSet, kvSetNx, kvGetOrCreate, kvSetMemberClaim } from '../pg-kv'
import {
  currentWorkspaceNamespace,
  SINGLE_WORKSPACE_NAMESPACE,
} from '@/lib/server/workspaces/workspace-keyed'
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

const [A, B] = workspacePair()

beforeAll(async () => {
  await ensureKvSchema()
})

afterAll(async () => {
  await cleanupWorkspaces(A, B)
  await closeHarness()
})

describe('workspace separation — the value store', () => {
  it('a cached value written by one workspace is invisible to the other', async () => {
    const key = uniqueKey('settings:workspace')
    await withRealWorkspace(A, () => kvSet(key, { name: 'alpha-workspace' }, 60))

    expect(await withRealWorkspace(A, () => kvGet<{ name: string }>(key))).toEqual({
      name: 'alpha-workspace',
    })
    expect(await withRealWorkspace(B, () => kvGet(key))).toBeNull()
  })

  it('and the other direction, with the write order reversed', async () => {
    const key = uniqueKey('settings:workspace')
    await withRealWorkspace(B, () => kvSet(key, { name: 'bravo-workspace' }, 60))

    expect(await withRealWorkspace(B, () => kvGet<{ name: string }>(key))).toEqual({
      name: 'bravo-workspace',
    })
    expect(await withRealWorkspace(A, () => kvGet(key))).toBeNull()
  })

  it('a set-if-absent lock taken by one workspace does not throttle the other', async () => {
    const key = uniqueKey('verify-domain')
    expect(await withRealWorkspace(A, () => kvSetNx(key, 1, 30))).toBe(true)
    // Same workspace, same key: refused, which is what makes the next line mean
    // something. Without this, "B took it" would also be true of a broken lock.
    expect(await withRealWorkspace(A, () => kvSetNx(key, 1, 30))).toBe(false)
    expect(await withRealWorkspace(B, () => kvSetNx(key, 1, 30))).toBe(true)
  })

  it('the daily visitor salt differs per workspace for the same UTC day', async () => {
    // §4.1's hazard: one salt means the layer-1 visitor key becomes a fleet-wide
    // identifier, which is the cross-site correlation the daily rotation exists
    // to make impossible.
    const day = new Date('2026-03-04T12:00:00.000Z')
    const saltA = await withRealWorkspace(A, () => getDailySalt(day))
    const saltB = await withRealWorkspace(B, () => getDailySalt(day))
    expect(saltA).toBeTruthy()
    expect(saltB).toBeTruthy()
    expect(saltA).not.toEqual(saltB)
  })
})

describe('workspace separation — rate buckets', () => {
  it("one workspace's traffic does not spend the other's budget", async () => {
    const key = uniqueKey('signin:credential:ip')
    for (let i = 0; i < 5; i++)
      await withRealWorkspace(A, () => incrementBucket({ key, windowSeconds: 60 }))

    const a = await withRealWorkspace(A, () => incrementBucket({ key, windowSeconds: 60 }))
    const b = await withRealWorkspace(B, () => incrementBucket({ key, windowSeconds: 60 }))

    expect(a.count).toBe(6)
    // B's first-ever request on the same bucket name: count 1, not 7.
    expect(b.count).toBe(1)
  })

  it('retry-after is read from the asking workspace, not whichever window is longest', async () => {
    const key = uniqueKey('widget:rl')
    await withRealWorkspace(A, () => incrementBucket({ key, windowSeconds: 3600 }))
    const retryB = await withRealWorkspace(B, () => bucketRetryAfter({ key, windowSeconds: 30 }))
    // B has no bucket, so it gets its own window size back — not A's hour.
    expect(retryB).toBe(30)
  })
})

describe('workspace separation — device sets', () => {
  it("a sign-in on one workspace does not suppress the other's new-device alert", async () => {
    // User ids are only unique within a workspace database, so this is a
    // realistic collision rather than a contrived one.
    const userId = 'user_01collision'
    const fingerprint = 'ffffffffffffffffffffffffffffffff'

    expect(await withRealWorkspace(A, () => isDeviceUnseen(userId, fingerprint))).toBe(true)
    // Same workspace, second sighting: known. The positive control for the line below.
    expect(await withRealWorkspace(A, () => isDeviceUnseen(userId, fingerprint))).toBe(false)
    expect(await withRealWorkspace(B, () => isDeviceUnseen(userId, fingerprint))).toBe(true)

    await testSql()`DELETE FROM kv_set_member WHERE workspace_key IN (${A}, ${B})`
  })

  it('claims the member back once its window has elapsed', async () => {
    const setKey = uniqueKey('user:devices')
    expect(await withRealWorkspace(A, () => kvSetMemberClaim(setKey, 'm', 1))).toBe(true)
    expect(await withRealWorkspace(A, () => kvSetMemberClaim(setKey, 'm', 1))).toBe(false)
    await testSql()`
      UPDATE kv_set_member SET expires_at = now() - interval '1 second'
      WHERE workspace_key = ${A} AND set_key = ${setKey}
    `
    expect(await withRealWorkspace(A, () => kvSetMemberClaim(setKey, 'm', 60))).toBe(true)
  })
})

describe('workspace separation — presence', () => {
  const agentA = 'principal_01alphaagent' as PrincipalId
  const agentB = 'principal_01bravoagent' as PrincipalId

  it('conversation routing cannot be handed an agent from another workspace', async () => {
    // §7.4 names this one specifically: `listOnlineAgentIds` feeds routing, so a
    // foreign principal id would be assigned a conversation it cannot see.
    await withRealWorkspace(A, () => markPresent(agentA, 'stream-a', true))
    await withRealWorkspace(B, () => markPresent(agentB, 'stream-b', true))

    expect(await withRealWorkspace(A, () => listOnlineAgentIds())).toEqual([agentA])
    expect(await withRealWorkspace(B, () => listOnlineAgentIds())).toEqual([agentB])
  })

  it("one workspace's live agent does not make the other workspace read as staffed", async () => {
    const [C, D] = workspacePair()
    try {
      await withRealWorkspace(C, () => markPresent(agentA, 'stream-c', true))
      expect(await withRealWorkspace(C, () => isAnyAgentOnline())).toBe(true)
      expect(await withRealWorkspace(D, () => isAnyAgentOnline())).toBe(false)
      // And the per-principal read, for the same principal id in both workspaces.
      expect(await withRealWorkspace(C, () => isPrincipalOnline(agentA))).toBe(true)
      expect(await withRealWorkspace(D, () => isPrincipalOnline(agentA))).toBe(false)
    } finally {
      await cleanupWorkspaces(C, D)
    }
  })

  it('a non-agent stream never appears in the routing list', async () => {
    const [C] = workspacePair()
    try {
      const visitor = 'principal_01visitoronly' as PrincipalId
      await withRealWorkspace(C, () => markPresent(visitor, 'stream-v', false))
      expect(await withRealWorkspace(C, () => isPrincipalOnline(visitor))).toBe(true)
      expect(await withRealWorkspace(C, () => listOnlineAgentIds())).toEqual([])
    } finally {
      await cleanupWorkspaces(C)
    }
  })
})

describe('the discriminator is the value that used to be the key prefix', () => {
  it('writes land under currentWorkspaceNamespace() — the same value the Redis prefix carried', async () => {
    // `workspaceScopedKey()` built `t:<currentWorkspaceNamespace()>:<key>`. The same function
    // now supplies `workspace_key`, so this is continuity rather than a new scheme:
    // the row's discriminator is asserted to equal what the function returns
    // inside the scope, not a literal copied from the test.
    const scoped = uniqueKey('kv:scoped')
    const observed = await withRealWorkspace(A, async () => {
      await kvGetOrCreate(scoped, 'v', 60)
      return currentWorkspaceNamespace()
    })
    const scopedRows = await testSql()<{ workspace_key: string }[]>`
      SELECT workspace_key FROM kv_store WHERE key = ${scoped}
    `
    expect(observed).toBe(A)
    expect(scopedRows.map((r) => r.workspace_key)).toEqual([observed])
  })

  it('and with no workspace scope the namespace is still one stable value, not absent', () => {
    // The single-workspace identity `workspace-keyed.ts` documents. A self-hosted
    // install writes every row under `_`, exactly as every Redis key was
    // prefixed `t:_:` before this change.
    expect(currentWorkspaceNamespace()).toBe(SINGLE_WORKSPACE_NAMESPACE)
    expect(SINGLE_WORKSPACE_NAMESPACE).toBe('_')
  })
})
