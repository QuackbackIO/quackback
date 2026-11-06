import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  principal,
  user,
  assistantPendingActions,
  conversationMessages,
  conversations,
  workspaceAssistantThreads,
  eq,
} from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    let validator: { parse: (data: unknown) => unknown } | undefined
    const builder = {
      validator: (schema: { parse: (data: unknown) => unknown }) => {
        validator = schema
        return builder
      },
      handler:
        (handler: (args: { data: unknown }) => Promise<unknown>) => (args: { data: unknown }) =>
          handler({ data: validator ? validator.parse(args.data) : args.data }),
    }
    return builder
  },
}))
const authState = vi.hoisted(() => ({ actor: null as Actor | null }))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: async () => ({
    principal: { id: authState.actor!.principalId, role: authState.actor!.role, type: 'user' },
    user: { id: null, email: 'you@example.com' },
  }),
  policyActorFromAuth: async () => authState.actor!,
}))
import { proposePendingAction } from '../pending-actions.service'
import { assertPendingWorkspaceParent } from '../pending-action-parent'
import { getAssistantPendingActionFn } from '@/lib/server/functions/assistant-pending-actions'
import {
  rejectAssistantActionFn,
  approveAssistantActionFn,
} from '@/lib/server/functions/assistant-actions'
const fixture = await createDbTestFixture()
let owner: Actor, foreign: Actor
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  async function seed(): Promise<Actor> {
    const userId = createId('user'),
      principalId = createId('principal')
    await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
    await testDb
      .insert(principal)
      .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
    return {
      principalId,
      role: 'member',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set([PERMISSIONS.COPILOT_USE]),
    }
  }
  owner = await seed()
  foreign = await seed()
  authState.actor = owner
})
afterEach(() => fixture.rollback())
afterAll(() => fixture.close())
/** A thread left over from the retired Home chat, with one private message. */
async function seedRetiredHomeThread(owner: Actor): Promise<string> {
  const key = `workspace:${createId('user')}`
  await testDb
    .insert(workspaceAssistantThreads)
    .values({ key, ownerPrincipalId: owner.principalId! })
  await testDb.insert(conversationMessages).values({
    workspaceThreadKey: key,
    principalId: owner.principalId,
    senderType: 'visitor',
    content: 'Acme question',
    isInternal: true,
  })
  return key
}

it('finds no retired Home proposal on any web endpoint, even for its owner', async () => {
  const key = await seedRetiredHomeThread(owner)
  const row = await proposePendingAction({
    workspaceThreadKey: key,
    toolName: 'create_post',
    args: { title: 'Acme' },
    summary: 'Acme',
    originRole: 'workspace_assistant',
  })
  for (const fn of [getAssistantPendingActionFn, rejectAssistantActionFn, approveAssistantActionFn])
    await expect(
      fn({ data: { pendingActionId: row.id, contentHash: row.argsDigest! } })
    ).rejects.toMatchObject({ code: 'PENDING_ACTION_NOT_FOUND' })
  expect(
    (
      await testDb
        .select()
        .from(assistantPendingActions)
        .where(eq(assistantPendingActions.id, row.id))
    )[0].status
  ).toBe('proposed')
})

it('rejects integration keys from every web decision endpoint', async () => {
  const row = await proposePendingAction({
    workspaceThreadKey: JSON.stringify(['T', 'C', '1']),
    toolName: 'create_post',
    args: { title: 'Acme' },
    summary: 'Acme',
    originRole: 'workspace_assistant',
  })
  for (const fn of [getAssistantPendingActionFn, rejectAssistantActionFn, approveAssistantActionFn])
    await expect(
      fn({ data: { pendingActionId: row.id, contentHash: row.argsDigest! } })
    ).rejects.toMatchObject({
      code: 'PENDING_ACTION_NOT_FOUND',
    })
  expect(
    (
      await testDb
        .select()
        .from(assistantPendingActions)
        .where(eq(assistantPendingActions.id, row.id))
    )[0].status
  ).toBe('proposed')
})

it('lets an integration decide only the thread it verified', async () => {
  const row = await proposePendingAction({
    workspaceThreadKey: JSON.stringify(['T', 'C', '123']),
    toolName: 'create_post',
    args: { title: 'Acme' },
    summary: 'Acme',
    originRole: 'workspace_assistant',
  })
  expect(() => assertPendingWorkspaceParent(row)).toThrow(
    expect.objectContaining({ code: 'PENDING_ACTION_NOT_FOUND' })
  )
  expect(() => assertPendingWorkspaceParent(row, 'different')).toThrow(
    expect.objectContaining({ code: 'PENDING_ACTION_NOT_FOUND' })
  )
  expect(() => assertPendingWorkspaceParent(row, row.workspaceThreadKey!)).not.toThrow()
})

it('keeps retired Home transcript messages out of public message actions', async () => {
  const key = await seedRetiredHomeThread(owner)
  const [message] = await testDb
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.workspaceThreadKey, key))
  const { resolveMessageParent } = await import('@/lib/server/domains/conversation/message-parent')
  for (const actor of [owner, foreign])
    await expect(resolveMessageParent(message, actor)).rejects.toMatchObject({
      code: 'MESSAGE_NOT_FOUND',
    })
})

it('keeps retired Home transcript engagement out of Leads with a real message positive control', async () => {
  await seedRetiredHomeThread(owner)
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
