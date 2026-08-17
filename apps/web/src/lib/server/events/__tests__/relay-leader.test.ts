/**
 * The relay leadership lease, against a real Postgres.
 *
 * These properties do not survive being mocked. Whether two concurrent claimers
 * serialize, whether the loser re-reads the winner's committed row, and whether
 * an expiry is evaluated against the *server's* clock are all database
 * behaviour; a test double would assert that the string I wrote is the string I
 * wrote.
 *
 * The suite mints a unique lease name per test, because `DATABASE_URL` is
 * hard-coded to one shared `quackback_test` for every worktree on this machine
 * and a suite that asserted whole-table state would fail on somebody else's row.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
// The lint rule reserves @quackback/db/client for db.ts; test fixtures that need
// their own short-lived connection are sanctioned callers, same as
// db-test-fixture.ts and the job-queue harness.
// oxlint-disable-next-line no-restricted-imports
import { createDbFromSql, type Database } from '@quackback/db/client'

const URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'

const MIGRATION = path.resolve(
  __dirname,
  '../../../../../../../packages/db/drizzle/0256_outbox_relay_leader.sql'
)

let sqlHandle: postgres.Sql
let dbHandle: Database

vi.mock('@/lib/server/db', () => ({}))

import {
  claimRelayLease,
  readRelayLease,
  releaseRelayLease,
  relayOwnerId,
  renewRelayLease,
  __resetRelayOwnerIdForTests,
} from '../relay-leader'

let seq = 0
const leaseName = () => `test-lease-${process.pid}-${Date.now()}-${seq++}`

beforeAll(async () => {
  sqlHandle = postgres(URL, { max: 8, onnotice: () => {} })
  dbHandle = createDbFromSql(sqlHandle)
  const [{ ready }] = await sqlHandle<{ ready: boolean }[]>`
    SELECT to_regclass('public.outbox_relay_leader') IS NOT NULL AS ready
  `
  // Execute the SHIPPED migration rather than a paraphrase of it. If the two
  // ever diverge, this suite is testing something that does not ship.
  if (!ready) await sqlHandle.unsafe(readFileSync(MIGRATION, 'utf8'))
})

afterAll(async () => {
  await sqlHandle.end({ timeout: 5 })
})

describe('one replica leads, and the loser is told so', () => {
  it('a second owner gets null while the first holds a live lease', async () => {
    const name = leaseName()
    const a = await claimRelayLease(dbHandle, 30_000, { owner: 'replica-a', name })
    const b = await claimRelayLease(dbHandle, 30_000, { owner: 'replica-b', name })
    expect(a).not.toBeNull()
    expect(b).toBeNull()
    // The positive control: without it, `b === null` would also be satisfied by
    // a lease nobody can ever take, which is a different (and worse) bug.
    await releaseRelayLease(dbHandle, a!, { name })
    const bAfter = await claimRelayLease(dbHandle, 30_000, { owner: 'replica-b', name })
    expect(bAfter).not.toBeNull()
    expect(bAfter!.owner).toBe('replica-b')
  })

  it('concurrent claimers produce exactly one leader', async () => {
    const name = leaseName()
    const owners = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8']
    const results = await Promise.all(
      owners.map((owner) => claimRelayLease(dbHandle, 30_000, { owner, name }))
    )
    const winners = results.filter((r) => r !== null)
    expect(winners).toHaveLength(1)
    const held = await readRelayLease(dbHandle, { name })
    expect(held!.owner).toBe(winners[0]!.owner)
  })

  it('renewal keeps the fence; a takeover moves it', async () => {
    const name = leaseName()
    const a = (await claimRelayLease(dbHandle, 30_000, { owner: 'replica-a', name }))!
    const renewed = await renewRelayLease(dbHandle, a, 30_000, { name })
    expect(renewed!.fence).toBe(a.fence)
    expect(renewed!.expiresAt.getTime()).toBeGreaterThanOrEqual(a.expiresAt.getTime())

    // Expire it the way a dead leader does: let the server clock pass it.
    await sqlHandle`UPDATE outbox_relay_leader SET expires_at = now() - interval '1 second' WHERE name = ${name}`
    const b = (await claimRelayLease(dbHandle, 30_000, { owner: 'replica-b', name }))!
    expect(b.owner).toBe('replica-b')
    expect(Number(b.fence)).toBe(Number(a.fence) + 1)
    await releaseRelayLease(dbHandle, b, { name })
  })

  it('a stalled leader that resumes is refused by the fence, not by its own owner name', async () => {
    // The case a lease alone cannot express. `a` holds the lease, stalls past its
    // expiry, `b` takes over, `b` dies, `a` wakes up. An owner-only renewal check
    // hands `a` the lease back with no signal that anything happened in between —
    // so `a` would carry on believing it never stopped leading.
    const name = leaseName()
    const a = (await claimRelayLease(dbHandle, 30_000, { owner: 'replica-a', name }))!
    await sqlHandle`UPDATE outbox_relay_leader SET expires_at = now() - interval '1 second' WHERE name = ${name}`
    const b = (await claimRelayLease(dbHandle, 30_000, { owner: 'replica-b', name }))!
    await sqlHandle`UPDATE outbox_relay_leader SET expires_at = now() - interval '1 second' WHERE name = ${name}`

    const stale = await renewRelayLease(dbHandle, a, 30_000, { name })
    expect(stale).toBeNull()

    // And the control that makes the assertion above mean something: `a` CAN
    // still acquire afresh. So the null above is the fence refusing a stale
    // epoch, not the lease being unavailable.
    const fresh = (await claimRelayLease(dbHandle, 30_000, { owner: 'replica-a', name }))!
    expect(Number(fresh.fence)).toBe(Number(b.fence) + 1)
    await releaseRelayLease(dbHandle, fresh, { name })
  })

  it('release refuses another owner lease', async () => {
    const name = leaseName()
    const a = (await claimRelayLease(dbHandle, 30_000, { owner: 'replica-a', name }))!
    await sqlHandle`UPDATE outbox_relay_leader SET expires_at = now() - interval '1 second' WHERE name = ${name}`
    const b = (await claimRelayLease(dbHandle, 30_000, { owner: 'replica-b', name }))!

    expect(await releaseRelayLease(dbHandle, a, { name })).toBe(false)
    expect((await readRelayLease(dbHandle, { name }))!.owner).toBe('replica-b')
    expect(await releaseRelayLease(dbHandle, b, { name })).toBe(true)
    expect(await readRelayLease(dbHandle, { name })).toBeNull()
  })

  it('release is ALSO fenced, so a stale handle cannot free the same owner new lease', async () => {
    // Written after a falsification pass caught the previous version: with the
    // `AND fence = …` clause removed, the test above still passed, because the
    // `owner` clause alone refuses a DIFFERENT owner's lease. The fence in
    // `releaseRelayLease` is only observable when the owner is the SAME and the
    // epoch is not — a replica that lapsed, was superseded, and later re-acquired
    // while some older code path still held the first handle.
    const name = leaseName()
    const first = (await claimRelayLease(dbHandle, 30_000, { owner: 'replica-a', name }))!
    await sqlHandle`UPDATE outbox_relay_leader SET expires_at = now() - interval '1 second' WHERE name = ${name}`
    await claimRelayLease(dbHandle, 30_000, { owner: 'replica-b', name })
    await sqlHandle`UPDATE outbox_relay_leader SET expires_at = now() - interval '1 second' WHERE name = ${name}`
    const again = (await claimRelayLease(dbHandle, 30_000, { owner: 'replica-a', name }))!
    expect(again.owner).toBe(first.owner)
    expect(again.fence).not.toBe(first.fence)

    // Same owner, older epoch. Must not free the live lease.
    expect(await releaseRelayLease(dbHandle, first, { name })).toBe(false)
    expect((await readRelayLease(dbHandle, { name }))!.fence).toBe(again.fence)
    // Control: the CURRENT handle does free it, so the refusal above is the
    // fence and not the lease being unfreeable.
    expect(await releaseRelayLease(dbHandle, again, { name })).toBe(true)
    expect(await readRelayLease(dbHandle, { name })).toBeNull()
  })

  it('an expired lease reads as unheld, so a follower does not wait on a corpse', async () => {
    const name = leaseName()
    const a = (await claimRelayLease(dbHandle, 30_000, { owner: 'replica-a', name }))!
    expect(await readRelayLease(dbHandle, { name })).not.toBeNull()
    await sqlHandle`UPDATE outbox_relay_leader SET expires_at = now() - interval '1 second' WHERE name = ${name}`
    expect(await readRelayLease(dbHandle, { name })).toBeNull()
    await releaseRelayLease(dbHandle, a, { name })
  })
})

describe('why this is not pg_try_advisory_lock', () => {
  it('the advisory lock is RE-ENTRANT on one backend, and the lease is not', async () => {
    // This is the mechanism behind the measured pooler failure, reproduced
    // locally without needing a pooler. Through PgBouncer a second client can be
    // routed onto a backend that already holds the lock; because session
    // advisory locks are re-entrant it is told `t` and believes it won the
    // election. Two leaders, no error.
    //
    // The lease has no session dimension at all, so the same two calls on the
    // same connection give one winner.
    const key = 4_820_231_100 + (process.pid % 1000)
    const one = postgres(URL, { max: 1, onnotice: () => {} })
    try {
      const first = await one<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(${key}::bigint) AS locked`
      const second = await one<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(${key}::bigint) AS locked`
      expect(first[0].locked).toBe(true)
      // The whole point: a SECOND acquisition of a lock that is already held
      // succeeds, because it is the same session.
      expect(second[0].locked).toBe(true)
      await one`SELECT pg_advisory_unlock_all()`
    } finally {
      await one.end({ timeout: 5 })
    }

    const name = leaseName()
    const first = await claimRelayLease(dbHandle, 30_000, { owner: 'client-1', name })
    const second = await claimRelayLease(dbHandle, 30_000, { owner: 'client-2', name })
    expect(first).not.toBeNull()
    expect(second).toBeNull()
    await releaseRelayLease(dbHandle, first!, { name })
  })
})

describe('owner identity', () => {
  it('is per process, not per workspace — two workspaces share it, two processes do not', () => {
    __resetRelayOwnerIdForTests()
    const a = relayOwnerId()
    expect(relayOwnerId()).toBe(a)
    __resetRelayOwnerIdForTests()
    expect(relayOwnerId()).not.toBe(a)
  })
})
