/**
 * Real-DB coverage for the dispatcher guards (§4.6, Slice 5d-ii): each frequency
 * cap type counted from the run-event ledger, and the customer_facing exclusive
 * lock (which ignores background runs and ended runs). Runs inside the fixture
 * rollback.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type PrincipalId,
  type UserId,
  type ConversationId,
  type WorkflowId,
  type WorkflowRunId,
} from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  workflows,
  workflowRuns,
  workflowRunEvents,
  conversations,
  user,
  principal,
  type Workflow,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  channelAllows,
  ticketStatusCategoryAllows,
  audienceAllows,
  sendWindowAllows,
  frequencyCapAllows,
  claimFrequencyCapSlot,
  hasActiveCustomerFacingRun,
} from '../dispatcher.guards'
import type { WorkflowTrigger } from '../dispatcher'
import type { TicketStatusCategory } from '@/lib/shared/db-types'
import { makeConditionContext } from './workflow-test-utils'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: workflows.id }).from(workflows).limit(0)
    await db.select({ id: workflowRuns.id }).from(workflowRuns).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedWorkflow(
  cls: 'customer_facing' | 'background',
  triggerSettings: Record<string, unknown> = {}
): Promise<Workflow> {
  const [row] = await testDb
    .insert(workflows)
    .values({ name: `wf-${suffix()}`, class: cls, triggerType: 'x', triggerSettings })
    .returning()
  return row
}

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `V-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

async function seedConversation(): Promise<ConversationId> {
  const principalId = await seedPrincipal()
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: principalId, channel: 'messenger' })
    .returning()
  return row.id
}

/** Record N 'started' events for (workflow, principal), optionally aged. */
async function seedStarts(
  workflowId: WorkflowId,
  subjectPrincipalId: PrincipalId,
  n: number,
  at?: Date
): Promise<void> {
  const runId = createId('workflow_run') as WorkflowRunId
  await testDb
    .insert(workflowRuns)
    .values({ id: runId, workflowId, subjectPrincipalId, state: 'done' })
  for (let i = 0; i < n; i++) {
    await testDb
      .insert(workflowRunEvents)
      .values({ runId, workflowId, subjectPrincipalId, kind: 'started', ...(at ? { at } : {}) })
  }
}

function workflowWithChannels(channels: unknown): Workflow {
  return { triggerSettings: { channels } } as unknown as Workflow
}

// Pure — no DB, so this runs regardless of fixture availability.
describe('channelAllows', () => {
  it('allows when channels is missing, non-array, or empty (all channels)', () => {
    expect(channelAllows({ triggerSettings: {} } as unknown as Workflow, 'email')).toBe(true)
    expect(channelAllows(workflowWithChannels('email'), 'email')).toBe(true) // not an array
    expect(channelAllows(workflowWithChannels([]), 'email')).toBe(true)
  })

  it('allows when the conversation channel is unresolvable', () => {
    expect(channelAllows(workflowWithChannels(['email']), null)).toBe(true)
    expect(channelAllows(workflowWithChannels(['email']), undefined)).toBe(true)
  })

  it('allows a listed channel and blocks an unlisted one once channels is non-empty', () => {
    const wf = workflowWithChannels(['messenger', 'email'])
    expect(channelAllows(wf, 'messenger')).toBe(true)
    expect(channelAllows(wf, 'email')).toBe(true)
    expect(channelAllows(wf, 'sms')).toBe(false)
  })
})

function workflowWithSettings(triggerSettings: Record<string, unknown>): Workflow {
  return { id: 'workflow_test', triggerSettings } as unknown as Workflow
}

function triggerWith(
  triggerType: string,
  ticketStatusCategory?: TicketStatusCategory | null
): WorkflowTrigger {
  return {
    triggerType,
    conversationId: 'conversation_test',
    actorType: 'user',
    ticketStatusCategory,
  } as unknown as WorkflowTrigger
}

// Pure — no DB.
describe('ticketStatusCategoryAllows', () => {
  it('always allows a non-ticket.status_changed trigger, regardless of any configured category', () => {
    const wf = workflowWithSettings({ ticketStatusCategory: 'closed' })
    expect(ticketStatusCategoryAllows(wf, triggerWith('ticket.created'))).toBe(true)
    expect(ticketStatusCategoryAllows(wf, triggerWith('conversation.created'))).toBe(true)
  })

  it('allows ticket.status_changed when no category is configured ("Any status change")', () => {
    const wf = workflowWithSettings({})
    expect(ticketStatusCategoryAllows(wf, triggerWith('ticket.status_changed', 'closed'))).toBe(
      true
    )
  })

  it("matches the configured category against the trigger's ENTERED category", () => {
    const wf = workflowWithSettings({ ticketStatusCategory: 'closed' })
    expect(ticketStatusCategoryAllows(wf, triggerWith('ticket.status_changed', 'closed'))).toBe(
      true
    )
    expect(ticketStatusCategoryAllows(wf, triggerWith('ticket.status_changed', 'open'))).toBe(false)
  })

  it('blocks same-category churn (the trigger carries no entered category, i.e. null)', () => {
    const wf = workflowWithSettings({ ticketStatusCategory: 'closed' })
    expect(ticketStatusCategoryAllows(wf, triggerWith('ticket.status_changed', null))).toBe(false)
  })
})

const baseCtx = makeConditionContext({
  conversation: {
    status: 'open',
    channel: 'messenger',
    priority: 'none',
    waitingMinutes: null,
    tagIds: [],
    assignedTeamId: null,
  },
})

// Pure — no DB.
describe('audienceAllows', () => {
  it('allows when no audience is configured (absent or null)', () => {
    expect(audienceAllows(workflowWithSettings({}), baseCtx)).toBe(true)
    expect(audienceAllows(workflowWithSettings({ audience: null }), baseCtx)).toBe(true)
  })

  it('matches the SAME resolved context every other condition in the run reads', () => {
    const wf = workflowWithSettings({
      audience: { field: 'conversation.status', op: 'eq', value: 'open' },
    })
    expect(audienceAllows(wf, baseCtx)).toBe(true)
    expect(
      audienceAllows(wf, {
        ...baseCtx,
        conversation: { ...baseCtx.conversation, status: 'closed' },
      })
    ).toBe(false)
  })

  it('evaluates a dynamic person/company attribute predicate through the same evaluateCondition', () => {
    const wf = workflowWithSettings({
      audience: { field: 'person.attr.plan', op: 'eq', value: 'pro' },
    })
    expect(
      audienceAllows(wf, { ...baseCtx, person: { segmentIds: [], attributes: { plan: 'pro' } } })
    ).toBe(true)
    expect(
      audienceAllows(wf, { ...baseCtx, person: { segmentIds: [], attributes: { plan: 'free' } } })
    ).toBe(false)
  })

  it('evaluates a nested all/any group', () => {
    const wf = workflowWithSettings({
      audience: {
        any: [
          { field: 'conversation.priority', op: 'eq', value: 'urgent' },
          { field: 'conversation.status', op: 'eq', value: 'open' },
        ],
      },
    })
    expect(audienceAllows(wf, baseCtx)).toBe(true) // status matches
  })

  it('fails open (allows) for a stored audience that is not a plain-object condition', () => {
    expect(audienceAllows(workflowWithSettings({ audience: 'garbage' }), baseCtx)).toBe(true)
    expect(audienceAllows(workflowWithSettings({ audience: 42 }), baseCtx)).toBe(true)
    expect(
      audienceAllows(workflowWithSettings({ audience: ['not', 'a', 'condition'] }), baseCtx)
    ).toBe(true)
  })

  it('an empty group ({}) is vacuously true — matches everything, same as the visual editor default', () => {
    expect(audienceAllows(workflowWithSettings({ audience: {} }), baseCtx)).toBe(true)
  })
})

describe('sendWindowAllows', () => {
  it('allows unconditionally when unset, "any", or an unrecognized value', () => {
    expect(sendWindowAllows(workflowWithSettings({}), { ...baseCtx, officeHours: false })).toBe(
      true
    )
    expect(
      sendWindowAllows(workflowWithSettings({ sendWindow: 'any' }), {
        ...baseCtx,
        officeHours: false,
      })
    ).toBe(true)
    expect(
      sendWindowAllows(workflowWithSettings({ sendWindow: 'sometimes' }), {
        ...baseCtx,
        officeHours: false,
      })
    ).toBe(true)
  })

  it('inside_office_hours matches officeHours true, blocks false', () => {
    const wf = workflowWithSettings({ sendWindow: 'inside_office_hours' })
    expect(sendWindowAllows(wf, { ...baseCtx, officeHours: true })).toBe(true)
    expect(sendWindowAllows(wf, { ...baseCtx, officeHours: false })).toBe(false)
  })

  it('outside_office_hours matches officeHours false, blocks true', () => {
    const wf = workflowWithSettings({ sendWindow: 'outside_office_hours' })
    expect(sendWindowAllows(wf, { ...baseCtx, officeHours: false })).toBe(true)
    expect(sendWindowAllows(wf, { ...baseCtx, officeHours: true })).toBe(false)
  })

  it('fails open when officeHours is unresolved (null/undefined) on the context', () => {
    const wf = workflowWithSettings({ sendWindow: 'inside_office_hours' })
    expect(sendWindowAllows(wf, { ...baseCtx, officeHours: null })).toBe(true)
    expect(sendWindowAllows(wf, baseCtx)).toBe(true) // officeHours absent entirely
  })
})

describe.skipIf(!fixture.available)('dispatcher guards (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('no cap / unlimited / anonymous subject are always allowed', async () => {
    const none = await seedWorkflow('background')
    const unlimited = await seedWorkflow('background', { frequencyCap: { type: 'unlimited' } })
    const principalId = createId('principal') as PrincipalId
    expect(await frequencyCapAllows(none, principalId)).toBe(true)
    expect(await frequencyCapAllows(unlimited, principalId)).toBe(true)
    // A per-person 'once' cap can't key on an anonymous (null) subject -> allowed.
    const once = await seedWorkflow('background', { frequencyCap: { type: 'once' } })
    expect(await frequencyCapAllows(once, null)).toBe(true)
  })

  it('once: allowed until the first run, then blocked', async () => {
    const wf = await seedWorkflow('background', { frequencyCap: { type: 'once' } })
    const p = await seedPrincipal()
    expect(await frequencyCapAllows(wf, p)).toBe(true)
    await seedStarts(wf.id, p, 1)
    expect(await frequencyCapAllows(wf, p)).toBe(false)
  })

  it('once_per_days: an old run does not count, a recent one does', async () => {
    const wf = await seedWorkflow('background', {
      frequencyCap: { type: 'once_per_days', days: 7 },
    })
    const p = await seedPrincipal()
    await seedStarts(wf.id, p, 1, new Date(Date.now() - 30 * 86_400_000)) // 30d ago
    expect(await frequencyCapAllows(wf, p)).toBe(true) // outside the 7d window
    await seedStarts(wf.id, p, 1) // now
    expect(await frequencyCapAllows(wf, p)).toBe(false)
  })

  it('n_total: allowed while under the count', async () => {
    const wf = await seedWorkflow('background', { frequencyCap: { type: 'n_total', count: 3 } })
    const p = await seedPrincipal()
    await seedStarts(wf.id, p, 2)
    expect(await frequencyCapAllows(wf, p)).toBe(true) // 2 < 3
    await seedStarts(wf.id, p, 1)
    expect(await frequencyCapAllows(wf, p)).toBe(false) // 3 >= 3
  })

  it('claimFrequencyCapSlot authoritatively re-checks the cap under the advisory lock (extracted from workflow.engine.ts)', async () => {
    const wf = await seedWorkflow('background', { frequencyCap: { type: 'once' } })
    const p = await seedPrincipal()

    await testDb.transaction(async (tx) => {
      expect(await claimFrequencyCapSlot(tx, wf, p)).toBe(true)
    })

    await seedStarts(wf.id, p, 1)

    await testDb.transaction(async (tx) => {
      expect(await claimFrequencyCapSlot(tx, wf, p)).toBe(false)
    })
  })

  it('hasActiveCustomerFacingRun sees a live customer_facing run only', async () => {
    const conversationId = await seedConversation()
    expect(await hasActiveCustomerFacingRun(conversationId)).toBe(false)

    // A background run on the conversation does not lock it.
    const bg = await seedWorkflow('background')
    await testDb
      .insert(workflowRuns)
      .values({ workflowId: bg.id, conversationId, state: 'running' })
    expect(await hasActiveCustomerFacingRun(conversationId)).toBe(false)

    // An ENDED customer_facing run does not lock it.
    const cf = await seedWorkflow('customer_facing')
    await testDb.insert(workflowRuns).values({ workflowId: cf.id, conversationId, state: 'done' })
    expect(await hasActiveCustomerFacingRun(conversationId)).toBe(false)

    // A running customer_facing run does.
    await testDb
      .insert(workflowRuns)
      .values({ workflowId: cf.id, conversationId, state: 'waiting' })
    expect(await hasActiveCustomerFacingRun(conversationId)).toBe(true)
  })
})
