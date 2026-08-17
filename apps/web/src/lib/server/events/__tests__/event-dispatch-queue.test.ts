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
import { drainOnce } from '../relay'
import { MAX_STRICT_RESOLVE_ATTEMPTS } from '../relay'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import type { HookTarget } from '../hook-types'

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

async function insertEvent(opts: {
  eventId?: string
  owner: 'job' | 'relay'
  published?: boolean
  depth?: number
  type?: string
}): Promise<string> {
  const eventId = opts.eventId ?? createId('event')
  await db.insert(events).values({
    eventId,
    type: opts.type ?? 'post.created',
    entityType: 'post',
    entityId: createId('post'),
    actorType: 'system',
    payload: {},
    context: { depth: opts.depth ?? 0 },
    dispatchOwner: opts.owner,
    publishedAt: opts.published ? new Date() : null,
  })
  return eventId
}

const webhookAndWorkflow = async (): Promise<HookTarget[]> => [
  {
    type: 'webhook',
    target: { url: 'https://example.test/hook' },
    config: { webhookId: 'wh_1' },
    deliveryKey: 'wh_1',
  },
  {
    type: 'workflow',
    target: { workflowId: 'wf_1' },
    config: {},
    deliveryKey: 'wf_1',
  },
]

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
    const enqueued: Array<{ jobId: string }> = []
    await expect(
      runEventDispatch(job('evt_does_not_exist'), {
        enqueue: async (jobs) => {
          enqueued.push(...jobs)
        },
      })
    ).resolves.toBeUndefined()
    expect(enqueued).toEqual([])

    const eventId = await insertEvent({ owner: 'job', published: true })
    await expect(
      runEventDispatch(job(eventId), {
        enqueue: async (jobs) => {
          enqueued.push(...jobs)
        },
      })
    ).resolves.toBeUndefined()
    expect(enqueued).toEqual([])
  })

  it('does not publish a relay-owned row', async () => {
    const eventId = await insertEvent({ owner: 'relay' })
    await runEventDispatch(job(eventId), { resolve: webhookAndWorkflow })
    const [row] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(row.publishedAt).toBeNull()
  })

  it('is idempotent: a second run enqueues nothing', async () => {
    const eventId = await insertEvent({ owner: 'job' })
    const enqueued: string[] = []
    const enqueue = async (jobs: Array<{ jobId: string }>) => {
      enqueued.push(...jobs.map((j) => j.jobId))
    }
    await runEventDispatch(job(eventId), { resolve: webhookAndWorkflow, enqueue })
    const [first] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(first.publishedAt).not.toBeNull()
    expect(enqueued).toHaveLength(2)

    await runEventDispatch(job(eventId), { resolve: webhookAndWorkflow, enqueue })
    expect(enqueued).toHaveLength(2)
  })

  it('duplicate concurrent execution uses the same deterministic keys', async () => {
    const eventId = await insertEvent({ owner: 'job' })
    const keys: string[] = []
    const enqueue = async (jobs: Array<{ jobId: string }>) => {
      keys.push(...jobs.map((j) => j.jobId))
    }
    await Promise.all([
      runEventDispatch(job(eventId), { resolve: webhookAndWorkflow, enqueue }),
      runEventDispatch(job(eventId), { resolve: webhookAndWorkflow, enqueue }),
    ])
    expect(new Set(keys).size).toBe(2)
    expect(keys.every((k) => k.startsWith(`${eventId}:`))).toBe(true)
    const [row] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(row.publishedAt).not.toBeNull()
  })

  it('preserves the reaction-loop depth ceiling', async () => {
    const eventId = await insertEvent({ owner: 'job', depth: 6 })
    const enqueued: unknown[] = []
    await runEventDispatch(job(eventId), {
      resolve: webhookAndWorkflow,
      enqueue: async (jobs) => {
        enqueued.push(...jobs)
      },
    })
    const [row] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(row.publishedAt).not.toBeNull()
    expect(enqueued).toEqual([])
  })

  it('rethrows a strict destination-resolution failure and leaves the event unpublished', async () => {
    const eventId = await insertEvent({ owner: 'job' })
    await expect(
      runEventDispatch(job(eventId, 1), {
        resolve: async () => {
          throw new Error('webhook sink down')
        },
      })
    ).rejects.toThrow('webhook sink down')
    const [row] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(row.publishedAt).toBeNull()
  })

  it('degrades to best-effort after the strict retry budget', async () => {
    const eventId = await insertEvent({ owner: 'job' })
    const modes: Array<boolean | undefined> = []
    const enqueued: string[] = []
    await runEventDispatch(job(eventId, MAX_STRICT_RESOLVE_ATTEMPTS), {
      resolve: async (_event, opts) => {
        modes.push(opts?.bestEffort)
        return webhookAndWorkflow()
      },
      enqueue: async (jobs) => {
        enqueued.push(...jobs.map((j) => j.jobId))
      },
    })
    expect(modes).toEqual([true])
    expect(enqueued).toHaveLength(2)
    const [row] = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(row.publishedAt).not.toBeNull()
  })

  it('matches the relay job-id shape for webhook and workflow targets', async () => {
    const eventId = await insertEvent({ owner: 'job' })
    const fromJob: string[] = []
    await runEventDispatch(job(eventId), {
      resolve: webhookAndWorkflow,
      enqueue: async (jobs) => {
        fromJob.push(...jobs.map((j) => j.jobId))
      },
    })

    const relayEventId = await insertEvent({ owner: 'relay' })
    const fromRelay: string[] = []
    await drainOnce({
      resolve: webhookAndWorkflow,
      enqueue: async (jobs) => {
        fromRelay.push(...jobs.map((j) => j.jobId))
      },
    })

    const jobSuffixes = fromJob.map((k) => k.slice(eventId.length)).sort()
    const relayOurs = fromRelay
      .filter((k) => k.startsWith(`${relayEventId}:`))
      .map((k) => k.slice(relayEventId.length))
      .sort()
    expect(jobSuffixes).toEqual(relayOurs)
    expect(jobSuffixes.some((s) => s.startsWith(':webhook:'))).toBe(true)
    expect(jobSuffixes.some((s) => s.startsWith(':workflow:'))).toBe(true)
  })

  it('lets job-owned and relay-owned unpublished rows coexist', async () => {
    const jobId = await insertEvent({ owner: 'job' })
    const relayId = await insertEvent({ owner: 'relay' })

    await runEventDispatch(job(jobId), { resolve: webhookAndWorkflow, enqueue: async () => {} })
    await drainOnce({
      resolve: webhookAndWorkflow,
      enqueue: async () => {},
    })

    const [jobRow] = await db.select().from(events).where(eq(events.eventId, jobId))
    const [relayRow] = await db.select().from(events).where(eq(events.eventId, relayId))
    expect(jobRow.publishedAt).not.toBeNull()
    expect(relayRow.publishedAt).not.toBeNull()
    expect(jobRow.dispatchOwner).toBe('job')
    expect(relayRow.dispatchOwner).toBe('relay')
  })
})
