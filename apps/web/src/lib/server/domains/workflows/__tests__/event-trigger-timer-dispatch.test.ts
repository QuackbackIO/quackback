/**
 * Coverage for dispatchWorkflowTrigger's `targetWorkflowId` mode (support
 * platform §4.6): the two timer-driven unresponsive triggers dispatch through
 * this single-workflow path instead of the generic multi-workflow fan-out
 * (see dispatcher.ts's DispatchWorkflowTriggerOpts doc for why). Originally a
 * standalone dispatchTimerTrigger duplicated the fan-out's guard order by
 * hand (lock-check LAST instead of dispatcher.ts's upfront Promise.all
 * pre-check); this now exercises the SAME merged dispatchWorkflowTrigger every
 * other trigger type uses, just with `live` populated from one targeted
 * lookup instead of listLiveWorkflowsForTrigger. Every guard it applies
 * (channel, audience, send window, frequency cap, the customer_facing
 * exclusive lock) is mocked here individually so each gate's effect can be
 * pinned in isolation — mirrors dispatcher.test.ts's mocking style.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ConversationId, WorkflowId } from '@quackback/ids'
import { makeConditionContext } from './workflow-test-utils'

const { getWorkflow, listLiveWorkflowsForTrigger } = vi.hoisted(() => ({
  getWorkflow: vi.fn(),
  listLiveWorkflowsForTrigger: vi.fn(),
}))
vi.mock('../workflow.service', () => ({ getWorkflow, listLiveWorkflowsForTrigger }))

const { resolveConditionContext } = vi.hoisted(() => ({ resolveConditionContext: vi.fn() }))
vi.mock('../condition.context', () => ({ resolveConditionContext }))

const {
  channelAllows,
  ticketStatusCategoryAllows,
  pagePathAllows,
  audienceAllows,
  sendWindowAllows,
  frequencyCapAllows,
  hasActiveCustomerFacingRun,
} = vi.hoisted(() => ({
  channelAllows: vi.fn(),
  // Not exercised by this file (the unresponsive pair are never ticket
  // triggers) — always-allow, same stance as every other guard's default
  // here (see beforeEach below).
  ticketStatusCategoryAllows: vi.fn(),
  // Same always-allow stance: page.visited is never a timer trigger.
  pagePathAllows: vi.fn(),
  audienceAllows: vi.fn(),
  sendWindowAllows: vi.fn(),
  frequencyCapAllows: vi.fn(),
  hasActiveCustomerFacingRun: vi.fn(),
}))
vi.mock('../dispatcher.guards', () => ({
  channelAllows,
  ticketStatusCategoryAllows,
  pagePathAllows,
  audienceAllows,
  sendWindowAllows,
  frequencyCapAllows,
  hasActiveCustomerFacingRun,
}))

const { runWorkflow } = vi.hoisted(() => ({ runWorkflow: vi.fn() }))
vi.mock('../workflow.engine', () => ({ runWorkflow }))

import { dispatchWorkflowTrigger, type WorkflowTrigger } from '../dispatcher'

const conversationId = 'conversation_1' as ConversationId
const workflowId = 'workflow_1' as WorkflowId

// Only `conversation.channel`/`visitorPrincipalId` matter here (every guard
// that would read the rest of the context — channelAllows, audienceAllows,
// sendWindowAllows, frequencyCapAllows — is mocked below), so the shared
// builder's other defaults are inert, same as the previous hand-rolled
// partial that omitted them outright.
const baseCtx = makeConditionContext({
  conversation: {
    status: 'open',
    channel: 'messenger',
    priority: 'none',
    waitingMinutes: null,
    tagIds: [],
    assignedTeamId: null,
    visitorPrincipalId: 'principal_visitor',
  },
})

const liveWorkflow = {
  id: workflowId,
  status: 'live',
  class: 'background',
  triggerType: 'conversation.teammate_unresponsive',
  triggerSettings: {},
  graph: { nodes: [] },
}

// eventToWorkflowTrigger omits subjectPrincipalId for the unresponsive pair
// (see event-trigger.ts's doc) — dispatchWorkflowTrigger must derive it from
// the resolved ctx.conversation.visitorPrincipalId instead.
const trigger = (over: Partial<WorkflowTrigger> = {}): WorkflowTrigger => ({
  triggerType: 'conversation.teammate_unresponsive',
  conversationId,
  actorType: 'service',
  allowServiceActor: true,
  message: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  getWorkflow.mockResolvedValue(liveWorkflow)
  resolveConditionContext.mockResolvedValue(baseCtx)
  channelAllows.mockReturnValue(true)
  ticketStatusCategoryAllows.mockReturnValue(true)
  pagePathAllows.mockReturnValue(true)
  audienceAllows.mockReturnValue(true)
  sendWindowAllows.mockReturnValue(true)
  frequencyCapAllows.mockResolvedValue(true)
  hasActiveCustomerFacingRun.mockResolvedValue(false)
  runWorkflow.mockResolvedValue({ id: 'workflow_run_1', state: 'done' })
})

describe('dispatchWorkflowTrigger (targetWorkflowId mode)', () => {
  it('runs the one targeted workflow when every gate passes, deriving the subject from the resolved conversation visitor', async () => {
    await dispatchWorkflowTrigger(trigger(), { targetWorkflowId: workflowId })

    expect(getWorkflow).toHaveBeenCalledWith(workflowId)
    expect(listLiveWorkflowsForTrigger).not.toHaveBeenCalled()
    expect(runWorkflow).toHaveBeenCalledWith(liveWorkflow, baseCtx, {
      conversationId,
      subjectPrincipalId: 'principal_visitor',
    })
  })

  it('skips when the target workflow no longer exists (deleted since the sweep scanned it)', async () => {
    getWorkflow.mockResolvedValue(null)
    await dispatchWorkflowTrigger(trigger(), { targetWorkflowId: workflowId })
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('skips when the target workflow was paused since the sweep scanned it', async () => {
    getWorkflow.mockResolvedValue({ ...liveWorkflow, status: 'paused' })
    await dispatchWorkflowTrigger(trigger(), { targetWorkflowId: workflowId })
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('skips when the target workflow was edited to a different trigger type since the sweep scanned it', async () => {
    getWorkflow.mockResolvedValue({ ...liveWorkflow, triggerType: 'conversation.created' })
    await dispatchWorkflowTrigger(trigger(), { targetWorkflowId: workflowId })
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('skips when the conversation is gone', async () => {
    resolveConditionContext.mockResolvedValue(null)
    await dispatchWorkflowTrigger(trigger(), { targetWorkflowId: workflowId })
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('skips when the channel guard denies', async () => {
    channelAllows.mockReturnValue(false)
    await dispatchWorkflowTrigger(trigger(), { targetWorkflowId: workflowId })
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('skips when the audience guard denies', async () => {
    audienceAllows.mockReturnValue(false)
    await dispatchWorkflowTrigger(trigger(), { targetWorkflowId: workflowId })
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('skips when the send-window guard denies', async () => {
    sendWindowAllows.mockReturnValue(false)
    await dispatchWorkflowTrigger(trigger(), { targetWorkflowId: workflowId })
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('skips when the frequency cap denies, keyed on the conversation visitor as subject', async () => {
    frequencyCapAllows.mockResolvedValue(false)
    await dispatchWorkflowTrigger(trigger(), { targetWorkflowId: workflowId })
    expect(frequencyCapAllows).toHaveBeenCalledWith(liveWorkflow, 'principal_visitor')
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('skips a customer_facing workflow when the exclusive lock is already held', async () => {
    getWorkflow.mockResolvedValue({ ...liveWorkflow, class: 'customer_facing' })
    hasActiveCustomerFacingRun.mockResolvedValue(true)
    await dispatchWorkflowTrigger(trigger(), { targetWorkflowId: workflowId })
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('checks the exclusive lock for a customer_facing workflow but not for a background one', async () => {
    await dispatchWorkflowTrigger(trigger(), { targetWorkflowId: workflowId }) // background
    expect(hasActiveCustomerFacingRun).not.toHaveBeenCalled()
  })

  it('routes conversation.customer_unresponsive the same way', async () => {
    getWorkflow.mockResolvedValue({
      ...liveWorkflow,
      triggerType: 'conversation.customer_unresponsive',
    })
    await dispatchWorkflowTrigger(trigger({ triggerType: 'conversation.customer_unresponsive' }), {
      targetWorkflowId: workflowId,
    })
    expect(runWorkflow).toHaveBeenCalledTimes(1)
  })

  it('an explicit subjectPrincipalId (even null) is never overridden by the conversation visitor fallback', async () => {
    await dispatchWorkflowTrigger(trigger({ subjectPrincipalId: null }), {
      targetWorkflowId: workflowId,
    })
    expect(runWorkflow).toHaveBeenCalledWith(liveWorkflow, baseCtx, {
      conversationId,
      subjectPrincipalId: null,
    })
  })
})
