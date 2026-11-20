/**
 * Real-Postgres coverage for whose name feedback written through an API key
 * shows on the public board.
 *
 * A post or comment a workspace key wrote, or a personal key that keeps its own
 * name (made before the cutoff), shows the support team's name on every
 * customer-facing feedback surface: the post page (post, comments, replies,
 * pinned comment), the board lists, and the emails and bells that link to
 * them. The team's own views keep the key's name. A personal key made after
 * the cutoff shows its creator, as it does in support threads.
 *
 * Keys come from createApiKey; the reads are the real portal loaders.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type PostCommentId,
  type PostId,
  type PrincipalId,
  type RoleId,
  type UserId,
} from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/config')>()),
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheDel: vi.fn(),
}))

vi.mock('@/lib/server/domains/teams', () => ({
  addPrincipalToDefaultTeam: vi.fn(),
}))

vi.mock('@/lib/server/domains/principals/membership-sync', () => ({
  enqueueMembershipSync: vi.fn(async () => {}),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  postComments,
  postSubscriptions,
  posts,
  principal,
  roles,
  settings,
  sql,
  user,
} from '@/lib/server/db'
import { ALL_PERMISSIONS, SYSTEM_ROLES } from '@/lib/shared/permissions'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'
import { createApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import {
  getSupportTeamName,
  PERSONAL_KEY_CUTOFF_KV_KEY,
} from '@/lib/server/domains/principals/principal-display'
import { getPublicPostDetail } from '../post.public.detail'
import { listPublicPosts, listPublicPostsWithVotesAndAvatars } from '../post.public'
import { getCommentsWithReplies, getPostWithDetails } from '../post.query'
import { getMentionTargets, getSubscriberTargets } from '@/lib/server/events/targets'
import type { CommentCreatedEvent, PostMentionedEvent } from '@/lib/server/events/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: postComments.id }).from(postComments).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const KEY_NAME = 'feedback-bot'
const PUBLIC_NAME = 'Pat from Support'
const CREATOR_IMAGE = 'https://images.example.com/pat.png'
const CONTEXT = { workspaceName: 'Acme', portalBaseUrl: 'http://localhost:3100', logoUrl: null }

async function setCutoff(at: Date | null): Promise<void> {
  await testDb.execute(sql`delete from kv_store where key = ${PERSONAL_KEY_CUTOFF_KV_KEY}`)
  if (!at) return
  await testDb.execute(sql`insert into kv_store (workspace_key, key, value, expires_at)
    values ('_', ${PERSONAL_KEY_CUTOFF_KV_KEY}, to_jsonb(${at.toISOString()}::timestamptz),
      now() + interval '100 years')`)
}

const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000)
const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000)

async function seedCreator(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({
    id: userId,
    name: 'Patricia Account',
    image: CREATOR_IMAGE,
    email: `feedback-key-${suffix()}@example.com`,
  })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'admin',
    type: 'user',
    displayName: PUBLIC_NAME,
    createdAt: new Date(),
  })
  return principalId
}

/** A portal customer subscribed to nothing yet, with a deliverable address. */
async function seedCustomer(name: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name, email: `customer-${suffix()}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: name,
    createdAt: new Date(),
  })
  return principalId
}

async function managerRoleId(): Promise<RoleId> {
  const [row] = await testDb
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, SYSTEM_ROLES.MANAGER))
  return row.id as RoleId
}

async function workspaceKey(creator: PrincipalId): Promise<PrincipalId> {
  const { apiKey } = await createApiKey(
    { name: KEY_NAME, kind: 'workspace', roleId: await managerRoleId() },
    creator,
    { permissions: ALL_PERMISSIONS, role: 'admin' }
  )
  return apiKey.principalId
}

async function personalKey(creator: PrincipalId): Promise<PrincipalId> {
  const { apiKey } = await createApiKey({ name: KEY_NAME }, creator)
  return apiKey.principalId
}

/**
 * A public post the key wrote, with a root comment and a reply by the key
 * (the root pinned), and a customer's comment beside them.
 */
async function seedFeedback(keyPrincipal: PrincipalId) {
  const customer = await seedCustomer('Casey Customer')
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `ideas-${suffix()}`, name: 'Ideas', access: DEFAULT_BOARD_ACCESS })
    .returning()
  const [postRow] = await testDb
    .insert(posts)
    .values({
      boardId: board.id,
      title: 'Posted through a key',
      content: 'Imported idea',
      principalId: keyPrincipal,
    })
    .returning()
  const now = Date.now()
  const [root] = await testDb
    .insert(postComments)
    .values({
      postId: postRow.id,
      principalId: keyPrincipal,
      content: 'Root from the key',
      isTeamMember: true,
      createdAt: new Date(now - 3000),
    })
    .returning()
  await testDb.insert(postComments).values([
    {
      postId: postRow.id,
      parentId: root.id,
      principalId: keyPrincipal,
      content: 'Reply from the key',
      isTeamMember: true,
      createdAt: new Date(now - 2000),
    },
    {
      postId: postRow.id,
      principalId: customer,
      content: 'From a customer',
      createdAt: new Date(now - 1000),
    },
  ])
  await testDb.update(posts).set({ pinnedCommentId: root.id }).where(eq(posts.id, postRow.id))
  return { postId: postRow.id as PostId, rootId: root.id as PostCommentId, board, customer }
}

type Shown = { name: string | null; avatar: string | null }

/** Every customer-facing name the key's feedback shows, from the real loaders. */
async function customerFacing(keyPrincipal: PrincipalId) {
  const seeded = await seedFeedback(keyPrincipal)
  const detail = await getPublicPostDetail(seeded.postId, ANONYMOUS_ACTOR)
  expect(detail).not.toBeNull()
  const root = detail!.comments.find((c) => c.content === 'Root from the key')!
  const reply = root.replies.find((c) => c.content === 'Reply from the key')!
  const customerComment = detail!.comments.find((c) => c.content === 'From a customer')!
  const feed = await listPublicPostsWithVotesAndAvatars({
    boardSlug: seeded.board.slug,
    actor: ANONYMOUS_ACTOR,
    page: 1,
    limit: 20,
  })
  const list = await listPublicPosts({
    boardSlug: seeded.board.slug,
    actor: ANONYMOUS_ACTOR,
    page: 1,
    limit: 20,
  })
  const feedItem = feed.items.find((p) => p.id === seeded.postId)!
  const listItem = list.items.find((p) => p.id === seeded.postId)!

  // Subscriber email and bell for the key's comment, as the outbox relays it:
  // the event carries the key's own name (integrators keep it).
  await testDb
    .insert(postSubscriptions)
    .values({ postId: seeded.postId, principalId: seeded.customer, reason: 'manual' })
  const commented: CommentCreatedEvent = {
    id: createId('event'),
    type: 'comment.created',
    timestamp: new Date().toISOString(),
    actor: { type: 'service', principalId: keyPrincipal, displayName: 'api' },
    data: {
      post: {
        id: seeded.postId,
        title: 'Posted through a key',
        boardId: seeded.board.id,
        boardSlug: seeded.board.slug,
      },
      comment: { id: seeded.rootId, content: 'Root from the key', authorName: KEY_NAME },
    },
  }
  const targets = await getSubscriberTargets(commented, CONTEXT)
  const email = targets.find((t) => t.type === 'email')
  const bell = targets.find((t) => t.type === 'notification')
  expect(email).toBeDefined()
  expect(bell).toBeDefined()

  const mentioned: PostMentionedEvent = {
    id: createId('event'),
    type: 'post.mentioned',
    timestamp: new Date().toISOString(),
    actor: { type: 'service', principalId: keyPrincipal, displayName: 'api' },
    data: {
      postId: seeded.postId,
      postTitle: 'Posted through a key',
      postUrl: `http://localhost:3100/b/${seeded.board.slug}/posts/${seeded.postId}`,
      mentionedPrincipalId: seeded.customer,
      mentioningPrincipalId: keyPrincipal,
      excerpt: 'Hello',
    },
  }
  const mentionTargets = await getMentionTargets(mentioned, CONTEXT)
  const mentionEmail = mentionTargets.find((t) => t.type === 'email')
  const mentionBell = mentionTargets.find((t) => t.type === 'notification')
  expect(mentionEmail).toBeDefined()
  expect(mentionBell).toBeDefined()

  const shown = (name: string | null | undefined, avatar: string | null | undefined): Shown => ({
    name: name ?? null,
    avatar: avatar ?? null,
  })
  return {
    seeded,
    post: shown(detail!.authorName, detail!.authorAvatarUrl),
    comment: shown(root.authorName, root.avatarUrl),
    reply: shown(reply.authorName, reply.avatarUrl),
    pinned: shown(detail!.pinnedComment?.authorName, detail!.pinnedComment?.avatarUrl),
    feed: shown(feedItem.authorName, feedItem.avatarUrl),
    list: listItem.authorName,
    customerComment: customerComment.authorName,
    emailName: email!.config.commenterName,
    bellName: bell!.config.commenterName,
    mentionEmailName: mentionEmail!.config.mentionerName,
    mentionBellName: mentionBell!.config.mentionerName,
  }
}

async function seedWorkspace(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme_${suffix()}`, createdAt: new Date() })
}

async function teamName(): Promise<string> {
  const name = await getSupportTeamName()
  expect(name).toBeTruthy()
  expect(name).not.toBe(KEY_NAME)
  return name!
}

function expectEverywhere(
  views: Awaited<ReturnType<typeof customerFacing>>,
  name: string,
  avatar: string | null
) {
  const both = { name, avatar }
  expect(views.post).toEqual(both)
  expect(views.comment).toEqual(both)
  expect(views.reply).toEqual(both)
  expect(views.pinned).toEqual(both)
  expect(views.feed).toEqual(both)
  expect(views.list).toBe(name)
  expect(views.emailName).toBe(name)
  expect(views.bellName).toBe(name)
  expect(views.mentionEmailName).toBe(name)
  expect(views.mentionBellName).toBe(name)
  // Everyone else keeps their own name.
  expect(views.customerComment).toBe('Casey Customer')
}

if (fixture.available) {
  beforeEach(async () => {
    await fixture.begin()
    await seedWorkspace()
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('feedback written through an API key', () => {
  it('a workspace key shows as the support team on the public board and in its emails', async () => {
    await setCutoff(anHourAgo())
    const creator = await seedCreator()
    const key = await workspaceKey(creator)
    const views = await customerFacing(key)
    expectEverywhere(views, await teamName(), null)

    // The team's own views keep the key's name.
    const admin = await getPostWithDetails(views.seeded.postId)
    expect(admin.authorName).toBe(KEY_NAME)
    const adminComments = await getCommentsWithReplies(views.seeded.postId)
    expect(adminComments.find((c) => c.content === 'Root from the key')?.authorName).toBe(KEY_NAME)
  })

  it('a personal key made before the cutoff shows as the support team', async () => {
    await setCutoff(inAnHour())
    const creator = await seedCreator()
    const views = await customerFacing(await personalKey(creator))
    expectEverywhere(views, await teamName(), null)
  })

  it('a personal key made after the cutoff shows its creator', async () => {
    await setCutoff(anHourAgo())
    const creator = await seedCreator()
    const views = await customerFacing(await personalKey(creator))
    expectEverywhere(views, PUBLIC_NAME, CREATOR_IMAGE)
  })
})
