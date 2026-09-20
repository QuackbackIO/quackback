import { afterEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
vi.mock('@/lib/server/db', async (original) => {
  // oxlint-disable-next-line no-restricted-imports
  const { createDb } = await import('@quackback/db/client')
  return {
    ...(await original<typeof import('@/lib/server/db')>()),
    db: createDb(process.env.DATABASE_URL!, { max: 8, prepare: false }),
  }
})
import { db, sql } from '@/lib/server/db'
import { enqueueHookJobsWithIds, retryIntegrationDelivery } from '../process'
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import { integrationDeliveryKey, completeIntegrationDelivery } from '../integration-delivery'
import type { HookJobData } from '../hook-job'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
const fixtures: HookJobData[] = []
function delivery(type = 'linear'): HookJobData {
  const data: HookJobData = {
    hookType: type,
    target: { channelId: 'team' },
    config: { integrationId: createId('integration') },
    event: {
      id: createId('event'),
      type: 'post.created',
      timestamp: new Date().toISOString(),
      actor: { type: 'service' },
      data: {
        post: {
          id: createId('post'),
          title: 'Queue regression',
          boardId: createId('board'),
          boardSlug: 'bugs',
          voteCount: 0,
          content: 'Test',
        },
      },
    },
  }
  fixtures.push(data)
  return data
}
async function rows(data: HookJobData) {
  return getExecuteRows<{
    status: string
    attempts: number
    dedupe_key: string
    job_id: string
    lease_token: string | null
  }>(
    await db.execute(
      sql`SELECT * FROM job_queue WHERE payload->'config'->>'integrationId' = ${data.config.integrationId as string}`
    )
  )
}
afterEach(async () => {
  for (const data of fixtures.splice(0)) {
    await db.execute(
      sql`DELETE FROM job_queue WHERE payload->'config'->>'integrationId' = ${data.config.integrationId as string}`
    )
    await db.execute(
      sql`DELETE FROM hook_deliveries WHERE job_id = ${integrationDeliveryKey(data)}`
    )
  }
})
describe('shared integration delivery (PostgreSQL)', () => {
  it.each(['linear', 'github', 'slack'])(
    '%s deduplicates original fan-out and concurrent manual retries',
    async (type) => {
      const data = delivery(type)
      await Promise.all([
        enqueueHookJobsWithIds([{ name: 'post.created', data, jobId: 'original-event-key' }]),
        ...Array.from({ length: 5 }, () =>
          retryIntegrationDelivery({ ...data, event: { ...data.event, id: createId('event') } })
        ),
      ])
      const jobs = await rows(data)
      expect(jobs).toHaveLength(1)
      expect(jobs[0].dedupe_key).toBe(integrationDeliveryKey(data))
      expect(jobs[0].status).toBe('pending')
    }
  )
  it('keeps integration instances and destinations independent', async () => {
    const data = delivery()
    const other = { ...data, target: { channelId: 'other-team' } }
    await retryIntegrationDelivery(data)
    await retryIntegrationDelivery(other)
    expect(await rows(data)).toHaveLength(2)
  })
  it('adopts a pre-upgrade pending job without creating a second job', async () => {
    const data = delivery()
    await enqueueJob({
      queue: 'events',
      dedupeKey: 'legacy-' + createId('event'),
      payload: data as unknown as Record<string, unknown>,
      maxAttempts: 6,
    })
    expect(await retryIntegrationDelivery(data)).toBe(true)
    expect(await rows(data)).toHaveLength(1)
  })
  it('revives a failed job once with fresh payload and attempts', async () => {
    const data = delivery()
    await retryIntegrationDelivery(data)
    await db.execute(
      sql`UPDATE job_queue SET status = 'failed', attempts = 6, last_error = 'old failure', finished_at = now() WHERE dedupe_key = ${integrationDeliveryKey(data)}`
    )
    await Promise.all([retryIntegrationDelivery(data), retryIntegrationDelivery(data)])
    const jobs = await rows(data)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].status).toBe('pending')
    expect(jobs[0].attempts).toBe(0)
  })
  it('never steals a running lease', async () => {
    const data = delivery()
    await retryIntegrationDelivery(data)
    const token = crypto.randomUUID()
    await db.execute(
      sql`UPDATE job_queue SET status = 'running', attempts = 1, lease_token = ${token}::uuid, locked_until = now() + interval '1 minute' WHERE dedupe_key = ${integrationDeliveryKey(data)}`
    )
    expect(await retryIntegrationDelivery(data)).toBe(true)
    const [job] = await rows(data)
    expect(job.status).toBe('running')
    expect(job.lease_token).toBe(token)
  })
  it('keeps completed deliveries deduplicated after queue retention', async () => {
    const data = delivery('slack')
    await retryIntegrationDelivery(data)
    await completeIntegrationDelivery(integrationDeliveryKey(data)!, data.hookType)
    await db.execute(sql`DELETE FROM job_queue WHERE dedupe_key = ${integrationDeliveryKey(data)}`)
    expect(await retryIntegrationDelivery(data)).toBe(false)
    expect(await rows(data)).toHaveLength(0)
  })
  it('rejects instead of reporting queued when PostgreSQL rejects insertion', async () => {
    const data = delivery()
    if (data.event.type === 'post.created') data.event.data.post.title = 'Queue rejection test'
    await db.execute(
      sql`CREATE FUNCTION review_test_reject_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected queue failure'; END $$`
    )
    await db.execute(
      sql`CREATE TRIGGER review_test_reject_job BEFORE INSERT ON job_queue FOR EACH ROW WHEN (NEW.payload->'event'->'data'->'post'->>'title' = 'Queue rejection test') EXECUTE FUNCTION review_test_reject_job()`
    )
    try {
      await expect(retryIntegrationDelivery(data)).rejects.toThrow()
      expect(await rows(data)).toHaveLength(0)
    } finally {
      await db.execute(sql`DROP TRIGGER review_test_reject_job ON job_queue`)
      await db.execute(sql`DROP FUNCTION review_test_reject_job()`)
    }
    expect(await retryIntegrationDelivery(data)).toBe(true)
  })
})
