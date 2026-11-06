/**
 * What a decision on a pending action binds to, against a real database.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, user, conversations, assistantPendingActions } from '@/lib/server/db'
import { ALL_PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { proposePendingAction } from '../pending-actions.service'
import { decisionFieldsForDisplay } from '../pending-action-decisions'
import { decideAssistantAction } from '../assistant-actions.service'
import { digestOf } from '@/lib/server/utils/canonical-json'

const fixture = await createDbTestFixture()

let admin: Actor
let keyPrincipal: PrincipalId

async function seedAdmin(): Promise<Actor> {
  const userId = createId('user')
  const principalId = createId('principal')
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
  admin = await seedAdmin()
  keyPrincipal = await seedServicePrincipal()
})
afterEach(() => fixture.rollback())
afterAll(() => fixture.close())

async function inboxProposal(
  args: Record<string, unknown> = {},
  requester?: Parameters<typeof proposePendingAction>[0]['requester']
) {
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: keyPrincipal, channel: 'messenger', createdAt: new Date() })
    .returning()
  return proposePendingAction({
    conversationId: conversation!.id,
    toolName: 'end_conversation',
    args,
    summary: 'Close the conversation',
    requester,
  })
}

const reject = (id: string, contentHash: string) =>
  decideAssistantAction(id as never, 'rejected', admin.principalId!, admin, undefined, {
    contentHash,
  })

const rowOf = async (id: string) =>
  (
    await testDb
      .select()
      .from(assistantPendingActions)
      .where(eq(assistantPendingActions.id, id as never))
  )[0]!

describe('what a decision binds to', () => {
  it('needs the digest the person was shown', async () => {
    const pending = await inboxProposal()
    await expect(reject(pending.id, 'not-the-digest')).rejects.toMatchObject({
      code: 'APPROVAL_CONTENT_CHANGED',
    })
    const rejected = await reject(pending.id, pending.argsDigest!)
    expect(rejected.status).toBe('rejected')
  })

  it('binds a request filed before digests were kept to the content first shown', async () => {
    const pending = await inboxProposal({ note: 'first' })
    await testDb
      .update(assistantPendingActions)
      .set({ argsDigest: null })
      .where(eq(assistantPendingActions.id, pending.id))
    // Never shown, so nothing names its content yet: no hash can decide it.
    await expect(reject(pending.id, pending.argsDigest!)).rejects.toMatchObject({
      code: 'APPROVAL_CONTENT_CHANGED',
    })

    // Showing it stores the digest of exactly what is shown.
    const shown = await decisionFieldsForDisplay(await rowOf(pending.id))
    expect(shown.argsDigest).toBe(pending.argsDigest)
    expect((await rowOf(pending.id)).argsDigest).toBe(pending.argsDigest)

    // An edit after it was shown is refused, with the digest the person saw.
    await testDb
      .update(assistantPendingActions)
      .set({ args: { note: 'edited' } })
      .where(eq(assistantPendingActions.id, pending.id))
    await expect(reject(pending.id, shown.argsDigest)).rejects.toMatchObject({
      code: 'APPROVAL_CONTENT_CHANGED',
    })
    expect((await rowOf(pending.id)).status).toBe('proposed')
  })

  it('re-binds a request an older instance edited in place to the content shown now', async () => {
    const pending = await inboxProposal({ note: 'first' })
    // A version that merged same-turn requests by editing the row left its
    // digest behind, so it no longer matches the content.
    const edited = { note: 'edited' }
    await testDb
      .update(assistantPendingActions)
      .set({ args: edited })
      .where(eq(assistantPendingActions.id, pending.id))
    await expect(reject(pending.id, pending.argsDigest!)).rejects.toMatchObject({
      code: 'APPROVAL_CONTENT_CHANGED',
    })

    // Showing it again binds the digest to what is shown now, so it can be decided.
    const shown = await decisionFieldsForDisplay(await rowOf(pending.id))
    expect(shown).toEqual({ argsDigest: digestOf(edited) })
    expect((await rowOf(pending.id)).argsDigest).toBe(shown.argsDigest)
    expect((await reject(pending.id, shown.argsDigest)).status).toBe('rejected')
  })

  it('never lets the principal that asked decide its own request', async () => {
    const pending = await inboxProposal({}, { requestedById: admin.principalId! })
    await expect(reject(pending.id, pending.argsDigest!)).rejects.toMatchObject({
      code: 'APPROVAL_SELF_DECISION',
    })
    expect((await rowOf(pending.id)).status).toBe('proposed')
  })
})
