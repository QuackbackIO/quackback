/**
 * Real-DB coverage for workflow effectiveness reporting (§7): per-workflow run
 * counts by state over a date range, plus the per-run drill-down
 * (listWorkflowRuns / workflowRunTimeline) — the read side of
 * workflow_run_events, previously write-only. Fixture rollback.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  workflows,
  workflowRuns,
  workflowRunEvents,
  conversations,
  principal,
  user,
  type Workflow,
} from '@/lib/server/db'
import { createId, type ConversationId, type PrincipalId, type UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { workflowEffectiveness, listWorkflowRuns, workflowRunTimeline } from '../workflow-reporting'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: workflowRuns.id }).from(workflowRuns).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedWorkflow(): Promise<Workflow> {
  const [row] = await testDb
    .insert(workflows)
    .values({ name: `wf-${suffix()}`, class: 'background', triggerType: 'x' })
    .returning()
  return row
}

async function seedConversation(): Promise<ConversationId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `V-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: principalId, channel: 'messenger' })
    .returning()
  return row.id
}

// One shared fixture across all three describe blocks in this file (same
// connection pool) — `close` only runs once, in the LAST block's afterAll;
// each earlier block calling it too would tear the pool down before the
// blocks that follow ever get to `begin`.
describe.skipIf(!fixture.available)('workflowEffectiveness (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('aggregates run states per workflow within the range', async () => {
    const wf = await seedWorkflow()
    const run = (state: string, startedAt: string) => ({
      workflowId: wf.id,
      state: state as never,
      startedAt: new Date(startedAt),
    })
    await testDb.insert(workflowRuns).values([
      run('done', '2026-01-05T10:00:00Z'),
      run('done', '2026-01-05T11:00:00Z'),
      run('interrupted', '2026-01-05T12:00:00Z'),
      run('waiting', '2026-01-05T13:00:00Z'),
      // Outside the range — excluded.
      run('done', '2026-02-01T10:00:00Z'),
    ])

    const res = await workflowEffectiveness(
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z')
    )
    expect(res).toHaveLength(1)
    expect(res[0]).toEqual({
      workflowId: wf.id,
      started: 4, // every in-range run
      completed: 2,
      interrupted: 1,
      waiting: 1,
      sentRuns: 0,
      engagedRuns: 0,
    })
  })

  it('returns an empty array when no runs fall in the range', async () => {
    await seedWorkflow()
    const res = await workflowEffectiveness(
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-02T00:00:00Z')
    )
    expect(res).toEqual([])
  })

  it('counts DISTINCT runs for the funnel — a run with several block_sent events counts once', async () => {
    const wf = await seedWorkflow()
    const [run1] = await testDb
      .insert(workflowRuns)
      .values({ workflowId: wf.id, state: 'done', startedAt: new Date('2026-01-05T10:00:00Z') })
      .returning()
    const [run2] = await testDb
      .insert(workflowRuns)
      .values({ workflowId: wf.id, state: 'waiting', startedAt: new Date('2026-01-05T11:00:00Z') })
      .returning()

    await testDb.insert(workflowRunEvents).values([
      // run1: sent three times, engaged once — still one distinct run each.
      { runId: run1.id, workflowId: wf.id, kind: 'block_sent' },
      { runId: run1.id, workflowId: wf.id, kind: 'block_sent' },
      { runId: run1.id, workflowId: wf.id, kind: 'block_sent' },
      { runId: run1.id, workflowId: wf.id, kind: 'block_engaged' },
      // run2: sent only, never engaged.
      { runId: run2.id, workflowId: wf.id, kind: 'block_sent' },
      // An unrelated kind on run1 must not be counted as sent/engaged.
      { runId: run1.id, workflowId: wf.id, kind: 'completed' },
    ])

    const res = await workflowEffectiveness(
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z')
    )
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ workflowId: wf.id, sentRuns: 2, engagedRuns: 1 })
  })

  it("counts a funnel event against the run's own started_at window, not the event's own timestamp", async () => {
    const wf = await seedWorkflow()
    // The run started INSIDE the window; its block_sent event lands well
    // after it (a customer can take hours to answer) but must still count,
    // because the join is on the RUN's started_at, not the event's own `at`.
    const [run] = await testDb
      .insert(workflowRuns)
      .values({ workflowId: wf.id, state: 'done', startedAt: new Date('2026-01-05T10:00:00Z') })
      .returning()
    await testDb.insert(workflowRunEvents).values({
      runId: run.id,
      workflowId: wf.id,
      kind: 'block_sent',
      at: new Date('2026-01-06T20:00:00Z'),
    })

    const res = await workflowEffectiveness(
      new Date('2026-01-05T00:00:00Z'),
      new Date('2026-01-06T00:00:00Z') // the event's own `at` falls OUTSIDE this range
    )
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ sentRuns: 1 })
  })

  it('excludes a funnel event whose run started OUTSIDE the range even if the event itself falls inside it', async () => {
    const wf = await seedWorkflow()
    const [run] = await testDb
      .insert(workflowRuns)
      .values({ workflowId: wf.id, state: 'done', startedAt: new Date('2025-12-01T00:00:00Z') })
      .returning()
    await testDb.insert(workflowRunEvents).values({
      runId: run.id,
      workflowId: wf.id,
      kind: 'block_sent',
      at: new Date('2026-01-05T10:00:00Z'), // inside the query range
    })

    const res = await workflowEffectiveness(
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z')
    )
    expect(res).toEqual([]) // the run itself started before the range
  })
})

describe.skipIf(!fixture.available)('listWorkflowRuns (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it("returns a workflow's runs newest-first, with the drill-down shape", async () => {
    const wf = await seedWorkflow()
    const conversationId = await seedConversation()
    const older = new Date('2026-01-05T10:00:00Z')
    const newer = new Date('2026-01-05T12:00:00Z')
    const [run1] = await testDb
      .insert(workflowRuns)
      .values({
        workflowId: wf.id,
        conversationId,
        state: 'done',
        startedAt: older,
        endedAt: new Date('2026-01-05T10:05:00Z'),
      })
      .returning()
    const [run2] = await testDb
      .insert(workflowRuns)
      .values({ workflowId: wf.id, conversationId: null, state: 'waiting', startedAt: newer })
      .returning()

    const rows = await listWorkflowRuns(wf.id)
    expect(rows.map((r) => r.id)).toEqual([run2.id, run1.id]) // newest first
    expect(rows[1]).toEqual({
      id: run1.id,
      state: 'done',
      startedAt: older,
      endedAt: new Date('2026-01-05T10:05:00Z'),
      conversationId,
    })
    expect(rows[0]).toMatchObject({ id: run2.id, state: 'waiting', endedAt: null })
  })

  it("never returns another workflow's runs", async () => {
    const wf1 = await seedWorkflow()
    const wf2 = await seedWorkflow()
    await testDb.insert(workflowRuns).values({ workflowId: wf1.id, state: 'done' })
    await testDb.insert(workflowRuns).values({ workflowId: wf2.id, state: 'done' })

    const rows = await listWorkflowRuns(wf1.id)
    expect(rows).toHaveLength(1)
  })

  it('respects the limit (default WORKFLOW_RUN_LIST_LIMIT, or an explicit override)', async () => {
    const wf = await seedWorkflow()
    for (let i = 0; i < 5; i++) {
      await testDb.insert(workflowRuns).values({ workflowId: wf.id, state: 'done' })
    }
    expect(await listWorkflowRuns(wf.id, 3)).toHaveLength(3)
  })

  it('returns an empty array for a workflow with no runs', async () => {
    const wf = await seedWorkflow()
    expect(await listWorkflowRuns(wf.id)).toEqual([])
  })
})

describe.skipIf(!fixture.available)('workflowRunTimeline (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it("returns one run's events oldest-first, excluding a sibling run's events", async () => {
    const wf = await seedWorkflow()
    const [run1] = await testDb
      .insert(workflowRuns)
      .values({ workflowId: wf.id, state: 'done' })
      .returning()
    const [run2] = await testDb
      .insert(workflowRuns)
      .values({ workflowId: wf.id, state: 'done' })
      .returning()

    await testDb.insert(workflowRunEvents).values([
      { runId: run1.id, workflowId: wf.id, kind: 'started', at: new Date('2026-01-05T10:00:00Z') },
      {
        runId: run1.id,
        workflowId: wf.id,
        kind: 'action_failed:add_note',
        at: new Date('2026-01-05T10:00:05Z'),
      },
      {
        runId: run1.id,
        workflowId: wf.id,
        kind: 'completed',
        at: new Date('2026-01-05T10:00:10Z'),
      },
      // A sibling run's events must never leak into run1's timeline.
      { runId: run2.id, workflowId: wf.id, kind: 'started', at: new Date('2026-01-05T11:00:00Z') },
    ])

    const timeline = await workflowRunTimeline(run1.id)
    expect(timeline.map((e) => e.kind)).toEqual(['started', 'action_failed:add_note', 'completed'])
    expect(timeline[0]!.at).toEqual(new Date('2026-01-05T10:00:00Z'))
  })

  it('returns an empty array for a run with no logged events', async () => {
    const wf = await seedWorkflow()
    const [run] = await testDb
      .insert(workflowRuns)
      .values({ workflowId: wf.id, state: 'running' })
      .returning()
    expect(await workflowRunTimeline(run.id)).toEqual([])
  })
})
