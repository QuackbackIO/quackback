/**
 * Real-DB coverage for the condition-context resolver (§4.6, Slice 4): it reads a
 * conversation's status/channel/priority, derives waiting-minutes from
 * waiting_since, collects tag ids + the visitor's segment ids, and threads
 * through the passed-in message + CSAT. Feeds straight into the pure evaluator.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type PrincipalId,
  type UserId,
  type ConversationId,
  type SegmentId,
  type ConversationTagId,
} from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  conversationTags,
  conversationTagAssignments,
  segments,
  userSegments,
  user,
  principal,
  teams,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { resolveConditionContext } from '../condition.context'
import { evaluateCondition } from '../condition.evaluator'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: userSegments.principalId }).from(userSegments).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Visitor-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

describe.skipIf(!fixture.available)('resolveConditionContext (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('assembles a full snapshot (status, waiting minutes, tags, segments, csat, message, team)', async () => {
    const principalId = await seedPrincipal()
    const [team] = await testDb
      .insert(teams)
      .values({ name: `Support-${suffix()}` })
      .returning()
    const waitingSince = new Date('2026-01-05T10:00:00Z')
    const [conv] = await testDb
      .insert(conversations)
      .values({
        visitorPrincipalId: principalId,
        channel: 'messenger',
        priority: 'high',
        waitingSince,
        csatRating: 4,
        customAttributes: { plan: { v: 'pro', src: 'teammate', at: '2026-01-05T09:00:00Z' } },
        assignedTeamId: team!.id,
      })
      .returning()

    // One tag, attached.
    const tagId = createId('conversation_tag') as ConversationTagId
    await testDb.insert(conversationTags).values({ id: tagId, name: `vip-${suffix()}` })
    await testDb
      .insert(conversationTagAssignments)
      .values({ conversationId: conv.id, conversationTagId: tagId })

    // One segment membership for the visitor.
    const segmentId = createId('segment') as SegmentId
    await testDb
      .insert(segments)
      .values({ id: segmentId, name: 'Paid', slug: `paid-${suffix()}`, type: 'manual' })
    await testDb.insert(userSegments).values({ principalId, segmentId })

    // Resolve 30 minutes after waiting started.
    const ctx = await resolveConditionContext(conv.id, {
      message: { body: 'Please help' },
      at: new Date('2026-01-05T10:30:00Z'),
    })
    expect(ctx).not.toBeNull()
    expect(ctx!.conversation.status).toBe('open')
    expect(ctx!.conversation.channel).toBe('messenger')
    expect(ctx!.conversation.priority).toBe('high')
    expect(ctx!.conversation.waitingMinutes).toBe(30)
    expect(ctx!.conversation.tagIds).toEqual([tagId])
    expect(ctx!.conversation.assignedTeamId).toBe(team!.id)
    expect(ctx!.conversation.attributes).toEqual({
      plan: { v: 'pro', src: 'teammate', at: '2026-01-05T09:00:00Z' },
    })
    expect(ctx!.person!.segmentIds).toEqual([segmentId])
    expect(ctx!.csatRating).toBe(4)
    expect(ctx!.message).toEqual({ body: 'Please help' })

    // And it drives the evaluator end-to-end.
    expect(
      evaluateCondition(
        {
          all: [
            { field: 'conversation.waiting_minutes', op: 'gt', value: 15 },
            { field: 'person.segments', op: 'includes_any', value: [segmentId] },
            { field: 'message.body', op: 'contains', value: 'help' },
            { field: 'conversation.attr.plan', op: 'eq', value: 'pro' },
            { field: 'conversation.team', op: 'eq', value: team!.id },
          ],
        },
        ctx!
      )
    ).toBe(true)
  })

  it('reports null waiting minutes when nobody is waiting, and null for a missing conversation', async () => {
    const principalId = await seedPrincipal()
    const [conv] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: principalId, channel: 'email' }) // no waitingSince
      .returning()

    const ctx = await resolveConditionContext(conv.id)
    expect(ctx!.conversation.waitingMinutes).toBeNull()
    expect(ctx!.conversation.tagIds).toEqual([])
    expect(ctx!.conversation.assignedTeamId).toBeNull()
    expect(ctx!.person!.segmentIds).toEqual([])
    expect(ctx!.csatRating).toBeNull()
    expect(ctx!.message).toBeNull()
    expect(evaluateCondition({ field: 'conversation.team', op: 'is_empty' }, ctx!)).toBe(true)

    expect(await resolveConditionContext(createId('conversation') as ConversationId)).toBeNull()
  })
})
