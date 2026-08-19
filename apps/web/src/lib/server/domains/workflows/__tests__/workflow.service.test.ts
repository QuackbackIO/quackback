/**
 * Real-DB coverage for workflow CRUD (§4.6, Slice 5b): create with graph defaults,
 * the lifecycle transition, drag order, the soft-delete filter, and the
 * dispatcher's live-for-trigger read (which excludes draft/paused/deleted and
 * other triggers). Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'
import { workflows } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  createWorkflow,
  listWorkflows,
  getWorkflow,
  updateWorkflow,
  setWorkflowStatus,
  softDeleteWorkflow,
  reorderWorkflows,
  listLiveWorkflowsForTrigger,
  getLiveWorkflowReferencedAttributeKeys,
  __resetLiveWorkflowReferencedAttributeKeysCache,
  hasAnyLiveWorkflow,
  invalidateHasLiveWorkflowCache,
} from '../workflow.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: workflows.id }).from(workflows).limit(0)
  },
})

describe.skipIf(!fixture.available)('workflow.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('creates with graph/settings defaults and reads back', async () => {
    const wf = await createWorkflow({
      name: 'Route billing',
      class: 'background',
      triggerType: 'conversation.created',
    })
    expect(wf.status).toBe('draft')
    expect(wf.graph).toEqual({ nodes: [], edges: [] })
    expect(wf.triggerSettings).toEqual({})
    expect((await getWorkflow(wf.id))?.id).toBe(wf.id)
  })

  it('updates the graph + settings and transitions lifecycle', async () => {
    const wf = await createWorkflow({
      name: 'Greet',
      class: 'customer_facing',
      triggerType: 'conversation.created',
    })
    const graph = {
      nodes: [{ id: 't', type: 'trigger' as const }],
      edges: [],
    }
    const updated = await updateWorkflow(wf.id, {
      graph,
      triggerSettings: { channels: ['messenger'] },
    })
    expect(updated.graph).toEqual(graph)
    expect(updated.triggerSettings).toEqual({ channels: ['messenger'] })

    const live = await setWorkflowStatus(wf.id, 'live')
    expect(live.status).toBe('live')
  })

  it('lists in drag order and hides soft-deleted', async () => {
    const a = await createWorkflow({
      name: 'A',
      class: 'background',
      triggerType: 'x',
      sortOrder: 2,
    })
    const b = await createWorkflow({
      name: 'B',
      class: 'background',
      triggerType: 'x',
      sortOrder: 1,
    })
    // Filtered to this test's own rows: listWorkflows is workspace-global and
    // this transaction reads the shared test database under READ COMMITTED, so
    // a workflow committed by a concurrently-running test file (frequency-cap-
    // race.test.ts commits one mid-run) would otherwise appear in the list and
    // flake an exact-equality assertion. The properties under test — drag
    // order and the soft-delete filter — hold on the filtered view unchanged.
    const ours = (list: { id: string }[]) =>
      list.map((w) => w.id).filter((id) => id === a.id || id === b.id)
    expect(ours(await listWorkflows())).toEqual([b.id, a.id]) // sortOrder asc

    await softDeleteWorkflow(a.id)
    expect(ours(await listWorkflows())).toEqual([b.id])
    expect(await getWorkflow(a.id)).toBeNull()
  })

  it('live-for-trigger excludes draft/paused/deleted and other triggers', async () => {
    const liveA = await createWorkflow({
      name: 'liveA',
      class: 'background',
      triggerType: 'msg',
      sortOrder: 1,
    })
    await setWorkflowStatus(liveA.id, 'live')
    const liveB = await createWorkflow({
      name: 'liveB',
      class: 'customer_facing',
      triggerType: 'msg',
      sortOrder: 0,
    })
    await setWorkflowStatus(liveB.id, 'live')
    const draft = await createWorkflow({ name: 'draft', class: 'background', triggerType: 'msg' })
    const otherTrigger = await createWorkflow({
      name: 'other',
      class: 'background',
      triggerType: 'assign',
    })
    await setWorkflowStatus(otherTrigger.id, 'live')

    const forMsg = await listLiveWorkflowsForTrigger('msg')
    // Only the two live 'msg' workflows, in sortOrder (liveB=0 before liveA=1).
    expect(forMsg.map((w) => w.id)).toEqual([liveB.id, liveA.id])
    expect(forMsg.some((w) => w.id === draft.id)).toBe(false)
    expect(forMsg.some((w) => w.id === otherTrigger.id)).toBe(false)
  })

  it('reorder hands the customer-facing first-match slot to the dragged workflow', async () => {
    const trigger = 'reorder.first-match'
    const made = []
    for (const [i, name] of ['Welcome tour', 'Billing triage', 'VIP escalation'].entries()) {
      const wf = await createWorkflow({
        name,
        class: 'customer_facing',
        triggerType: trigger,
        sortOrder: i,
      })
      await setWorkflowStatus(wf.id, 'live')
      made.push(wf)
    }
    const [first, second, third] = made
    const order = async () => (await listLiveWorkflowsForTrigger(trigger)).map((w) => w.id)
    expect(await order()).toEqual([first.id, second.id, third.id])

    // Drag the last one to the top: the dispatcher's first-match slot is
    // whatever this list returns first.
    await reorderWorkflows([third.id, first.id, second.id])
    expect(await order()).toEqual([third.id, first.id, second.id])
  })

  it('reorder leaves workflows outside the dragged group untouched', async () => {
    const other = await createWorkflow({
      name: 'Untouched',
      class: 'background',
      triggerType: 'reorder.other',
      sortOrder: 7,
    })
    const a = await createWorkflow({
      name: 'A',
      class: 'customer_facing',
      triggerType: 'reorder.group',
      sortOrder: 0,
    })
    const b = await createWorkflow({
      name: 'B',
      class: 'customer_facing',
      triggerType: 'reorder.group',
      sortOrder: 1,
    })
    await reorderWorkflows([b.id, a.id])
    expect((await getWorkflow(other.id))?.sortOrder).toBe(7)
    expect((await getWorkflow(b.id))?.sortOrder).toBe(0)
    expect((await getWorkflow(a.id))?.sortOrder).toBe(1)
    // The manager lists each row's last edit; priority is a property of the
    // group, not an edit of either workflow, so no timestamp moves.
    expect((await getWorkflow(a.id))?.updatedAt).toEqual(a.updatedAt)
  })

  it('getLiveWorkflowReferencedAttributeKeys reads only LIVE, non-deleted workflows', async () => {
    __resetLiveWorkflowReferencedAttributeKeysCache()

    const live = await createWorkflow({
      name: 'live with attr condition',
      class: 'background',
      triggerType: 'assistant.handed_off',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'g',
            type: 'condition',
            condition: { field: 'conversation.attr.issue_type', op: 'is_set' },
          },
        ],
        edges: [{ from: 't', to: 'g' }],
      },
    })
    await setWorkflowStatus(live.id, 'live')

    const draft = await createWorkflow({
      name: 'draft with attr condition',
      class: 'background',
      triggerType: 'assistant.handed_off',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'g',
            type: 'condition',
            condition: { field: 'conversation.attr.sentiment', op: 'is_set' },
          },
        ],
        edges: [{ from: 't', to: 'g' }],
      },
    })
    // Left in 'draft' — never transitioned live.
    void draft

    const deletedLive = await createWorkflow({
      name: 'deleted live with attr condition',
      class: 'background',
      triggerType: 'assistant.handed_off',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'g',
            type: 'condition',
            condition: { field: 'conversation.attr.urgency', op: 'is_set' },
          },
        ],
        edges: [{ from: 't', to: 'g' }],
      },
    })
    await setWorkflowStatus(deletedLive.id, 'live')
    await softDeleteWorkflow(deletedLive.id)

    const keys = await getLiveWorkflowReferencedAttributeKeys()
    expect([...keys]).toEqual(['issue_type'])
  })

  describe('hasAnyLiveWorkflow (events/process.ts enqueue gate)', () => {
    // The cache is module-level state, so start each case cold: a value cached
    // by an earlier test (or by this suite's own CRUD tests above, whose
    // mutations invalidate but whose reads could populate it) must not leak in.
    beforeEach(invalidateHasLiveWorkflowCache)

    // Only the TRUE direction is asserted against the real DB. The query is
    // workspace-global and this suite's transaction reads the shared test
    // database under READ COMMITTED, so a live workflow COMMITTED by another
    // test file running in parallel (frequency-cap-race.test.ts commits one
    // for its dispatch window, then deletes it in afterAll) is visible here —
    // a `false` assertion would flake whenever the two files overlap.
    // "Our own live workflow makes it true" can't be falsified by foreign
    // rows; the false paths, caching, TTL, and per-mutation invalidation are
    // pinned deterministically in workflow.service.live-gate.test.ts with a
    // scripted db and query call-counting instead.
    it('sees a workflow this transaction just made live (real query path)', async () => {
      const wf = await createWorkflow({ name: 'Route', class: 'background', triggerType: 'x' })
      await setWorkflowStatus(wf.id, 'live')
      expect(await hasAnyLiveWorkflow()).toBe(true)
    })
  })
})
