/**
 * Real-DB coverage for workflow version history + rollback (support platform
 * §4.6): a version is written on create and on a meaningful update, skipped
 * on a no-op save, pruned back to the retention cap, and a restore actually
 * round-trips an older snapshot back onto the live workflow via the normal
 * update path.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { workflowVersions } from '@/lib/server/db'

// Counts `db.select` property reads (one per call site, this codebase's
// only usage pattern) so a test can prove updateWorkflow skipped the
// version-check `before` read entirely for a patch that can't touch a
// version-worthy field — wraps testDb's own Proxy (see db-test-fixture.ts)
// rather than replacing it, so every other test's real-DB behavior is
// unaffected.
const dbCallCounts = vi.hoisted(() => ({ select: 0 }))
vi.mock('@/lib/server/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/db')>()
  const { testDb: fixtureDb } = await import('@/lib/server/__tests__/db-test-fixture')
  const countingDb = new Proxy(fixtureDb, {
    get(target, prop, receiver) {
      if (prop === 'select') dbCallCounts.select++
      return Reflect.get(target, prop, receiver)
    },
  })
  return { ...original, db: countingDb }
})

import { createWorkflow, updateWorkflow, getWorkflow, setWorkflowStatus } from '../workflow.service'
import {
  listWorkflowVersions,
  pruneWorkflowVersions,
  MAX_WORKFLOW_VERSIONS,
} from '../workflow-versions'
import type { WorkflowGraph } from '../graph'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: workflowVersions.id }).from(workflowVersions).limit(0)
  },
})

describe.skipIf(!fixture.available)('workflow-versions (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('writes an initial version on createWorkflow', async () => {
    const wf = await createWorkflow({
      name: 'Route billing',
      class: 'background',
      triggerType: 'conversation.created',
      triggerSettings: { channels: ['messenger'] },
      graph: { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
    })

    const versions = await listWorkflowVersions(wf.id)
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({
      workflowId: wf.id,
      name: 'Route billing',
      triggerType: 'conversation.created',
      triggerSettings: { channels: ['messenger'] },
      graph: { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
    })
  })

  it('writes a new version on a meaningful update (name change)', async () => {
    const wf = await createWorkflow({
      name: 'Original',
      class: 'background',
      triggerType: 'conversation.created',
    })
    await updateWorkflow(wf.id, { name: 'Renamed' })

    const versions = await listWorkflowVersions(wf.id)
    expect(versions).toHaveLength(2)
    expect(versions[0]!.name).toBe('Renamed') // newest first
    expect(versions[1]!.name).toBe('Original')
  })

  it('writes a new version on a meaningful update (graph change)', async () => {
    const wf = await createWorkflow({
      name: 'Greet',
      class: 'customer_facing',
      triggerType: 'conversation.created',
    })
    const graph = { nodes: [{ id: 't', type: 'trigger' as const }], edges: [] }
    await updateWorkflow(wf.id, { graph })

    const versions = await listWorkflowVersions(wf.id)
    expect(versions).toHaveLength(2)
    expect(versions[0]!.graph).toEqual(graph)
  })

  it('does NOT write a version on a no-op update (same name, or sortOrder-only)', async () => {
    const wf = await createWorkflow({
      name: 'Stable',
      class: 'background',
      triggerType: 'x',
    })
    expect(await listWorkflowVersions(wf.id)).toHaveLength(1)

    // Re-saving the identical name is a no-op for version purposes.
    await updateWorkflow(wf.id, { name: 'Stable' })
    expect(await listWorkflowVersions(wf.id)).toHaveLength(1)

    // A sortOrder-only patch (drag reorder) never touches the tracked fields.
    // Knowable from the patch's own keys alone, so updateWorkflow should skip
    // its `before` read entirely — not just skip the version write.
    const selectsBefore = dbCallCounts.select
    await updateWorkflow(wf.id, { sortOrder: 7 })
    expect(dbCallCounts.select).toBe(selectsBefore)
    expect(await listWorkflowVersions(wf.id)).toHaveLength(1)

    const stored = await getWorkflow(wf.id)
    expect(stored?.sortOrder).toBe(7)
  })

  it('prunes back to the newest MAX_WORKFLOW_VERSIONS after an insert', async () => {
    const wf = await createWorkflow({
      name: 'Pruned',
      class: 'background',
      triggerType: 'x',
    })
    // Clear the initial version so this test controls every row's timestamp
    // precisely, rather than reasoning about where "now" lands relative to
    // a batch of synthetic ones.
    await testDb.delete(workflowVersions).where(eq(workflowVersions.workflowId, wf.id))

    const total = MAX_WORKFLOW_VERSIONS + 10
    const base = Date.now() - total * 1000
    await testDb.insert(workflowVersions).values(
      Array.from({ length: total }, (_, i) => ({
        workflowId: wf.id,
        name: `v${i}`,
        triggerType: 'x',
        triggerSettings: {},
        graph: { nodes: [], edges: [] },
        createdBy: null,
        createdAt: new Date(base + i * 1000),
      }))
    )

    await pruneWorkflowVersions(wf.id)

    const versions = await listWorkflowVersions(wf.id)
    expect(versions).toHaveLength(MAX_WORKFLOW_VERSIONS)
    // Newest-first: the last-inserted (highest i) survive; the oldest 10 (v0..v9) are pruned.
    expect(versions[0]!.name).toBe(`v${total - 1}`)
    expect(versions.some((v) => v.name === 'v0')).toBe(false)
    expect(versions.some((v) => v.name === 'v9')).toBe(false)
    expect(versions.some((v) => v.name === 'v10')).toBe(true)
  })

  it('restore round-trip: applying an old version via updateWorkflow restores its state, creates a new version, and preserves status', async () => {
    const wf = await createWorkflow({
      name: 'v1 name',
      class: 'background',
      triggerType: 'conversation.created',
      graph: { nodes: [{ id: 't', type: 'trigger' as const }], edges: [] },
    })
    await updateWorkflow(wf.id, { name: 'v2 name', graph: { nodes: [], edges: [] } })
    await setWorkflowStatus(wf.id, 'live')

    const versionsAfterEdits = await listWorkflowVersions(wf.id)
    expect(versionsAfterEdits).toHaveLength(2)
    const v1 = versionsAfterEdits[1]! // oldest = the original save

    // "Restore" = apply the old snapshot via the SAME update path a save uses.
    // v1.graph is the generic jsonb shape (Record<string, unknown>); the cast
    // mirrors functions/workflows.ts's own toGraph() at the same boundary.
    const restored = await updateWorkflow(wf.id, {
      name: v1.name,
      triggerType: v1.triggerType,
      triggerSettings: v1.triggerSettings,
      graph: v1.graph as unknown as WorkflowGraph,
    })

    expect(restored.name).toBe('v1 name')
    expect(restored.graph).toEqual({ nodes: [{ id: 't', type: 'trigger' }], edges: [] })
    // Status is untouched by a restore — it's not part of what updateWorkflow's
    // patch here even mentions, let alone what a version snapshot stores.
    expect(restored.status).toBe('live')

    // The restore itself is an ordinary meaningful update, so it produces a
    // THIRD version row — history grows forward, it never "un-does" itself.
    const versionsAfterRestore = await listWorkflowVersions(wf.id)
    expect(versionsAfterRestore).toHaveLength(3)
    expect(versionsAfterRestore[0]!.name).toBe('v1 name')
  })
})
