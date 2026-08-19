/**
 * Deterministic coverage for the hasAnyLiveWorkflow cache (§4.6 hardening):
 * the events/process.ts enqueue gate's caching, its exported reset seam, the
 * TTL expiry, and the eager invalidation every liveness-changing mutation
 * performs. `db` is fully scripted here (queued select results + a query call
 * counter) rather than the real-DB fixture, for two reasons:
 *
 *   - Cache behavior is observable only as "did the second call re-query?",
 *     which needs call-counting on the underlying query — not possible
 *     through the fixture's transaction proxy.
 *   - The query is workspace-global, and the shared test database can carry
 *     a live workflow COMMITTED by another test file mid-run (frequency-cap-
 *     race.test.ts commits one for its dispatch window), so any real-DB
 *     assertion that it returns `false` is inherently flaky under vitest's
 *     file parallelism. The real-DB smoke test (workflow.service.test.ts)
 *     therefore only asserts the foreign-row-immune TRUE direction; every
 *     other property is pinned here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { WorkflowId } from '@quackback/ids'

// Queued results for the gate's select(...).from(...).where(...).limit(...)
// read, consumed FIFO, plus a counter — the counter is what proves a call was
// served from cache (count unchanged) vs re-queried (count bumped).
let liveRowQueue: unknown[][] = []
const gateQueryCount = { n: 0 }

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  // update(...).set(...).where(...) is awaited directly by softDeleteWorkflow
  // and chained with .returning() by updateWorkflow/setWorkflowStatus, so the
  // where() result is a thenable that also carries .returning().
  const whereResult = () =>
    Object.assign(Promise.resolve([{ id: 'workflow_1' }]), {
      returning: () => Promise.resolve([{ id: 'workflow_1' }]),
    })
  // The version-history write path (workflow-versions.ts) this suite's
  // updateWorkflow/createWorkflow now trigger also reads via select(...) —
  // shares this mock's single liveRowQueue/counter (harmless: the "before"
  // read this drains is reassigned wholesale before the next real
  // hasAnyLiveWorkflow() read in every case below) and additionally chains
  // .orderBy() (pruneWorkflowVersions' subquery) before .limit().
  const limitResult = () => Promise.resolve(liveRowQueue.shift() ?? [])
  const dbMock: Record<string, unknown> = {
    select: vi.fn(() => {
      gateQueryCount.n++
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(limitResult),
            orderBy: vi.fn(() => ({ limit: vi.fn(limitResult) })),
          })),
        })),
      }
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 'workflow_1' }])),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: whereResult })) })),
    // pruneWorkflowVersions' cap-enforcement delete — argument unused, same
    // as every other operation this scripted mock stubs rather than models.
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
  }
  // updateWorkflow now wraps its update + version insert in one
  // db.transaction (see workflow.service.ts) — the callback gets this same
  // scripted object as `tx`, since every operation it calls is stubbed
  // identically either way.
  dbMock.transaction = vi.fn((cb: (tx: typeof dbMock) => unknown) => cb(dbMock))

  return {
    ...actual,
    db: dbMock,
  }
})

import {
  createWorkflow,
  updateWorkflow,
  setWorkflowStatus,
  softDeleteWorkflow,
  hasAnyLiveWorkflow,
  invalidateHasLiveWorkflowCache,
} from '../workflow.service'

const workflowId = 'workflow_1' as WorkflowId

beforeEach(() => {
  vi.clearAllMocks()
  liveRowQueue = []
  gateQueryCount.n = 0
  invalidateHasLiveWorkflowCache()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('hasAnyLiveWorkflow caching', () => {
  it('is false with no live workflow, and a second call within the TTL is served from cache (no re-query)', async () => {
    liveRowQueue = [[]]
    expect(await hasAnyLiveWorkflow()).toBe(false)
    expect(gateQueryCount.n).toBe(1)

    expect(await hasAnyLiveWorkflow()).toBe(false)
    expect(gateQueryCount.n).toBe(1) // cached — the queue was not consulted again
  })

  it('invalidateHasLiveWorkflowCache makes the next call re-query and pick up the fresh value', async () => {
    liveRowQueue = [[]]
    expect(await hasAnyLiveWorkflow()).toBe(false)

    invalidateHasLiveWorkflowCache()
    liveRowQueue = [[{ id: workflowId }]]
    expect(await hasAnyLiveWorkflow()).toBe(true)
    expect(gateQueryCount.n).toBe(2)
  })

  it('re-queries once the TTL has elapsed (no invalidation needed)', async () => {
    vi.useFakeTimers()
    liveRowQueue = [[]]
    expect(await hasAnyLiveWorkflow()).toBe(false)
    expect(gateQueryCount.n).toBe(1)

    vi.advanceTimersByTime(29_000)
    expect(await hasAnyLiveWorkflow()).toBe(false)
    expect(gateQueryCount.n).toBe(1) // still inside the 30s TTL

    vi.advanceTimersByTime(2_000) // 31s total — past the TTL
    liveRowQueue = [[{ id: workflowId }]]
    expect(await hasAnyLiveWorkflow()).toBe(true)
    expect(gateQueryCount.n).toBe(2)
  })
})

describe('hasAnyLiveWorkflow invalidation by liveness-changing mutations', () => {
  // Each case: cache a false answer, run the mutation, then verify the very
  // next read re-queries (sees the queued true) instead of returning the
  // 30s-stale cached false — which is exactly what makes a workflow going
  // live visible to the events/process.ts gate immediately.
  const mutations: [string, () => Promise<unknown>][] = [
    ['createWorkflow', () => createWorkflow({ name: 'W', class: 'background', triggerType: 'x' })],
    ['updateWorkflow', () => updateWorkflow(workflowId, { name: 'W2' })],
    ['setWorkflowStatus', () => setWorkflowStatus(workflowId, 'live')],
    ['softDeleteWorkflow', () => softDeleteWorkflow(workflowId)],
  ]

  it.each(mutations)('%s invalidates the cached answer', async (_name, mutate) => {
    liveRowQueue = [[]]
    expect(await hasAnyLiveWorkflow()).toBe(false) // cached
    expect(gateQueryCount.n).toBe(1)

    await mutate()
    // createWorkflow/updateWorkflow may issue their own incidental select(s)
    // (the version-history write path's "before" read / retention-cap
    // subquery) — irrelevant to what this test pins, so it snapshots the
    // count AFTER the mutation rather than asserting an absolute value.
    const afterMutate = gateQueryCount.n

    liveRowQueue = [[{ id: workflowId }]]
    expect(await hasAnyLiveWorkflow()).toBe(true)
    expect(gateQueryCount.n).toBe(afterMutate + 1) // the mutation cleared the cache
  })
})
