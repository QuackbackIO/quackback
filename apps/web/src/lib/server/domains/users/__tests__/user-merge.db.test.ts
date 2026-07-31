/**
 * Real-DB coverage for mergeLeadIntoUser (admin "merge lead into user").
 *
 * The merge moves a lead's whole footprint — conversation ownership, message
 * and post authorship, votes — onto an identified portal user, then tears the
 * anonymous identity down. Only Postgres can prove the re-point, the
 * unique-collision drop (both parties voted the same post), the contact-email
 * gap fill, and the identity teardown all land in one transaction. Runs inside
 * the db-test-fixture rollback transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  eq,
  boards,
  conversationMessages,
  conversations,
  postVotes,
  posts,
  principal,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { mergeLeadIntoUser } from '../user.merge'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: principal.id }).from(principal).limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedUser(opts: {
  name: string
  email?: string | null
  contactEmail?: string | null
}): Promise<{ userId: UserId; principalId: PrincipalId }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: opts.name,
    email: opts.email ?? `${runSuffix()}@example.com`,
    emailVerified: false,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: opts.name,
    contactEmail: opts.contactEmail ?? null,
    createdAt: new Date(),
  })
  return { userId, principalId }
}

async function seedLead(opts: {
  name: string | null
  contactEmail: string | null
}): Promise<{ userId: UserId; principalId: PrincipalId }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: opts.name ?? 'Anonymous',
    email: `temp-${runSuffix()}@anon.quackback.io`,
    isAnonymous: true,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'anonymous',
    displayName: opts.name,
    contactEmail: opts.contactEmail,
    createdAt: new Date(),
  })
  return { userId, principalId }
}

async function seedBoard(): Promise<BoardId> {
  const id = createId('board') as BoardId
  const suffix = runSuffix()
  await testDb.insert(boards).values({ id, slug: `board-${suffix}`, name: `Board ${suffix}` })
  return id
}

async function seedPost(boardId: BoardId, principalId: PrincipalId): Promise<PostId> {
  const id = createId('post') as PostId
  await testDb.insert(posts).values({
    id,
    boardId,
    title: `Post ${runSuffix()}`,
    content: 'content',
    principalId,
  })
  return id
}

describe.skipIf(!fixture.available)('mergeLeadIntoUser', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it("re-homes the lead's activity on the user and tears down the lead identity", async () => {
    const target = await seedUser({ name: 'Ivy Identified' })
    const lead = await seedLead({ name: 'Curious visitor', contactEmail: null })
    const boardId = await seedBoard()
    const postId = await seedPost(boardId, lead.principalId)
    const conversationId = createId('conversation')
    await testDb.insert(conversations).values({
      id: conversationId,
      visitorPrincipalId: lead.principalId,
      channel: 'messenger',
    })
    const messageId = createId('conversation_message')
    await testDb.insert(conversationMessages).values({
      id: messageId,
      conversationId,
      principalId: lead.principalId,
      senderType: 'visitor',
      content: 'hello from the lead',
    })
    await testDb.insert(postVotes).values({ postId, principalId: lead.principalId })

    await mergeLeadIntoUser(lead.principalId, target.principalId)

    const [post] = await testDb
      .select({ principalId: posts.principalId })
      .from(posts)
      .where(eq(posts.id, postId))
    expect(post.principalId).toBe(target.principalId)

    const [conversation] = await testDb
      .select({ visitorPrincipalId: conversations.visitorPrincipalId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    expect(conversation.visitorPrincipalId).toBe(target.principalId)

    const [message] = await testDb
      .select({ principalId: conversationMessages.principalId })
      .from(conversationMessages)
      .where(eq(conversationMessages.id, messageId))
    expect(message.principalId).toBe(target.principalId)

    const [vote] = await testDb
      .select({ principalId: postVotes.principalId })
      .from(postVotes)
      .where(eq(postVotes.postId, postId))
    expect(vote.principalId).toBe(target.principalId)

    // Identity teardown: the anonymous principal and its synthetic user row are gone.
    expect(
      await testDb
        .select({ id: principal.id })
        .from(principal)
        .where(eq(principal.id, lead.principalId))
    ).toEqual([])
    expect(await testDb.select({ id: user.id }).from(user).where(eq(user.id, lead.userId))).toEqual(
      []
    )
  })

  it("fills the user's missing contact email from the lead (user wins otherwise)", async () => {
    const email = `lead-${runSuffix()}@example.com`
    const target = await seedUser({ name: 'No Contact' })
    const lead = await seedLead({ name: null, contactEmail: email })

    await mergeLeadIntoUser(lead.principalId, target.principalId)

    const [row] = await testDb
      .select({ contactEmail: principal.contactEmail })
      .from(principal)
      .where(eq(principal.id, target.principalId))
    expect(row.contactEmail).toBe(email)
  })

  it('drops the lead vote when both parties voted the same post (user wins)', async () => {
    const target = await seedUser({ name: 'Voter User' })
    const lead = await seedLead({ name: null, contactEmail: null })
    const boardId = await seedBoard()
    const postId = await seedPost(boardId, target.principalId)
    await testDb.insert(postVotes).values({ postId, principalId: target.principalId })
    await testDb.insert(postVotes).values({ postId, principalId: lead.principalId })

    await mergeLeadIntoUser(lead.principalId, target.principalId)

    const votes = await testDb
      .select({ principalId: postVotes.principalId })
      .from(postVotes)
      .where(eq(postVotes.postId, postId))
    expect(votes).toEqual([{ principalId: target.principalId }])
  })

  it('rejects a source that is not a lead', async () => {
    const a = await seedUser({ name: 'User A' })
    const b = await seedUser({ name: 'User B' })

    await expect(mergeLeadIntoUser(a.principalId, b.principalId)).rejects.toThrow(/not found|lead/i)
  })

  it('rejects a target that is not an identified portal user', async () => {
    const lead = await seedLead({ name: null, contactEmail: null })
    const otherLead = await seedLead({ name: null, contactEmail: null })

    await expect(mergeLeadIntoUser(lead.principalId, otherLead.principalId)).rejects.toThrow(
      /not found|user/i
    )
    // The failed merge leaves both leads untouched.
    expect(
      await testDb
        .select({ id: principal.id })
        .from(principal)
        .where(eq(principal.id, lead.principalId))
    ).toHaveLength(1)
  })

  it('rejects merging a lead into itself', async () => {
    const lead = await seedLead({ name: null, contactEmail: null })

    await expect(mergeLeadIntoUser(lead.principalId, lead.principalId)).rejects.toThrow()
  })
})
