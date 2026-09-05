/**
 * Contract
 *
 *   V1  Every sink that registerAllResolvers() knows about takes part in
 *       production fan-out: an event the dispatcher processes is resolved
 *       against a POPULATED registry, never an empty one.
 *
 * Regression guard. The WO-18 cutover removed the last production caller of
 * getHookTargets(), and with it the only call to registerAllResolvers(). The
 * registry stayed empty for the whole process lifetime, so resolveTargets()
 * returned [] for every event: the row was stamped published, no hook job was
 * ever enqueued, and no sink fired at all — integrations, webhooks,
 * notifications, AI, workflows. Nothing logged, nothing errored.
 *
 * Deliberately DB-free: the handler registers before it touches the event row,
 * so a payload without an eventId exercises the wiring and returns early.
 */
import { describe, expect, it } from 'vitest'
import { createId } from '@quackback/ids'
import { runEventDispatch } from '../event-dispatch-queue'
import { listResolvers } from '../resolvers/registry'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'

/** A claimed job whose payload carries no eventId — the handler returns before any DB access. */
function jobWithoutEvent(): ClaimedJob {
  return {
    id: '1',
    jobId: createId('job'),
    queue: 'event-dispatch',
    dedupeKey: null,
    payload: {},
    workspaceKey: null,
    attempts: 1,
    maxAttempts: 10,
    leaseToken: 'test',
    lockedUntil: new Date(),
  }
}

describe('event-dispatch resolves against a populated sink registry', () => {
  it('registers the sinks before resolving (V1)', async () => {
    await runEventDispatch(jobWithoutEvent())

    // Not pinned to an exact set — a ninth resolver is a legitimate change, an
    // empty registry never is.
    expect(listResolvers().length).toBeGreaterThan(0)
    expect(listResolvers().map((r) => r.sink)).toContain('integration')
  })

  it('stays populated across dispatches without duplicating registrations (V1)', async () => {
    await runEventDispatch(jobWithoutEvent())
    const afterFirst = listResolvers().length

    await runEventDispatch(jobWithoutEvent())

    expect(listResolvers()).toHaveLength(afterFirst)
  })
})
