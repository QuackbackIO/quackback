/**
 * Coverage for processEvent's durable workflow-dispatch enqueue (§4.6
 * hardening, replacing the old fire-and-forget dispatchWorkflowsForEvent
 * call). A separate file from process.test.ts so the workflow-dispatch-queue
 * module can be mocked directly instead of relying on process.test.ts's
 * whole-package 'bullmq' mock (which has no `add` on its MockQueue).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EventData } from '../types'

const mockEnqueueWorkflowDispatch = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/server/domains/workflows/workflow-dispatch-queue', () => ({
  enqueueWorkflowDispatch: (...args: unknown[]) => mockEnqueueWorkflowDispatch(...args),
}))

// hasAnyLiveWorkflow is the second (DB-backed) gate, mocked here so this file
// stays a pure unit test; its own cache/invalidation behavior is covered
// against a real DB in workflow.service.test.ts. Default true so the
// existing trigger-mapping tests below don't need to know about this gate.
const mockHasAnyLiveWorkflow = vi.fn().mockResolvedValue(true)
vi.mock('@/lib/server/domains/workflows/workflow.service', () => ({
  hasAnyLiveWorkflow: () => mockHasAnyLiveWorkflow(),
}))

// process.ts also enqueues webhook/notification hooks via its own BullMQ
// queue; keep that side inert the same way process.test.ts does.
vi.mock('bullmq', () => {
  class MockQueue {
    addBulk = vi.fn().mockResolvedValue(undefined)
    close = vi.fn().mockResolvedValue(undefined)
    waitUntilReady = vi.fn().mockResolvedValue(undefined)
    constructor() {}
  }
  class MockWorker {
    close = vi.fn().mockResolvedValue(undefined)
    constructor() {}
    on() {
      return this
    }
  }
  class UnrecoverableError extends Error {}
  return { Queue: MockQueue, Worker: MockWorker, UnrecoverableError }
})

vi.mock('@/lib/server/config', () => ({
  config: { redisUrl: 'redis://localhost:6379' },
}))

vi.mock('../targets', () => ({
  getHookTargets: vi.fn().mockResolvedValue([]),
}))

import { processEvent } from '../process'

function messageCreatedEvent(overrides: Partial<EventData> = {}): EventData {
  return {
    id: 'evt-msg-1',
    type: 'message.created',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', userId: 'user_1' },
    data: {
      message: {
        id: 'm1',
        conversationId: 'conversation_1',
        senderType: 'visitor',
        authorPrincipalId: 'principal_1',
        content: 'hello',
      },
      conversation: { id: 'conversation_1' },
    },
    ...overrides,
  } as unknown as EventData
}

function postCreatedEvent(): EventData {
  return {
    id: 'evt-post-1',
    type: 'post.created',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', userId: 'user_1' },
    data: {
      post: {
        id: 'post_1',
        title: 'Test',
        content: 'Content',
        boardId: 'board_1',
        boardSlug: 'bugs',
        voteCount: 0,
      },
    },
  } as unknown as EventData
}

// vi.waitFor's default 1000ms timeout flakes on a cold-cache first run (module
// resolution, mock setup lag) — every fire-and-forget assertion below shares
// this one helper with a longer budget instead of each hand-rolling its own
// vi.waitFor(..., { timeout }) call.
function waitForAssertion(assertion: () => void): Promise<void> {
  return vi.waitFor(assertion, { timeout: 5000 })
}

describe('processEvent workflow-dispatch enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The enqueue is fire-and-forget (not awaited by processEvent — a caught,
  // logged, never-retried failure buys no durability from awaiting it), so
  // these assert against the mock via waitForAssertion instead of immediately
  // after processEvent's own promise settles.
  it('enqueues the event when it maps to a workflow trigger', async () => {
    const event = messageCreatedEvent()
    await processEvent(event)
    await waitForAssertion(() => expect(mockEnqueueWorkflowDispatch).toHaveBeenCalledWith(event))
  })

  it('skips the enqueue for an event with no workflow trigger mapping', async () => {
    await processEvent(postCreatedEvent())
    expect(mockEnqueueWorkflowDispatch).not.toHaveBeenCalled()
  })

  it('isolates an enqueue failure — processEvent still resolves', async () => {
    mockEnqueueWorkflowDispatch.mockRejectedValueOnce(new Error('redis down'))
    await expect(processEvent(messageCreatedEvent())).resolves.toBeUndefined()
    // Let this test's own fire-and-forget chain finish (consume the
    // mockRejectedValueOnce) before the next test starts, so it can't bleed
    // into a later test's call-count assertions.
    await waitForAssertion(() => expect(mockEnqueueWorkflowDispatch).toHaveBeenCalled())
  })

  it('skips the enqueue when the workspace has no live workflow at all (gate false)', async () => {
    mockHasAnyLiveWorkflow.mockResolvedValueOnce(false)
    const event = messageCreatedEvent()
    await processEvent(event)
    // Give the fire-and-forget chain a tick to run before asserting a negative.
    await waitForAssertion(() => expect(mockHasAnyLiveWorkflow).toHaveBeenCalled())
    expect(mockEnqueueWorkflowDispatch).not.toHaveBeenCalled()
  })

  it('still enqueues a message event once a live workflow exists (gate true)', async () => {
    mockHasAnyLiveWorkflow.mockResolvedValueOnce(true)
    const event = messageCreatedEvent()
    await processEvent(event)
    await waitForAssertion(() => expect(mockEnqueueWorkflowDispatch).toHaveBeenCalledWith(event))
  })
})
