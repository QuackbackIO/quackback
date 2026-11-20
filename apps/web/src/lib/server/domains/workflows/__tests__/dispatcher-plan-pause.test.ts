/**
 * The dispatcher starts no live workflow while workflows are paused after the
 * plan limits grace. IO is mocked as in dispatcher.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'

const { listLiveWorkflowsForTrigger, resolveConditionContext, runWorkflow } = vi.hoisted(() => ({
  listLiveWorkflowsForTrigger: vi.fn(),
  resolveConditionContext: vi.fn(),
  runWorkflow: vi.fn(),
}))
vi.mock('../workflow.service', () => ({ listLiveWorkflowsForTrigger, getWorkflow: vi.fn() }))
vi.mock('../condition.context', () => ({ resolveConditionContext }))
vi.mock('../workflow.engine', () => ({ runWorkflow }))
vi.mock('../dispatcher.guards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../dispatcher.guards')>()),
  frequencyCapAllows: vi.fn(async () => true),
  hasActiveCustomerFacingRun: vi.fn(async () => false),
}))
vi.mock(
  '@/lib/server/domains/plan-limits/plan-limits.service',
  async () =>
    (await import('@/lib/server/domains/plan-limits/__tests__/feature-states'))
      .planLimitsServiceDouble
)

import { dispatchWorkflowTrigger } from '../dispatcher'
import {
  FEATURE_STATES,
  planLimitsServiceDouble,
  runsWithoutPlanGate,
  setFeatureState,
} from '@/lib/server/domains/plan-limits/__tests__/feature-states'

const trigger = {
  triggerType: 'conversation.created',
  conversationId: 'conversation_1' as ConversationId,
  actorType: 'user' as const,
  subjectPrincipalId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveConditionContext.mockResolvedValue({ conversation: {} })
  runWorkflow.mockResolvedValue({ id: 'run_1' })
  listLiveWorkflowsForTrigger.mockResolvedValue([
    { id: 'cf1', class: 'customer_facing', triggerSettings: {} },
    { id: 'bg1', class: 'background', triggerSettings: {} },
  ])
})

describe('dispatchWorkflowTrigger and the plan limits pause', () => {
  it.each(FEATURE_STATES)('in the %s state', async (state) => {
    setFeatureState(state, 'workflows')
    await dispatchWorkflowTrigger(trigger)
    if (runsWithoutPlanGate(state)) {
      expect(runWorkflow.mock.calls.map((c) => (c[0] as { id: string }).id).sort()).toEqual([
        'bg1',
        'cf1',
      ])
    } else {
      expect(runWorkflow).not.toHaveBeenCalled()
      expect(resolveConditionContext).not.toHaveBeenCalled()
    }
  })

  it('reads no plan state when no workflow is live for the trigger', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([])
    setFeatureState('enforced', 'workflows')
    await dispatchWorkflowTrigger(trigger)
    expect(planLimitsServiceDouble.isFeaturePaused).not.toHaveBeenCalled()
  })
})
