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
import {
  enqueueMembershipSync,
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

vi.mock('@/lib/server/workspaces/wake-nudge', () => ({
  nudgeWorker: vi.fn(),
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
  it('writes a retryable row under the minute-bucket key', async () => {
    const key = membershipSyncDedupeKey()
    keys.push(key)
    await cleanupDedupeKeys(MEMBERSHIP_SYNC_QUEUE, [key])
    await enqueueMembershipSync()
    const rows = (await rowsFor(MEMBERSHIP_SYNC_QUEUE)).filter((r) => r.dedupe_key === key)
    expect(rows).toHaveLength(1)
    expect(rows[0].max_attempts).toBe(MEMBERSHIP_SYNC_MAX_ATTEMPTS)
    expect(rows[0].max_attempts).toBeGreaterThanOrEqual(3)
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
})

describe('membership mutation sites enqueue the job', () => {
  const serverRoot = path.resolve(__dirname, '../../..')

  it('invite send and owner transfer call enqueueMembershipSync', () => {
    const invite = readFileSync(path.join(serverRoot, 'functions/admin.ts'), 'utf8')
    const owner = readFileSync(path.join(serverRoot, 'functions/ownership.ts'), 'utf8')
    expect(invite).toContain('enqueueMembershipSync')
    expect(owner).toContain('enqueueMembershipSync')
  })

  it('the role writer is the non-HTTP enqueue site', () => {
    const factory = readFileSync(
      path.join(serverRoot, 'domains/principals/principal.factory.ts'),
      'utf8'
    )
    expect(factory).toContain('enqueueMembershipSync')
    expect(factory).toContain('shouldSyncMembership')
  })
})
