/**
 * Real-DB integration coverage for the principal merge flow.
 *
 * The mock-based suites (merge-anonymous.test.ts, principal-repoint.test.ts)
 * pin orchestration order and branching, but only Postgres can prove the
 * registry's SQL is valid against the live schema and that the FK topology
 * cooperates: conversations/messages are ON DELETE RESTRICT (a missed
 * re-point aborts the merge), and post_edit_history.editor_principal_id is
 * NOT NULL with ON DELETE SET NULL — the classic merge-abort landmine the
 * completeness audit flagged.
 *
 * Every test runs inside the db-test-fixture rollback transaction, so
 * quackback_test stays clean. The global `db` is rebound to that transaction
 * via the importOriginal-spread mock, so the REAL merge orchestrators run
 * unmodified (their db.transaction becomes a savepoint).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type BoardId,
  type CompanyId,
  type ConversationId,
  type PostCommentId,
  type PostId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  account,
  boards,
  companies,
  conversationMessages,
  conversations,
  eq,
  postComments,
  postEditHistory,
  posts,
  postVotes,
  principal,
  session,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/redis', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

import { mergeAnonymousToIdentified, absorbSignupIntoAnonymous } from '../merge-anonymous'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    // Schema-currency probe over the seeded tables + merge-critical columns;
    // a stale test DB skips the suite instead of failing it mid-test.
    await db
      .select({ id: principal.id, email: principal.contactEmail, company: principal.companyId })
      .from(principal)
      .limit(0)
    await db.select({ id: companies.id }).from(companies).limit(0)
    await db.select({ id: user.id, ext: user.externalId }).from(user).limit(0)
    await db.select({ id: session.id }).from(session).limit(0)
    await db.select({ id: account.id }).from(account).limit(0)
    await db.select({ id: posts.id, author: posts.principalId }).from(posts).limit(0)
    await db.select({ id: postComments.id }).from(postComments).limit(0)
    await db.select({ id: postVotes.id }).from(postVotes).limit(0)
    await db.select({ editor: postEditHistory.editorPrincipalId }).from(postEditHistory).limit(0)
    await db.select({ visitor: conversations.visitorPrincipalId }).from(conversations).limit(0)
    await db.select({ id: conversationMessages.id }).from(conversationMessages).limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

interface SeededIdentity {
  userId: UserId
  principalId: PrincipalId
}

async function seedIdentity(opts: {
  type: 'anonymous' | 'user'
  name: string
  email?: string | null
  contactEmail?: string | null
  companyId?: CompanyId | null
}): Promise<SeededIdentity> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: opts.name,
    email: opts.email ?? null,
    isAnonymous: opts.type === 'anonymous',
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: opts.type,
    displayName: opts.name,
    contactEmail: opts.contactEmail ?? null,
    companyId: opts.companyId ?? null,
    createdAt: new Date(),
  })
  return { userId, principalId }
}

async function seedCompany(name: string): Promise<CompanyId> {
  const id = createId('company') as CompanyId
  await testDb.insert(companies).values({ id, name })
  return id
}

async function seedSession(userId: UserId): Promise<string> {
  const id = `sess-${runSuffix()}`
  await testDb.insert(session).values({
    id,
    token: `tok-${runSuffix()}`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    updatedAt: new Date(),
    userId,
  })
  return id
}

async function seedBoardWithPost(
  author: PrincipalId
): Promise<{ boardId: BoardId; postId: PostId }> {
  const boardId = createId('board') as BoardId
  const postId = createId('post') as PostId
  await testDb.insert(boards).values({
    id: boardId,
    slug: `merge-db-${runSuffix()}`,
    name: 'merge-db fixture board',
  })
  await testDb.insert(posts).values({
    id: postId,
    boardId,
    title: 'Seeded post',
    content: 'Seeded content',
    principalId: author,
  })
  return { boardId, postId }
}

describe.skipIf(!fixture.available)('principal merge (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('mergeAnonymousToIdentified', () => {
    it('moves every seeded activity row to the survivor and deletes the anonymous identity', async () => {
      const companyId = await seedCompany('Acme Inc')
      const anon = await seedIdentity({
        type: 'anonymous',
        name: 'Curious Penguin',
        contactEmail: 'visitor@example.com',
        companyId,
      })
      const target = await seedIdentity({
        type: 'user',
        name: 'Jane Doe',
        email: `jane-${runSuffix()}@example.com`,
      })
      await seedSession(anon.userId)

      // Post + comment authored by the anon principal.
      const { boardId, postId: anonPostId } = await seedBoardWithPost(anon.principalId)
      const commentId = createId('post_comment') as PostCommentId
      await testDb.insert(postComments).values({
        id: commentId,
        postId: anonPostId,
        principalId: anon.principalId,
        content: 'anon comment',
      })

      // Votes: both sides voted on the anon post (collision — the identified
      // vote must win), and the anon side alone voted on a second post.
      const otherPostId = createId('post') as PostId
      await testDb.insert(posts).values({
        id: otherPostId,
        boardId,
        title: 'Other post',
        content: 'Other content',
        principalId: target.principalId,
      })
      await testDb.insert(postVotes).values([
        { postId: anonPostId, principalId: anon.principalId },
        { postId: anonPostId, principalId: target.principalId },
        { postId: otherPostId, principalId: anon.principalId },
      ])

      // NOT-NULL editor FK (ON DELETE SET NULL): without the re-point, the
      // teardown's principal delete would try to null a NOT NULL column.
      await testDb.insert(postEditHistory).values({
        postId: anonPostId,
        editorPrincipalId: anon.principalId,
        previousTitle: 'Before edit',
        previousContent: 'Before content',
      })

      // Conversation owned by the anon visitor, with an authored message and
      // a system message (null author) that must stay untouched.
      const conversationId = createId('conversation') as ConversationId
      await testDb.insert(conversations).values({
        id: conversationId,
        visitorPrincipalId: anon.principalId,
        channel: 'messenger',
      })
      await testDb.insert(conversationMessages).values([
        {
          conversationId,
          principalId: anon.principalId,
          senderType: 'visitor',
          content: 'hello from anon',
        },
        { conversationId, principalId: null, senderType: 'system', content: 'agent joined' },
      ])

      await mergeAnonymousToIdentified({
        anonPrincipalId: anon.principalId,
        targetPrincipalId: target.principalId,
        anonUserId: anon.userId,
        anonDisplayName: 'Curious Penguin',
        targetDisplayName: 'Jane Doe',
      })

      // Content authorship follows the survivor.
      const [postRow] = await testDb.select().from(posts).where(eq(posts.id, anonPostId))
      expect(postRow.principalId).toBe(target.principalId)
      const [commentRow] = await testDb
        .select()
        .from(postComments)
        .where(eq(postComments.id, commentId))
      expect(commentRow.principalId).toBe(target.principalId)

      // Collision post keeps exactly the identified vote; the solo anon vote
      // is re-pointed.
      const collisionVotes = await testDb
        .select()
        .from(postVotes)
        .where(eq(postVotes.postId, anonPostId))
      expect(collisionVotes).toHaveLength(1)
      expect(collisionVotes[0].principalId).toBe(target.principalId)
      const soloVotes = await testDb
        .select()
        .from(postVotes)
        .where(eq(postVotes.postId, otherPostId))
      expect(soloVotes).toHaveLength(1)
      expect(soloVotes[0].principalId).toBe(target.principalId)

      // Edit attribution re-pointed (the NOT-NULL landmine did not fire).
      const [editRow] = await testDb
        .select()
        .from(postEditHistory)
        .where(eq(postEditHistory.postId, anonPostId))
      expect(editRow.editorPrincipalId).toBe(target.principalId)

      // Conversation + authored message follow; the system message stays null.
      const [convRow] = await testDb
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
      expect(convRow.visitorPrincipalId).toBe(target.principalId)
      const messages = await testDb
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversationId))
      expect(messages.find((m) => m.senderType === 'visitor')?.principalId).toBe(target.principalId)
      expect(messages.find((m) => m.senderType === 'system')?.principalId).toBeNull()

      // contact_email + company_id fill-if-empty: the empty target takes the
      // lead's email and company.
      const [targetPrincipal] = await testDb
        .select()
        .from(principal)
        .where(eq(principal.id, target.principalId))
      expect(targetPrincipal.contactEmail).toBe('visitor@example.com')
      expect(targetPrincipal.companyId).toBe(companyId)

      // Anonymous identity fully torn down.
      await expect(
        testDb.select().from(principal).where(eq(principal.id, anon.principalId))
      ).resolves.toHaveLength(0)
      await expect(
        testDb.select().from(user).where(eq(user.id, anon.userId))
      ).resolves.toHaveLength(0)
      await expect(
        testDb.select().from(session).where(eq(session.userId, anon.userId))
      ).resolves.toHaveLength(0)
    })

    it('never overwrites a populated target contact_email and merges a no-activity anon cleanly', async () => {
      const anonCompany = await seedCompany('Lead Co')
      const targetCompany = await seedCompany('Existing Co')
      const anon = await seedIdentity({
        type: 'anonymous',
        name: 'Curious Penguin',
        contactEmail: 'lead@example.com',
        companyId: anonCompany,
      })
      const target = await seedIdentity({
        type: 'user',
        name: 'Jane Doe',
        contactEmail: 'existing@example.com',
        companyId: targetCompany,
      })

      await mergeAnonymousToIdentified({
        anonPrincipalId: anon.principalId,
        targetPrincipalId: target.principalId,
        anonUserId: anon.userId,
        anonDisplayName: 'Curious Penguin',
        targetDisplayName: 'Jane Doe',
      })

      const [targetPrincipal] = await testDb
        .select()
        .from(principal)
        .where(eq(principal.id, target.principalId))
      expect(targetPrincipal.contactEmail).toBe('existing@example.com')
      // A populated target company is never overwritten by the source.
      expect(targetPrincipal.companyId).toBe(targetCompany)
      await expect(
        testDb.select().from(principal).where(eq(principal.id, anon.principalId))
      ).resolves.toHaveLength(0)
      await expect(
        testDb.select().from(user).where(eq(user.id, anon.userId))
      ).resolves.toHaveLength(0)
    })
  })

  describe('absorbSignupIntoAnonymous', () => {
    it('absorbs a fresh signup: auth rows re-parent, activity follows, identity is stamped', async () => {
      const email = `jane-${runSuffix()}@example.com`
      const anon = await seedIdentity({ type: 'anonymous', name: 'Curious Penguin' })
      const fresh = await seedIdentity({ type: 'user', name: 'Jane Doe', email })

      // Auth rows on the throwaway signup user; they must survive on the anon
      // user, which proves the re-parent runs before the CASCADE delete.
      const sessionId = await seedSession(fresh.userId)
      const accountId = createId('account')
      await testDb.insert(account).values({
        id: accountId,
        accountId: `ext-${runSuffix()}`,
        providerId: 'credential',
        userId: fresh.userId,
      })

      // Any activity the signup principal acquired follows the survivor via
      // the shared registry.
      const { postId } = await seedBoardWithPost(anon.principalId)
      await testDb.insert(postVotes).values({ postId, principalId: fresh.principalId })

      // Stamping the signup's own email onto the anon user only works if the
      // signup identity is deleted first (partial unique index on user.email).
      const { cacheKeysToBust } = await absorbSignupIntoAnonymous({
        anonUserId: anon.userId,
        anonPrincipalId: anon.principalId,
        newUserId: fresh.userId,
        newUserPrincipalId: fresh.principalId,
        name: 'Jane Doe',
        email,
        image: null,
        displayName: 'Jane Doe',
      })

      const [sessionRow] = await testDb.select().from(session).where(eq(session.id, sessionId))
      expect(sessionRow.userId).toBe(anon.userId)
      const [accountRow] = await testDb.select().from(account).where(eq(account.id, accountId))
      expect(accountRow.userId).toBe(anon.userId)

      const [voteRow] = await testDb.select().from(postVotes).where(eq(postVotes.postId, postId))
      expect(voteRow.principalId).toBe(anon.principalId)

      await expect(
        testDb.select().from(user).where(eq(user.id, fresh.userId))
      ).resolves.toHaveLength(0)
      await expect(
        testDb.select().from(principal).where(eq(principal.id, fresh.principalId))
      ).resolves.toHaveLength(0)

      const [survivor] = await testDb.select().from(user).where(eq(user.id, anon.userId))
      expect(survivor).toMatchObject({
        name: 'Jane Doe',
        email,
        emailVerified: true,
        isAnonymous: false,
      })
      const [survivorPrincipal] = await testDb
        .select()
        .from(principal)
        .where(eq(principal.id, anon.principalId))
      expect(survivorPrincipal).toMatchObject({ type: 'user', displayName: 'Jane Doe' })

      expect(cacheKeysToBust).toEqual([`principal:user:${anon.userId}`])
    })
  })
})
