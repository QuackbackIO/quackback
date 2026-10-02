import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type ConversationId,
  type PostId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, conversations, inArray, posts, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listConversationsForAgent } from '../conversation.query'
import { countInboxScopes } from '../../inbox/inbox.query'
import { deleteTestConversations, sweepTestData } from '../conversation.test-data'

const fixture = await createDbTestFixture()

const DAY = 86_400_000
let owner: PrincipalId, otherOwner: PrincipalId, visitor: PrincipalId, boardId: BoardId

function actorFor(id: PrincipalId): Actor {
  return { principalId: id, role: 'admin', principalType: 'user', segmentIds: new Set() }
}

const testMarker = (by: PrincipalId) => ({ test: true, testOwnerPrincipalId: by })

async function seedConversation(
  attrs: Record<string, unknown>,
  ageDays = 0,
  status: 'open' | 'closed' = 'open'
) {
  const id = createId('conversation') as ConversationId
  const at = new Date(Date.now() - ageDays * DAY)
  await testDb.insert(conversations).values({
    id,
    visitorPrincipalId: visitor,
    channel: 'messenger',
    status,
    customAttributes: attrs,
    createdAt: at,
    lastMessageAt: at,
  })
  return id
}

async function seedPost(meta: Record<string, unknown> | null, ageDays = 0) {
  const id = createId('post') as PostId
  await testDb.insert(posts).values({
    id,
    boardId,
    title: 'Dark mode',
    content: 'Please',
    principalId: visitor,
    // The ingress seam stores a boolean marker despite the column's string type.
    widgetMetadata: meta as Record<string, string> | null,
    createdAt: new Date(Date.now() - ageDays * DAY),
  })
  return id
}

async function remainingConversations(ids: ConversationId[]) {
  const rows = await testDb
    .select({ id: conversations.id })
    .from(conversations)
    .where(inArray(conversations.id, ids))
  return rows.map((r) => r.id).sort()
}

describe.skipIf(!fixture.available)('test conversations in the inbox', () => {
  beforeEach(async () => {
    await fixture.begin()
    owner = createId('principal') as PrincipalId
    otherOwner = createId('principal') as PrincipalId
    visitor = createId('principal') as PrincipalId
    const [u1, u2] = [createId('user') as UserId, createId('user') as UserId]
    await testDb.insert(user).values([
      { id: u1, name: 'Acme' },
      { id: u2, name: 'Acme Two' },
    ])
    await testDb.insert(principal).values([
      { id: owner, userId: u1, role: 'admin', type: 'user', createdAt: new Date() },
      { id: otherOwner, userId: u2, role: 'admin', type: 'user', createdAt: new Date() },
      { id: visitor, role: 'user', type: 'anonymous', createdAt: new Date() },
    ])
    boardId = createId('board') as BoardId
    await testDb.insert(boards).values({ id: boardId, name: 'Feedback', slug: String(boardId) })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('marks test rows and lists only them in the Test view', async () => {
    const test = await seedConversation(testMarker(owner))
    const real = await seedConversation({})
    const all = await listConversationsForAgent({ visitorPrincipalId: visitor }, actorFor(owner))
    const flags = Object.fromEntries(all.conversations.map((c) => [c.id, c.isTest]))
    expect(flags).toEqual({ [test]: true, [real]: false })

    const onlyTest = await listConversationsForAgent(
      { visitorPrincipalId: visitor, testOnly: true },
      actorFor(owner)
    )
    expect(onlyTest.conversations.map((c) => c.id)).toEqual([test])
  })

  it('counts test conversations whatever their status', async () => {
    const before = (await countInboxScopes(actorFor(owner))).test
    await seedConversation(testMarker(owner))
    await seedConversation(testMarker(owner), 0, 'closed')
    await seedConversation({})
    expect((await countInboxScopes(actorFor(owner))).test).toBe(before + 2)
  })

  it('deletes test conversations and leaves real ones', async () => {
    const mine = await seedConversation(testMarker(owner), 0, 'closed')
    const theirs = await seedConversation(testMarker(otherOwner))
    const real = await seedConversation({ test: false })
    const deleted = await deleteTestConversations(actorFor(owner), { ownerPrincipalId: owner })
    expect(deleted).toBe(1)
    expect(await remainingConversations([mine, theirs, real])).toEqual([theirs, real].sort())
  })

  it('sweeps test conversations and posts once they are a week old', async () => {
    const oldTest = await seedConversation(testMarker(owner), 8)
    const freshTest = await seedConversation(testMarker(owner), 1)
    const oldReal = await seedConversation({}, 30)
    const oldTestPost = await seedPost(testMarker(owner), 8)
    const freshTestPost = await seedPost(testMarker(owner), 1)
    const oldRealPost = await seedPost(null, 30)

    const result = await sweepTestData({ ownerPrincipalId: owner })
    expect(result).toEqual({ conversations: 1, posts: 1 })
    expect(await remainingConversations([oldTest, freshTest, oldReal])).toEqual(
      [freshTest, oldReal].sort()
    )
    const postsLeft = await testDb
      .select({ id: posts.id })
      .from(posts)
      .where(inArray(posts.id, [oldTestPost, freshTestPost, oldRealPost]))
    expect(postsLeft.map((p) => p.id).sort()).toEqual([freshTestPost, oldRealPost].sort())
  })
})
