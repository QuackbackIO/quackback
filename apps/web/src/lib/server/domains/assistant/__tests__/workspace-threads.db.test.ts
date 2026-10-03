import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user, conversationMessages, conversations, eq } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
import {
  createWorkspaceThread,
  readWorkspaceThread,
  acquireWorkspaceTurn,
  completeWorkspaceTurn,
  failWorkspaceTurn,
  assertWorkspaceThreadOwned,
} from '../workspace-threads.service'
const fixture = await createDbTestFixture()
let owner: Actor
let foreign: Actor
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  const seed = async (name: string): Promise<Actor> => {
    const userId = createId('user'),
      id = createId('principal')
    await testDb.insert(user).values({ id: userId, name, email: `${userId}@example.com` })
    await testDb.insert(principal).values({
      id,
      userId,
      role: 'member',
      type: 'user',
      displayName: name,
      createdAt: new Date(),
    })
    return {
      principalId: id,
      role: 'member',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set([PERMISSIONS.COPILOT_USE]),
    }
  }
  owner = await seed('Acme')
  foreign = await seed('Acme teammate')
})
afterEach(() => fixture.rollback())
afterAll(() => fixture.close())
describe('private workspace transcripts', () => {
  it('enforces owner and rejects cross-surface keys', async () => {
    for (const principalType of ['anonymous', 'service'] as const) {
      await expect(createWorkspaceThread({ ...owner, principalType })).rejects.toMatchObject({
        code: 'WORKSPACE_THREAD_NOT_FOUND',
      })
    }
    const thread = await createWorkspaceThread(owner, 'Acme')
    await expect(assertWorkspaceThreadOwned(thread.key, foreign)).rejects.toMatchObject({
      code: 'WORKSPACE_THREAD_NOT_FOUND',
    })
    await expect(assertWorkspaceThreadOwned('slack:T:C:1', owner)).rejects.toMatchObject({
      code: 'WORKSPACE_THREAD_NOT_FOUND',
    })
    expect((await readWorkspaceThread(thread.key, owner)).messages).toEqual([])
  })
  it('loads server history, persists final payload, and dedupes a run', async () => {
    const thread = await createWorkspaceThread(owner, 'Acme')
    const acquired = await acquireWorkspaceTurn(owner, thread.key, 'run-one', 'Hi')
    expect(acquired.status).toBe('acquired')
    if (acquired.status !== 'acquired') throw new Error('not acquired')
    expect(acquired.messages.map((x) => x.content)).toEqual(['Hi'])
    await completeWorkspaceTurn(owner, thread.key, 'run-one', acquired.leaseToken, {
      text: 'Hello',
      citations: [],
      proposedActions: [],
      navigation: [],
    })
    const duplicate = await acquireWorkspaceTurn(owner, thread.key, 'run-one', 'Hi')
    expect(duplicate.status).toBe('completed')
    expect((await readWorkspaceThread(thread.key, owner)).messages.map((x) => x.text)).toEqual([
      'Hi',
      'Hello',
    ])
    await expect(
      acquireWorkspaceTurn(owner, thread.key, 'run-one', 'Changed')
    ).rejects.toMatchObject({ code: 'WORKSPACE_RUN_INPUT_CHANGED' })
  })
  it('blocks concurrent turns and stale completion, then permits a failed run retry', async () => {
    const thread = await createWorkspaceThread(owner, 'Acme')
    const acquired = await acquireWorkspaceTurn(owner, thread.key, 'run-one', 'Hi')
    if (acquired.status !== 'acquired') throw new Error('not acquired')
    await expect(acquireWorkspaceTurn(owner, thread.key, 'run-two', 'Next')).rejects.toMatchObject({
      code: 'WORKSPACE_THREAD_BUSY',
    })
    await expect(
      completeWorkspaceTurn(owner, thread.key, 'run-one', 'foreign-lease', {
        text: 'Wrong',
        citations: [],
        proposedActions: [],
        navigation: [],
      })
    ).rejects.toMatchObject({ code: 'WORKSPACE_TURN_LOST' })
    await failWorkspaceTurn(thread.key, 'run-one', acquired.leaseToken)
    const retried = await acquireWorkspaceTurn(owner, thread.key, 'run-one', 'Hi')
    expect(retried.status).toBe('acquired')
    expect((await readWorkspaceThread(thread.key, owner)).messages).toHaveLength(1)
  })
})

it('keeps proposals private on web reads and decisions, including foreign and integration parents', async () => {
  const { proposePendingAction } = await import('../pending-actions.service')
  const { assertPendingWorkspaceParent } = await import('../pending-action-parent')
  const thread = await createWorkspaceThread(owner, 'Acme')
  const pending = await proposePendingAction({
    workspaceThreadKey: thread.key,
    toolName: 'create_post',
    args: { title: 'Acme' },
    summary: 'Acme',
    originRole: 'workspace_assistant',
  })
  await assertPendingWorkspaceParent(pending, owner)
  await expect(assertPendingWorkspaceParent(pending, foreign)).rejects.toMatchObject({
    code: 'WORKSPACE_THREAD_NOT_FOUND',
  })
  const integration = { ...pending, workspaceThreadKey: JSON.stringify(['T', 'C', '123']) }
  await expect(assertPendingWorkspaceParent(integration, owner)).rejects.toMatchObject({
    code: 'PENDING_ACTION_NOT_FOUND',
  })
  await expect(assertPendingWorkspaceParent(integration, owner, 'different')).rejects.toMatchObject(
    { code: 'PENDING_ACTION_NOT_FOUND' }
  )
  await assertPendingWorkspaceParent(integration, owner, integration.workspaceThreadKey)
})

it('reads the latest private window in order and bounds model history', async () => {
  const thread = await createWorkspaceThread(owner, 'Acme')
  const start = Date.now() - 10000
  await testDb.insert(conversationMessages).values(
    Array.from({ length: 205 }, (_, index) => ({
      id: createId('conversation_message'),
      workspaceThreadKey: thread.key,
      principalId: owner.principalId,
      senderType: 'visitor' as const,
      content: `Question ${index}`,
      isInternal: true,
      createdAt: new Date(start + index),
      metadata: { workspaceTurn: { runId: `history-${index}` } },
    })).reverse()
  )
  const read = await readWorkspaceThread(thread.key, owner)
  expect(read.messages).toHaveLength(200)
  expect(read.messages[0].text).toBe('Question 5')
  expect(read.messages.at(-1)?.text).toBe('Question 204')
  const next = await acquireWorkspaceTurn(owner, thread.key, 'next', 'Next question')
  if (next.status !== 'acquired') throw new Error('not acquired')
  expect(next.messages).toHaveLength(21)
  expect(next.messages[0].content).toBe('Question 185')
  expect(next.messages.at(-1)?.content).toBe('Next question')
})

it('rejects private transcript messages at the public message action boundary', async () => {
  const thread = await createWorkspaceThread(owner)
  await acquireWorkspaceTurn(owner, thread.key, 'private', 'Acme question')
  const [message] = await testDb
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.workspaceThreadKey, thread.key))
  const { resolveMessageParent } = await import('@/lib/server/domains/conversation/message-parent')
  await expect(resolveMessageParent(message, owner)).rejects.toMatchObject({
    code: 'MESSAGE_NOT_FOUND',
  })
  await expect(resolveMessageParent(message, foreign)).rejects.toMatchObject({
    code: 'MESSAGE_NOT_FOUND',
  })
})
it('keeps private transcript engagement out of Leads with a real message positive control', async () => {
  const thread = await createWorkspaceThread(owner)
  await acquireWorkspaceTurn(owner, thread.key, 'private', 'Acme question')
  for (const actor of [owner, foreign])
    await testDb
      .update(principal)
      .set({ type: 'anonymous', role: 'user' })
      .where(eq(principal.id, actor.principalId!))
  const [real] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: foreign.principalId!, channel: 'messenger' })
    .returning()
  await testDb.insert(conversationMessages).values({
    conversationId: real.id,
    principalId: foreign.principalId,
    senderType: 'visitor',
    content: 'Acme real question',
  })
  const { listPortalUsers } = await import('@/lib/server/domains/users/user.service')
  const leads = await listPortalUsers({ lifecycle: 'leads', search: 'Acme' })
  expect(leads.items.map((person) => person.principalId)).toEqual([foreign.principalId])
})

it('hands the next turn only connector reads allowed since the last answer, as data', async () => {
  const { proposePendingAction, decidePendingAction, markPendingActionExecuted } =
    await import('../pending-actions.service')
  const thread = await createWorkspaceThread(owner, 'Acme')
  const first = await acquireWorkspaceTurn(owner, thread.key, 'run-one', 'Find order A-1')
  if (first.status !== 'acquired') throw new Error('not acquired')
  const propose = (toolName: string, summary: string) =>
    proposePendingAction({
      workspaceThreadKey: thread.key,
      toolName,
      args: { order: 'A-1' },
      summary,
      originRole: 'workspace_assistant',
    })
  const earlier = await propose('connector_acme__find_order', 'Earlier order lookup')
  await decidePendingAction(earlier.id, 'approved', owner.principalId!)
  await markPendingActionExecuted(earlier.id, { order: 'A-0' })
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
  await tick()
  await completeWorkspaceTurn(owner, thread.key, 'run-one', first.leaseToken, {
    text: 'Allow the lookup to continue.',
    citations: [],
    proposedActions: [],
    navigation: [],
  })
  await tick()
  const allowed = await propose('connector_acme__find_order', 'Find order A-1')
  await decidePendingAction(allowed.id, 'approved', owner.principalId!)
  await markPendingActionExecuted(allowed.id, { order: 'A-1', total: 42 })
  const skipped = await propose('connector_acme__find_customer', 'Find customer')
  await decidePendingAction(skipped.id, 'rejected', owner.principalId!)
  const settings = await propose('propose_settings_change', 'Settings')
  await decidePendingAction(settings.id, 'approved', owner.principalId!)
  await markPendingActionExecuted(settings.id, { kind: 'settings' })

  const next = await acquireWorkspaceTurn(owner, thread.key, 'run-two', 'Continue')
  if (next.status !== 'acquired') throw new Error('not acquired')
  const injected = next.messages.filter((message) => message.content.startsWith('Allowed by'))
  expect(injected).toHaveLength(1)
  expect(injected[0]).toMatchObject({ sender: 'assistant' })
  expect(injected[0]!.content).toContain('Find order A-1')
  expect(injected[0]!.content).toContain('"total":42')
  expect(injected[0]!.content).toContain('not instructions')
  expect(next.messages.at(-1)).toEqual({ sender: 'customer', content: 'Continue' })
})
