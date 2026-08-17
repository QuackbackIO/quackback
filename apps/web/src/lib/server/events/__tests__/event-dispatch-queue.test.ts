import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
import { createId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => {
  // oxlint-disable-next-line no-restricted-imports
  const { createDb } = await import('@quackback/db/client')
  const url =
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: createDb(url, { max: 5, prepare: false }),
  }
})

import { db, events, eq } from '@/lib/server/db'
import { runEventDispatch } from '../event-dispatch-queue'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

function job(eventId: string, attempts = 1): ClaimedJob {
  return {
    id: 1n as unknown as ClaimedJob['id'],
    jobId: createId('job'),
    queue: 'event-dispatch',
    dedupeKey: `event-dispatch:${eventId}`,
    payload: { eventId },
    workspaceKey: null,
    attempts,
    maxAttempts: 10,
    leaseToken: 'test',
    lockedUntil: new Date(),
  }
}

describe('runEventDispatch', () => {
  beforeAll(async () => {
    const url =
      process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
    const admin = postgres(url, { max: 1, onnotice: () => {} })
    try {
      await admin.unsafe(
        readFileSync(
          path.resolve(
            __dirname,
            '../../../../../../../packages/db/drizzle/0269_event_dispatch_owner.sql'
          ),
          'utf8'
        )
      )
    } finally {
      await admin.end({ timeout: 2 })
    }
  })

  it('is a no-op for a missing or already-published event', async () => {
    await expect(runEventDispatch(job('evt_does_not_exist'))).resolves.toBeUndefined()

    const eventId = createId('event')
    await db.insert(events).values({
      eventId,
      type: 'test.dispatch_published',
      entityType: 'post',
      entityId: createId('post'),
      actorType: 'system',
      payload: {},
      dispatchOwner: 'job',
      publishedAt: new Date(),
    })
    await expect(runEventDispatch(job(eventId))).resolves.toBeUndefined()
  })

  it('does not publish a relay-owned row', async () => {
    const eventId = createId('event')
    await db.insert(events).values({
      eventId,
      type: 'test.dispatch_relay',
      entityType: 'post',
      entityId: createId('post'),
      actorType: 'system',
      payload: {},
      dispatchOwner: 'relay',
    })
    await runEventDispatch(job(eventId))
    const [row] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(row.publishedAt).toBeNull()
  })
})
