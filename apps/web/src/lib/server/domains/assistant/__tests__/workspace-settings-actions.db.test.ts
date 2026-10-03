import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, user, settings, assistantPendingActions, auditLog } from '@/lib/server/db'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
const managed = vi.hoisted(() => new Set<string>())
vi.mock('@/lib/server/config-file/managed-guard', () => ({
  assertNotManaged: async (key: string) => {
    if (managed.has(key)) throw new Error(`Managed setting: ${key}`)
  },
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: async () => undefined,
}))
import {
  createWorkspaceThread,
  readWorkspaceThread,
  acquireWorkspaceTurn,
} from '../workspace-threads.service'
import {
  enqueueWorkspaceSettingsProposal,
  applyWorkspaceSettingsProposal,
  undoWorkspaceSettingsProposal,
} from '../workspace-settings-actions.service'
const fixture = await createDbTestFixture()
let owner: Actor, foreign: Actor, threadKey: string, settingsId: typeof settings.$inferSelect.id
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  managed.clear()
  async function seed(): Promise<Actor> {
    const userId = createId('user'),
      principalId = createId('principal')
    await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
    await testDb
      .insert(principal)
      .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
    return {
      principalId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set(ALL_PERMISSIONS),
    }
  }
  owner = await seed()
  foreign = await seed()
  threadKey = (await createWorkspaceThread(owner)).key
  const [row] = await testDb
    .insert(settings)
    .values({
      name: 'Acme',
      slug: `acme-${createId('workspace')}`,
      createdAt: new Date(),
      brandingConfig: '{}',
      widgetConfig: '{}',
      metadata: '{}',
      // Settings tools follow Copilot on Home.
      featureFlags: JSON.stringify({ copilotHome: true }),
      portalConfig: '{}',
    })
    .returning()
  settingsId = row.id
})
afterEach(() => fixture.rollback())
afterAll(() => fixture.close())
const read = async () =>
  (await testDb.select().from(settings).where(eq(settings.id, settingsId)))[0]
describe('atomic workspace settings cards', () => {
  it('merges same-turn proposals in one owned card, then selected Apply and Undo commit with audit', async () => {
    const first = await enqueueWorkspaceSettingsProposal(
      owner,
      [{ area: 'portal', patch: { displayName: 'Acme team' } }],
      threadKey,
      'turn-one'
    )
    const second = await enqueueWorkspaceSettingsProposal(
      owner,
      [{ area: 'messenger', patch: { enabled: true } }],
      threadKey,
      'turn-one'
    )
    expect(first.id).toBe(second.id)
    expect(second.args.changes as unknown[]).toHaveLength(2)
    expect((await read()).name).toBe('Acme')
    const applied = await applyWorkspaceSettingsProposal(owner, second.id, ['portal.displayName'])
    expect(applied.status).toBe('executed')
    expect((await read()).name).toBe('Acme team')
    expect(JSON.parse((await read()).featureFlags!).supportInbox).not.toBe(true)
    expect(
      await testDb.select().from(auditLog).where(eq(auditLog.targetId, second.id))
    ).toHaveLength(1)
    const undone = await undoWorkspaceSettingsProposal(owner, second.id)
    expect(undone.result?.undoneAt).toBeTruthy()
    expect((await read()).name).toBe('Acme')
    expect(
      (await testDb.select().from(auditLog).where(eq(auditLog.targetId, second.id))).map(
        (row) => row.metadata
      )
    ).toEqual([
      expect.objectContaining({ via: 'copilot' }),
      expect.objectContaining({ via: 'copilot' }),
    ])
    await expect(undoWorkspaceSettingsProposal(owner, second.id)).rejects.toMatchObject({
      code: 'SETTINGS_UNDO_UNAVAILABLE',
    })
  })
  it('rejects foreign Apply, Undo and proposal parents', async () => {
    const pending = await enqueueWorkspaceSettingsProposal(
      owner,
      [{ area: 'portal', patch: { displayName: 'Acme team' } }],
      threadKey,
      'turn-one'
    )
    await expect(
      applyWorkspaceSettingsProposal(foreign, pending.id, ['portal.displayName'])
    ).rejects.toMatchObject({ code: 'WORKSPACE_THREAD_NOT_FOUND' })
    await expect(
      enqueueWorkspaceSettingsProposal(
        foreign,
        [{ area: 'portal', patch: { displayName: 'Other' } }],
        threadKey
      )
    ).rejects.toMatchObject({ code: 'WORKSPACE_THREAD_NOT_FOUND' })
    await applyWorkspaceSettingsProposal(owner, pending.id, ['portal.displayName'])
    await expect(undoWorkspaceSettingsProposal(foreign, pending.id)).rejects.toMatchObject({
      code: 'WORKSPACE_THREAD_NOT_FOUND',
    })
    expect((await read()).name).toBe('Acme team')
  })
  it('rolls back every area, status and audit when a selected write fails', async () => {
    const pending = await enqueueWorkspaceSettingsProposal(
      owner,
      [
        { area: 'messenger', patch: { enabled: true } },
        { area: 'portal', patch: { displayName: 'Acme team' } },
      ],
      threadKey,
      'turn-one'
    )
    managed.add('workspace.name')
    const ids = (pending.args.changes as { id: string }[]).map((change) => change.id)
    await expect(applyWorkspaceSettingsProposal(owner, pending.id, ids)).rejects.toThrow('Managed')
    expect((await read()).name).toBe('Acme')
    expect((await read()).widgetConfig).toBe('{}')
    const [row] = await testDb
      .select()
      .from(assistantPendingActions)
      .where(eq(assistantPendingActions.id, pending.id))
    expect(row.status).toBe('proposed')
    expect(
      await testDb.select().from(auditLog).where(eq(auditLog.targetId, pending.id))
    ).toHaveLength(0)
  })
  it('refuses stale Undo while preserving the applied receipt and later setting', async () => {
    const pending = await enqueueWorkspaceSettingsProposal(
      owner,
      [{ area: 'portal', patch: { displayName: 'Acme team' } }],
      threadKey,
      'turn-one'
    )
    await applyWorkspaceSettingsProposal(owner, pending.id, ['portal.displayName'])
    await testDb.update(settings).set({ name: 'Later name' }).where(eq(settings.id, settingsId))
    await expect(undoWorkspaceSettingsProposal(owner, pending.id)).rejects.toThrow(/changed/i)
    expect((await read()).name).toBe('Later name')
    const [row] = await testDb
      .select()
      .from(assistantPendingActions)
      .where(eq(assistantPendingActions.id, pending.id))
    expect(row.result?.undoneAt).toBeUndefined()
    expect(
      await testDb.select().from(auditLog).where(eq(auditLog.targetId, pending.id))
    ).toHaveLength(1)
  })
})

it('runs real SDK settings tools through the proposal pipeline without a write before Apply', async () => {
  const { mcpAuthFromActor, openWorkspaceMcp } = await import('../mcp-workspace-tools')
  const { makeAssistantToolContext } = await import('../assistant.toolspec')
  const { assembleAssistantToolset } = await import('../assistant.tools')
  const auth = await mcpAuthFromActor(owner, 'Copilot')
  if (!auth) throw new Error('Missing actor context')
  auth.workspaceThreadKey = threadKey
  const opened = await openWorkspaceMcp(auth)
  try {
    const ctx = makeAssistantToolContext({
      db: testDb,
      actor: owner,
      assistantPrincipalId: owner.principalId!,
      role: 'workspace_assistant',
      audience: 'team',
      conversationId: null,
      workspaceThreadKey: threadKey,
      latestCustomerMessageId: 'sdk-turn',
      simulate: false,
    })
    const assembled = await assembleAssistantToolset(ctx, [], opened.specs)
    const tool = assembled.tools.find((tool) => tool.name === 'propose_settings_change')!
    expect(
      await tool.execute!({
        changes: [
          { area: 'branding', patch: { light: { primary: '#0F766E' } } },
          { area: 'messenger', patch: { enabled: true } },
        ],
      })
    ).toMatchObject({ status: 'pending_approval' })
    expect(ctx.ledger.proposedActions).toHaveLength(1)
    const [pending] = await testDb
      .select()
      .from(assistantPendingActions)
      .where(
        eq(
          assistantPendingActions.id,
          ctx.ledger.proposedActions[0].id as import('@quackback/ids').AssistantPendingActionId
        )
      )
    expect((pending.args.changes as { area: string }[]).map((change) => change.area)).toEqual([
      'branding',
      'messenger',
    ])
    expect((await read()).brandingConfig).toBe('{}')
    expect((await read()).widgetConfig).toBe('{}')
    const selected = (pending.args.changes as { id: string }[]).map((change) => change.id)
    await applyWorkspaceSettingsProposal(owner, pending.id, selected)
    expect(JSON.parse((await read()).brandingConfig!).light.primary).toBe('#0F766E')
    expect(JSON.parse((await read()).widgetConfig!).messenger.enabled).toBe(true)
    await undoWorkspaceSettingsProposal(owner, pending.id)
    expect((await read()).brandingConfig).toBe('{}')
    expect((await read()).widgetConfig).toBe('{}')
  } finally {
    await opened.close()
  }
})
it('returns an honest role refusal from the proposal loop instead of failing the turn', async () => {
  const { mcpAuthFromActor, openWorkspaceMcp } = await import('../mcp-workspace-tools')
  const { makeAssistantToolContext } = await import('../assistant.toolspec')
  const { assembleAssistantToolset } = await import('../assistant.tools')
  const restricted = { ...owner, permissions: new Set([PERMISSIONS.COPILOT_USE]) }
  const auth = await mcpAuthFromActor(restricted, 'Copilot')
  if (!auth) throw new Error('Missing actor context')
  auth.workspaceThreadKey = threadKey
  const opened = await openWorkspaceMcp(auth)
  try {
    const ctx = makeAssistantToolContext({
      db: testDb,
      actor: restricted,
      assistantPrincipalId: owner.principalId!,
      role: 'workspace_assistant',
      audience: 'team',
      conversationId: null,
      workspaceThreadKey: threadKey,
      latestCustomerMessageId: 'sdk-denied',
      simulate: false,
    })
    const tool = (await assembleAssistantToolset(ctx, [], opened.specs)).tools.find(
      (tool) => tool.name === 'propose_settings_change'
    )!
    const result = await tool.execute!({
      changes: [{ area: 'portal', patch: { displayName: 'Acme team' } }],
    })
    expect(result).toMatchObject({ status: 'denied', note: expect.stringMatching(/owner/i) })
    expect(ctx.ledger.proposedActions).toHaveLength(0)
    expect((await read()).name).toBe('Acme')
  } finally {
    await opened.close()
  }
})

it('publishes external SDK proposals for owner review without changing settings or interrupting chat', async () => {
  const active = await acquireWorkspaceTurn(owner, threadKey, 'active-chat', 'Hello')
  expect(active.status).toBe('acquired')
  const { mcpAuthFromActor, openWorkspaceMcp } = await import('../mcp-workspace-tools')
  const auth = await mcpAuthFromActor(owner, 'Copilot')
  if (!auth) throw new Error('Missing actor context')
  const opened = await openWorkspaceMcp(auth)
  try {
    const result = await opened.session.callTool('propose_settings_change', {
      changes: [{ area: 'portal', patch: { displayName: 'Acme team' } }],
    })
    expect(result.ok).toBe(true)
    const envelope = JSON.parse(result.data)
    const data =
      envelope.structured ??
      JSON.parse(envelope.content.find((entry: { type: string }) => entry.type === 'text').text)
    expect(data.reviewHref).toMatch(/^\/admin\?copilotThread=workspace%3A/)
    const reviewKey = new URL(data.reviewHref, 'https://example.com').searchParams.get(
      'copilotThread'
    )!
    expect(reviewKey).not.toBe(threadKey)
    const review = await readWorkspaceThread(reviewKey, owner)
    expect(review.messages).toHaveLength(1)
    expect(review.messages[0]).toMatchObject({
      sender: 'assistant',
      text: '',
      payload: {
        threadKey: reviewKey,
        proposedActions: [{ id: data.pendingActionId, toolName: 'propose_settings_change' }],
        navigation: [],
      },
    })
    expect((await read()).name).toBe('Acme')
    expect(
      (await readWorkspaceThread(threadKey, owner)).messages.map((entry) => entry.text)
    ).toEqual(['Hello'])
    await expect(readWorkspaceThread(reviewKey, foreign)).rejects.toMatchObject({
      code: 'WORKSPACE_THREAD_NOT_FOUND',
    })
    const { conversationMessages } = await import('@/lib/server/db')
    const [message] = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.workspaceThreadKey, reviewKey))
    expect(message).toMatchObject({
      conversationId: null,
      ticketId: null,
      principalId: null,
      isInternal: true,
    })
    const { publishWorkspaceProposalReviewInTransaction } =
      await import('../workspace-proposal-review')
    const [pending] = await testDb
      .select()
      .from(assistantPendingActions)
      .where(eq(assistantPendingActions.id, data.pendingActionId))
    await testDb.transaction((tx) =>
      publishWorkspaceProposalReviewInTransaction(tx, owner, pending)
    )
    expect((await readWorkspaceThread(reviewKey, owner)).messages).toHaveLength(1)
  } finally {
    await opened.close()
  }
})
