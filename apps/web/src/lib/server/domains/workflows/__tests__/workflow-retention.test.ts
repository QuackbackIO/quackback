/**
 * Real-DB coverage for workflow run retention (compactTerminalWorkflowRuns).
 * Mirrors workflow-sweep.test.ts's fixture idiom: runs are seeded directly
 * into workflow_runs so each case controls state/startedAt/graph exactly,
 * and every case runs inside the fixture's rolled-back transaction.
 */
import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { workflowRuns, workflowRunEvents, eq } from '@/lib/server/db'
import type { WorkflowGraph } from '../graph'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createWorkflow } from '../workflow.service'
import { compactTerminalWorkflowRuns } from '../workflow-retention'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: workflowRuns.id }).from(workflowRuns).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
const emptyGraph: WorkflowGraph = { nodes: [], edges: [] }
const nonEmptyGraph = { nodes: [{ id: 't', type: 'trigger' }], edges: [] }

async function seedWorkflow() {
  return createWorkflow({
    name: `retention test ${suffix()}`,
    class: 'background',
    triggerType: 'conversation.created',
    graph: emptyGraph,
  })
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)

describe.skipIf(!fixture.available)('compactTerminalWorkflowRuns (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('blanks the graph on an old terminal run with a non-empty graph', async () => {
    const wf = await seedWorkflow()
    const [run] = await testDb
      .insert(workflowRuns)
      .values({
        workflowId: wf.id,
        state: 'done',
        graph: nonEmptyGraph,
        startedAt: daysAgo(100),
      })
      .returning()

    const result = await compactTerminalWorkflowRuns({ olderThanDays: 90, batchSize: 500 })
    expect(result.compacted).toBe(1)

    const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
    expect(after.graph).toEqual({})
  })

  it('leaves a recent terminal run untouched', async () => {
    const wf = await seedWorkflow()
    const [run] = await testDb
      .insert(workflowRuns)
      .values({
        workflowId: wf.id,
        state: 'interrupted',
        graph: nonEmptyGraph,
        startedAt: daysAgo(1), // well inside the 90-day window
      })
      .returning()

    const result = await compactTerminalWorkflowRuns({ olderThanDays: 90 })
    expect(result.compacted).toBe(0)

    const [after] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
    expect(after.graph).toEqual(nonEmptyGraph)
  })

  it('leaves an old running/waiting run untouched regardless of age', async () => {
    const wf = await seedWorkflow()
    const [running] = await testDb
      .insert(workflowRuns)
      .values({
        workflowId: wf.id,
        state: 'running',
        graph: nonEmptyGraph,
        startedAt: daysAgo(200),
      })
      .returning()
    const [waiting] = await testDb
      .insert(workflowRuns)
      .values({
        workflowId: wf.id,
        state: 'waiting',
        graph: nonEmptyGraph,
        startedAt: daysAgo(200),
      })
      .returning()

    const result = await compactTerminalWorkflowRuns({ olderThanDays: 90 })
    expect(result.compacted).toBe(0)

    const rows = await testDb.select().from(workflowRuns).where(eq(workflowRuns.workflowId, wf.id))
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get(running.id)?.graph).toEqual(nonEmptyGraph)
    expect(byId.get(waiting.id)?.graph).toEqual(nonEmptyGraph)
  })

  it('is a no-op for a terminal run whose graph is already blanked', async () => {
    const wf = await seedWorkflow()
    await testDb.insert(workflowRuns).values({
      workflowId: wf.id,
      state: 'done',
      graph: {}, // already compacted (or never had a graph worth blanking)
      startedAt: daysAgo(200),
    })

    const result = await compactTerminalWorkflowRuns({ olderThanDays: 90 })
    expect(result.compacted).toBe(0)
  })

  it('never touches workflow_run_events for a compacted run', async () => {
    const wf = await seedWorkflow()
    const [run] = await testDb
      .insert(workflowRuns)
      .values({
        workflowId: wf.id,
        state: 'done',
        graph: nonEmptyGraph,
        startedAt: daysAgo(100),
      })
      .returning()
    await testDb.insert(workflowRunEvents).values({
      runId: run.id,
      workflowId: wf.id,
      subjectPrincipalId: null,
      kind: 'started',
    })

    await compactTerminalWorkflowRuns({ olderThanDays: 90 })

    const events = await testDb
      .select()
      .from(workflowRunEvents)
      .where(eq(workflowRunEvents.runId, run.id))
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('started')

    const [runRow] = await testDb.select().from(workflowRuns).where(eq(workflowRuns.id, run.id))
    expect(runRow).toBeDefined() // the run row itself is never deleted
  })

  it('loops in batches until every qualifying row is compacted', async () => {
    const wf = await seedWorkflow()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const [run] = await testDb
        .insert(workflowRuns)
        .values({
          workflowId: wf.id,
          state: i % 2 === 0 ? 'done' : 'interrupted',
          graph: nonEmptyGraph,
          startedAt: daysAgo(100),
        })
        .returning()
      ids.push(run.id)
    }

    const result = await compactTerminalWorkflowRuns({ olderThanDays: 90, batchSize: 2 })
    expect(result.compacted).toBe(5)

    const rows = await testDb.select().from(workflowRuns).where(eq(workflowRuns.workflowId, wf.id))
    expect(rows.every((r) => Object.keys(r.graph as object).length === 0)).toBe(true)
  })
})
