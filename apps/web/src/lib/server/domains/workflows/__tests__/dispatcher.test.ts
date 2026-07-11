/**
 * Unit coverage for the dispatcher flow (§4.6, Slice 5d-ii): the human-actor gate,
 * customer_facing exclusivity (first match wins, skip when already locked), and
 * background parallelism + frequency caps. Every IO dependency is mocked so this
 * pins orchestration only; the guards are tested against a real DB separately.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'

const {
  listLiveWorkflowsForTrigger,
  getWorkflow,
  resolveConditionContext,
  runWorkflow,
  frequencyCapAllows,
  hasActiveCustomerFacingRun,
} = vi.hoisted(() => ({
  listLiveWorkflowsForTrigger: vi.fn(),
  getWorkflow: vi.fn(),
  resolveConditionContext: vi.fn(),
  runWorkflow: vi.fn(),
  frequencyCapAllows: vi.fn(),
  hasActiveCustomerFacingRun: vi.fn(),
}))
vi.mock('../workflow.service', () => ({ listLiveWorkflowsForTrigger, getWorkflow }))
vi.mock('../condition.context', () => ({ resolveConditionContext }))
vi.mock('../workflow.engine', () => ({ runWorkflow }))
// channelAllows is left real (pure, no IO) so these tests exercise the actual
// channel-scoping logic; only the DB-backed guards are mocked.
vi.mock('../dispatcher.guards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../dispatcher.guards')>()),
  frequencyCapAllows,
  hasActiveCustomerFacingRun,
}))

import { dispatchWorkflowTrigger, type WorkflowTrigger } from '../dispatcher'

const conversationId = 'conversation_1' as ConversationId
const wf = (
  id: string,
  cls: 'customer_facing' | 'background',
  triggerSettings: Record<string, unknown> = {}
) => ({ id, class: cls, triggerSettings }) as never
const trigger = (over: Partial<WorkflowTrigger> = {}): WorkflowTrigger => ({
  triggerType: 'conversation.created',
  conversationId,
  actorType: 'user',
  subjectPrincipalId: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  resolveConditionContext.mockResolvedValue({ conversation: {} })
  frequencyCapAllows.mockResolvedValue(true)
  hasActiveCustomerFacingRun.mockResolvedValue(false)
  runWorkflow.mockResolvedValue({ id: 'run_1' }) // matched + ran
})

const ranIds = () => runWorkflow.mock.calls.map((c) => (c[0] as { id: string }).id)

describe('dispatchWorkflowTrigger', () => {
  it('gates out an automated (service) actor before any load', async () => {
    await dispatchWorkflowTrigger(trigger({ actorType: 'service' }))
    expect(listLiveWorkflowsForTrigger).not.toHaveBeenCalled()
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('loop guard: a service-authored message.note_created trigger (a workflow add_note action posting its own note) never dispatches — eventToWorkflowTrigger does not opt it out of the human-actor gate (see event-trigger.test.ts)', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([wf('note_wf', 'background')])
    await dispatchWorkflowTrigger(
      trigger({ triggerType: 'message.note_created', actorType: 'service' })
    )
    expect(listLiveWorkflowsForTrigger).not.toHaveBeenCalled()
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('lets a service actor through when the trigger explicitly opts out of the gate', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([wf('bg1', 'background')])
    await dispatchWorkflowTrigger(trigger({ actorType: 'service', allowServiceActor: true }))
    expect(ranIds()).toEqual(['bg1'])
  })

  it('does nothing when no workflow is live for the trigger', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([])
    await dispatchWorkflowTrigger(trigger())
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('customer_facing is exclusive: the first that runs wins, the rest are skipped', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('cf1', 'customer_facing'),
      wf('cf2', 'customer_facing'),
      wf('cf3', 'customer_facing'),
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(ranIds()).toEqual(['cf1']) // cf1 ran (truthy) -> break
  })

  it('customer_facing falls through a non-matching workflow to the next', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('cf1', 'customer_facing'),
      wf('cf2', 'customer_facing'),
      wf('cf3', 'customer_facing'),
    ])
    runWorkflow.mockResolvedValueOnce(null) // cf1 matches nothing
    await dispatchWorkflowTrigger(trigger())
    expect(ranIds()).toEqual(['cf1', 'cf2']) // tried cf1 (null), cf2 ran -> break, cf3 skipped
  })

  it('starts no customer_facing workflow when one is already locked on the conversation', async () => {
    hasActiveCustomerFacingRun.mockResolvedValue(true)
    listLiveWorkflowsForTrigger.mockResolvedValue([wf('cf1', 'customer_facing')])
    await dispatchWorkflowTrigger(trigger())
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('runs every background workflow in parallel, and both classes together', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('cf1', 'customer_facing'),
      wf('bg1', 'background'),
      wf('bg2', 'background'),
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(ranIds().sort()).toEqual(['bg1', 'bg2', 'cf1'])
  })

  it('skips a workflow whose frequency cap is exhausted', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('bg1', 'background'),
      wf('bg2', 'background'),
    ])
    frequencyCapAllows.mockImplementation(async (w: { id: string }) => w.id !== 'bg1')
    await dispatchWorkflowTrigger(trigger({ subjectPrincipalId: 'principal_x' as never }))
    expect(ranIds()).toEqual(['bg2'])
  })

  it('a channel-scoped customer_facing workflow does not run for a non-matching channel, and is never matched (the exclusive slot passes to the next)', async () => {
    resolveConditionContext.mockResolvedValue({ conversation: { channel: 'email' } })
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('cf1', 'customer_facing', { channels: ['messenger'] }),
      wf('cf2', 'customer_facing'),
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(ranIds()).toEqual(['cf2']) // cf1 is channel-excluded, never counts as tried
  })

  it('a customer_facing workflow with empty channels runs for any channel', async () => {
    resolveConditionContext.mockResolvedValue({ conversation: { channel: 'email' } })
    listLiveWorkflowsForTrigger.mockResolvedValue([wf('cf1', 'customer_facing', { channels: [] })])
    await dispatchWorkflowTrigger(trigger())
    expect(ranIds()).toEqual(['cf1'])
  })

  it('a channel-scoped background workflow does not run for a non-matching channel; a matching one does', async () => {
    resolveConditionContext.mockResolvedValue({ conversation: { channel: 'email' } })
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('bg1', 'background', { channels: ['messenger'] }),
      wf('bg2', 'background', { channels: ['email'] }),
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(ranIds()).toEqual(['bg2'])
  })

  it('a background workflow throwing does not reject the batch or lose a sibling run that already committed', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('bg1', 'background'),
      wf('bg2', 'background'),
    ])
    runWorkflow.mockImplementation(async (w: { id: string }) => {
      if (w.id === 'bg2') throw new Error('transient redis error scheduling wait')
      return { id: 'run_1' }
    })
    await expect(dispatchWorkflowTrigger(trigger())).resolves.toBeUndefined()
    expect(ranIds()).toEqual(['bg1', 'bg2']) // both were attempted; bg1's run stands
  })

  it('a failure before any run starts (condition resolution) still propagates for a clean retry', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([wf('bg1', 'background')])
    resolveConditionContext.mockRejectedValue(new Error('db unavailable'))
    await expect(dispatchWorkflowTrigger(trigger())).rejects.toThrow('db unavailable')
    expect(runWorkflow).not.toHaveBeenCalled()
  })
})

describe('dispatchWorkflowTrigger — audience', () => {
  it('a matching audience runs; a non-matching one is skipped (customer_facing) without consuming the exclusive slot', async () => {
    resolveConditionContext.mockResolvedValue({
      conversation: { channel: 'messenger', status: 'open' },
    })
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('cf1', 'customer_facing', {
        audience: { field: 'conversation.status', op: 'eq', value: 'closed' },
      }),
      wf('cf2', 'customer_facing', {
        audience: { field: 'conversation.status', op: 'eq', value: 'open' },
      }),
    ])
    await dispatchWorkflowTrigger(trigger())
    // cf1's audience never matches -> never tried; cf2 matches and runs.
    expect(ranIds()).toEqual(['cf2'])
  })

  it('a matching audience runs; a non-matching one is skipped (background) — every cap-permitted match runs in parallel', async () => {
    resolveConditionContext.mockResolvedValue({
      conversation: { channel: 'messenger', status: 'open' },
    })
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('bg1', 'background', {
        audience: { field: 'conversation.status', op: 'eq', value: 'closed' },
      }),
      wf('bg2', 'background', {
        audience: { field: 'conversation.status', op: 'eq', value: 'open' },
      }),
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(ranIds()).toEqual(['bg2'])
  })

  it('no audience configured always runs (both classes)', async () => {
    resolveConditionContext.mockResolvedValue({ conversation: { channel: 'messenger' } })
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('cf1', 'customer_facing'),
      wf('bg1', 'background'),
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(ranIds().sort()).toEqual(['bg1', 'cf1'])
  })

  it('a stored audience that is not a well-formed condition (a stray string) fails open — allows and does not throw', async () => {
    resolveConditionContext.mockResolvedValue({ conversation: { channel: 'messenger' } })
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('bg1', 'background', { audience: 'not-a-condition' }),
    ])
    await expect(dispatchWorkflowTrigger(trigger())).resolves.toBeUndefined()
    expect(ranIds()).toEqual(['bg1'])
  })

  it('an audience over a dynamic attribute participates in the same first-match ordering as any other predicate', async () => {
    resolveConditionContext.mockResolvedValue({
      conversation: { channel: 'messenger' },
      person: { segmentIds: [], attributes: { plan: 'pro' } },
    })
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('cf1', 'customer_facing', {
        audience: { field: 'person.attr.plan', op: 'eq', value: 'free' },
      }),
      wf('cf2', 'customer_facing', {
        audience: { field: 'person.attr.plan', op: 'eq', value: 'pro' },
      }),
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(ranIds()).toEqual(['cf2'])
  })
})

describe('dispatchWorkflowTrigger — sendWindow', () => {
  it('inside_office_hours runs when officeHours is true, is skipped when false (customer_facing, slot passes to the next)', async () => {
    resolveConditionContext.mockResolvedValue({
      conversation: { channel: 'messenger' },
      officeHours: false,
    })
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('cf1', 'customer_facing', { sendWindow: 'inside_office_hours' }),
      wf('cf2', 'customer_facing'),
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(ranIds()).toEqual(['cf2'])
  })

  it('outside_office_hours runs when officeHours is false, is skipped when true (background)', async () => {
    resolveConditionContext.mockResolvedValue({
      conversation: { channel: 'messenger' },
      officeHours: true,
    })
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('bg1', 'background', { sendWindow: 'outside_office_hours' }),
      wf('bg2', 'background', { sendWindow: 'inside_office_hours' }),
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(ranIds()).toEqual(['bg2'])
  })

  it('"any" (or an absent key) never restricts, regardless of officeHours', async () => {
    resolveConditionContext.mockResolvedValue({
      conversation: { channel: 'messenger' },
      officeHours: false,
    })
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('bg1', 'background', { sendWindow: 'any' }),
      wf('bg2', 'background'),
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(ranIds().sort()).toEqual(['bg1', 'bg2'])
  })
})

describe('dispatchWorkflowTrigger — ticket triggers', () => {
  it('loop guard: a service-authored ticket.status_changed trigger (a workflow set_ticket_status action writing its own status) never dispatches — event-trigger.ts does not opt it out of the human-actor gate', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([wf('status_wf', 'background')])
    await dispatchWorkflowTrigger(
      trigger({ triggerType: 'ticket.status_changed', actorType: 'service' })
    )
    expect(listLiveWorkflowsForTrigger).not.toHaveBeenCalled()
    expect(runWorkflow).not.toHaveBeenCalled()
  })

  it('ticketStatusCategory only restricts ticket.status_changed, matching the entered category (customer_facing, first match wins)', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('cf1', 'customer_facing', { ticketStatusCategory: 'closed' }),
      wf('cf2', 'customer_facing', { ticketStatusCategory: 'pending' }),
    ])
    await dispatchWorkflowTrigger(
      trigger({ triggerType: 'ticket.status_changed', ticketStatusCategory: 'closed' })
    )
    expect(ranIds()).toEqual(['cf1'])
  })

  it('an unconfigured ticketStatusCategory ("any status change") never restricts', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('bg1', 'background'),
      wf('bg2', 'background', { ticketStatusCategory: 'open' }),
    ])
    await dispatchWorkflowTrigger(
      trigger({ triggerType: 'ticket.status_changed', ticketStatusCategory: null })
    )
    expect(ranIds()).toEqual(['bg1'])
  })

  it('is never applied to ticket.created (or any other trigger type)', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('bg1', 'background', { ticketStatusCategory: 'closed' }),
    ])
    await dispatchWorkflowTrigger(trigger({ triggerType: 'ticket.created' }))
    expect(ranIds()).toEqual(['bg1'])
  })
})

describe('dispatchWorkflowTrigger — person/company context gating', () => {
  it('skips the person/company join when no live workflow references a person./company. field', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('bg1', 'background', {
        audience: { field: 'conversation.status', op: 'eq', value: 'open' },
      }),
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(resolveConditionContext).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ resolvePersonCompany: false })
    )
  })

  it('resolves the join when a workflow AUDIENCE references a person attribute', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([
      wf('bg1', 'background', {
        audience: { field: 'person.attr.plan', op: 'eq', value: 'pro' },
      }),
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(resolveConditionContext).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ resolvePersonCompany: true })
    )
  })

  it('resolves the join when a workflow GRAPH condition node references a company attribute', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([
      {
        id: 'bg1',
        class: 'background',
        triggerSettings: {},
        graph: {
          nodes: [
            {
              id: 'c1',
              type: 'condition',
              condition: { field: 'company.attr.tier', op: 'eq', value: 'gold' },
            },
          ],
        },
      } as never,
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(resolveConditionContext).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ resolvePersonCompany: true })
    )
  })

  it('resolves the join when a BRANCH path references person.email', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([
      {
        id: 'bg1',
        class: 'background',
        triggerSettings: {},
        graph: {
          nodes: [
            {
              id: 'b1',
              type: 'branch',
              branches: [{ key: 'has_email', condition: { field: 'person.email', op: 'is_set' } }],
            },
          ],
        },
      } as never,
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(resolveConditionContext).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ resolvePersonCompany: true })
    )
  })

  it('does NOT gate on person.segments — its own pre-existing resolution is unconditional', async () => {
    listLiveWorkflowsForTrigger.mockResolvedValue([
      {
        id: 'bg1',
        class: 'background',
        triggerSettings: {},
        graph: {
          nodes: [
            {
              id: 'c1',
              type: 'condition',
              condition: { field: 'person.segments', op: 'includes_any', value: ['seg_1'] },
            },
          ],
        },
      } as never,
    ])
    await dispatchWorkflowTrigger(trigger())
    expect(resolveConditionContext).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({ resolvePersonCompany: false })
    )
  })
})
