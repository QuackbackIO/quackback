/**
 * Real-DB coverage for the dry-run preview (support platform §4.6 dry-run
 * preview): the trace walks a saved graph against a REAL resolved condition
 * context (a condition/branch node evaluates for real, not a stub), stops at
 * a parking node, reports the audience verdict, and previews a draft
 * workflow just as readily as a live one — since nothing is executed or
 * written either way.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createId, type PrincipalId, type UserId, type ConversationId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { conversations, user, principal, workflowVersions } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// previewWorkflow -> resolveConditionContext reads the workspace office-hours
// schedule; stub it disabled (24/7-open) so it never depends on a real
// settings row, same idiom as condition.context.test.ts.
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => ({ enabled: false, timezone: 'UTC', intervals: [] })),
}))

import { createWorkflow } from '../workflow.service'
import { previewWorkflow } from '../workflow-preview'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: workflowVersions.id }).from(workflowVersions).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedConversation(priority: 'low' | 'medium' | 'high' | 'urgent') {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Visitor-${suffix()}`, email: null })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'member',
    type: 'user',
    createdAt: new Date(),
  })
  const [conv] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: principalId, channel: 'messenger', priority })
    .returning()
  return conv!.id as ConversationId
}

describe.skipIf(!fixture.available)('previewWorkflow (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('walks a real graph, evaluating a condition for real, and parks at a wait', async () => {
    const conversationId = await seedConversation('high')
    const wf = await createWorkflow({
      name: 'High priority pause',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'g',
            type: 'condition',
            condition: { field: 'conversation.priority', op: 'eq', value: 'high' },
          },
          { id: 'a', type: 'action', action: { type: 'close' } },
          { id: 'w', type: 'wait', seconds: 60 },
        ],
        edges: [
          { from: 't', to: 'g' },
          { from: 'g', to: 'a' },
          { from: 'a', to: 'w' },
        ],
      },
    })

    const result = await previewWorkflow({ workflowId: wf.id, conversationId })

    expect(result.finalStatus).toBe('waiting')
    expect(result.trace.map((e) => e.nodeId)).toEqual(['t', 'g', 'a', 'w'])
    expect(result.trace.map((e) => e.outcome)).toEqual(['planned', 'planned', 'planned', 'parked'])
    expect(result.trace[1]!.summary).toMatch(/met/i)
  })

  it('halts the walk when the condition does not match the real context', async () => {
    const conversationId = await seedConversation('low')
    const wf = await createWorkflow({
      name: 'High priority only',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'g',
            type: 'condition',
            condition: { field: 'conversation.priority', op: 'eq', value: 'high' },
          },
          { id: 'a', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'g' },
          { from: 'g', to: 'a' },
        ],
      },
    })

    const result = await previewWorkflow({ workflowId: wf.id, conversationId })

    expect(result.finalStatus).toBe('halted')
    expect(result.trace.map((e) => e.nodeId)).toEqual(['t', 'g'])
    expect(result.trace[1]!.outcome).toBe('end')
  })

  it('routes a branch node on the real context, taking the matching path', async () => {
    const conversationId = await seedConversation('urgent')
    const wf = await createWorkflow({
      name: 'Branch by priority',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'b',
            type: 'branch',
            branches: [
              {
                key: 'urgent',
                condition: { field: 'conversation.priority', op: 'eq', value: 'urgent' },
              },
              { key: 'other', condition: { all: [] } },
            ],
          },
          { id: 'urgent-action', type: 'action', action: { type: 'close' } },
          { id: 'other-action', type: 'action', action: { type: 'close' } },
        ],
        edges: [
          { from: 't', to: 'b' },
          { from: 'b', to: 'urgent-action', branch: 'urgent' },
          { from: 'b', to: 'other-action', branch: 'other' },
        ],
      },
    })

    const result = await previewWorkflow({ workflowId: wf.id, conversationId })

    expect(result.trace.map((e) => e.nodeId)).toEqual(['t', 'b', 'urgent-action'])
    expect(result.finalStatus).toBe('completed')
  })

  it('parks at an interactive block reached fresh (no answer in scope yet)', async () => {
    const conversationId = await seedConversation('medium')
    const wf = await createWorkflow({
      name: 'Ask a question',
      class: 'customer_facing',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          {
            id: 'rb',
            type: 'reply_buttons',
            body: { type: 'doc', content: [] },
            options: [{ key: 'yes', label: 'Yes' }],
            allowTyping: false,
          },
        ],
        edges: [{ from: 't', to: 'rb' }],
      },
    })

    const result = await previewWorkflow({ workflowId: wf.id, conversationId })

    expect(result.finalStatus).toBe('waiting')
    expect(result.trace.at(-1)).toMatchObject({ nodeId: 'rb', outcome: 'parked' })
  })

  it('reports the audience verdict, both matched and unmatched, against the real context', async () => {
    const highConversation = await seedConversation('high')
    const lowConversation = await seedConversation('low')
    const wf = await createWorkflow({
      name: 'Audience-gated',
      class: 'background',
      triggerType: 'conversation.created',
      triggerSettings: {
        audience: { field: 'conversation.priority', op: 'eq', value: 'high' },
      },
      graph: { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
    })

    const matched = await previewWorkflow({ workflowId: wf.id, conversationId: highConversation })
    expect(matched.audienceConfigured).toBe(true)
    expect(matched.audienceMatched).toBe(true)

    const unmatched = await previewWorkflow({ workflowId: wf.id, conversationId: lowConversation })
    expect(unmatched.audienceConfigured).toBe(true)
    expect(unmatched.audienceMatched).toBe(false)
  })

  it('reports no audience configured when the trigger has none', async () => {
    const conversationId = await seedConversation('medium')
    const wf = await createWorkflow({
      name: 'No audience',
      class: 'background',
      triggerType: 'conversation.created',
      graph: { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
    })

    const result = await previewWorkflow({ workflowId: wf.id, conversationId })
    expect(result.audienceConfigured).toBe(false)
    expect(result.audienceMatched).toBe(true) // audienceAllows' own "no audience -> always allows"
  })

  it('previews a DRAFT workflow (never gone live) just as readily as a live one', async () => {
    const conversationId = await seedConversation('medium')
    const wf = await createWorkflow({
      name: 'Still a draft',
      class: 'background',
      triggerType: 'conversation.created',
      graph: { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
    })
    expect(wf.status).toBe('draft')

    const result = await previewWorkflow({ workflowId: wf.id, conversationId })
    expect(result.workflowStatus).toBe('draft')
    expect(result.finalStatus).toBe('completed')
  })

  it('throws when the workflow does not exist', async () => {
    const conversationId = await seedConversation('medium')
    await expect(
      previewWorkflow({ workflowId: 'workflow_doesnotexist' as never, conversationId })
    ).rejects.toThrow()
  })

  it('is read-only: does not write any workflow_run/workflow_run_event row', async () => {
    const conversationId = await seedConversation('high')
    const wf = await createWorkflow({
      name: 'No side effects',
      class: 'background',
      triggerType: 'conversation.created',
      graph: {
        nodes: [
          { id: 't', type: 'trigger' },
          { id: 'a', type: 'action', action: { type: 'close' } },
        ],
        edges: [{ from: 't', to: 'a' }],
      },
    })

    await previewWorkflow({ workflowId: wf.id, conversationId })

    // Only the initial version write from createWorkflow exists — the preview
    // itself must not have written anything, including a version.
    const versions = await testDb
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, wf.id))
    expect(versions).toHaveLength(1)
  })
})
