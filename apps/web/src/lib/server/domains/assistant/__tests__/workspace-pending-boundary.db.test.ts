import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user, assistantPendingActions, eq } from '@/lib/server/db'
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
vi.mock('../workspace-copilot-gate', () => ({
  workspaceCopilotAvailable: async () => false,
  assertWorkspaceCopilotAvailable: async () => {
    throw new Error('Copilot unavailable')
  },
}))
import { createWorkspaceThread } from '../workspace-threads.service'
import {
  getWorkspaceCopilotThreadFn,
  listWorkspaceCopilotThreadsFn,
  createWorkspaceCopilotThreadFn,
} from '@/lib/server/functions/workspace-copilot'
import { proposePendingAction } from '../pending-actions.service'
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
it('checks actual workspace ownership on get, reject and approve', async () => {
  const thread = await createWorkspaceThread(owner)
  const row = await proposePendingAction({
    workspaceThreadKey: thread.key,
    toolName: 'create_post',
    args: { title: 'Acme' },
    summary: 'Acme',
    originRole: 'workspace_assistant',
  })
  expect(
    (await getAssistantPendingActionFn({ data: { pendingActionId: row.id } })).workspaceThreadKey
  ).toBe(thread.key)
  authState.actor = foreign
  await expect(
    getAssistantPendingActionFn({ data: { pendingActionId: row.id } })
  ).rejects.toMatchObject({ code: 'WORKSPACE_THREAD_NOT_FOUND' })
  await expect(
    rejectAssistantActionFn({ data: { pendingActionId: row.id } })
  ).rejects.toMatchObject({ code: 'WORKSPACE_THREAD_NOT_FOUND' })
  await expect(
    approveAssistantActionFn({ data: { pendingActionId: row.id } })
  ).rejects.toMatchObject({ code: 'WORKSPACE_THREAD_NOT_FOUND' })
  authState.actor = owner
  await expect(
    approveAssistantActionFn({ data: { pendingActionId: row.id } })
  ).rejects.toMatchObject({ code: 'ASSISTANT_ACTION_POLICY_CHANGED' })
  expect((await rejectAssistantActionFn({ data: { pendingActionId: row.id } })).status).toBe(
    'rejected'
  )
  expect(
    (
      await testDb
        .select()
        .from(assistantPendingActions)
        .where(eq(assistantPendingActions.id, row.id))
    )[0].decidedById
  ).toBe(owner.principalId)
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
    await expect(fn({ data: { pendingActionId: row.id } })).rejects.toMatchObject({
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

it('allows owner review with AI unavailable while refusing new chat and foreign reads', async () => {
  const thread = await createWorkspaceThread(owner)
  expect((await getWorkspaceCopilotThreadFn({ data: { threadKey: thread.key } })).key).toBe(
    thread.key
  )
  expect(
    (await listWorkspaceCopilotThreadsFn({ data: undefined })).map((entry) => entry.key)
  ).toContain(thread.key)
  await expect(createWorkspaceCopilotThreadFn({ data: {} })).rejects.toThrow('Copilot unavailable')
  authState.actor = foreign
  await expect(
    getWorkspaceCopilotThreadFn({ data: { threadKey: thread.key } })
  ).rejects.toMatchObject({ code: 'WORKSPACE_THREAD_NOT_FOUND' })
  expect(await listWorkspaceCopilotThreadsFn({ data: undefined })).toEqual([])
  authState.actor = { ...owner, permissions: new Set() }
  await expect(
    getWorkspaceCopilotThreadFn({ data: { threadKey: thread.key } })
  ).rejects.toMatchObject({ code: 'WORKSPACE_THREAD_NOT_FOUND' })
})
