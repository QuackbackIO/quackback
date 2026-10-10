import { beforeEach, expect, it, vi } from 'vitest'

const { registerAllResolvers, resolveTargets } = vi.hoisted(() => ({
  registerAllResolvers: vi.fn(),
  resolveTargets: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
      }),
    }),
  },
  events: { eventId: 'event_id' },
  eq: vi.fn(),
  sql: vi.fn(),
}))
vi.mock('@/lib/server/jobs/job-queue', () => ({ enqueueJob: vi.fn() }))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) },
}))
vi.mock('@/lib/server/workspaces/after-commit', () => ({ SINGLE_WORKSPACE_KEY: 'single' }))
vi.mock('@/lib/server/workspaces/workspace-context', () => ({
  getCurrentWorkspace: () => null,
}))
vi.mock('../process', () => ({ enqueueHookJobsWithIds: vi.fn() }))
vi.mock('../outbox', () => ({
  hydrateEvent: vi.fn(),
  MAX_DEPTH: 5,
  MAX_STRICT_RESOLVE_ATTEMPTS: 3,
}))
vi.mock('../resolvers', () => ({ registerAllResolvers, resolveTargets }))
vi.mock('../to-legacy-event', () => ({ toLegacyEvent: vi.fn() }))

import { runEventDispatch } from '../event-dispatch-queue'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

const job = {
  id: 1n as unknown as ClaimedJob['id'],
  jobId: 'job_1' as ClaimedJob['jobId'],
  queue: 'event-dispatch',
  dedupeKey: 'event-dispatch:event_1',
  payload: { eventId: 'event_1' },
  workspaceKey: null,
  attempts: 1,
  maxAttempts: 10,
  leaseToken: 'lease_1',
  lockedUntil: new Date(),
  runAt: new Date(),
} satisfies ClaimedJob

beforeEach(() => {
  registerAllResolvers.mockClear()
  resolveTargets.mockClear()
})

it('registers production sinks before using the default resolver', async () => {
  await runEventDispatch(job)

  expect(registerAllResolvers).toHaveBeenCalledOnce()
})

it('does not touch global registration when a test supplies a resolver', async () => {
  const resolve = vi.fn()

  await runEventDispatch(job, { resolve })

  expect(registerAllResolvers).not.toHaveBeenCalled()
})
