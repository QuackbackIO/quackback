/**
 * The approval rules, against a real database: who may decide a request and
 * what a decision binds to.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  eq,
  principal,
  user,
  settings,
  conversations,
  assistantPendingActions,
} from '@/lib/server/db'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import { permissionsForLegacyRole } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/config-file/managed-guard', () => ({
  assertNotManaged: async () => undefined,
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: async () => undefined,
}))

import { createWorkspaceThread } from '../workspace-threads.service'
import {
  enqueueWorkspaceSettingsProposal,
  applyWorkspaceSettingsProposal,
  undoWorkspaceSettingsProposal,
} from '../workspace-settings-actions.service'
import { proposePendingAction } from '../pending-actions.service'
import { approvalFieldsForDisplay, rejectApproval } from '../approvals.service'
import { decideAssistantAction } from '../assistant-actions.service'
import { digestOf } from '@/lib/server/utils/canonical-json'

const fixture = await createDbTestFixture()

let owner: Actor
let otherAdmin: Actor
let member: Actor
let threadKey: string

async function seedPerson(role: 'admin' | 'member'): Promise<Actor> {
  const userId = createId('user')
  const principalId = createId('principal')
  await testDb.insert(user).values({ id: userId, name: 'Acme', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return {
    principalId,
    role,
    principalType: 'user',
    segmentIds: new Set(),
    permissions: role === 'admin' ? new Set(ALL_PERMISSIONS) : permissionsForLegacyRole('member'),
  }
}

async function seedServicePrincipal(): Promise<PrincipalId> {
  const principalId = createId('principal')
  await testDb.insert(principal).values({
    id: principalId,
    role: 'admin',
    type: 'service',
    displayName: 'Zapier key',
    createdAt: new Date(),
  })
  return principalId
}

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  owner = await seedPerson('admin')
  otherAdmin = await seedPerson('admin')
  member = await seedPerson('member')
  threadKey = (await createWorkspaceThread(owner)).key
  await testDb.insert(settings).values({
    name: 'Acme',
    slug: `acme-${createId('workspace')}`,
    createdAt: new Date(),
    brandingConfig: '{}',
    widgetConfig: '{}',
    metadata: '{}',
    featureFlags: JSON.stringify({ copilotHome: true }),
    portalConfig: '{}',
  })
})
afterEach(() => fixture.rollback())
afterAll(() => fixture.close())

const workspaceName = async () => (await testDb.select().from(settings).limit(1))[0]!.name

async function homeProposal(patch: Record<string, unknown> = { displayName: 'Acme team' }) {
  return enqueueWorkspaceSettingsProposal(owner, [{ area: 'portal', patch }], threadKey, 'turn-1')
}

const rowOf = async (id: string) =>
  (
    await testDb
      .select()
      .from(assistantPendingActions)
      .where(eq(assistantPendingActions.id, id as never))
  )[0]!

describe('who may decide', () => {
  it('lets any person with the needed permissions approve, not only the thread owner', async () => {
    const pending = await homeProposal()
    const applied = await applyWorkspaceSettingsProposal(
      otherAdmin,
      pending.id,
      ['portal.displayName'],
      { contentHash: pending.argsDigest! }
    )
    expect(applied).toMatchObject({
      status: 'executed',
      decidedById: otherAdmin.principalId,
      decidedVia: 'app',
      executionState: 'succeeded',
    })
    expect(await workspaceName()).toBe('Acme team')
    // Undo is open to a qualified person too, and re-checks their permissions.
    await undoWorkspaceSettingsProposal(otherAdmin, pending.id)
    expect(await workspaceName()).toBe('Acme')
  })

  it('refuses a person who lacks a permission the request needs', async () => {
    const pending = await homeProposal()
    await expect(
      applyWorkspaceSettingsProposal(member, pending.id, ['portal.displayName'], {
        contentHash: pending.argsDigest!,
      })
    ).rejects.toMatchObject({ code: 'APPROVAL_PERMISSION_REQUIRED' })
    expect((await rowOf(pending.id)).status).toBe('proposed')
  })

  it('never lets the credential or agent that asked decide its own request', async () => {
    const keyPrincipal = await seedServicePrincipal()
    const pending = await enqueueWorkspaceSettingsProposal(
      owner,
      [{ area: 'portal', patch: { displayName: 'Acme team' } }],
      undefined,
      undefined,
      {
        via: 'mcp',
        requestedById: keyPrincipal,
        onBehalfOfPrincipalId: owner.principalId!,
        credentialId: 'api_key_1',
        clientName: 'Zapier key',
      }
    )
    expect(await rowOf(pending.id)).toMatchObject({
      requestedVia: 'mcp',
      requestedById: keyPrincipal,
      onBehalfOfPrincipalId: owner.principalId,
      credentialId: 'api_key_1',
      clientName: 'Zapier key',
    })
    const keyActor: Actor = { ...owner, principalId: keyPrincipal, principalType: 'service' }
    await expect(
      applyWorkspaceSettingsProposal(keyActor, pending.id, ['portal.displayName'], {
        contentHash: pending.argsDigest!,
      })
    ).rejects.toMatchObject({ code: 'APPROVAL_SELF_DECISION' })
    // The person behind the key, deciding through that same key, is refused too.
    await expect(
      applyWorkspaceSettingsProposal(owner, pending.id, ['portal.displayName'], {
        contentHash: pending.argsDigest!,
        credentialId: 'api_key_1',
      })
    ).rejects.toMatchObject({ code: 'APPROVAL_SELF_DECISION' })
    await expect(
      rejectApproval(keyActor, pending.id, { contentHash: pending.argsDigest! })
    ).rejects.toMatchObject({ code: 'APPROVAL_SELF_DECISION' })
    expect((await rowOf(pending.id)).status).toBe('proposed')
    // In the app, the person behind the key may decide like any qualified person.
    const applied = await applyWorkspaceSettingsProposal(
      owner,
      pending.id,
      ['portal.displayName'],
      {
        contentHash: pending.argsDigest!,
      }
    )
    expect(applied.status).toBe('executed')
  })

  it('never lets a person approve a request they filed themselves', async () => {
    const pending = await proposePendingAction({
      workspaceThreadKey: threadKey,
      toolName: 'propose_settings_change',
      args: (await homeProposal()).args,
      summary: 'ignored',
      originRole: 'workspace_assistant',
      requester: { via: 'ui', requestedById: otherAdmin.principalId! },
    })
    await expect(
      rejectApproval(otherAdmin, pending.id, { contentHash: pending.argsDigest! })
    ).rejects.toMatchObject({ code: 'APPROVAL_SELF_DECISION' })
  })

  it('lets an admin turn down a high-risk request without signing in again', async () => {
    // Changelog settings: something a member also holds the permission for.
    const pending = await enqueueWorkspaceSettingsProposal(
      owner,
      [{ area: 'changelog', patch: { autoSubscribe: false } }],
      undefined,
      undefined,
      { via: 'mcp', onBehalfOfPrincipalId: owner.principalId! }
    )
    await testDb
      .update(assistantPendingActions)
      .set({ risk: 'high' })
      .where(eq(assistantPendingActions.id, pending.id))
    // High risk is still decided by admins, whichever way.
    await expect(
      rejectApproval(member, pending.id, { contentHash: pending.argsDigest! })
    ).rejects.toMatchObject({ code: 'APPROVAL_ADMIN_REQUIRED' })
    // Approving still needs a fresh sign-in; turning it down changes nothing.
    await expect(
      applyWorkspaceSettingsProposal(otherAdmin, pending.id, ['changelog.autoSubscribe'], {
        contentHash: pending.argsDigest!,
      })
    ).rejects.toMatchObject({ code: 'APPROVAL_SIGN_IN_REQUIRED' })
    const rejected = await rejectApproval(otherAdmin, pending.id, {
      contentHash: pending.argsDigest!,
      reason: 'Not this one',
    })
    expect(rejected).toMatchObject({ status: 'rejected', decisionReason: 'Not this one' })
  })

  it('needs an admin who signed in again for a high-risk request, and refuses critical', async () => {
    const pending = await homeProposal()
    await testDb
      .update(assistantPendingActions)
      .set({ risk: 'high' })
      .where(eq(assistantPendingActions.id, pending.id))
    const decide = (actor: Actor, freshSignIn?: boolean) =>
      applyWorkspaceSettingsProposal(actor, pending.id, ['portal.displayName'], {
        contentHash: pending.argsDigest!,
        freshSignIn,
      })
    await expect(decide(otherAdmin)).rejects.toMatchObject({ code: 'APPROVAL_SIGN_IN_REQUIRED' })
    const settingsMember: Actor = {
      ...member,
      permissions: new Set([...(member.permissions ?? []), PERMISSIONS.SETTINGS_BRANDING]),
    }
    await expect(decide(settingsMember, true)).rejects.toMatchObject({
      code: expect.stringMatching(/^APPROVAL_(ADMIN|PERMISSION)_REQUIRED$/),
    })
    expect((await rowOf(pending.id)).status).toBe('proposed')
    expect((await decide(otherAdmin, true)).status).toBe('executed')

    const critical = await homeProposal({ displayName: 'Acme two' })
    await testDb
      .update(assistantPendingActions)
      .set({ risk: 'critical' })
      .where(eq(assistantPendingActions.id, critical.id))
    await expect(
      applyWorkspaceSettingsProposal(otherAdmin, critical.id, ['portal.displayName'], {
        contentHash: critical.argsDigest!,
        freshSignIn: true,
      })
    ).rejects.toMatchObject({ code: 'APPROVAL_NOT_AVAILABLE' })
  })
})

describe('what a decision binds to', () => {
  it('refuses a decision whose content hash is not the pending content', async () => {
    const pending = await homeProposal()
    await expect(
      applyWorkspaceSettingsProposal(otherAdmin, pending.id, ['portal.displayName'], {
        contentHash: 'not-the-digest',
      })
    ).rejects.toMatchObject({ code: 'APPROVAL_CONTENT_CHANGED' })
    // A payload changed underneath its digest is refused even with the old hash.
    await testDb
      .update(assistantPendingActions)
      .set({
        args: {
          ...pending.args,
          changes: (pending.args.changes as Record<string, unknown>[]).map((change) => ({
            ...change,
            after: 'Someone else',
          })),
        },
      })
      .where(eq(assistantPendingActions.id, pending.id))
    await expect(
      applyWorkspaceSettingsProposal(otherAdmin, pending.id, ['portal.displayName'], {
        contentHash: pending.argsDigest!,
      })
    ).rejects.toMatchObject({ code: 'APPROVAL_CONTENT_CHANGED' })
    expect(await workspaceName()).toBe('Acme')
    expect((await rowOf(pending.id)).status).toBe('proposed')
  })

  it('binds a request filed before digests were kept to the content first shown', async () => {
    const pending = await homeProposal()
    await testDb
      .update(assistantPendingActions)
      .set({ argsDigest: null })
      .where(eq(assistantPendingActions.id, pending.id))
    // Never shown, so nothing names its content yet: no hash can decide it.
    await expect(
      rejectApproval(otherAdmin, pending.id, { contentHash: pending.argsDigest! })
    ).rejects.toMatchObject({ code: 'APPROVAL_CONTENT_CHANGED' })

    // Showing it stores the digest of exactly what is shown.
    const shown = await approvalFieldsForDisplay(await rowOf(pending.id))
    expect(shown.argsDigest).toBe(pending.argsDigest)
    expect((await rowOf(pending.id)).argsDigest).toBe(pending.argsDigest)

    // An edit after it was shown is refused, with the digest the person saw.
    await testDb
      .update(assistantPendingActions)
      .set({ args: { ...pending.args, kind: 'settings', version: 1, edited: true } })
      .where(eq(assistantPendingActions.id, pending.id))
    await expect(
      rejectApproval(otherAdmin, pending.id, { contentHash: shown.argsDigest })
    ).rejects.toMatchObject({ code: 'APPROVAL_CONTENT_CHANGED' })
    expect((await rowOf(pending.id)).status).toBe('proposed')
  })

  it('re-binds a request an older instance edited in place to the content shown now', async () => {
    const pending = await homeProposal()
    // A version that merged same-turn requests by editing the row left its
    // digest behind, so it no longer matches the content.
    const edited = {
      ...pending.args,
      changes: (pending.args.changes as Record<string, unknown>[]).map((change) => ({
        ...change,
        after: 'Acme crew',
      })),
    }
    await testDb
      .update(assistantPendingActions)
      .set({ args: edited })
      .where(eq(assistantPendingActions.id, pending.id))
    await expect(
      applyWorkspaceSettingsProposal(otherAdmin, pending.id, ['portal.displayName'], {
        contentHash: pending.argsDigest!,
      })
    ).rejects.toMatchObject({ code: 'APPROVAL_CONTENT_CHANGED' })

    // Showing it again binds the digest to what is shown now, so it can be decided.
    const shown = await approvalFieldsForDisplay(await rowOf(pending.id))
    expect(shown.argsDigest).toBe(digestOf(edited))
    expect((await rowOf(pending.id)).argsDigest).toBe(shown.argsDigest)
    const applied = await applyWorkspaceSettingsProposal(
      otherAdmin,
      pending.id,
      ['portal.displayName'],
      { contentHash: shown.argsDigest }
    )
    expect(applied.status).toBe('executed')
    expect(await workspaceName()).toBe('Acme crew')
  })

  it('needs the digest the person was shown on the inbox path too', async () => {
    const keyPrincipal = await seedServicePrincipal()
    const [conversation] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: keyPrincipal, channel: 'messenger', createdAt: new Date() })
      .returning()
    const pending = await proposePendingAction({
      conversationId: conversation!.id,
      toolName: 'end_conversation',
      args: {},
      summary: 'Close the conversation',
    })
    await expect(
      decideAssistantAction(
        pending.id,
        'rejected',
        otherAdmin.principalId!,
        otherAdmin,
        undefined,
        {
          contentHash: 'not-the-digest',
        }
      )
    ).rejects.toMatchObject({ code: 'APPROVAL_CONTENT_CHANGED' })
    const rejected = await decideAssistantAction(
      pending.id,
      'rejected',
      otherAdmin.principalId!,
      otherAdmin,
      undefined,
      { contentHash: pending.argsDigest!, reason: 'Not yet' }
    )
    expect(rejected).toMatchObject({ status: 'rejected', decisionReason: 'Not yet' })
  })

  it('never edits a pending request: a combined one replaces it', async () => {
    const first = await homeProposal()
    const second = await enqueueWorkspaceSettingsProposal(
      owner,
      [{ area: 'office_hours', patch: { timezone: 'Europe/London' } }],
      threadKey,
      'turn-1'
    )
    expect(second.id).not.toBe(first.id)
    expect(second.supersededId).toBe(first.id)
    expect((second.args.changes as { id: string }[]).map((change) => change.id)).toEqual([
      'portal.displayName',
      'office_hours.timezone',
    ])
    const old = await rowOf(first.id)
    expect(old).toMatchObject({ status: 'expired', disposition: 'superseded:merged' })
    expect(old.args).toEqual(first.args)
    expect(old.argsDigest).toBe(first.argsDigest)
    await expect(
      applyWorkspaceSettingsProposal(owner, first.id, ['portal.displayName'], {
        contentHash: first.argsDigest!,
      })
    ).rejects.toMatchObject({ code: 'PENDING_ACTION_NOT_DECIDABLE' })
  })

  it('rejects with an optional reason', async () => {
    const pending = await homeProposal()
    const rejected = await rejectApproval(otherAdmin, pending.id, {
      contentHash: pending.argsDigest!,
      reason: 'Keep the current name',
    })
    expect(rejected).toMatchObject({
      status: 'rejected',
      decidedById: otherAdmin.principalId,
      decidedVia: 'app',
      decisionReason: 'Keep the current name',
    })
    const plain = await homeProposal({ displayName: 'Other' })
    expect(
      (await rejectApproval(otherAdmin, plain.id, { contentHash: plain.argsDigest! }))
        .decisionReason
    ).toBeNull()
  })
})

describe('server-written summaries and risk', () => {
  it('summarizes from the diff and sets the risk server-side', async () => {
    const pending = await enqueueWorkspaceSettingsProposal(
      owner,
      [{ area: 'messenger', patch: { enabled: true } }],
      threadKey,
      'turn-1'
    )
    expect(await rowOf(pending.id)).toMatchObject({
      summary: 'Turn on Messenger',
      risk: 'medium',
    })
  })
})
