/**
 * membership-sync enqueue: roster changes write one coalesced job.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  cleanupDedupeKeys,
  closeHarness,
  ensureJobQueueSchema,
  rowsFor,
  testDb,
} from '@/lib/server/jobs/__tests__/harness'
import { claimJobs, completeJob } from '@/lib/server/jobs/job-queue'
import { findJobDefinition } from '@/lib/server/jobs/definitions'
import {
  enqueueMembershipSync,
  MEMBERSHIP_SYNC_DEDUPE_KEY,
  MEMBERSHIP_SYNC_MAX_ATTEMPTS,
  MEMBERSHIP_SYNC_QUEUE,
  membershipSyncDedupeKey,
} from '../membership-sync'

vi.mock('@/lib/server/db', () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        const handle = testDb()
        const value = Reflect.get(handle as object, prop, handle)
        return typeof value === 'function' ? value.bind(handle) : value
      },
    }
  ),
}))

vi.mock('@/lib/server/workspaces/workspace-context', () => ({
  getCurrentWorkspace: () => null,
}))

const keys: string[] = []

beforeAll(async () => {
  await ensureJobQueueSchema()
})

afterAll(async () => {
  await cleanupDedupeKeys(MEMBERSHIP_SYNC_QUEUE, keys)
  await closeHarness()
})

describe('enqueueMembershipSync', () => {
  it('writes a retryable row under the stable key', async () => {
    const key = membershipSyncDedupeKey()
    expect(key).toBe(MEMBERSHIP_SYNC_DEDUPE_KEY)
    keys.push(key)
    await cleanupDedupeKeys(MEMBERSHIP_SYNC_QUEUE, [key])
    await enqueueMembershipSync()
    const rows = (await rowsFor(MEMBERSHIP_SYNC_QUEUE)).filter((r) => r.dedupe_key === key)
    expect(rows).toHaveLength(1)
    expect(rows[0].max_attempts).toBe(MEMBERSHIP_SYNC_MAX_ATTEMPTS)
    expect(rows[0].max_attempts).toBeGreaterThanOrEqual(10)
    expect(rows[0].status).toBe('pending')
  })

  it('coalesces rapid edits onto the same key', async () => {
    const key = membershipSyncDedupeKey()
    keys.push(key)
    await cleanupDedupeKeys(MEMBERSHIP_SYNC_QUEUE, [key])
    await enqueueMembershipSync()
    await enqueueMembershipSync()
    const rows = (await rowsFor(MEMBERSHIP_SYNC_QUEUE)).filter((r) => r.dedupe_key === key)
    expect(rows).toHaveLength(1)
  })

  it('re-enqueues after success and leaves a running row alone', async () => {
    const key = membershipSyncDedupeKey()
    keys.push(key)
    await cleanupDedupeKeys(MEMBERSHIP_SYNC_QUEUE, [key])
    await enqueueMembershipSync()

    const [job] = await claimJobs({
      specs: [{ queue: MEMBERSHIP_SYNC_QUEUE, limit: 1, leaseMs: 60_000 }],
    })
    expect(job).toBeDefined()
    await enqueueMembershipSync()
    const inFlight = (await rowsFor(MEMBERSHIP_SYNC_QUEUE)).filter((r) => r.dedupe_key === key)
    expect(inFlight).toHaveLength(1)
    expect(inFlight[0].status).toBe('running')

    await completeJob(job)
    await enqueueMembershipSync()
    const after = (await rowsFor(MEMBERSHIP_SYNC_QUEUE)).filter((r) => r.dedupe_key === key)
    expect(after).toHaveLength(1)
    expect(after[0].status).toBe('pending')
  })
})

describe('membership mutation sites enqueue the job', () => {
  const serverRoot = path.resolve(__dirname, '../../..')

  it('invite send does not enqueue; accept, owner transfer and email change do', () => {
    const invite = readFileSync(path.join(serverRoot, 'functions/admin.ts'), 'utf8')
    const owner = readFileSync(path.join(serverRoot, 'functions/ownership.ts'), 'utf8')
    const contact = readFileSync(path.join(serverRoot, 'functions/contact-email.ts'), 'utf8')
    expect(invite).not.toContain('enqueueMembershipSync')
    expect(owner).toContain('enqueueMembershipSync')
    expect(contact).toContain('enqueueMembershipSync')
  })

  it('the role writer is the non-HTTP enqueue site', () => {
    const factory = readFileSync(
      path.join(serverRoot, 'domains/principals/principal.factory.ts'),
      'utf8'
    )
    expect(factory).toContain('enqueueMembershipSync')
    expect(factory).toContain('shouldSyncMembership')
  })

  it('retries on a minute-or-longer curve with a gated 15-minute backstop', () => {
    const def = findJobDefinition(MEMBERSHIP_SYNC_QUEUE)
    expect(def?.maxAttempts).toBe(MEMBERSHIP_SYNC_MAX_ATTEMPTS)
    expect(def?.retryBackoffMs).toBeGreaterThanOrEqual(60_000)
    expect(def?.cron).toBe('*/15 * * * *')
    expect(def?.cronEnabled).toBeTypeOf('function')
  })
})
