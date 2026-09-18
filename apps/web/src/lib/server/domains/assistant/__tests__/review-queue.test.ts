import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  principal,
  user,
  assistantInvolvements,
  assistantPendingActions,
  eq,
} from '@/lib/server/db'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
import type { ConversationId } from '@quackback/ids'
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
import { getQuinnReviewQueue } from '../review-queue'
const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select().from(assistantInvolvements).limit(0)
  },
})
const now = new Date('2026-09-18T12:00:00Z')
const hourAgo = new Date(now.getTime() - 3600000)
async function person() {
  const [u] = await testDb.insert(user).values({ name: 'Queue test' }).returning()
  const [p] = await testDb
    .insert(principal)
    .values({ userId: u.id, role: 'member', type: 'user', createdAt: now })
    .returning()
  return p.id
}
async function world() {
  const agent = await person(),
    other = await person(),
    visitor = await person()
  const actor: Actor = {
    principalId: agent,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
  }
  const [mine, hidden] = await testDb
    .insert(conversations)
    .values([
      {
        channel: 'messenger',
        visitorPrincipalId: visitor,
        assignedAgentPrincipalId: agent,
        subject: 'Mine',
        lastMessageAt: now,
      },
      {
        channel: 'messenger',
        visitorPrincipalId: visitor,
        assignedAgentPrincipalId: other,
        subject: 'Hidden',
        lastMessageAt: now,
      },
    ])
    .returning()
  return { actor, mine, hidden }
}
async function handoff(id: ConversationId, at = hourAgo) {
  await testDb.insert(assistantInvolvements).values({
    conversationId: id,
    triggeredBy: 'first_touch',
    status: 'handed_off',
    createdAt: at,
    endedAt: at,
  })
}
describe.skipIf(!fixture.available)('Quinn review queue', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)
  it('uses inbox row permissions before returning subjects and denies an unprivileged actor', async () => {
    const { actor, mine, hidden } = await world()
    await handoff(mine.id)
    await handoff(hidden.id)
    expect((await getQuinnReviewQueue(actor, 'review', 7, 10, now)).map((r) => r.subject)).toEqual([
      'Mine',
    ])
    expect(
      await getQuinnReviewQueue({ ...actor, permissions: new Set() }, 'review', 7, 10, now)
    ).toEqual([])
  })
  it('does not treat a historical handoff as the current involvement', async () => {
    const { actor, mine } = await world()
    await handoff(mine.id)
    await testDb.insert(assistantInvolvements).values({
      conversationId: mine.id,
      triggeredBy: 'agent_handback',
      status: 'active',
      createdAt: now,
    })
    expect(await getQuinnReviewQueue(actor, 'review', 7, 10, now)).toEqual([])
    expect(await getQuinnReviewQueue(actor, 'live', 7, 10, now)).toHaveLength(1)
    await testDb
      .update(conversations)
      .set({ status: 'closed' })
      .where(eq(conversations.id, mine.id))
    expect(await getQuinnReviewQueue(actor, 'live', 7, 10, now)).toEqual([])
  })
  it('excludes expired proposals and spam even before the expiry sweep runs', async () => {
    const { actor, mine } = await world()
    const [action] = await testDb
      .insert(assistantPendingActions)
      .values({
        conversationId: mine.id,
        toolName: 'create_ticket',
        args: {},
        summary: 'Review request',
        expiresAt: new Date(now.getTime() + 1000),
      })
      .returning()
    expect((await getQuinnReviewQueue(actor, 'review', 7, 10, now))[0].reason).toBe(
      'Needs approval'
    )
    await testDb
      .update(conversations)
      .set({ status: 'closed', endReason: 'spam' })
      .where(eq(conversations.id, mine.id))
    expect(await getQuinnReviewQueue(actor, 'review', 7, 10, now)).toEqual([])
    await testDb
      .update(conversations)
      .set({ status: 'open', endReason: null })
      .where(eq(conversations.id, mine.id))
    await testDb
      .update(assistantPendingActions)
      .set({ expiresAt: hourAgo })
      .where(eq(assistantPendingActions.id, action.id))
    expect(await getQuinnReviewQueue(actor, 'review', 7, 10, now)).toEqual([])
  })
  it('applies the selected review window and includes recent low ratings', async () => {
    const { actor, mine } = await world()
    await handoff(mine.id, new Date(now.getTime() - 10 * 86400000))
    expect(await getQuinnReviewQueue(actor, 'review', 7, 10, now)).toEqual([])
    expect(await getQuinnReviewQueue(actor, 'review', 30, 10, now)).toHaveLength(1)
    await testDb
      .update(conversations)
      .set({ csatRating: 1, csatSubmittedAt: hourAgo })
      .where(eq(conversations.id, mine.id))
    expect((await getQuinnReviewQueue(actor, 'review', 7, 10, now))[0].reason).toBe(
      'Negative rating'
    )
  })
})
